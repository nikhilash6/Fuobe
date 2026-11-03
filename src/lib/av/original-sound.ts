import type { ChainSlot, Engine, GenerationRequest } from "@/lib/catalog/types";
import type { PlanStep } from "@/lib/catalog/shorts";
import { clampLowerDb, LOWER_DEFAULT_DB, LOWER_MAX_DB, LOWER_MIN_DB, muxChain, type DialogueOutcome } from "./remove-dialogue";
import { dbsChannelsFor, SPLIT_MODEL } from "./split";

/**
 * "Original sound" (DBS D7, docs/research/dbs-separation-7.md §8 and §9 D7): when a studio puts a clip's own sound back
 * under its result (Shorts, Mixed Media, Genjutsu, Remove object, Character Swap Studio), the user picks what goes
 * back: Everything (as before), Music & effects only, Dialogue only, or the dialogue with the music lowered. Pure: the
 * studios' planners and pages share it.
 *
 * - Open engine: graph A (separate-soundtrack-dbs on oss-dbs-separate) splits the working clip's soundtrack (the
 *   trimmed source, not the result), then the studio's own stream-copy mux (oss-mux) takes the chosen stem: background
 *   or voice (video-mux-audio-replace), or the voice over the background at a lower level (video-mux-audio). No new graph.
 * - Cloud: Everything only. DBS is hosted nowhere and SAM Audio in its place is the owner's call, not taken
 *   (docs/handoff/owner-decisions.json samAudioCloud: false), so the other choices say they run on your GPU.
 */

export type OriginalSound = "everything" | DialogueOutcome;

export const ORIGINAL_SOUNDS: { id: OriginalSound; label: string; hint: string }[] = [
  { id: "everything", label: "Everything", hint: "The clip's sound as it was" },
  { id: "no-dialogue", label: "Music & effects only", hint: "The talking taken out" },
  { id: "dialogue-only", label: "Dialogue only", hint: "Just the talking" },
  { id: "lower-music", label: "Lower the music", hint: "The talking, with the music and effects quieter" },
];
export const originalSoundLabel = (id: OriginalSound): string => ORIGINAL_SOUNDS.find((o) => o.id === id)?.label ?? "Everything";
export const isOriginalSound = (v: unknown): v is OriginalSound => ORIGINAL_SOUNDS.some((o) => o.id === v);

export { LOWER_DEFAULT_DB as SOUND_LOWER_DEFAULT_DB, LOWER_MAX_DB as SOUND_LOWER_MAX_DB, LOWER_MIN_DB as SOUND_LOWER_MIN_DB };

/** What a studio was asked to put back (stored with its run). */
export interface SoundChoice {
  sound?: OriginalSound;
  /** Lower the music: the music and effects' level (dB, −30…0). */
  musicDb?: number;
}

/** The choice to run on an engine: anything unknown is Everything. */
export const soundOf = (c?: SoundChoice | null): OriginalSound => (isOriginalSound(c?.sound) ? c!.sound! : "everything");

/** Whether two stored choices put back the same sound (unset is Everything). */
export function sameSound(a?: SoundChoice | null, b?: SoundChoice | null): boolean {
  const x = soundOf(a);
  if (x !== soundOf(b)) return false;
  return x !== "lower-music" || clampLowerDb(a?.musicDb) === clampLowerDb(b?.musicDb);
}

/** Whether the clip's sound is split before it goes back (the open engine, anything but Everything). */
export const separates = (engine: Engine, c?: SoundChoice | null): boolean => engine === "open" && soundOf(c) !== "everything";

/** What the cloud says about the choices it doesn't have (the studios' sound setting). */
export const CLOUD_SOUND_NOTE = "Music & effects only, Dialogue only and Lower the music run on your GPU (open source). The cloud puts the whole sound back.";

/** Why a run can't go as asked (in words the page shows), or null. */
export function originalSoundProblem(engine: Engine, c?: SoundChoice | null): string | null {
  const s = soundOf(c);
  if (engine === "cloud" && s !== "everything") return `${originalSoundLabel(s)} runs on your GPU (open source) — switch to the open engine, or put back Everything`;
  return null;
}

