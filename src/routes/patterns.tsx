import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo } from "react";

import billy from "@/assets/billy.png";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { computeMood, computeSignals, MOOD_STYLES, taskStateAt, type TaskLike } from "@/lib/mood";

export const Route = createFileRoute("/patterns")({
  head: () => ({
    meta: [
      { title: "Patterns — Billy" },
      {
        name: "description",
        content:
          "A gentle look at how your tasks have been going: what's overdue, what you've finished, and which ones keep being avoided.",
      },
      { property: "og:title", content: "Patterns — Billy" },
      {
        property: "og:description",
        content: "The honest shape of your task list, held kindly.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Patterns,
});

type Task = TaskLike & { details: string | null };

const DAY = 1000 * 60 * 60 * 24;

function Patterns() {
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

  return <PatternsView userId={session.user.id} />;
}

function PatternsView({ userId }: { userId: string }) {
  const profileQuery = useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("nudge_threshold_days")
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

  const threshold = profileQuery.data?.nudge_threshold_days ?? 5;
  const tasks = tasksQuery.data ?? [];
  const signals = useMemo(() => computeSignals(tasks, threshold), [tasks, threshold]);
  const mood = useMemo(() => computeMood(signals), [signals]);

  // Weekly trend for the last 6 weeks — oldest first. Overdue/avoided are read
  // from how the list actually looked at the end of each week.
  const weekly = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: 6 }, (_, i) => {
      const weeksAgo = 5 - i;
      const end = now - weeksAgo * 7 * DAY;
      const start = end - 7 * DAY;
      const state = taskStateAt(tasks, end);
      const s = computeSignals(state, threshold, end);
      const done = tasks.filter((t) => {
        if (!t.completed_at) return false;
        const at = new Date(t.completed_at).getTime();
        return at > start && at <= end;
      }).length;
      return { done, overdue: s.overdue.length, avoided: s.avoided.length };
    });
  }, [tasks, threshold]);

  // Mood, day by day, for the last three weeks.
  const moodDays = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: 21 }, (_, i) => {
      const at = now - (20 - i) * DAY;
      const s = computeSignals(taskStateAt(tasks, at), threshold, at);
      const m = computeMood(s);
      const drivers = [
        ...s.avoided.slice(0, 2).map((t) => `${t.title} (${t.ageDays}d waiting)`),
        ...s.overdue
          .filter((o) => !s.avoided.some((a) => a.id === o.id))
          .slice(0, 2)
          .map((t) => `${t.title} (${t.overdueDays}d late)`),
      ];
      return {
        label: new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        mood: m,
        drivers,
      };
    });
  }, [tasks, threshold]);

  const moodChanges = useMemo(
    () => moodDays.filter((d, i) => i > 0 && d.mood.key !== moodDays[i - 1]!.mood.key),
    [moodDays],
  );

  const totalDone = useMemo(() => tasks.filter((t) => t.status === "done").length, [tasks]);
  const overdueCount = signals.overdue.length;
  const avoidedCount = signals.avoided.length;
  const maxWeekly = Math.max(1, ...weekly.flatMap((w) => [w.done, w.overdue, w.avoided]));

  if (tasksQuery.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Shimmer>Looking at the shape of things...</Shimmer>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-8 lg:py-10">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={billy} alt="Billy" width={816} height={816} className="h-10 w-10" />
          <div>
            <h1 className="text-2xl leading-none">Patterns</h1>
            <p className="text-xs text-muted-foreground">the honest shape of your list, held kindly</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
            <ArrowLeft className="size-4" /> Back to Billy
          </Link>
        </Button>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Overdue" value={overdueCount} tone={overdueCount > 0 ? "warn" : "calm"} />
        <StatCard label="Avoided" value={avoidedCount} tone={avoidedCount > 0 ? "warn" : "calm"} hint={`${threshold}+ days`} />
        <StatCard label="Done this week" value={signals.doneRecently} tone="calm" />
        <StatCard label="Done all time" value={totalDone} tone="calm" />
      </section>

      <section className={`paper-card mb-5 p-5 ${MOOD_STYLES[mood.key]}`}>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Billy's read</p>
        <p className="mt-1 font-medium">{mood.label}</p>
        <p className="mt-1 text-sm opacity-90">{mood.line}</p>
      </section>

      <section className="paper-card mb-5 p-5">
        <h2 className="text-lg">The ones you keep avoiding</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Open for {threshold}+ days, or {threshold}+ days past their date. Not a scolding — just the ones worth a
          second look.
        </p>
        {signals.avoided.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has been sitting that long. Whatever you're doing, it's working.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {signals.avoided.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-2"
              >
                <span className="text-sm font-medium">{t.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t.ageDays} day{t.ageDays === 1 ? "" : "s"} old
                  {t.overdueDays > 0 && ` · ${t.overdueDays} day${t.overdueDays === 1 ? "" : "s"} overdue`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="paper-card mb-5 p-5">
        <h2 className="text-lg">Overdue right now</h2>
        {signals.overdue.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing past its date. Lovely and clear.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {signals.overdue.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-2"
              >
                <span className="text-sm font-medium">{t.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t.overdueDays} day{t.overdueDays === 1 ? "" : "s"} late
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="paper-card mb-5 p-5">
        <h2 className="text-lg">Week by week</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          The last six weeks: what you finished, what was overdue at the end of each week, and how many things had
          been sitting {threshold}+ days. A low bar after a hard week isn't failure — it's context.
        </p>
        <div className="flex items-end gap-3">
          {weekly.map((w, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-28 w-full items-end justify-center gap-[3px]">
                <Bar value={w.done} max={maxWeekly} className="bg-primary/70" title={`${w.done} completed`} />
                <Bar
                  value={w.overdue}
                  max={maxWeekly}
                  className="bg-mood-attentive"
                  title={`${w.overdue} overdue`}
                />
                <Bar value={w.avoided} max={maxWeekly} className="bg-mood-heavy" title={`${w.avoided} avoided`} />
              </div>
              <span className="text-[10px] text-muted-foreground">{i === 5 ? "this wk" : `${5 - i}w ago`}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
          <Legend className="bg-primary/70" label="completed" />
          <Legend className="bg-mood-attentive" label="overdue" />
          <Legend className="bg-mood-heavy" label={`avoided (${threshold}+ days)`} />
        </div>
      </section>

      <section className="paper-card p-5">
        <h2 className="text-lg">Billy's mood, day by day</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          The last three weeks, worked out from how your list looked each day. Hover a day to see what he was
          holding.
        </p>
        <div className="flex items-end gap-[3px]">
          {moodDays.map((d) => (
            <div
              key={d.label}
              title={`${d.label} — ${d.mood.label}${d.drivers.length ? `: ${d.drivers.join(", ")}` : ""}`}
              className={`h-10 flex-1 rounded-sm ${MOOD_STYLES[d.mood.key]}`}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{moodDays[0]?.label}</span>
          <span>today</span>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {moodChanges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Billy's mood has held steady across these days. Nothing has tugged at it.
            </p>
          ) : (
            moodChanges.map((d) => (
              <div key={d.label} className="rounded-md border border-border bg-background/60 px-3 py-2">
                <p className="text-sm">
                  <span className="text-muted-foreground">{d.label}</span>{" "}
                  <span className="font-medium">{d.mood.label}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.drivers.length > 0 ? `Because of ${d.drivers.join(", ")}.` : d.mood.line}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function Bar({
  value,
  max,
  className,
  title,
}: {
  value: number;
  max: number;
  className: string;
  title: string;
}) {
  return (
    <div className="flex h-full flex-1 flex-col justify-end" title={title}>
      <span className="mb-0.5 text-center text-[10px] text-muted-foreground">{value > 0 ? value : ""}</span>
      <div
        className={`w-full rounded-t-sm ${className}`}
        style={{ height: `${Math.max(3, (value / max) * 84)}px` }}
      />
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block size-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "calm" | "warn";
  hint?: string;
}) {
  return (
    <div className="paper-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${tone === "warn" && value > 0 ? "text-mood-heavy" : ""}`}>
        {value}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
