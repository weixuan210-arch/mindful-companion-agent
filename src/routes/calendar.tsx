import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import billy from "@/assets/billy.png";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { fetchCalendarEvents } from "@/lib/calendar.functions";

import {
  computeMood,
  computeSignals,
  taskStateAt,
  type MoodKey,
  type TaskLike,
} from "@/lib/mood";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "What's coming up — Billy" },
      {
        name: "description",
        content:
          "A month at a glance: what's due each day, what you've finished, and how Billy's mood moved along the way.",
      },
      { property: "og:title", content: "What's coming up — Billy" },
      {
        property: "og:description",
        content: "See your tasks by day, with due dates and Billy's mood for each day.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CalendarPage,
});

type Task = TaskLike & { details: string | null };

const MOOD_DOT: Record<MoodKey, string> = {
  settled: "bg-mood-settled",
  attentive: "bg-mood-attentive",
  tender: "bg-mood-tender",
  heavy: "bg-mood-heavy",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function CalendarPage() {
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
  return <CalendarView userId={session.user.id} />;
}

function CalendarView({ userId }: { userId: string }) {
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));

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

  const loadEvents = useServerFn(fetchCalendarEvents);
  const monthEnd = useMemo(
    () => new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1),
    [monthStart],
  );
  const eventsQuery = useQuery({
    queryKey: ["calendar-events", userId, monthStart.toISOString()],
    queryFn: () =>
      loadEvents({ data: { from: monthStart.toISOString(), to: monthEnd.toISOString() } }),
  });

  const threshold = profileQuery.data?.nudge_threshold_days ?? 5;
  const tasks = tasksQuery.data ?? [];
  const events = eventsQuery.data?.events ?? [];
  const calendarConnected = eventsQuery.data?.connected === true;


  const days = useMemo(() => {
    const firstWeekday = (monthStart.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(
      monthStart.getFullYear(),
      monthStart.getMonth() + 1,
      0,
    ).getDate();
    const todayKey = new Date().toDateString();

    const cells: {
      key: string;
      date: Date | null;
      due: Task[];
      done: Task[];
      mood: MoodKey | null;
      isToday: boolean;
      isPast: boolean;
    }[] = [];

    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push({
        key: `pad-${i}`,
        date: null,
        due: [],
        done: [],
        mood: null,
        isToday: false,
        isPast: false,
      });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
      const dayKey = date.toDateString();
      const endOfDay = new Date(date).setHours(23, 59, 59, 999);
      const isPast = endOfDay <= Date.now();

      const due = tasks.filter((t) => t.due_at && new Date(t.due_at).toDateString() === dayKey);
      const done = tasks.filter(
        (t) => t.completed_at && new Date(t.completed_at).toDateString() === dayKey,
      );

      // Billy's mood as the day closed — or right now, for today.
      const at = Math.min(endOfDay, Date.now());
      const state = isPast ? taskStateAt(tasks, at) : [];
      const mood =
        state.length > 0 ? computeMood(computeSignals(state, threshold, at)).key : null;

      cells.push({
        key: dayKey,
        date,
        due,
        done,
        mood,
        isToday: dayKey === todayKey,
        isPast,
      });
    }

    return cells;
  }, [monthStart, tasks, threshold]);

  const monthLabel = monthStart.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  if (tasksQuery.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Shimmer>Looking at what's coming up...</Shimmer>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 lg:px-8 lg:py-10">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={billy} alt="Billy" width={816} height={816} className="h-10 w-10" />
          <div>
            <h1 className="text-2xl leading-none">What's coming up</h1>
            <p className="text-xs text-muted-foreground">Your days, due dates and Billy's mood</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/patterns">Patterns</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">Back to Billy</Link>
          </Button>
        </div>
      </header>

      <section className="paper-card p-4 lg:p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base">{monthLabel}</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() =>
                setMonthStart(
                  (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
                )
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMonthStart(startOfMonth(new Date()))}>
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              onClick={() =>
                setMonthStart(
                  (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1),
                )
              }
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
          {WEEKDAYS.map((label) => (
            <div key={label} className="pb-1">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((cell) => {
            if (!cell.date) return <div key={cell.key} className="min-h-24 rounded-xl" />;
            const overdue = cell.due.some((t) => t.status === "open" && cell.isPast);
            return (
              <div
                key={cell.key}
                className={`min-h-24 rounded-xl border p-1.5 text-left ${
                  cell.isToday
                    ? "border-primary bg-accent/40"
                    : "border-border/70 bg-muted/30"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs ${cell.isToday ? "font-semibold" : "text-muted-foreground"}`}
                  >
                    {cell.date.getDate()}
                  </span>
                  {cell.mood && (
                    <span
                      title={`Billy was ${cell.mood}`}
                      className={`h-2 w-2 rounded-full ${MOOD_DOT[cell.mood]}`}
                    />
                  )}
                </div>

                <ul className="mt-1 space-y-1">
                  {cell.due.slice(0, 3).map((task) => (
                    <li
                      key={task.id}
                      title={task.title}
                      className={`truncate rounded-md px-1.5 py-0.5 text-[11px] ${
                        task.status === "done"
                          ? "bg-mood-settled text-mood-settled-foreground line-through"
                          : overdue
                            ? "bg-mood-tender text-mood-tender-foreground"
                            : "bg-secondary text-secondary-foreground"
                      }`}
                    >
                      {task.title}
                    </li>
                  ))}
                  {cell.due.length > 3 && (
                    <li className="px-1.5 text-[11px] text-muted-foreground">
                      +{cell.due.length - 3} more
                    </li>
                  )}
                  {cell.done.length > 0 && (
                    <li className="px-1.5 text-[11px] text-muted-foreground">
                      ✓ {cell.done.length} done
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          {(["settled", "attentive", "tender", "heavy"] as MoodKey[]).map((key) => (
            <span key={key} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${MOOD_DOT[key]}`} />
              {key}
            </span>
          ))}
          <span className="ml-auto">Mood dots show how the day closed.</span>
        </div>
      </section>
    </main>
  );
}
