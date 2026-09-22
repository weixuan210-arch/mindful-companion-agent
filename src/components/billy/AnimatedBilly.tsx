import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import billyCaring from "@/assets/billy-caring.png";
import billyCheerful from "@/assets/billy-cheerful.png";
import billyCurious from "@/assets/billy-curious.png";
import billyThoughtful from "@/assets/billy-thoughtful.png";
import billySettled from "@/assets/billy.png";
import type { MoodKey } from "@/lib/mood";
import { cn } from "@/lib/utils";

export type BillyExpression = "settled" | "cheerful" | "curious" | "thoughtful" | "caring";

const PORTRAITS: Record<BillyExpression, string> = {
  settled: billySettled,
  cheerful: billyCheerful,
  curious: billyCurious,
  thoughtful: billyThoughtful,
  caring: billyCaring,
};

const LABELS: Record<BillyExpression, string> = {
  settled: "Billy looks calm",
  cheerful: "Billy looks cheerful",
  curious: "Billy looks curious",
  thoughtful: "Billy looks thoughtful",
  caring: "Billy looks caring",
};

export function moodExpression(mood: MoodKey): BillyExpression {
  if (mood === "heavy" || mood === "tender") return "caring";
  if (mood === "attentive") return "thoughtful";
  return "settled";
}

export function expressionFromText(text: string, fallback: BillyExpression): BillyExpression {
  const normalized = text.toLowerCase();
  if (!normalized.trim()) return fallback;

  if (
    /\b(sorry|hard|heavy|hurt|painful|worry|worried|overwhelm|tough|gentle|with you|take your time)\b/.test(
      normalized,
    )
  ) {
    return "caring";
  }
  if (
    /\b(done|nice|good|great|glad|happy|saved|added|sorted|finished|lovely|welcome back)\b/.test(
      normalized,
    )
  ) {
    return "cheerful";
  }
  if (normalized.includes("?") || /\b(tell me|what do you|shall we|would you|which one)\b/.test(normalized)) {
    return "curious";
  }
  if (/\b(think|perhaps|maybe|notice|pattern|seems|wonder|consider|looking at)\b/.test(normalized)) {
    return "thoughtful";
  }
  return fallback;
}

export function AnimatedBilly({
  expression,
  size = "message",
  thinking = false,
  className,
}: {
  expression: BillyExpression;
  size?: "message" | "thinking" | "companion";
  thinking?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const dimension =
    size === "companion" ? "h-28 w-28" : size === "thinking" ? "h-16 w-16" : "h-12 w-12";

  return (
    <motion.div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full border border-border bg-accent/45 shadow-sm",
        dimension,
        className,
      )}
      {...(!reduceMotion
        ? {
            animate: thinking
              ? { y: [0, -3, 0], rotate: [-1.5, 1.5, -1.5] }
              : size === "companion"
                ? { y: [0, -3, 0], rotate: [0, 0.8, 0, -0.8, 0] }
                : { y: [0, -1.5, 0] },
          }
        : {})}
      transition={{ duration: thinking ? 1.35 : size === "companion" ? 4.8 : 3.6, repeat: Infinity, ease: "easeInOut" }}
      role="img"
      aria-label={thinking ? "Billy is thinking" : LABELS[expression]}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.img
          key={expression}
          src={PORTRAITS[expression]}
          alt=""
          className="absolute left-1/2 top-1/2 h-[148%] w-[148%] max-w-none -translate-x-1/2 -translate-y-[45%] object-contain"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.94, rotate: -2 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          {...(!reduceMotion ? { exit: { opacity: 0, scale: 1.03 } } : {})}
          transition={{ duration: 0.24, ease: "easeOut" }}
        />
      </AnimatePresence>

      {!reduceMotion && !thinking && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-card"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0, 0.18, 0, 0] }}
          transition={{ duration: 0.16, repeat: Infinity, repeatDelay: 4.6, ease: "easeInOut" }}
        />
      )}

      {thinking && (
        <span className="absolute bottom-1.5 right-1.5 flex gap-0.5" aria-hidden="true">
          {[0, 1, 2].map((dot) => (
            <motion.span
              key={dot}
              className="h-1 w-1 rounded-full bg-primary"
              {...(!reduceMotion
                ? { animate: { y: [0, -2, 0], opacity: [0.45, 1, 0.45] } }
                : {})}
              transition={{ duration: 0.8, repeat: Infinity, delay: dot * 0.14 }}
            />
          ))}
        </span>
      )}
    </motion.div>
  );
}