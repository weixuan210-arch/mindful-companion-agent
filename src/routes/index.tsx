import { useChat } from "@ai-sdk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import billy from "@/assets/billy.png";
import { DriveCard } from "@/components/billy/DriveCard";
import { MoodCard } from "@/components/billy/MoodCard";
import { NudgeCard } from "@/components/billy/NudgeCard";
import { TaskList } from "@/components/billy/TaskList";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
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

type Task = TaskLike & { details: string | null };

const TOOL_TITLES: Record<string, string> = {
  "tool-save_thought": "Keeping that",
  "tool-recall_thoughts": "Looking back",
  "tool-create_task": "Adding to your list",
  "tool-complete_task": "Ticking that off",
  "tool-list_tasks": "Checking your list",
};

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
        .select("id, title, details, due_at, status, created_at, completed_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Task[];
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
      queryClient.invalidateQueries({ queryKey: ["tasks", userId] });
    },
    [queryClient, userId],
  );

  const onTurnFinished = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["tasks", userId] });
  }, [queryClient, userId]);

  if (historyQuery.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Shimmer>Remembering where we left off...</Shimmer>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-10">
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
        <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
          Sign out
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <ChatPanel
          initialMessages={historyQuery.data ?? []}
          onTurnFinished={onTurnFinished}
          nudge={nudge}
        />

        <aside className="flex flex-col gap-5">
          <MoodCard mood={mood} signals={signals} threshold={threshold} />
          <TaskList tasks={tasks} threshold={threshold} onToggle={toggleTask} />
          <DriveCard userId={userId} />
        </aside>
      </div>
    </main>
  );
}

function ChatPanel({
  initialMessages,
  onTurnFinished,
  nudge,
}: {
  initialMessages: UIMessage[];
  onTurnFinished: () => void;
  nudge: ReturnType<typeof computeNudge>;
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

  const { messages, sendMessage, status, stop, error } = useChat({
    id: "billy",
    messages: initialMessages,
    transport,
    onFinish: onTurnFinished,
    onError: (chatError) => {
      console.error(chatError);
      toast.error("Billy couldn't answer just now. Give it another go in a moment.");
    },
  });

  const isBusy = status === "submitted" || status === "streaming";

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

          {messages.map((message) => (
            <Message from={message.role} key={message.id}>
              <MessageContent
                className={
                  message.role === "assistant"
                    ? "bg-transparent p-0 text-foreground"
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
            </Message>
          ))}

          {status === "submitted" && <Shimmer>Billy is thinking...</Shimmer>}
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
          onSubmit={(payload, event) => {
            event.preventDefault();
            send(payload.text ?? "");
          }}
        >
          <PromptInputTextarea
            ref={textareaRef}
            autoFocus
            placeholder="Tell Billy anything — a thought, a worry, something you need to do..."
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