/**
 * The choice a studio starts with. Everything, except where the person on screen is replaced or removed (Character
 * Swap Studio, Remove object's person removal): their speech no longer belongs, so Music & effects only on your GPU.
 */
export function defaultSound(engine: Engine, o: { personReplaced?: boolean } = {}): OriginalSound {
  return engine === "open" && o.personReplaced ? "no-dialogue" : "everything";
}

/** One line for a run's summary: what goes back. */
export function soundSummary(c?: SoundChoice | null): string {
  const s = soundOf(c);
  if (s === "lower-music") return `Dialogue, with the music and effects ${Math.abs(clampLowerDb(c?.musicDb))} dB lower`;
  return originalSoundLabel(s);
}

/** The same, lower-cased for the middle of a sentence ("music & effects only"; dB keeps its case). */
export const soundLine = (c?: SoundChoice | null): string => {
  const s = soundSummary(c);
  return s[0].toLowerCase() + s.slice(1);
};

/** The mux's sound: what it waits on (after/chain), the file it reads (inputs.audio) and its extra settings. */
export interface SoundBack {
  after: string[];
  chain: ChainSlot[];
  inputs?: { audio: string };
  extra?: Record<string, unknown>;
}

/**
 * The sound a studio's mux takes. `from` is the working clip: a file (the upload, the 24 fps copy) or an earlier
 * step's clip (the selection cut out). Everything: that clip as it is (the mux reads its soundtrack). Otherwise (open
 * engine) a split step on it is pushed, and the mux takes its stems. Throws what's in the way on the cloud.
 */
export function soundBack(
  steps: PlanStep[],
  o: { engine: Engine; choice?: SoundChoice | null; from: { url: string } | { key: string }; helper: Partial<GenerationRequest>; key?: string; channels?: number; seconds?: number; name?: string },
): SoundBack {
  const problem = originalSoundProblem(o.engine, o.choice);
  if (problem) throw new Error(problem);
  if (!separates(o.engine, o.choice)) return "url" in o.from ? { after: [], chain: [], inputs: { audio: o.from.url } } : { after: [o.from.key], chain: [{ slot: "audio" }] };
  const outcome = soundOf(o.choice) as DialogueOutcome;
  const key = o.key ?? "split";
  const extra: Record<string, unknown> = { channels: dbsChannelsFor("mono", o.channels) };
  if (o.channels && o.channels > 0) extra.sourceChannels = Math.round(o.channels);
  steps.push({
    key,
    request: {
      ...o.helper,
      modelId: SPLIT_MODEL,
      op: "separate-audio",
      title: `Stems · ${o.name?.trim() || "the clip's sound"}`,
      ...("url" in o.from ? { inputs: { video: o.from.url } } : {}),
      params: { extra, ...(o.seconds && o.seconds > 0 ? { sourceDuration: Math.round(o.seconds * 1000) / 1000 } : {}) },
      step: { label: "Dialogue, music, effects", index: 1150, of: 1000 },
    } as GenerationRequest,
    ...("key" in o.from ? { after: [o.from.key], chain: [{ slot: "video" as const }] } : {}),
  });
  const lower = outcome === "lower-music";
  return {
    after: lower ? [key, key] : [key],
    chain: muxChain(outcome),
    ...(lower && { extra: { backgroundVolumeDb: clampLowerDb(o.choice?.musicDb) } }),
  };
}

/** A mux request with its sound settings merged in (keeps the request's own params). */
export function withSoundExtra(request: GenerationRequest, back: SoundBack): GenerationRequest {
  if (!back.extra) return request;
  return { ...request, params: { ...request.params, extra: { ...request.params?.extra, ...back.extra } } };
}

/** Labels for the mux step: what goes back. */
export const SOUND_STEP_LABEL: Record<OriginalSound, string> = {
  everything: "Put the sound back",
  "no-dialogue": "Music and effects back",
  "dialogue-only": "Dialogue back",
  "lower-music": "Dialogue over the lowered music",
};
