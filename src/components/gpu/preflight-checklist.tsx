"use client";

import { CheckCircle2, Circle, CircleAlert, CircleX, Loader2 } from "lucide-react";
import type { CheckLine } from "@/lib/gpu/types";
import { cn } from "@/lib/utils";

const STEPS: { step: CheckLine["step"]; waiting: string }[] = [
  { step: "found", waiting: "Looking for ComfyUI" },
  { step: "gpu", waiting: "Reading your graphics card" },
  { step: "models", waiting: "Looking through your models" },
  { step: "addons", waiting: "Checking add-ons" },
  { step: "manager", waiting: "Looking for ComfyUI-Manager" },
  { step: "match", waiting: "Matching the studios to your GPU" },
];

const WORD: Record<CheckLine["state"], string> = { running: "checking", done: "done", warn: "needs you", fail: "needs you" };

/**
 * The live checklist (UX §4 step 2): one line per step, each changing in place as its answer comes, never
 * reset. One polite live region says what changed; icons are decoration, the state is also a word.
 */
export function PreflightChecklist({ lines, running }: { lines: CheckLine[]; running: boolean }) {
  const failed = lines.some((l) => l.step === "found" && l.state === "fail");
  type Shown = Omit<CheckLine, "state"> & { state: CheckLine["state"] | "pending" };
  const shown: Shown[] = STEPS.flatMap(({ step, waiting }): Shown[] => {
    const l = lines.find((x) => x.step === step);
    if (l) return [l];
    if (!running || failed) return [];
    return [{ step, state: "pending", text: waiting }];
  });
  const last = lines.at(-1);
  return (
    <div>
      <ol aria-label="Setup checks" className="space-y-2">
        {shown.map((l) => {
          const state = l.state;
          const Icon = state === "pending" ? Circle : state === "running" ? Loader2 : state === "done" ? CheckCircle2 : state === "warn" ? CircleAlert : CircleX;
          return (
            <li key={l.step} className="animate-fade-up flex items-start gap-2.5 text-[14px] motion-reduce:animate-none">
              <Icon
                aria-hidden
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  state === "running" && "animate-spin text-muted-foreground motion-reduce:animate-none",
                  state === "pending" && "text-muted-foreground/50",
                  state === "done" && "text-success",
                  state === "warn" && "text-warning",
                  state === "fail" && "text-destructive",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className={cn(state === "pending" && "text-muted-foreground")}>{l.text}</span>
                <span className="sr-only"> ({state === "pending" ? "waiting" : WORD[state]})</span>
                {l.detail && <span className="block text-[12px] text-muted-foreground">{l.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <div aria-live="polite" className="sr-only">
        {last && last.state !== "running" ? last.text : ""}
      </div>
    </div>
  );
}
