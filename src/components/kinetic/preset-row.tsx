"use client";

import { Check } from "lucide-react";
import { PRESETS, presetOf, type PresetCategory } from "@/lib/motion/edit";
import type { Recipe } from "@/lib/motion/recipe";
import { cn } from "@/lib/utils";

/**
 * A category's presets (at most four), each with its one line of purpose. The one whose values the recipe has exactly
 * is marked; when none matches, "Custom" shows. Presets aren't stored: the label is worked out from the values, so undo
 * and redo keep it right.
 */
export function PresetRow({ category, recipe, onPick, label }: { category: PresetCategory; recipe: Recipe; onPick: (id: string) => void; label: string }) {
  const current = presetOf(category, recipe);
  return (
    <div className="min-w-0" data-kinetic-presets={category}>
      <p className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
        {label}
        {current === "custom" && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium md:text-[12px] text-foreground" data-kinetic-custom>
            Custom
          </span>
        )}
      </p>
      <div role="radiogroup" aria-label={label} className="grid min-w-0 grid-cols-2 gap-1.5">
        {PRESETS[category].map((p) => {
          const on = current === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(p.id)}
              className={cn("relative flex min-h-14 min-w-0 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", on ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-accent")}
            >
              <span className="flex w-full min-w-0 items-center gap-1 text-[13px] font-medium">
                <span className="truncate">{p.name}</span>
                {on && <Check className="ml-auto size-3.5 shrink-0" aria-hidden />}
              </span>
              <span className={cn("line-clamp-2 text-[11px] leading-snug md:text-[12px]", on ? "text-background/75" : "text-muted-foreground")}>{p.purpose}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
