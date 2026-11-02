"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { BED_NOTES, VOICE_FIRST_HINTS, VOICE_FIRST_LABEL, voiceFirstLine } from "@/lib/av/voice-first";
import type { Engine, ModelDef } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

/**
 * "Clean the voice first" (src/lib/av/voice-first.ts) where speech feeds a model: Transcribe, Lipsync & avatars,
 * Captions, Genjutsu's "What's said" and Character Swap Studio's transcript. One line: the switch, what it does on this
 * engine, and what it adds (time on your GPU, the price in the cloud). For a lip re-sync of a clip, a second line says
 * what happens to the clip's music and effects. Always the same height, on or off, so nothing moves.
 */
export function VoiceFirstSwitch({
  engine,
  on,
  onChange,
  seconds,
  device,
  bed,
  clip,
  getModel,
  price,
  className,
}: {
  engine: Engine;
  on: boolean;
  onChange: (on: boolean) => void;
  /** Seconds the speech runs, when known. */
  seconds?: number;
  /** Your GPU's device ("cuda", "cpu"), when known: the time's range. */
  device?: string | null;
  /** The clip's music and effects go back after the lip sync (open engine). */
  bed?: boolean;
  /** A lip re-sync of a clip: say what happens to its music and effects. */
  clip?: boolean;
  /** The catalog, where the page has it (its price for the cloud step); else the step's list price. */
  getModel?: (id: string) => ModelDef | undefined;
  /** The price line, when the page has its own (Character Swap Studio's estimate). */
  price?: string;
  className?: string;
}) {
  const id = useId();
  const line = price ?? voiceFirstLine({ engine, seconds, device, bed, getModel });
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)} data-voice-first>
      {/* On a phone the time or price goes under the words, so they keep the width. */}
      <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-0.5">
        <Switch id={id} checked={on} onCheckedChange={onChange} className="mt-px shrink-0" />
        <label htmlFor={id} className="min-w-0 flex-1 text-[12px] leading-snug">
          <span className="font-medium">{VOICE_FIRST_LABEL}</span>
          <span className="text-muted-foreground"> · {VOICE_FIRST_HINTS[engine]}</span>
        </label>
        <span className="basis-full pl-11 font-mono text-[11px] text-muted-foreground tabular-nums sm:basis-auto sm:shrink-0 sm:pl-0">{line}</span>
      </div>
      {clip && <p className="pl-11 text-[11.5px] leading-snug text-muted-foreground">{BED_NOTES[engine]}</p>}
    </div>
  );
}
