import { motion } from "motion/react";
import { Flame, Sparkles, Star, Sun } from "lucide-react";

import billy from "@/assets/billy.png";
import { Button } from "@/components/ui/button";
import { MOOD_STYLES, type Mood, type Signals, type TaskLike } from "@/lib/mood";

const DAY = 86400000;

/** Days in a row, counting back from today, with at least one task finished. */
function completionStreak(tasks: TaskLike[], now: number): number {
  const done = new Set(
    tasks
      .filter((t) => t.completed_at)
      .map((t) => new Date(t.completed_at!).toDateString()),
  );
  let streak = 0;
  for (let i = 0; i < 365; i += 1) {
    const day = new Date(now - i * DAY).toDateString();
    if (done.has(day)) streak += 1;
    else if (i > 0 || !done.has(new Date(now).toDateString())) break;
  }
  return streak;
}

function greeting(hour: number): string {
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Morning!";
  if (hour < 17) return "Afternoon!";
  return "Evening!";
}

export function DailyCheckIn({
  displayName,
  tasks,
  signals,
  mood,
  onStart,
}: {
  displayName: string | null;
  tasks: TaskLike[];
  signals: Signals;
  mood: Mood;
  onStart: () => void;
}) {
  const now = Date.now();
  const todayEnd = new Date(new Date(now).setHours(23, 59, 59, 999)).getTime();
  const dueToday = tasks.filter(
    (t) => t.status === "open" && t.due_at && new Date(t.due_at).getTime() <= todayEnd,
  );
  const doneAll = tasks.filter((t) => t.status === "done").length;
  const streak = completionStreak(tasks, now);
  const level = Math.floor(doneAll / 5) + 1;
  const progress = ((doneAll % 5) / 5) * 100;

  const quests = dueToday.length > 0 ? dueToday.slice(0, 3) : signals.avoided.slice(0, 3);
  const questLabel = dueToday.length > 0 ? "Due today" : "Worth a nudge";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 180, damping: 18 }}
        className="paper-card w-full max-w-lg overflow-hidden"
      >
        <div className="relative flex flex-col items-center gap-3 bg-accent/40 px-6 pb-6 pt-8 text-center">
          <motion.img
            src={billy}
            alt="Billy"
            width={816}
            height={816}
            className="h-28 w-28 drop-shadow-sm"
            animate={{ y: [0, -8, 0], rotate: [-2, 2, -2] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />
          <div>
            <h1 className="text-2xl leading-tight">
              {greeting(new Date(now).getHours())}
              {displayName ? ` ${displayName}` : ""}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{mood.line}</p>
          </div>
          <span
            className={`rounded-full px-3 py-0.5 text-xs font-semibold ${MOOD_STYLES[mood.key]}`}
          >
            Billy is {mood.label.toLowerCase()}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 border-b border-border px-6 py-4 text-center">
          {[
            { icon: <Star className="h-4 w-4" />, label: "Level", value: level },
            { icon: <Flame className="h-4 w-4" />, label: "Day streak", value: streak },
            { icon: <Sun className="h-4 w-4" />, label: "On the list", value: signals.openCount },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl bg-muted/70 px-2 py-3">
              <div className="flex items-center justify-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {stat.icon}
                {stat.label}
              </div>
              <p className="font-display text-2xl">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="px-6 pt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{doneAll % 5}/5 to the next level</span>
            <span>{doneAll} finished all time</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.9, ease: "easeOut", delay: 0.25 }}
            />
          </div>
        </div>

        <div className="px-6 py-5">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Today's quest
          </p>
          {quests.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing pressing. A good day to think out loud.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {quests.map((quest) => (
                <li key={quest.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>
                    {quest.title}
                    <span className="ml-1 text-xs text-muted-foreground">({questLabel})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Button className="mt-5 w-full" size="lg" onClick={onStart}>
            Let's get into it
          </Button>
        </div>
      </motion.div>
    </main>
  );
}
