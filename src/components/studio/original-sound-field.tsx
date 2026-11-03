"use client";

import { Cloud, Cpu } from "lucide-react";
import { useId } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  CLOUD_SOUND_NOTE,
  ORIGINAL_SOUNDS,
  originalSoundLabel,
  soundOf,
  SOUND_LOWER_DEFAULT_DB,
  SOUND_LOWER_MAX_DB,
  SOUND_LOWER_MIN_DB,
  type OriginalSound,
  type SoundChoice,
} from "@/lib/av/original-sound";
import type { Engine } from "@/lib/catalog/types";

/**
 * "Original sound" (src/lib/av/original-sound.ts): what of a clip's sound a studio puts back under its result.
 * Everything on both engines; Music & effects only, Dialogue only and Lower the music on your GPU (the cloud lists them
 * turned off, with the reason). `suggested` marks the studio's own suggestion (a person replaced: Music & effects only).
 */
export function OriginalSoundField({
  engine,
  value,
  onChange,
  hasAudio,
  suggested,
  disabled,
  label = "Original sound",
}: {
  engine: Engine;
  value: SoundChoice;
  onChange: (v: SoundChoice) => void;
  /** False: the clip has no sound (the field says so and stays off). */
  hasAudio?: boolean;
  suggested?: OriginalSound;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const cloud = engine === "cloud";
  // The cloud puts back everything: a choice made on your GPU shows as Everything there (and is kept for the switch back).
  const shown: OriginalSound = cloud ? "everything" : soundOf(value);
  const musicDb = value.musicDb ?? SOUND_LOWER_DEFAULT_DB;
  const silent = hasAudio === false;
  const hint = ORIGINAL_SOUNDS.find((o) => o.id === shown)?.hint;
  return (
    <div className="min-w-0 space-y-1.5" data-testid="original-sound">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`${id}-sound`} className="text-[13px] font-medium">
          {label}
        </label>
        <span className="inline-flex min-w-0 items-center gap-1 truncate text-[12px] text-muted-foreground">
          {cloud ? <Cloud className="size-3 shrink-0" /> : <Cpu className="size-3 shrink-0" />}
          {cloud ? "Everything in the cloud" : "Free on your GPU"}
        </span>
      </div>
      <Select
        value={shown}
        onValueChange={(v) => onChange({ ...value, sound: v as OriginalSound, ...(v === "lower-music" && value.musicDb === undefined ? { musicDb: SOUND_LOWER_DEFAULT_DB } : {}) })}
        disabled={disabled || silent}
      >
        <SelectTrigger id={`${id}-sound`} className="w-full" aria-label={label}>
          <SelectValue>{originalSoundLabel(shown)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ORIGINAL_SOUNDS.map((o) => (
            <SelectItem key={o.id} value={o.id} disabled={cloud && o.id !== "everything"}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">
                  {o.label}
                  {suggested === o.id && o.id !== "everything" && !cloud && <span className="ml-1.5 rounded bg-brand-faint px-1 text-[10px] text-brand-text">suggested</span>}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">{cloud && o.id !== "everything" ? "On your GPU (open source)" : o.hint}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {silent ? (
        <p className="text-[12px] leading-snug text-muted-foreground">This clip has no sound to put back.</p>
      ) : cloud ? (
        <p className="text-[12px] leading-snug text-muted-foreground">{CLOUD_SOUND_NOTE}</p>
      ) : shown === "lower-music" ? (
        <div className="flex min-w-0 items-center gap-3 pt-1">
          <label htmlFor={`${id}-db`} className="shrink-0 text-[12px] text-muted-foreground">
            Music &amp; effects
          </label>
          <Slider
            id={`${id}-db`}
            min={SOUND_LOWER_MIN_DB}
            max={SOUND_LOWER_MAX_DB}
            step={1}
            value={[musicDb]}
            onValueChange={([v]) => onChange({ ...value, sound: "lower-music", musicDb: v })}
            aria-label="Music and effects level"
            aria-valuetext={`${musicDb} dB`}
            disabled={disabled}
            className="min-w-0 flex-1"
          />
          <span className="w-14 shrink-0 text-right font-mono text-[12px] tabular-nums">{musicDb === 0 ? "0 dB" : `−${Math.abs(musicDb)} dB`}</span>
        </div>
      ) : (
        <p className="text-[12px] leading-snug text-muted-foreground">
          {hint}
          {shown !== "everything" ? ". The clip's sound is split into dialogue, music and effects first." : "."}
        </p>
      )}
    </div>
  );
}

/** What the run asks the server for: nothing for Everything (the studios' default), the choice otherwise. */
export function soundBody(engine: Engine, v: SoundChoice): { sound?: SoundChoice } {
  const s = soundOf(v);
  if (engine === "cloud" || s === "everything") return {};
  return { sound: s === "lower-music" ? { sound: s, musicDb: v.musicDb ?? SOUND_LOWER_DEFAULT_DB } : { sound: s } };
}
