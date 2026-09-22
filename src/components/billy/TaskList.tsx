import { formatDistanceToNowStrict } from "date-fns";
import { AnimatePresence, motion } from "motion/react";

import { Checkbox } from "@/components/ui/checkbox";
import type { TaskLike } from "@/lib/mood";

type Task = TaskLike & { details: string | null; project_id: string | null };
type Project = { id: string; name: string };

export function TaskList({
  tasks,
  projects,
  threshold,
  onToggle,
}: {
  tasks: Task[];
  projects: Project[];
  threshold: number;
  onToggle: (task: Task, done: boolean) => void;
}) {
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done").slice(-4).reverse();
  const now = Date.now();

  // Grouped by project, in the order projects were created, unsorted last.
  const groups: { key: string; label: string; items: Task[] }[] = [];
  for (const project of projects) {
    const items = open.filter((t) => t.project_id === project.id);
    if (items.length > 0) groups.push({ key: project.id, label: project.name, items });
  }
  const unsorted = open.filter((t) => !t.project_id || !projects.some((p) => p.id === t.project_id));
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
        className="flex items-start gap-3"
        exit={{ opacity: 0, x: 16, transition: { duration: 0.25, ease: "easeIn" } }}
      >
        <motion.span
          className="mt-0.5"
          whileTap={{ scale: 0.85 }}
          transition={{ type: "spring", stiffness: 500, damping: 15 }}
        >
          <Checkbox
            checked={false}
            onCheckedChange={(value) => onToggle(task, value === true)}
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
