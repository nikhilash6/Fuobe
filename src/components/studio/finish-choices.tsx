"use client";

import { Cpu } from "lucide-react";
import type { Engine, ModelDef } from "@/lib/catalog/types";
import { REGEN_COPY, REGEN_MODEL, type FINISH_CHOICES } from "@/lib/catalog/regenerate";
import { cn } from "@/lib/utils";
import { radioKeys, radioTab } from "./radio-keys";

/**
 * Upscale → Video's two open finishing steps side by side (StudioConfig.finishChoices): SeedVR2 "Restore · faithful" and
 * Open-H3 "Regenerate · creative". On the cloud engine (both engines on) Regenerate says it runs on your GPU, with a
 * button that takes the composer there; with Engine mode "Paid APIs only" nothing shows. GPU-only: nobody hosts it.
 */
export function FinishChoices({
  choices,
  model,
  engine,
  engineMode,
  offered,
  onPick,
}: {
  choices: typeof FINISH_CHOICES;
  model: ModelDef | undefined;
  engine: Engine;
  engineMode: "both" | "open" | "cloud";
  /** The choices Settings → Models & licences leaves on (and this catalog has). */
  offered: (id: string) => ModelDef | undefined;
  onPick: (m: ModelDef) => void;
}) {
  if (engineMode === "cloud") return null;
  const regen = offered(REGEN_MODEL);
  if (engine === "cloud") {
    if (!regen) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 pb-2 text-[12px] leading-snug text-muted-foreground">
        <Cpu className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">
          <span className="font-medium text-foreground">Regenerate · creative</span> · {REGEN_COPY.gpuOnly}
        </span>
        <button
          type="button"
          onClick={() => onPick(regen)}
          className="rounded-full px-1.5 font-medium text-brand-text underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Use it on your GPU
        </button>
      </div>
    );
  }
  const shown = choices.map((c) => ({ ...c, m: offered(c.modelId) })).filter((c) => !!c.m);
  if (shown.length < 2) return null;
  const picked = shown.find((c) => c.modelId === model?.id);
  return (
    <div className="px-1.5 pb-2">
      <div role="radiogroup" aria-label="How to finish the clip" onKeyDown={radioKeys} className="grid grid-cols-2 gap-1.5">
        {shown.map((c) => {
          const sel = c.modelId === model?.id;
          return (
            <button
              key={c.modelId}
              type="button"
              role="radio"
              aria-checked={sel}
              tabIndex={radioTab(sel || (!picked && c === shown[0]))}
              onClick={() => !sel && onPick(c.m!)}
              className={cn(
                "min-w-0 rounded-xl border px-2.5 py-1.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                sel ? "border-primary bg-brand-faint" : "hover:bg-accent",
              )}
            >
              <span className={cn("block text-[12px] font-medium", sel ? "text-brand-text" : "text-foreground")}>{c.label}</span>
              <span className="block text-[11px] leading-snug text-pretty text-muted-foreground">{c.hint}</span>
            </button>
          );
        })}
      </div>
      {model?.id === REGEN_MODEL && <p className="mt-1.5 px-1 text-[11px] leading-snug text-pretty text-muted-foreground">Free on your GPU · {REGEN_COPY.gpu}</p>}
    </div>
  );
}
