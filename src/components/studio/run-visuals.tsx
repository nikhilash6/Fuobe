"use client";

import type { RunStage } from "@/lib/run-stage";
import { cn } from "@/lib/utils";

/*
 * The look every run on its way shares, wherever it is waited on (the studios' feeds, a Library card, a Canvas node, a
 * film's shot): a soft living light across its card, and a ring beside its words.
 */

/** The living fill under a run on its way: a soft light that drifts (still under reduced motion). */
export function RunAura() {
  return <div aria-hidden className="run-aura absolute inset-0" />;
}

/**
 * The ring beside a run's words: its progress when it reports one, else a turning arc. A run in line waits calmly
 * (muted); one being made is in the brand colour.
 */
export function RunRing({ fraction, stage }: { fraction: number | null; stage: RunStage }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const spin = fraction == null;
  return (
    <svg
      viewBox="0 0 18 18"
      aria-hidden
      data-run-spinner
      className={cn("mt-px size-4 shrink-0", spin ? "animate-spin [animation-duration:1.4s] motion-reduce:animate-none" : "-rotate-90", stage === "in-line" ? "text-muted-foreground" : "text-primary")}
    >
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth="2" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c.toFixed(2)}
        strokeDashoffset={(spin ? c * 0.72 : c * (1 - Math.max(0.04, fraction))).toFixed(2)}
        className="transition-[stroke-dashoffset] duration-(--motion-slow) ease-standard"
      />
    </svg>
  );
}
