import { createOpenAI } from "@ai-sdk/openai";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json()) as { messages?: unknown };
        if (!Array.isArray(body.messages)) {
          return new Response("Messages are required", { status: 400 });
        }
        const messages = body.messages as UIMessage[];

        // Local mode: set LOCAL_AI_BASE_URL (e.g. http://127.0.0.1:11434/v1) in .env to
        // run Billy's brain on a local model (Ollama/Qwen) instead of Lovable AI.
        const localBaseURL = process.env["LOCAL_AI_BASE_URL"];
        const localModel = process.env["LOCAL_AI_MODEL"] ?? "qwen2.5:3b";
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!localBaseURL && !apiKey) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }

        const {
          createCompanionContext,
          buildSnapshot,
          buildSystemPrompt,
          saveConversationTurn,
        } = await import("@/lib/companion.server");
        const {
          createLovableAiGatewayRunIdFetch,
          getLovableAiGatewayRunId,
          withLovableAiGatewayRunIdHeader,
        } = await import("@/lib/ai-gateway.server");

        const ctx = await createCompanionContext(token);
        if (!ctx) return new Response("Unauthorized", { status: 401 });

        // The browser tells us the user's IANA timezone so dates mean their local day.
        const rawTz = request.headers.get("x-user-timezone") ?? "UTC";
        let timeZone = "UTC";
        try {
          new Intl.DateTimeFormat("en", { timeZone: rawTz });
          timeZone = rawTz;
        } catch {
          // invalid zone string — fall back to UTC
        }

        const snapshot = await buildSnapshot(ctx);

        // File parts arrive as data URLs. Never store those megabytes in the
        // messages table — keep the filename as a marker instead.
        const stripFileData = (parts: unknown[]) =>
          parts.map((p) => {
            const part = p as { type?: string; url?: string };
            return part?.type === "file" && part.url?.startsWith("data:")
              ? { ...(p as object), url: "" }
              : p;
          });

        // The model needs the real file data; stale markers from earlier turns
        // become a plain text note so context stays truthful.
        const messagesForModel = messages.map((m) => ({
          ...m,
          parts: (m.parts ?? []).map((p) => {
            const part = p as { type?: string; url?: string; filename?: string; mediaType?: string };
            if (part?.type !== "file") return p;
            if (part.url?.startsWith("data:") || part.url?.startsWith("http")) return p;
            return {
              type: "text" as const,
              text: `[They shared a file earlier: ${part.filename ?? "attachment"}]`,
            };
          }),
        }));

        // Persist the incoming user turn.
        const lastMessage = messages[messages.length - 1];
        let filesSavedToDrive = 0;
        let attachedCount = 0;
        if (lastMessage?.role === "user") {
          await saveConversationTurn(ctx, [
            {
              role: "user",
              parts: stripFileData(lastMessage.parts ?? []),
              sdk_message_id: lastMessage.id ?? null,
            },
          ]);

          // Keep attachments alongside their thoughts and tasks in their Drive folder.
          const attachments = (lastMessage.parts ?? []).filter((p) => {
            const part = p as { type?: string; url?: string };
            return part?.type === "file" && !!part.url?.startsWith("data:");
          }) as { url: string; filename?: string; mediaType?: string }[];
          attachedCount = attachments.length;

          const { mirrorFileToDrive } = await import("@/lib/drive.server");
          const results = await Promise.all(
            attachments.map((a) =>
              mirrorFileToDrive(ctx, a.filename ?? "attachment", a.mediaType ?? "", a.url),
            ),
          );
          filesSavedToDrive = results.filter(Boolean).length;
        }

        // Today's calendar, so Billy can talk about the day without being asked.
        const { getCalendarConnection } = await import("@/lib/calendarConnection.server");
        const calendarConnection = await getCalendarConnection(ctx.userId);
        let calendarNote = "";
        if (calendarConnection) {
          const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
          const { listCalendarEvents } = await import("@/lib/calendar.server");
          const from = new Date(`${dayKey}T00:00:00`);
          const events = await listCalendarEvents(
            calendarConnection.connectionKey,
            new Date(from.getTime() - from.getTimezoneOffset() * 60000).toISOString(),
            new Date(from.getTime() + 48 * 3600 * 1000).toISOString(),
            50,
          );
          if (events.ok) {
            const lines = events.data.map((event) => {
              const when = event.start
                ? event.allDay
                  ? event.start
                  : new Intl.DateTimeFormat("en-GB", {
                      timeZone,
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(event.start))
                : "sometime";
              return `- ${when}: ${event.title}${event.location ? ` (${event.location})` : ""}`;
            });
            calendarNote = `\n\nCALENDAR (their Google Calendar is connected; next 48 hours, ${timeZone}):\n${
              lines.length > 0 ? lines.join("\n") : "- nothing on the calendar"
            }\nUse this when they ask about their day or plan. You can add events with create_calendar_event, and look further ahead with list_calendar_events. Never invent events.`;
          }
        } else {
          calendarNote =
            "\n\nCALENDAR: their Google Calendar is not connected, so you cannot see or add events. If it would help, mention they can connect it from the sidebar.";
        }

        const initialRunId = getLovableAiGatewayRunId(request);

        const runIdFetch = createLovableAiGatewayRunIdFetch(initialRunId);
        const lovable = createOpenAI({
          baseURL: localBaseURL ?? "https://ai.gateway.lovable.dev/v1",
          apiKey: localBaseURL ? "local" : apiKey!,
          ...(localBaseURL
            ? {}
            : {
                headers: {
                  "Lovable-API-Key": apiKey!,
                  "X-Lovable-AIG-SDK": "vercel-ai-sdk",
                },
                fetch: runIdFetch.fetch,
              }),
        });

        // Lightweight local profile: small models on modest hardware need a short
        // prompt, a sliding window of recent turns and only the core tools.
        // Older context is fetched on demand through recall_thoughts.
        const LOCAL_WINDOW = Number(process.env["LOCAL_AI_WINDOW"] ?? "12");
        const LOCAL_TOOLS = ["save_thought", "recall_thoughts", "create_task", "complete_task", "list_tasks"];
        const pickTools = <T extends Record<string, unknown>>(all: T): T =>
          localBaseURL
            ? (Object.fromEntries(Object.entries(all).filter(([k]) => LOCAL_TOOLS.includes(k))) as T)
            : all;
        const nowLocal = new Intl.DateTimeFormat("en-GB", {
          timeZone,
          dateStyle: "full",
          timeStyle: "short",
        }).format(new Date());
        const localSystem = `You are Billy, a cosy companion: cheerful, warm and quietly wise, like a friendly dog happy to see them — never fawning, never blind praise. Keep replies short (1-4 sentences) and honest with a caring frame.
It is ${nowLocal} (${timeZone}).
Tools: save_thought for anything worth remembering; recall_thoughts to look up past notes, Obsidian notes or anything they mention from before (always check before saying you don't know); create_task when they want to do something; list_tasks and complete_task for their to-dos. Never invent tasks or memories.`;

        const result = streamText({
          // Local models speak plain chat-completions; the cloud model uses the Responses API.
          model: localBaseURL ? lovable.chat(localModel) : lovable.responses("openai/gpt-6-astra"),
          system: localBaseURL
            ? localSystem
            : buildSystemPrompt(snapshot, timeZone) +
              calendarNote +
              (attachedCount > 0
                ? filesSavedToDrive === attachedCount
                  ? `\n\nNOTE: ${attachedCount === 1 ? "The file they just shared has" : `All ${attachedCount} files they just shared have`} been saved into their Billy folder in their Google Drive.`
                  : `\n\nNOTE: ${filesSavedToDrive} of ${attachedCount} files they just shared could be saved to their Billy Drive folder — the rest could not be kept (their Drive may not be connected). Be honest about that if it comes up.`
                : ""),

          messages: await convertToModelMessages(
            localBaseURL ? messagesForModel.slice(-LOCAL_WINDOW) : messagesForModel,
          ),
          stopWhen: stepCountIs(localBaseURL ? 5 : 50),
          abortSignal: request.signal,
          tools: pickTools({
            save_thought: tool({
              description:
                "Store something the person shared worth remembering: a reflection, feeling, idea or fact about their life.",
              inputSchema: z.object({
                content: z.string().describe("The thought, in their own words where possible."),
                tags: z.array(z.string()).describe("A few short topic tags. Empty array if none."),
                mood: z
                  .string()
                  .nullable()
                  .describe("One word for how they seemed, or null if unclear."),
              }),
              execute: async ({ content, tags, mood }) => {
                const { data, error } = await ctx.supabase
                  .from("thoughts")
                  .insert({ user_id: ctx.userId, content, tags, mood })
                  .select("id, created_at")
                  .single();
                if (error) return { saved: false, error: error.message };
                const { mirrorThoughtToDrive } = await import("@/lib/drive.server");
                const mirrored = await mirrorThoughtToDrive(ctx, data.id, {
                  content,
                  tags,
                  mood,
                  createdAt: data.created_at,
                });
                return { saved: true, id: data.id, mirroredToDrive: mirrored };
              },
            }),
            recall_thoughts: tool({
              description:
                "Search previously saved thoughts by keyword to ground the conversation in what they actually said before.",
              inputSchema: z.object({
                query: z.string().describe("Keyword or phrase to look for."),
                limit: z.number().describe("How many to return, 1-20."),
              }),
              execute: async ({ query, limit }) => {
                const { data, error } = await ctx.supabase
                  .from("thoughts")
                  .select("content, tags, mood, created_at")
                  .eq("user_id", ctx.userId)
                  .ilike("content", `%${query}%`)
                  .order("created_at", { ascending: false })
                  .limit(Math.min(Math.max(limit, 1), 20));
                if (error) return { error: error.message };
                return { results: data ?? [] };
              },
            }),
            create_task: tool({
              description:
                "Add something they need to do to their task list. File it under a project when one clearly fits.",
              inputSchema: z.object({
                title: z.string().describe("Short task title."),
                details: z.string().nullable().describe("Extra context, or null."),
                due_at: z
                  .string()
                  .nullable()
                  .describe("Due date as YYYY-MM-DD, or null if no date was given."),
                project_id: z
                  .string()
                  .nullable()
                  .describe(
                    "Id of an existing project this clearly belongs to, or null to leave it unsorted.",
                  ),
              }),
              execute: async ({ title, details, due_at, project_id }) => {
                const { data, error } = await ctx.supabase
                  .from("tasks")
                  .insert({
                    user_id: ctx.userId,
                    title,
                    details,
                    due_at: due_at ? new Date(`${due_at}T12:00:00Z`).toISOString() : null,
                    project_id,
                  })
                  .select("id, created_at")
                  .single();
                if (error) return { created: false, error: error.message };
                const { mirrorTaskToDrive } = await import("@/lib/drive.server");
                await mirrorTaskToDrive(ctx, data.id, {
                  title,
                  details,
                  dueAt: due_at,
                  status: "open",
                  createdAt: data.created_at,
                });
                return { created: true, id: data.id, project_id };
              },
            }),
            list_projects: tool({
              description:
                "List their projects with how many open tasks each holds, plus how many tasks are unsorted.",
              inputSchema: z.object({}),
              execute: async () => {
                const [{ data: projects, error }, { data: tasks }] = await Promise.all([
                  ctx.supabase
                    .from("projects")
                    .select("id, name, description")
                    .eq("user_id", ctx.userId)
                    .order("created_at", { ascending: true }),
                  ctx.supabase
                    .from("tasks")
                    .select("id, title, project_id")
                    .eq("user_id", ctx.userId)
                    .eq("status", "open"),
                ]);
                if (error) return { error: error.message };
                const open = tasks ?? [];
                return {
                  projects: (projects ?? []).map((p) => ({
                    ...p,
                    openTasks: open.filter((t) => t.project_id === p.id).length,
                  })),
                  unsorted: open
                    .filter((t) => !t.project_id)
                    .map((t) => ({ id: t.id, title: t.title })),
                };
              },
            }),
            create_project: tool({
              description:
                "Create a new project. Only call this after they have agreed to it — never invent a project silently.",
              inputSchema: z.object({
                name: z.string().describe("Short project name in their own words."),
                description: z.string().nullable().describe("One line of context, or null."),
                task_ids: z
                  .array(z.string())
                  .describe("Ids of existing tasks to move into it. Empty array if none."),
              }),
              execute: async ({ name, description, task_ids }) => {
                const { data, error } = await ctx.supabase
                  .from("projects")
                  .insert({ user_id: ctx.userId, name, description })
                  .select("id, name")
                  .single();
                if (error) return { created: false, error: error.message };
                let moved = 0;
                if (task_ids.length > 0) {
                  const { error: moveError } = await ctx.supabase
                    .from("tasks")
                    .update({ project_id: data.id })
                    .eq("user_id", ctx.userId)
                    .in("id", task_ids);
                  if (!moveError) moved = task_ids.length;
                }
                return { created: true, id: data.id, name: data.name, movedTasks: moved };
              },
            }),
            assign_task_project: tool({
              description:
                "Put an existing task into a project, or pass null to leave it unsorted again.",
              inputSchema: z.object({
                task_id: z.string().describe("The task id."),
                project_id: z
                  .string()
                  .nullable()
                  .describe("The project id, or null to unsort the task."),
              }),
              execute: async ({ task_id, project_id }) => {
                const { error } = await ctx.supabase
                  .from("tasks")
                  .update({ project_id })
                  .eq("id", task_id)
                  .eq("user_id", ctx.userId);
                return error ? { assigned: false, error: error.message } : { assigned: true };
              },
            }),

            complete_task: tool({
              description: "Mark a task as done using its id from the current picture.",
              inputSchema: z.object({ id: z.string().describe("The task id.") }),
              execute: async ({ id }) => {
                const { data: task } = await ctx.supabase
                  .from("tasks")
                  .select("id, title, details, due_at, status, created_at")
                  .eq("id", id)
                  .eq("user_id", ctx.userId)
                  .maybeSingle();
                const { error } = await ctx.supabase
                  .from("tasks")
                  .update({ status: "done", completed_at: new Date().toISOString() })
                  .eq("id", id)
                  .eq("user_id", ctx.userId);
                if (error) return { done: false, error: error.message };
                // Keep the Drive copy truthful: status flips to done there too.
                if (task && task.status !== "done") {
                  const { mirrorTaskToDrive } = await import("@/lib/drive.server");
                  await mirrorTaskToDrive(ctx, task.id, {
                    title: task.title,
                    details: task.details,
                    dueAt: task.due_at,
                    status: "done",
                    createdAt: task.created_at,
                  });
                }
                return { done: true };
              },
            }),
            list_tasks: tool({
              description: "Re-read the current task list with ages and due dates.",
              inputSchema: z.object({
                include_done: z.boolean().describe("Whether to include completed tasks."),
              }),
              execute: async ({ include_done }) => {
                const query = ctx.supabase
                  .from("tasks")
                  .select("id, title, details, due_at, status, created_at, completed_at, project_id")
                  .eq("user_id", ctx.userId)
                  .order("created_at", { ascending: true });
                const { data, error } = include_done
                  ? await query
                  : await query.eq("status", "open");
                return error ? { error: error.message } : { tasks: data ?? [] };
              },
            }),
            list_calendar_events: tool({
              description:
                "Look at their Google Calendar between two dates, for talking through their plan.",
              inputSchema: z.object({
                from: z.string().describe("Start date as YYYY-MM-DD in their local time."),
                to: z.string().describe("End date as YYYY-MM-DD in their local time, inclusive."),
              }),
              execute: async ({ from, to }) => {
                if (!calendarConnection) return { connected: false };
                const { listCalendarEvents } = await import("@/lib/calendar.server");
                const result = await listCalendarEvents(
                  calendarConnection.connectionKey,
                  new Date(`${from}T00:00:00Z`).toISOString(),
                  new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000).toISOString(),
                  100,
                );
                return result.ok
                  ? { connected: true, events: result.data }
                  : { connected: false, needsReconnect: result.needsReconnect };
              },
            }),
            create_calendar_event: tool({
              description:
                "Put something on their Google Calendar. Use their local time. Only when they want it on the calendar.",
              inputSchema: z.object({
                title: z.string().describe("Short event title."),
                description: z.string().nullable().describe("Extra context, or null."),
                location: z.string().nullable().describe("Where it is, or null."),
                start: z
                  .string()
                  .describe(
                    "Start: YYYY-MM-DDTHH:mm:ss in their local time, or YYYY-MM-DD for an all-day event.",
                  ),
                end: z
                  .string()
                  .describe(
                    "End in the same format. For an all-day event use the next day's date.",
                  ),
              }),
              execute: async ({ title, description, location, start, end }) => {
                if (!calendarConnection) return { created: false, connected: false };
                const { createCalendarEvent } = await import("@/lib/calendar.server");
                const result = await createCalendarEvent(calendarConnection.connectionKey, {
                  title,
                  description,
                  location,
                  start,
                  end,
                  timeZone,
                });
                return result.ok
                  ? { created: true, event: result.data }
                  : { created: false, needsReconnect: result.needsReconnect, error: result.message };
              },
            }),
          }),

          ...(localBaseURL
            ? {}
            : {
                providerOptions: {
                  openai: {
                    forceReasoning: true,
                    reasoningEffort: "low",
                    reasoningSummary: "auto",
                    store: false,
                    include: ["reasoning.encrypted_content"],
                  },
                },
              }),
        });

        return withLovableAiGatewayRunIdHeader(
          result.toUIMessageStreamResponse({
            originalMessages: messages,
            sendReasoning: true,
            onFinish: async ({ responseMessage }) => {
              if (responseMessage) {
                await saveConversationTurn(ctx, [
                  {
                    role: responseMessage.role,
                    parts: responseMessage.parts,
                    sdk_message_id: responseMessage.id ?? null,
                  },
                ]);
              }
            },
          }),
          runIdFetch,
        );
      },
    },
  },
});
