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

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const {
          createCompanionContext,
          buildSnapshot,
          buildSystemPrompt,
          saveConversationTurn,
        } = await import("@/lib/companion.server");
        const { mirrorToDrive } = await import("@/lib/drive.server");
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

          const { mirrorFileToDrive } = await import("@/lib/drive.server");
          const results = await Promise.all(
            attachments.map((a) =>
              mirrorFileToDrive(ctx, a.filename ?? "attachment", a.mediaType ?? "", a.url),
            ),
          );
          filesSavedToDrive = results.filter(Boolean).length;
        }

        const initialRunId = getLovableAiGatewayRunId(request);
        const runIdFetch = createLovableAiGatewayRunIdFetch(initialRunId);
        const lovable = createOpenAI({
          baseURL: "https://ai.gateway.lovable.dev/v1",
          apiKey,
          headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
          fetch: runIdFetch.fetch,
        });

        const result = streamText({
          model: lovable.responses("openai/gpt-6-astra"),
          system:
            buildSystemPrompt(snapshot, timeZone) +
            (attachedCount > 0
              ? filesSavedToDrive === attachedCount
                ? `\n\nNOTE: ${attachedCount === 1 ? "The file they just shared has" : `All ${attachedCount} files they just shared have`} been saved into their Billy folder in their Google Drive.`
                : `\n\nNOTE: ${filesSavedToDrive} of ${attachedCount} files they just shared could be saved to their Billy Drive folder — the rest could not be kept (their Drive may not be connected). Be honest about that if it comes up.`
              : ""),
          messages: await convertToModelMessages(messagesForModel),
          stopWhen: stepCountIs(50),
          abortSignal: request.signal,
          tools: {
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
                const mirrored = await mirrorToDrive(ctx, "thought", data.id, content);
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
                  .select("id")
                  .single();
                if (error) return { created: false, error: error.message };
                await mirrorToDrive(ctx, "task", data.id, `${title}\n\n${details ?? ""}`);
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
                const { error } = await ctx.supabase
                  .from("tasks")
                  .update({ status: "done", completed_at: new Date().toISOString() })
                  .eq("id", id)
                  .eq("user_id", ctx.userId);
                return error ? { done: false, error: error.message } : { done: true };
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
          },
          providerOptions: {
            openai: {
              forceReasoning: true,
              reasoningEffort: "low",
              reasoningSummary: "auto",
              store: false,
              include: ["reasoning.encrypted_content"],
            },
          },
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
