import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo } from "react";

import billy from "@/assets/billy.png";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { computeMood, computeSignals, MOOD_STYLES, type TaskLike } from "@/lib/mood";

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

  // Weekly completions for the last 6 weeks — honest history, oldest first.
  const weeklyDone = useMemo(() => {
    const weeks: number[] = [0, 0, 0, 0, 0, 0];
    const now = Date.now();
    for (const t of tasks) {
      if (!t.completed_at) continue;
      const age = now - new Date(t.completed_at).getTime();
      const week = Math.floor(age / (7 * DAY));
      if (week >= 0 && week < 6) weeks[5 - week]! += 1;
    }
    return weeks;
  }, [tasks]);

  const totalDone = useMemo(() => tasks.filter((t) => t.status === "done").length, [tasks]);
  const overdueCount = signals.overdue.length;
  const avoidedCount = signals.avoided.length;
  const maxWeekly = Math.max(1, ...weeklyDone);

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

      <section className="paper-card p-5">
        <h2 className="text-lg">Completions, week by week</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          The last six weeks. A low bar after a hard week isn't failure — it's context.
        </p>
        <div className="flex items-end gap-2">
          {weeklyDone.map((count, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-xs text-muted-foreground">{count > 0 ? count : ""}</span>
              <div
                className="w-full rounded-t-md bg-primary/70"
                style={{ height: `${Math.max(6, (count / maxWeekly) * 96)}px` }}
              />
              <span className="text-[10px] text-muted-foreground">
                {i === 5 ? "this wk" : `${5 - i}w ago`}
              </span>
            </div>
          ))}
        </div>
      </section>
    </main>
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
