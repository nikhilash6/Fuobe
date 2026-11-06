import type { GenParams } from "./types";

/*
 * What a finished run was made at, for the views that show it (the feed card, the run details, the Library). Kept apart
 * from fitted.ts, which works it out from the field maps, so these views load no catalog code.
 */

export type FittedSetting = "aspectRatio" | "resolution" | "duration" | "seed" | "numOutputs" | "negativePrompt" | "generateAudio" | "shots";

/** One setting the run makes differently from what it asks. */
export interface SettingChange {
  setting: FittedSetting;
  /** The setting's name as the run details say it ("Quality"). */
  label: string;
  /** What was asked and what is made, as shown ("2K", "1080p"; "Its own" when the setting isn't sent). */
  asked: string;
  made: string;
  /** Why, short: "the most this model makes" (API run records). */
  reason: string;
  /** The whole sentence, for before a run: "MiniMax H3 Max Turbo makes up to 1080p, so this is made at 1080p". */
  note: string;
  /** The value to pick instead (a picker's "Use 1080p"), when there is one. */
  use?: string | number;
}

/** The settings a run is made at (undefined: not sent, the model picks), and what differs from the request. */
export interface MadeSettings {
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  seed?: number;
  numOutputs?: number;
  changes: SettingChange[];
}

/** "1080P" → "1080p", "2k" → "2K"; other values as they are. */
export function tierWords(v: string): string {
  const m = /^(\d+(?:\.\d+)?)\s*([pk])$/i.exec(v.trim());
  return m ? `${m[1]}${m[2].toLowerCase() === "k" ? "K" : "p"}` : v;
}

/** A run's settings as made (its `made`, else what it asked), for the feed card and the run details. */
export function shownSettings(g: { request: { params?: GenParams }; made?: MadeSettings }): { aspectRatio?: string; resolution?: string; duration?: number; seed?: number } {
  const p = g.request.params ?? {};
  const m = g.made;
  if (!m) return { aspectRatio: p.aspectRatio, resolution: p.resolution && tierWords(p.resolution), duration: p.duration, seed: p.seed };
  return { aspectRatio: m.aspectRatio, resolution: m.resolution && tierWords(m.resolution), duration: m.duration, seed: m.seed };
}

