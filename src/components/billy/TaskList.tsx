import { formatDistanceToNowStrict } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import type { TaskLike } from "@/lib/mood";

type Task = TaskLike & { details: string | null; project_id: string | null };
type Project = { id: string; name: string };

const CHEERS = ["Nice one!", "Boom.", "Got it!", "Yes!", "Tidy."];

/** Confetti burst from wherever the checkbox sits. Loaded lazily, never on SSR. */
async function celebrate(element: HTMLElement | null) {
  const { default: confetti } = await import("canvas-confetti");
  const rect = element?.getBoundingClientRect();
  const origin = rect
    ? {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
      }
    : { x: 0.85, y: 0.4 };
  confetti({
    particleCount: 70,
    spread: 70,
    startVelocity: 32,
    scalar: 0.85,
    origin,
    colors: ["#d98a4f", "#e8c07d", "#8fb77a", "#f2e4cf"],
    disableForReducedMotion: true,
  });
}

export function TaskList({
  tasks,
  projects,
  threshold,
  onToggle,
}: {
  tasks?: Task[] | null;
  projects?: Project[] | null;
  threshold: number;
  onToggle: (task: Task, done: boolean) => void;
}) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const projectList = Array.isArray(projects) ? projects : [];
  const open = taskList.filter((t) => t.status === "open");
  const done = taskList.filter((t) => t.status === "done").slice(-4).reverse();
  const now = Date.now();

  const [cheer, setCheer] = useState<{ id: string; text: string } | null>(null);

  const handleToggle = useCallback(
    (task: Task, isDone: boolean, element: HTMLElement | null) => {
      if (isDone) {
        void celebrate(element);
        const text = CHEERS[Math.floor(Math.random() * CHEERS.length)]!;
        setCheer({ id: task.id, text });
        window.setTimeout(() => setCheer(null), 1200);
      }
      onToggle(task, isDone);
    },
    [onToggle],
  );

  // Grouped by project, in the order projects were created, unsorted last.
  const groups: { key: string; label: string; items: Task[] }[] = [];
  for (const project of projectList) {
    const items = open.filter((t) => t.project_id === project.id);
    if (items.length > 0) groups.push({ key: project.id, label: project.name, items });
  }
  const unsorted = open.filter((t) => !t.project_id || !projectList.some((p) => p.id === t.project_id));
  if (unsorted.length > 0) {
    groups.push({
      key: "unsorted",
      label: groups.length > 0 ? "Not in a project" : "",
      items: unsorted,
    });
  }

  const renderTask = (task: Task) => {
    const ageDays = Math.floor((now - new Date(task.created_at).getTime()) / 86400000);
    const overdue = task.due_at ? new Date(task.due_at).getTime() < now : false;
    const stale = ageDays >= threshold;
    return (
      <motion.li
        key={task.id}
        layout
        className="relative flex items-start gap-3"
        exit={{ opacity: 0, x: 16, transition: { duration: 0.25, ease: "easeIn" } }}
      >
        <motion.span
          className="mt-0.5"
          whileTap={{ scale: 0.8 }}
          transition={{ type: "spring", stiffness: 500, damping: 15 }}
        >
          <Checkbox
            checked={false}
            onCheckedChange={(value) => {
              const element = document.querySelector<HTMLElement>(
                `[data-task-check="${task.id}"]`,
              );
              handleToggle(task, value === true, element);
            }}
            data-task-check={task.id}
            aria-label={`Mark ${task.title} as done`}
          />
        </motion.span>
        <div className="min-w-0">
          <p className="text-sm leading-snug">{task.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ageDays === 0 ? "added today" : `added ${ageDays}d ago`}
            {task.due_at
              ? ` · ${overdue ? "past due " : "due in "}${formatDistanceToNowStrict(new Date(task.due_at))}`
              : ""}
            {stale ? " · been a while" : ""}
          </p>
        </div>

        <AnimatePresence>
          {cheer?.id === task.id && (
            <motion.span
              key="cheer"
              initial={{ opacity: 0, y: 6, scale: 0.8 }}
              animate={{ opacity: 1, y: -14, scale: 1 }}
              exit={{ opacity: 0, y: -26 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
              className="pointer-events-none absolute right-0 top-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-sm"
            >
              {cheer.text} +1
            </motion.span>
          )}
        </AnimatePresence>
      </motion.li>
    );
  };

  return (
    <section className="paper-card p-5">
      <h3 className="text-base">Your list</h3>

      {open.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing on it. Mention something to Billy in the chat and it lands here.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map((group) => (
            <div key={group.key}>
              {group.label && (
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
              )}
              <ul className="space-y-3">
                <AnimatePresence initial={false}>{group.items.map(renderTask)}</AnimatePresence>
              </ul>
            </div>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Recently done</p>
          <ul className="mt-2 space-y-1.5">
            <AnimatePresence initial={false}>
              {done.map((task) => (
                <motion.li
                  key={task.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="text-sm text-muted-foreground strike-in"
                >
                  {task.title}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}
    </section>
  );
}
