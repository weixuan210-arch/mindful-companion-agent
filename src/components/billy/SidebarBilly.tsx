import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AnimatedBilly, type BillyExpression } from "@/components/billy/AnimatedBilly";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const IDLE_FACES: Record<BillyExpression, BillyExpression[]> = {
  settled: ["settled", "curious", "settled", "thoughtful"],
  cheerful: ["cheerful", "settled", "cheerful", "curious"],
  curious: ["curious", "thoughtful", "curious", "settled"],
  thoughtful: ["thoughtful", "settled", "thoughtful", "curious"],
  caring: ["caring", "thoughtful", "caring", "settled"],
};

const EXPRESSION_CUES: Record<BillyExpression, string> = {
  settled: "I'm right here.",
  cheerful: "That made my ears perk up.",
  curious: "You've got my attention.",
  thoughtful: "Let me sit with that.",
  caring: "I'm keeping you company.",
};

export function SidebarBilly({
  expression,
  thinking,
  moodLabel,
  cue,
}: {
  expression: BillyExpression;
  thinking: boolean;
  moodLabel: string;
  cue?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);
  const [idleStep, setIdleStep] = useState(0);

  useEffect(() => {
    setIdleStep(0);
  }, [expression, thinking]);

  useEffect(() => {
    if (thinking || reduceMotion) return;
    const timer = window.setInterval(() => setIdleStep((step) => step + 1), 7200);
    return () => window.clearInterval(timer);
  }, [thinking, reduceMotion]);

  const idleFaces = IDLE_FACES[expression];
  const visibleExpression = thinking
    ? "thoughtful"
    : idleFaces[idleStep % idleFaces.length] ?? expression;
  const visibleCue = useMemo(
    () => (thinking ? "Thinking it through…" : cue?.trim() || EXPRESSION_CUES[expression]),
    [cue, expression, thinking],
  );

  return (
    <motion.section
      layout={!reduceMotion}
      className={cn(
        "fixed bottom-4 right-4 z-30 border border-border bg-card shadow-lifted lg:sticky lg:bottom-6 lg:z-10",
        collapsed ? "rounded-full" : "w-[min(17rem,calc(100vw-2rem))] rounded-xl lg:w-full",
      )}
      aria-label="Billy companion"
    >
      {collapsed ? (
        <Button
          type="button"
          variant="ghost"
          className="h-16 w-16 rounded-full p-1"
          onClick={() => setCollapsed(false)}
          aria-label="Show Billy"
          title="Show Billy"
        >
          <AnimatedBilly expression={visibleExpression} thinking={thinking} />
        </Button>
      ) : (
        <div className="relative overflow-hidden px-4 pb-4 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full", thinking ? "animate-pulse bg-primary" : "bg-mood-settled-foreground")} />
              {thinking ? "Listening closely" : moodLabel}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setCollapsed(true)}
              aria-label="Tuck Billy away"
              title="Tuck Billy away"
            >
              <ChevronDown />
            </Button>
          </div>

          <div className="mt-1 flex items-end gap-2">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={visibleExpression}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0, scale: 1.03 }}
                transition={{ duration: 0.3 }}
              >
                <AnimatedBilly expression={visibleExpression} size="companion" thinking={thinking} />
              </motion.div>
            </AnimatePresence>
            <motion.div
              key={visibleCue}
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3 min-w-0 flex-1 rounded-lg rounded-bl-sm bg-secondary px-3 py-2 text-sm leading-snug text-secondary-foreground"
            >
              <MessageCircle className="mb-1 h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <p className="line-clamp-3">{visibleCue}</p>
            </motion.div>
          </div>
        </div>
      )}
    </motion.section>
  );
}