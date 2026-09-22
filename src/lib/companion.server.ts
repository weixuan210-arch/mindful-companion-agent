// Server-only data access for Billy. Never imported by browser code.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { computeMood, computeNudge, computeSignals, type TaskLike } from "@/lib/mood";

export type CompanionContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
};

export async function createCompanionContext(token: string): Promise<CompanionContext | null> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Missing Supabase server configuration");

  const supabase = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return { supabase, userId: data.claims.sub as string };
}

export async function buildSnapshot(ctx: CompanionContext) {
  const [{ data: profile }, { data: tasks }, { data: thoughts }, { data: projects }] =
    await Promise.all([
      ctx.supabase
        .from("profiles")
        .select("display_name, nudge_threshold_days")
        .eq("id", ctx.userId)
        .maybeSingle(),
      ctx.supabase
        .from("tasks")
        .select("id, title, details, due_at, status, created_at, completed_at, project_id")
        .eq("user_id", ctx.userId)
        .order("created_at", { ascending: true })
        .limit(200),
      ctx.supabase
        .from("thoughts")
        .select("content, tags, mood, created_at")
        .eq("user_id", ctx.userId)
        .order("created_at", { ascending: false })
        .limit(25),
      ctx.supabase
        .from("projects")
        .select("id, name, description")
        .eq("user_id", ctx.userId)
        .order("created_at", { ascending: true }),
    ]);

  const threshold = profile?.nudge_threshold_days ?? 5;
  const signals = computeSignals((tasks ?? []) as TaskLike[], threshold);
  const mood = computeMood(signals);
  const nudge = computeNudge(signals, threshold);

  return {
    displayName: profile?.display_name ?? null,
    threshold,
    tasks: tasks ?? [],
    thoughts: thoughts ?? [],
    projects: projects ?? [],
    signals,
    mood,
    nudge,
  };
}


/** YYYY-MM-DD of a moment in the user's own timezone. */
function localDateString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Whole calendar days between two moments, counted on the user's local clock. */
function localDayDiff(from: Date, to: Date, timeZone: string): number {
  const [fy, fm, fd] = localDateString(from, timeZone).split("-").map(Number);
  const [ty, tm, td] = localDateString(to, timeZone).split("-").map(Number);
  return Math.max(0, Math.round((Date.UTC(ty!, tm! - 1, td!) - Date.UTC(fy!, fm! - 1, fd!)) / 86400000));
}

export function buildSystemPrompt(
  snapshot: Awaited<ReturnType<typeof buildSnapshot>>,
  timeZone: string,
) {
  const { signals, mood, nudge, tasks, thoughts, threshold, displayName } = snapshot;
  const now = new Date();

  const openTasks = tasks
    .filter((t) => t.status === "open")
    .map((t) => {
      const age = localDayDiff(new Date(t.created_at), now, timeZone);
      const due = t.due_at ? `, due ${localDateString(new Date(t.due_at), timeZone)}` : "";
      return `- [${t.id}] ${t.title} (open ${age}d${due})`;
    })
    .join("\n");

  const recentThoughts = thoughts
    .slice(0, 12)
    .map((t) => `- ${localDateString(new Date(t.created_at), timeZone)}: ${t.content}`)
    .join("\n");

  const localNow = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  return `You are Billy — a cozy companion. You are kind, reassuring, nurturing, empathetic and wise.

VOICE
- Warm and unhurried. Short paragraphs, plain words, no corporate cheer, no emoji spam (one at most, rarely).
- ${displayName ? `The person you're talking with is ${displayName}.` : "Use no name unless they share one."}
- You speak like someone who remembers, not like a productivity app.

HONEST REASSURANCE (important)
- You see the whole picture below, including what's being avoided. Never praise blindly — empty comfort is worthless.
- Name what is true, then choose the caring frame. "That's been sitting a while, and I don't think that's laziness" is right. "Great job, you're crushing it!" when something has been avoided for a week is wrong.
- Never scold, never moralise, never imply they are failing.
- Progress on other tasks does NOT cancel an avoided one. Acknowledge both.

MEMORY
- When they share something personal, reflective, or worth remembering, save it with save_thought.
- When they mention something they need or want to do, create it with create_task (ask only if genuinely ambiguous).
- When they say something is done, call complete_task.
- To remember earlier things, use recall_thoughts instead of guessing. Never invent memories.
- Never claim to have saved something unless the tool call succeeded.

CURRENT PICTURE (behavioural, refreshed each turn)
Mood: ${mood.key} — ${mood.label}. ${mood.line}
Open tasks: ${signals.openCount}; overdue: ${signals.overdue.length}; untouched ${threshold}+ days: ${signals.avoided.length}; completed in last 7 days: ${signals.doneRecently}.
${nudge ? `A persistent pattern is present: ${nudge.headline} — ${nudge.body}` : `No persistent pattern. Do NOT invent concern; one recently missed task is not a pattern and should not be raised as one.`}

OPEN TASKS
${openTasks || "(none)"}

RECENT THOUGHTS THEY SAVED
${recentThoughts || "(none yet)"}

For them it is currently ${localNow} (timezone: ${timeZone}). Interpret "today", "tomorrow", "tonight" etc. against this local time, never UTC. When recording a due date from a relative phrase, work out the calendar date in their timezone first.`;
}

export async function saveConversationTurn(
  ctx: CompanionContext,
  rows: { role: string; parts: unknown; sdk_message_id: string | null }[],
) {
  if (rows.length === 0) return;
  const { error } = await ctx.supabase.from("messages").insert(
    rows.map((r) => ({
      user_id: ctx.userId,
      role: r.role,
      parts: r.parts as never,
      sdk_message_id: r.sdk_message_id,
    })),
  );
  if (error) console.error("[billy] failed to save messages", error);
}
