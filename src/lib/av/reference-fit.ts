import { clipTotalSeconds, elementClipSeconds, referenceSeconds, referenceVoiceSeconds } from "@/lib/catalog/clip-windows";
import type { StudioElement } from "@/lib/catalog/elements";
import type { GenerationRequest, ModelDef } from "@/lib/catalog/types";
import { H3_REFERENCE_LIMITS, openReferenceMode } from "@/lib/h3-references";

/**
 * Reference clips and sound held to a length: each one between `min` and `max` seconds, and (where the model says) at most
 * `total` seconds of them together. Which one to offer a part of (src/components/av/trim-picker.tsx), and what to say.
 * Pure, so Cinema Studio's references, the H3 reference tray, Kling 4.0's clip elements and the tests share it.
 * - A clip or sound over `max`: a part of it is offered.
 * - All of them together over `total`: how much to cut is said, and a part of the longest one is offered.
 * - One under `min` can't be made longer: it is said, with what to do.
 */

export interface ClipWindow {
  min: number;
  max: number;
  /** The most seconds of them together. */
  total?: number;
}

/** A header's length can run a frame or so past the cut that made it: a few hundredths over are let through. */
const SLACK = 0.05;

const sec = (n: number) => `${Math.round(n * 10) / 10} s`;

/**
 * The window a model holds its reference clips ("videos") or sound ("audios") to, or `fallback` (the studio's own):
 * MiniMax H3 and H3 Max Turbo in the cloud (2–15 s each, 15 s together), Vidu Q4's voices (3–12 s each), H3 on your GPU
 * (Pika's limits, the same).
 */
export function referenceWindow(model: Pick<ModelDef, "id" | "engine" | "routes" | "options"> | undefined, kind: "videos" | "audios", fallback?: ClipWindow): ClipWindow | undefined {
  if (!model) return fallback;
  if (model.engine !== "open") {
    const hosted = referenceSeconds(model.id);
    if (hosted?.kinds.includes(kind)) return { min: hosted.min, max: hosted.max, total: hosted.total };
    const voice = kind === "audios" ? referenceVoiceSeconds(model.id) : undefined;
    if (voice) return { ...voice };
  } else if (openReferenceMode(model as ModelDef)) {
    const L = H3_REFERENCE_LIMITS;
    return { min: L.minSec, max: L.maxSec, total: L.groupSec };
  }
  return fallback;
}

export interface TrimTarget {
  /** Which one (its place in the list). */
  index: number;
  /** The longest part of it to keep. */
  max: number;
  /** Seconds to cut from them together (when they are over `total`). */
  over?: number;
}

/**
 * The one to offer a part of: the first over `max` (the part is up to `max`); else, when they are over `total` together,
 * the longest that can still be cut (the part keeps what fits, never under `min`). Null when they fit, or nothing can
 * be cut. A length not known yet counts as nothing.
 */
export function trimTarget(seconds: readonly (number | undefined)[], w: ClipWindow): TrimTarget | null {
  for (const [index, s] of seconds.entries()) if (s !== undefined && s > w.max + SLACK) return { index, max: w.max };
  if (w.total === undefined) return null;
  const sum = seconds.reduce<number>((a, s) => a + (s ?? 0), 0);
  const over = sum - w.total;
  if (over <= SLACK) return null;
  let index = -1;
  for (const [i, s] of seconds.entries()) if (s !== undefined && s > w.min + SLACK && (index < 0 || s > seconds[index]!)) index = i;
  if (index < 0) return null;
  const keep = Math.floor((seconds[index]! - over) * 10) / 10;
  return { index, max: Math.max(w.min, keep), over: Math.ceil(over * 10) / 10 };
}

export interface WindowWords {
  /** The model's name: "MiniMax H3". */
  model: string;
  /** One of them by its place: "Clip 2", "Voice 1". */
  label: (index: number) => string;
  /** All of them: "The reference clips". */
  all: string;
}

/** What is wrong with their lengths, in a line with what to do, or null. */
export function windowProblem(seconds: readonly (number | undefined)[], w: ClipWindow, words: WindowWords): string | null {
  for (const [i, s] of seconds.entries()) {
    if (s === undefined || !(s > 0)) continue;
    if (s < w.min - SLACK) return `${words.label(i)} is ${sec(s)}, and ${words.model} needs at least ${w.min} s: use a longer one`;
    if (s > w.max + SLACK) return `${words.label(i)} is ${sec(s)}, and ${words.model} takes up to ${w.max} s: trim it first`;
  }
  if (w.total === undefined) return null;
  const sum = seconds.reduce<number>((a, s) => a + (s ?? 0), 0);
  if (sum <= w.total + SLACK) return null;
  return `${words.all} add up to ${sec(sum)}, and ${words.model} takes ${w.total} s of them together: cut ${sec(Math.ceil((sum - w.total) * 10) / 10)}`;
}

