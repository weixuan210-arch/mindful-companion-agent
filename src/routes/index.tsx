import { useChat } from "@ai-sdk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import billy from "@/assets/billy.png";
import {
  AnimatedBilly,
  expressionFromText,
  moodExpression,
  type BillyExpression,
} from "@/components/billy/AnimatedBilly";
import { DailyCheckIn } from "@/components/billy/DailyCheckIn";
import { CalendarCard } from "@/components/billy/CalendarCard";
import { DriveCard } from "@/components/billy/DriveCard";

import { MoodCard } from "@/components/billy/MoodCard";
import { NudgeCard } from "@/components/billy/NudgeCard";
import { SidebarBilly } from "@/components/billy/SidebarBilly";
import { TaskList } from "@/components/billy/TaskList";
import { VaultCard } from "@/components/billy/VaultCard";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { FileText, Mic, Paperclip, Square, Volume2, VolumeX, X } from "lucide-react";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { computeMood, computeNudge, computeSignals, type TaskLike } from "@/lib/mood";
import { recordWav, streamSpeech, transcribeRecording, type Recorder } from "@/lib/voice";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Billy — a cozy companion for your thoughts" },
      {
        name: "description",
        content:
          "Talk to Billy, save your thoughts safely, keep track of tasks, and get gentle nudges only when a pattern is real.",
      },
      { property: "og:title", content: "Billy — a cozy companion for your thoughts" },
      {
        property: "og:description",
        content:
          "A warm place to think out loud. Billy remembers what matters and notices what you've been avoiding.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const CHECK_IN_KEY = (userId: string) => `billy-checkin-${userId}`;

type Task = TaskLike & { details: string | null; project_id: string | null };

const TOOL_TITLES: Record<string, string> = {
  "tool-save_thought": "Keeping that",
  "tool-recall_thoughts": "Looking back",
  "tool-create_task": "Adding to your list",
  "tool-complete_task": "Ticking that off",
  "tool-list_tasks": "Checking your list",
  "tool-list_projects": "Looking at your projects",
  "tool-create_project": "Starting a project",
  "tool-assign_task_project": "Filing that away",
  "tool-list_calendar_events": "Checking your calendar",
  "tool-create_calendar_event": "Putting that on your calendar",
};



// Billy's quiet acknowledgment when a task is ticked off — honest, never gushing.
const DONE_LINES = [
  "That's done. One less thing carrying weight.",
  "Off the list — and off your mind.",
  "Good. Notice how that feels for a moment.",
  "That one's closed. The list is a little lighter.",
];

// Small preview strip for files about to be sent, and the paperclip button.
// Both must live inside <PromptInput> to reach its attachment state.
function AttachmentChips() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {attachments.files.map((file) => (
        <div
          key={file.id}
          className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1 text-xs"
        >
          {file.mediaType?.startsWith("image/") ? (
            <img src={file.url} alt="" className="h-8 w-8 rounded object-cover" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="max-w-40 truncate">{file.filename}</span>
          <button
            type="button"
            aria-label={`Remove ${file.filename ?? "attachment"}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => attachments.remove(file.id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

function AttachButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      type="button"
      aria-label="Attach an image or PDF"
      title="Attach an image or PDF"
      onClick={() => attachments.openFileDialog()}
    >
      <Paperclip className="h-4 w-4" />
    </PromptInputButton>
  );
}

function Index() {
  const { session, loading } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Shimmer>Waking Billy up...</Shimmer>
      </main>
    );
  }

  return <Companion userId={session.user.id} />;
}

function Companion({ userId }: { userId: string }) {
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, nudge_threshold_days")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, details, due_at, status, created_at, completed_at, project_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const projectsQuery = useQuery({
    queryKey: ["projects", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, description")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const historyQuery = useQuery({
    queryKey: ["messages", userId],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, parts, sdk_message_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(400);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.sdk_message_id ?? row.id,
        role: row.role as UIMessage["role"],
        parts: (row.parts ?? []) as UIMessage["parts"],
      })) satisfies UIMessage[];
    },
    staleTime: Infinity,
  });

  const threshold = profileQuery.data?.nudge_threshold_days ?? 5;
  const tasks = tasksQuery.data ?? [];
  const signals = useMemo(() => computeSignals(tasks, threshold), [tasks, threshold]);
  const mood = useMemo(() => computeMood(signals), [signals]);
  const nudge = useMemo(() => computeNudge(signals, threshold), [signals, threshold]);
  const [companionState, setCompanionState] = useState<{
    expression: BillyExpression;
    thinking: boolean;
    cue?: string;
  }>({ expression: moodExpression(mood.key), thinking: false });

  const toggleTask = useCallback(
    async (task: Task, done: boolean) => {
      const { error } = await supabase
        .from("tasks")
        .update({
          status: done ? "done" : "open",
          completed_at: done ? new Date().toISOString() : null,
        })
        .eq("id", task.id);
      if (error) {
        toast.error("Couldn't update that just now.");
        return;
      }
      if (done) {
        toast(DONE_LINES[Math.floor(Math.random() * DONE_LINES.length)]!, {
          description: `“${task.title}” is off your mind.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["tasks", userId] });
    },
    [queryClient, userId],
  );

  const onTurnFinished = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["tasks", userId] });
    queryClient.invalidateQueries({ queryKey: ["projects", userId] });
  }, [queryClient, userId]);


  const [checkedIn, setCheckedIn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(CHECK_IN_KEY(userId)) === new Date().toDateString();
  });

  const startDay = useCallback(() => {
    window.localStorage.setItem(CHECK_IN_KEY(userId), new Date().toDateString());
    setCheckedIn(true);
  }, [userId]);

  if (historyQuery.isLoading || tasksQuery.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Shimmer>Remembering where we left off...</Shimmer>
      </main>
    );
  }

  if (!checkedIn) {
    return (
      <DailyCheckIn
        displayName={profileQuery.data?.display_name ?? null}
        tasks={tasks}
        signals={signals}
        mood={mood}
        onStart={startDay}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 lg:px-8 lg:py-10">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={billy} alt="Billy" width={816} height={816} className="h-10 w-10" />
          <div>
            <h1 className="text-2xl leading-none">Billy</h1>
            <p className="text-xs text-muted-foreground">
              {profileQuery.data?.display_name
                ? `here with you, ${profileQuery.data.display_name}`
                : "here with you"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/calendar">Calendar</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/patterns">Patterns</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <ChatPanel
          initialMessages={historyQuery.data ?? []}
          onTurnFinished={onTurnFinished}
          nudge={nudge}
          moodKey={mood.key}
          onCompanionChange={setCompanionState}
        />

        <aside className="flex flex-col gap-5">
          <MoodCard mood={mood} signals={signals} threshold={threshold} />
          <TaskList
            tasks={tasks}
            projects={projectsQuery.data ?? []}
            threshold={threshold}
            onToggle={toggleTask}
          />
          <DriveCard userId={userId} />
          <CalendarCard userId={userId} />
          <VaultCard userId={userId} />

          <SidebarBilly
            expression={companionState.expression}
            thinking={companionState.thinking}
            moodLabel={mood.label}
            {...(companionState.cue ? { cue: companionState.cue } : {})}
          />
        </aside>
      </div>
    </main>
  );
}

function ChatPanel({
  initialMessages,
  onTurnFinished,
  nudge,
  moodKey,
  onCompanionChange,
}: {
  initialMessages: UIMessage[];
  onTurnFinished: () => void;
  nudge: ReturnType<typeof computeNudge>;
  moodKey: ReturnType<typeof computeMood>["key"];
  onCompanionChange: (state: {
    expression: BillyExpression;
    thinking: boolean;
    cue?: string;
  }) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (input, init) => {
          const { data } = await supabase.auth.getSession();
          const headers = new Headers(init?.headers);
          if (data.session?.access_token) {
            headers.set("Authorization", `Bearer ${data.session.access_token}`);
          }
          headers.set("x-user-timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
          return fetch(input, { ...init, headers });
        },
      }),
    [],
  );

  const [voiceOn, setVoiceOn] = useState<boolean>(
    () => typeof window !== "undefined" && window.localStorage.getItem("billy-voice-on") === "1",
  );
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const lastFromVoiceRef = useRef(false);

  const speakMessage = useCallback(
    async (id: string, text: string) => {
      if (speakingId === id) {
        speakAbortRef.current?.abort();
        return;
      }
      speakAbortRef.current?.abort();
      if (!text.trim()) return;
      const controller = new AbortController();
      speakAbortRef.current = controller;
      setSpeakingId(id);
      try {
        await streamSpeech(text.replace(/[#*_`>]/g, ""), controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          toast.error(error instanceof Error ? error.message : "Billy lost his voice. Try again?");
        }
      } finally {
        if (speakAbortRef.current === controller) {
          speakAbortRef.current = null;
          setSpeakingId(null);
        }
      }
    },
    [speakingId],
  );

  const toggleVoice = useCallback(() => {
    setVoiceOn((on) => {
      const next = !on;
      window.localStorage.setItem("billy-voice-on", next ? "1" : "0");
      if (!next) speakAbortRef.current?.abort();
      return next;
    });
  }, []);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      setIsRecording(false);
      if (!recorder) return;
      setIsTranscribing(true);
      try {
        const file = await recorder.stop();
        const text = await transcribeRecording(file);
        lastFromVoiceRef.current = true;
        sendMessage({ text });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Billy couldn't hear that.");
      } finally {
        setIsTranscribing(false);
      }
      return;
    }
    speakAbortRef.current?.abort();
    try {
      recorderRef.current = await recordWav();
      setIsRecording(true);
    } catch {
      toast.error("Billy needs microphone access — allow it in your browser and try again.");
    }
  }, [isRecording, sendMessage]);

  const { messages, sendMessage, status, stop, error } = useChat({
    id: "billy",
    messages: initialMessages,
    transport,
    onFinish: ({ message }) => {
      onTurnFinished();
      const shouldSpeak = voiceOn || lastFromVoiceRef.current;
      lastFromVoiceRef.current = false;
      if (!shouldSpeak || message.role !== "assistant") return;
      const text = message.parts
        .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join(" ");
      void speakMessage(message.id, text);
    },
    onError: (chatError) => {
      console.error(chatError);
      toast.error("Billy couldn't answer just now. Give it another go in a moment.");
    },
  });

  const isBusy = status === "submitted" || status === "streaming";
  const baselineExpression = moodExpression(moodKey);
  const latestAssistantIndex = messages.reduce(
    (latest, message, index) => (message.role === "assistant" ? index : latest),
    -1,
  );
  const latestAssistantText =
    latestAssistantIndex >= 0
      ? messages[latestAssistantIndex]?.parts
          .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
          .map((part) => part.text)
          .join(" ") ?? ""
      : "";
  const activeExpression = expressionFromText(latestAssistantText, baselineExpression);
  const companionCue = latestAssistantText
    .replace(/[#*_`>]/g, "")
    .split(/(?<=[.!?])\s/)[0]
    ?.slice(0, 110);

  useEffect(() => {
    if (isBusy) {
      onCompanionChange({ expression: "thoughtful", thinking: true });
      return;
    }
    onCompanionChange({
      expression: activeExpression,
      thinking: false,
      ...(companionCue ? { cue: companionCue } : {}),
    });
  }, [activeExpression, companionCue, isBusy, onCompanionChange]);

  useEffect(() => {
    if (!isBusy) textareaRef.current?.focus();
  }, [isBusy]);

  const send = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      sendMessage({ text: text.trim() });
    },
    [sendMessage],
  );

  return (
    <div className="paper-card flex h-[calc(100dvh-11rem)] min-h-[32rem] flex-col overflow-hidden">
      {nudge && (
        <div className="border-b border-border p-4">
          <NudgeCard
            nudge={nudge}
            onTalk={() => send(`Can we talk about this: ${nudge.headline} — ${nudge.body}`)}
          />
        </div>
      )}

      <Conversation className="flex-1">
        <ConversationContent className="gap-5">
          {messages.length === 0 && (
            <ConversationEmptyState
              icon={
                <img src={billy} alt="" width={816} height={816} className="h-20 w-20" loading="lazy" />
              }
              title="What's on your mind?"
              description="Think out loud. I'll keep what matters and remember your to-dos."
            />
          )}

          {messages.map((message, messageIndex) => {
            const assistantText = message.parts
              .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
              .map((part) => part.text)
              .join(" ");
            const expression = expressionFromText(assistantText, baselineExpression);
            const showBilly = message.role === "assistant" && messageIndex === latestAssistantIndex;

            return (
              <Message from={message.role} key={`${message.id}-${messageIndex}`}>
                <div className={showBilly ? "flex items-start gap-3" : undefined}>
                  {showBilly && <AnimatedBilly expression={expression} />}
                  <MessageContent
                    className={
                      message.role === "assistant"
                        ? "min-w-0 flex-1 bg-transparent p-0 text-foreground"
                        : "bg-chat-user text-chat-user-foreground"
                    }
                  >
                {message.parts.map((part, index) => {
                  if (part.type === "text") {
                    return <MessageResponse key={index}>{part.text}</MessageResponse>;
                  }
                  if (part.type === "reasoning" && part.text) {
                    return (
                      <p key={index} className="text-xs italic text-muted-foreground">
                        {part.text}
                      </p>
                    );
                  }
                  if (part.type === "file") {
                    const filePart = part as {
                      mediaType?: string;
                      filename?: string;
                      url?: string;
                    };
                    if (filePart.mediaType?.startsWith("image/") && filePart.url?.startsWith("data:")) {
                      return (
                        <img
                          key={index}
                          src={filePart.url}
                          alt={filePart.filename ?? "Shared image"}
                          className="max-h-52 rounded-lg"
                        />
                      );
                    }
                    return (
                      <span
                        key={index}
                        className="inline-flex items-center gap-1.5 rounded-md bg-background/20 px-2 py-1 text-xs"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {filePart.filename ?? "Attachment"}
                      </span>
                    );
                  }
                  if (part.type.startsWith("tool-")) {
                    const toolPart = part as {
                      type: `tool-${string}`;
                      state: "input-streaming" | "input-available" | "output-available" | "output-error";
                      input?: unknown;
                      output?: unknown;
                      errorText?: string;
                    };
                    return (
                      <Tool key={index} defaultOpen={false}>
                        <ToolHeader
                          type={toolPart.type}
                          state={toolPart.state}
                          title={TOOL_TITLES[toolPart.type] ?? "Working"}
                        />
                        <ToolContent>
                          <ToolInput input={toolPart.input} />
                          <ToolOutput
                            output={toolPart.output}
                            errorText={toolPart.errorText ?? undefined}
                          />
                        </ToolContent>
                      </Tool>
                    );
                  }
                  return null;
                })}
                  </MessageContent>
                </div>
              </Message>
            );
          })}

          {status === "submitted" && (
            <div className="flex items-center gap-3">
              <AnimatedBilly expression="thoughtful" size="thinking" thinking />
              <Shimmer>Billy is thinking...</Shimmer>
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive">
              That didn't send. Your words are still in the box — try again.
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border p-4">
        <PromptInput
          accept="image/*,application/pdf"
          multiple
          maxFiles={5}
          maxFileSize={15 * 1024 * 1024}
          onError={(err) => toast.error(err.message)}
          onSubmit={(payload, event) => {
            event.preventDefault();
            const text = payload.text?.trim() ?? "";
            const files = payload.files ?? [];
            if (!text && files.length === 0) return;
            sendMessage({ text, files });
          }}
        >
          <AttachmentChips />
          <PromptInputTextarea
            ref={textareaRef}
            autoFocus
            placeholder="Tell Billy anything — a thought, a worry, something you need to do..."
          />
          <PromptInputFooter className="justify-between">
            <AttachButton />
            <PromptInputSubmit status={status} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
