import billy from "@/assets/billy.png";
import { MOOD_STYLES, type Mood, type Signals } from "@/lib/mood";

export function MoodCard({
  mood,
  signals,
  threshold,
}: {
  mood: Mood;
  signals: Signals;
  threshold: number;
}) {
  return (
    <section className="paper-card p-5">
      <div className="flex items-start gap-4">
        <img src={billy} alt="Billy" width={816} height={816} className="h-16 w-16 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg">Billy</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${MOOD_STYLES[mood.key]}`}
            >
              {mood.label}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{mood.line}</p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
        {[
          { label: "waiting", value: signals.openCount },
          { label: "past due", value: signals.overdue.length },
          { label: `${threshold}d+ untouched`, value: signals.avoided.length },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-muted/70 px-2 py-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="font-display text-xl">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
