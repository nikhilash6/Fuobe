"use client";

import { useId } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CLOUD_ORIGINAL_SOUND, ORIGINAL_SOUNDS, type OriginalSound } from "@/lib/av/original-sound";
import type { Engine } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

/**
 * "Original sound" (src/lib/av/original-sound.ts): what of the clip's sound goes back under its new picture. On your GPU
 * all four choices; in the cloud Everything, with a line saying where the others run.
 */
export function OriginalSoundPicker({ engine, value, onChange, className, label = "Original sound" }: { engine: Engine; value: OriginalSound; onChange: (v: OriginalSound) => void; className?: string; label?: string }) {
  const id = useId();
  const cloud = engine === "cloud";
  const current = cloud ? "everything" : value;
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        <Select value={current} onValueChange={(v) => onChange(v as OriginalSound)} disabled={cloud}>
          <SelectTrigger id={id} className="h-8 w-auto min-w-[11rem] rounded-full text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORIGINAL_SOUNDS.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-[12px] text-pretty text-muted-foreground">{cloud ? CLOUD_ORIGINAL_SOUND : ORIGINAL_SOUNDS.find((o) => o.id === current)!.hint}</p>
    </div>
  );
}
