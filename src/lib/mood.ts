// Behavioural mood engine for Billy.
//
// Mood is driven by *patterns of behaviour*, never by completion counts:
// how old an open task is, how long it has been overdue, and how long a
// single item has been sitting untouched. Completing five other things does
// not hide a task that has been avoided for days.

export type TaskLike = {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
};

export type MoodKey = "settled" | "attentive" | "tender" | "heavy";

export type TaskSignal = {
  id: string;
  title: string;
  ageDays: number;
  overdueDays: number;
};

export type Signals = {
  openCount: number;
  doneRecently: number;
  overdue: TaskSignal[];
  avoided: TaskSignal[];
  oldestOpenAgeDays: number;
  strain: number;
};

export type Mood = {
  key: MoodKey;
  label: string;
  /** Honest one-liner: names the real picture, framed with care. */
  line: string;
};

const DAY = 1000 * 60 * 60 * 24;

const days = (from: string | null, now: number) =>
  from ? Math.max(0, Math.floor((now - new Date(from).getTime()) / DAY)) : 0;

export function computeSignals(
  tasks: TaskLike[],
  avoidanceThresholdDays: number,
  nowMs: number = Date.now(),
): Signals {
  const open = tasks.filter((t) => t.status === "open");
  const overdue: TaskSignal[] = [];
  const avoided: TaskSignal[] = [];
  let strain = 0;
  let oldestOpenAgeDays = 0;

  for (const t of open) {
    const ageDays = days(t.created_at, nowMs);
    const overdueDays = t.due_at ? days(t.due_at, nowMs) : 0;
    const isOverdue = Boolean(t.due_at && new Date(t.due_at).getTime() < nowMs);
    const signal: TaskSignal = { id: t.id, title: t.title, ageDays, overdueDays };

    oldestOpenAgeDays = Math.max(oldestOpenAgeDays, ageDays);
    // Age alone adds gentle weight, capped so a long backlog doesn't spiral.
    strain += Math.min(ageDays / 3, 3);
    if (isOverdue) {
      overdue.push(signal);
      strain += 1.5 + Math.min(overdueDays, 5);
    }
    if (ageDays >= avoidanceThresholdDays || overdueDays >= avoidanceThresholdDays) {
      avoided.push(signal);
    }
  }

  const doneRecently = tasks.filter(
    (t) => t.completed_at && nowMs - new Date(t.completed_at).getTime() < 7 * DAY,
  ).length;

  return {
    openCount: open.length,
    doneRecently,
    overdue: overdue.sort((a, b) => b.overdueDays - a.overdueDays),
    avoided: avoided.sort((a, b) => b.ageDays - a.ageDays),
    oldestOpenAgeDays,
    strain: Math.round(strain * 10) / 10,
  };
}

/**
 * Reconstructs what the list looked like at a past moment: tasks that didn't
 * exist yet are dropped, and tasks completed after that moment were still open.
 */
export function taskStateAt<T extends TaskLike>(tasks: T[], atMs: number): TaskLike[] {
  const state: TaskLike[] = [];
  for (const t of tasks) {
    if (new Date(t.created_at).getTime() > atMs) continue;
    const doneBy = t.completed_at ? new Date(t.completed_at).getTime() <= atMs : false;
    state.push({
      id: t.id,
      title: t.title,
      due_at: t.due_at,
      created_at: t.created_at,
      status: doneBy ? "done" : "open",
      completed_at: doneBy ? t.completed_at : null,
    });
  }
  return state;
}

export function computeMood(s: Signals): Mood {
  // Note: doneRecently never lowers strain. Progress is acknowledged in words,
  // not used to cancel out something being avoided.
  if (s.avoided.length >= 2 || s.strain >= 12) {
    return {
      key: "heavy",
      label: "Holding this with you",
      line:
        s.avoided.length >= 2
          ? `A few things have been waiting a while — ${s.avoided[0]!.title} the longest. That usually means something, not laziness.`
          : "There's a fair bit stacked up right now. We don't have to move all of it today.",
    };
  }
  if (s.avoided.length === 1) {
    const a = s.avoided[0]!;
    return {
      key: "tender",
      label: "Noticing something",
      line: `${a.title} has been sitting for ${a.ageDays} day${a.ageDays === 1 ? "" : "s"}. I'm not nagging — I just haven't forgotten it.`,
    };
  }
  if (s.overdue.length > 0 || s.strain >= 5) {
    return {
      key: "attentive",
      label: "Paying attention",
      line:
        s.overdue.length > 0
          ? `${s.overdue[0]!.title} slipped past its date. Recent, so let's just look at it.`
          : "Things are ticking along, with a little weight in the pile.",
    };
  }
  return {
    key: "settled",
    label: "Settled",
    line:
      s.openCount === 0
        ? "Nothing waiting. Enjoy the quiet — tell me what's on your mind."
        : `${s.openCount} thing${s.openCount === 1 ? "" : "s"} on the list, all still fresh. Nothing is slipping.`,
  };
}

export type Nudge = {
  /** Passive: shown when the app is opened. Never pushed. */
  headline: string;
  body: string;
  taskIds: string[];
};

/**
 * Downward-trend nudges have a persistence threshold: a single recently
 * missed task is not a pattern, so nothing is surfaced for it.
 */
export function computeNudge(s: Signals, avoidanceThresholdDays: number): Nudge | null {
  const persistent = s.avoided;
  const chronicOverdue = s.overdue.filter((t) => t.overdueDays >= avoidanceThresholdDays);

  if (persistent.length === 0 && chronicOverdue.length < 2) return null;

  if (persistent.length >= 2) {
    const names = persistent.slice(0, 3).map((t) => t.title);
    return {
      headline: "A pattern, not a one-off",
      body: `${names.join(", ")} have all been waiting more than ${avoidanceThresholdDays} days.${
        s.doneRecently > 0
          ? ` You've closed ${s.doneRecently} other thing${s.doneRecently === 1 ? "" : "s"} this week, so it isn't about effort — these specific ones seem to carry something.`
          : " Worth asking what's in the way rather than pushing harder."
      } Want to talk about one of them?`,
      taskIds: persistent.slice(0, 3).map((t) => t.id),
    };
  }

  if (persistent.length === 1) {
    const a = persistent[0]!;
    return {
      headline: "Still here, quietly",
      body: `${a.title} has gone ${a.ageDays} days untouched. I'm not going to pretend that's nothing${
        s.doneRecently > 0 ? `, even though you've finished ${s.doneRecently} other thing${s.doneRecently === 1 ? "" : "s"}` : ""
      }. Shall we shrink it, move it, or let it go?`,
      taskIds: [a.id],
    };
  }

  return {
    headline: "Dates keep sliding",
    body: `${chronicOverdue.length} tasks are more than ${avoidanceThresholdDays} days past their date. That's usually a sign the plan needs changing, not you.`,
    taskIds: chronicOverdue.map((t) => t.id),
  };
}

export const MOOD_STYLES: Record<MoodKey, string> = {
  settled: "bg-mood-settled text-mood-settled-foreground",
  attentive: "bg-mood-attentive text-mood-attentive-foreground",
  tender: "bg-mood-tender text-mood-tender-foreground",
  heavy: "bg-mood-heavy text-mood-heavy-foreground",
};
