import { formatDistanceToNowStrict } from "date-fns";

import { Checkbox } from "@/components/ui/checkbox";
import type { TaskLike } from "@/lib/mood";

type Task = TaskLike & { details: string | null };

export function TaskList({
  tasks,
  threshold,
  onToggle,
}: {
  tasks: Task[];
  threshold: number;
  onToggle: (task: Task, done: boolean) => void;
}) {
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done").slice(-4).reverse();
  const now = Date.now();

  return (
    <section className="paper-card p-5">
      <h3 className="text-base">Your list</h3>

      {open.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing on it. Mention something to Billy in the chat and it lands here.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {open.map((task) => {
            const ageDays = Math.floor((now - new Date(task.created_at).getTime()) / 86400000);
            const overdue = task.due_at ? new Date(task.due_at).getTime() < now : false;
            const stale = ageDays >= threshold;
            return (
              <li key={task.id} className="flex items-start gap-3">
                <Checkbox
                  className="mt-0.5"
                  checked={false}
                  onCheckedChange={(value) => onToggle(task, value === true)}
                  aria-label={`Mark ${task.title} as done`}
                />
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
              </li>
            );
          })}
        </ul>
      )}

      {done.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Recently done</p>
          <ul className="mt-2 space-y-1.5">
            {done.map((task) => (
              <li key={task.id} className="text-sm text-muted-foreground line-through">
                {task.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
