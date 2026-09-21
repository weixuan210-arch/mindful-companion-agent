import { Leaf } from "lucide-react";

import type { Nudge } from "@/lib/mood";
import { Button } from "@/components/ui/button";

/**
 * Passive nudge: it appears when the app is opened, never pushed.
 * Only rendered once a pattern has persisted — see computeNudge().
 */
export function NudgeCard({ nudge, onTalk }: { nudge: Nudge; onTalk: () => void }) {
  return (
    <section className="paper-card border-primary/25 bg-accent/40 p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-full bg-primary/15 p-2 text-primary">
          <Leaf className="size-4" />
        </span>
        <div>
          <h3 className="text-base">{nudge.headline}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{nudge.body}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={onTalk}>
            Talk it through
          </Button>
        </div>
      </div>
    </section>
  );
}