/** The picker's line for a target: why a part is asked, and of which one. */
export function trimLine(seconds: readonly (number | undefined)[], t: TrimTarget, w: ClipWindow, words: WindowWords): string {
  const s = seconds[t.index] ?? 0;
  if (!t.over) return `${words.label(t.index)} is ${sec(s)}. ${words.model} takes up to ${w.max} s: pick the part to use`;
  const sum = seconds.reduce<number>((a, x) => a + (x ?? 0), 0);
  return `${words.all} add up to ${sec(sum)}, and ${words.model} takes ${w.total} s together. Cut ${sec(t.over)}: pick the part of ${words.label(t.index)} to keep`;
}

// ---------------------------------------------------------------------------
// Clip elements (Kling 4.0: a character or prop given as a 3–8 s clip, with every clip of the run 30 s in all)

/** A clip that goes to the run as one of the model's elements, and the element it belongs to. */
export interface ElementClip {
  element: StudioElement;
  /** The clip (/api/files/…). */
  ref: string;
}

/** The mentioned elements whose clip goes to the run as the model's element (the request as applyMentions resolved it). */
export function elementClips(request: Pick<GenerationRequest, "params" | "inputs">, mentioned: readonly StudioElement[]): ElementClip[] {
  const videos = request.inputs?.videos ?? [];
  const out: ElementClip[] = [];
  for (const g of request.params?.elements ?? []) {
    const ref = g.video !== undefined ? videos[g.video] : undefined;
    const element = ref ? mentioned.find((e) => e.references.includes(ref)) : undefined;
    if (ref && element) out.push({ element, ref });
  }
  return out;
}

/**
 * Clip elements outside the model's window, in a line with what to do, and the clip to offer a part of: one over its
 * length, or the longest when the run's clips together (`others`: the clip edited and the reference clips, which aren't
 * cut here) are over what the model takes in all. Null when they fit, or the model holds clip elements to nothing.
 */
export function elementClipCheck(
  model: Pick<ModelDef, "id" | "name">,
  clips: readonly { name: string; seconds?: number }[],
  others = 0,
): { problem: string; target: (TrimTarget & { min: number; line: string }) | null } | null {
  const each = elementClipSeconds(model.id);
  const all = clipTotalSeconds(model.id);
  if (!each || !clips.length) return null;
  const seconds = clips.map((c) => c.seconds);
  for (const [i, s] of seconds.entries()) {
    if (s === undefined || !(s > 0) || s >= each.min - SLACK) continue;
    return { problem: `${model.name} takes ${each.min}–${each.max} s clips as elements, and ${clips[i].name}'s is ${sec(s)}: give ${clips[i].name} a longer clip, or photos instead`, target: null };
  }
  const w: ClipWindow = { ...each, ...(all !== undefined && { total: Math.max(0, all - others) }) };
  const t = trimTarget(seconds, w);
  const name = (i: number) => clips[i].name;
  if (t && !t.over) {
    const s = seconds[t.index]!;
    return {
      problem: `${model.name} takes ${each.min}–${each.max} s clips as elements, and ${name(t.index)}'s is ${sec(s)}: trim it`,
      target: { ...t, min: each.min, line: `${name(t.index)}'s clip is ${sec(s)}. ${model.name} takes ${each.min}–${each.max} s clips as elements: pick the part to use` },
    };
  }
  const sum = others + seconds.reduce<number>((a, s) => a + (s ?? 0), 0);
  if (all === undefined || sum <= all + SLACK) return null;
  const cut = sec(Math.ceil((sum - all) * 10) / 10);
  const problem = `The clips add up to ${sec(sum)} (the clip you edit, reference clips and clip elements together), and ${model.name} takes ${all} s in all: cut ${cut}`;
  return {
    problem,
    target: t ? { ...t, min: each.min, line: `The clips add up to ${sec(sum)}, and ${model.name} takes ${all} s in all. Cut ${cut}: pick the part of ${name(t.index)}'s clip to keep` } : null,
  };
}

/** The model that takes clips as elements (Kling 4.0, 3–8 s): an element's clip is fitted to it where it is attached. */
export const ELEMENT_CLIP_MODEL = { id: "kling-4", name: "Kling 4.0" } as const;

/** The window an element's clip is fitted to where it is attached, or undefined. */
export const elementClipWindow = (): ClipWindow | undefined => elementClipSeconds(ELEMENT_CLIP_MODEL.id);
