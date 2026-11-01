"use client";

import { Check, CircleDashed, Loader2, TriangleAlert } from "lucide-react";
import type { Generation } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

export interface StepRow {
  key: string;
  label: string;
  g?: Generation;
  /** Several jobs shown as one row (a dub's spoken lines): done when all are, failed when one is. */
  group?: (Generation | undefined)[];
}

type Shown = Pick<Generation, "status" | "progress" | "message" | "modelName" | "provider" | "error">;

/** One row's state: the job's own, or a group's roll-up (progress = the share done). */
function shownState(s: StepRow): { g?: Shown; counted?: string } {
  if (!s.group) return { g: s.g };
  const gs = s.group.filter((g): g is Generation => !!g);
  if (!gs.length) return {};
  const failed = gs.find((g) => g.status === "failed" || g.status === "canceled");
  const done = gs.filter((g) => g.status === "succeeded").length;
  const started = gs.some((g) => g.status === "running" || (g.status === "queued" && !g.message?.startsWith("Waits")));
  const status = failed ? failed.status : done === gs.length ? "succeeded" : started || done ? "running" : "queued";
  return {
    g: { status, progress: done / gs.length, message: null, modelName: gs[0].modelName, provider: gs.every((g) => g.provider === "mock") ? "mock" : gs[0].provider, error: failed?.error ?? null },
    counted: `${done}/${gs.length}`,
  };
}

/** One line per pipeline step: waiting, running (with progress), done or failed (with the reason). */
export function StepList({ steps, className }: { steps: StepRow[]; className?: string }) {
  return (
    <ol className={cn("space-y-1.5", className)} aria-label="Steps">
      {steps.map((s) => {
        const { g, counted } = shownState(s);
        const status = g?.status ?? "queued";
        const pct = g?.progress != null ? Math.round(g.progress * 100) : null;
        const waiting = status === "queued" && (!g || !!g.message?.startsWith("Waits") || !!counted);
        return (
          <li key={s.key} className="flex min-w-0 items-start gap-2.5 text-[13px]">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center">
              {status === "succeeded" ? (
                <span className="grid size-5 place-items-center rounded-full bg-success text-background">
                  <Check className="size-3" />
                </span>
              ) : status === "failed" || status === "canceled" ? (
                <TriangleAlert className="size-4 text-destructive" />
              ) : waiting ? (
                <CircleDashed className="size-4 text-subtle-foreground" />
              ) : (
                <Loader2 className="size-4 animate-spin text-brand-text" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className={cn("truncate font-medium", waiting && "text-muted-foreground")}>{s.label}</span>
                {g?.modelName && <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">{g.modelName}</span>}
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                  {status === "succeeded" ? "Done" : status === "failed" ? "Failed" : status === "canceled" ? "Canceled" : waiting ? "Waiting" : counted ?? (pct != null ? `${pct}%` : "Working")}
                  {g?.provider === "mock" && status === "succeeded" ? " · placeholder" : ""}
                </span>
              </div>
              {(status === "running" || (status === "queued" && !waiting)) && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full bg-primary transition-[width] duration-500", pct == null && "w-1/3 animate-pulse")} style={pct != null ? { width: `${Math.max(4, pct)}%` } : undefined} />
                </div>
              )}
              {(status === "failed" || status === "canceled") && g?.error && <p className="mt-0.5 text-[12px] leading-snug break-words text-destructive">{g.error}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Whether any of these generations still renders (poll while true). */
export const anyActive = (gs: (Generation | undefined)[]) => gs.some((g) => g && (g.status === "queued" || g.status === "running"));
