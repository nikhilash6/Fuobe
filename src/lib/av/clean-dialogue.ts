import type { Engine, GenerationRequest } from "@/lib/catalog/types";
import type { ToolPlan, ToolStep } from "./audio-tools";
import { DBS_MODELS, dbsChannelsFor, separationPasses, splitTime, surroundSource, type DbsChannels, type SplitQuality } from "./split";

/**
 * Audio → Split soundtrack → Clean up dialogue (DBS D5, docs/research/dbs-separation-7.md §9 D5): the speech in a noisy or
 * musical recording made clear, on audio and video. Pure: the page and the server (src/server/audio-tools.ts, tool
 * "clean-dialogue") share it.
 *
 * - Open engine (ComfyUI + ComfyUI-DBS, CPU or GPU): one job on oss-dbs-remix (graph C, soundtrack-remix-dbs): the DBS
 *   dialogue, with the music and effects mixed back under it at the level asked for (or left out). A video then gets the
 *   result back with the stream-copy mux (oss-mux), the picture untouched. DBS takes out music and effects; measured on
 *   the CPU ComfyUI (15 s clips), steady hum mostly went too (50 Hz about 50 dB lower) but hiss only about 10 dB, so the
 *   page points to Clean up voice (RE-USE, src/lib/av/clean-voice.ts) and the cloud cleaners for that.
 * - Cloud: hosted speech cleaners under their own names (DBS isn't hosted, and SAM Audio in its place is the owner's call,
 *   not taken: docs/handoff/owner-decisions.json samAudioCloud false), so the cloud gives the clean voice with nothing
 *   under it: VEED Clean Audio (takes a video's file itself), DeepFilterNet 3 (audio only: a video's soundtrack is
 *   extracted first) and ElevenLabs isolation. A video gets the voice back with fal's merge-audio-video.
 */

export const CLEAN_DIALOGUE_FEATURE = "clean-dialogue";
export const OPEN_MODEL = "oss-dbs-remix";
export const OPEN_MUX_MODEL = "oss-mux";
export const CLOUD_MUX_MODEL = "merge-audio-video";
export const EXTRACT_MODEL = "extract-soundtrack";

/** The page's address for the tool (Split soundtrack, opened on Clean up dialogue). */
export const CLEAN_DIALOGUE_PRESET = "clean-dialogue";
/** The preset Split soundtrack's mixer opens on for a task: Clean dialogue for that task or its "Fine-tune in the mixer". */
export const mixPresetFor = (goal: "split" | "clean", fromClean = false): string | null => (goal === "clean" || fromClean ? CLEAN_DIALOGUE_PRESET : null);
export const cleanDialogueHref = (kind: "audio" | "video", url: string): string => `/audio/split?${kind}=${encodeURIComponent(url)}&preset=${CLEAN_DIALOGUE_PRESET}`;

// ---------------------------------------------------------------------------
// The open engine: how loud the music and effects stay under the dialogue

/** "off" leaves the music and effects out; a number is their level in dB. */
export type BedLevel = "off" | number;
export const BED_LEVELS: BedLevel[] = ["off", -24, -18, -12];
export const DEFAULT_BED: BedLevel = -18;
/** What "off" sends: AudioAdjustVolume's floor, 1e-5, under a 16-bit FLAC's smallest step. */
export const OFF_DB = -100;
export const bedLabel = (b: BedLevel): string => (b === "off" ? "Dialogue only" : `Music & effects −${Math.abs(b)} dB`);
/** A bed level from what a request or the page sent: a whole number from −40 to 0, or off. */
export function bedOf(v: unknown): BedLevel {
  if (v === "off" || v === null || v === false) return "off";
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(0, Math.max(-40, Math.round(n))) : DEFAULT_BED;
}

// ---------------------------------------------------------------------------
// The cloud cleaners

export type Cleaner = "veed" | "deepfilternet" | "isolation";
export const CLEANERS: { id: Cleaner; label: string; model: string; op: "enhance-voice" | "separate-audio"; hint: string; takesVideo: boolean }[] = [
  { id: "veed", label: "Clean (VEED)", model: "veed-clean-audio", op: "enhance-voice", hint: "Removes background noise and levels the voice. Keeps quiet and distant words.", takesVideo: true },
  { id: "deepfilternet", label: "Denoise (DeepFilterNet 3)", model: "deepfilternet3", op: "enhance-voice", hint: "Open-source denoiser for steady noise, hiss and hum.", takesVideo: false },
  { id: "isolation", label: "Voice only (ElevenLabs)", model: "elevenlabs-voice-isolation", op: "separate-audio", hint: "Keeps the voice and removes music, noise and everything else.", takesVideo: true },
];
export const cleanerOf = (id: Cleaner) => CLEANERS.find((c) => c.id === id)!;
export const DEFAULT_CLEANER: Cleaner = "veed";

/** VEED Clean Audio takes up to 30 minutes of audio (fal's model page). */
export const VEED_MAX_SECONDS = 30 * 60;

/** VEED's bill: whole seconds, then up to whole minutes, at least one, at $0.0125 a minute. */
export function veedPrice(seconds: number): number {
  return Math.max(1, Math.ceil(Math.round(Math.max(0, seconds)) / 60 - 1e-9)) * 0.0125;
}
/** DeepFilterNet 3's bill: $0.001 a second of audio. */
export const deepFilterNetPrice = (seconds: number): number => Math.max(0, seconds) * 0.001;

// ---------------------------------------------------------------------------
// Words

export const OPEN_NOTE = "Removes music and sound effects. For hiss and hum, use Clean up voice or a cloud cleaner.";
export const CLOUD_NOTE = "The cloud gives the clean voice on its own, with no music or effects under it.";
export const RELATION_NOTE = "Clean up voice repairs the voice itself (noise, echo, muffled sound) on your GPU. Clean up dialogue takes the music and effects out from under it.";

// ---------------------------------------------------------------------------
// The plan

export interface CleanDialogueInput {
  engine: Engine;
  /** The audio or video file (/api/files/…). */
  media: string;
  kind: "audio" | "video";
  name?: string;
  /** Open: the music and effects' level under the dialogue (or off). */
  bed?: BedLevel;
  /** Open: Fast (DBS-BSRNN) or Best (DBS-TIGER); unset = the host's pick. */
  quality?: SplitQuality;
  /** Open: keep a stereo recording stereo (every channel separated, about twice as long). */
  stereo?: boolean;
  /** Cloud: the hosted cleaner. */
  cleaner?: Cleaner;
  /** VEED: how much of the noise goes (0–1; its default 0.874 leaves the rest 18 dB down). */
  strength?: number;
  /** A video: put the clean soundtrack back on the picture (default on). */
  remux?: boolean;
  channels?: number;
  seconds?: number;
  /** The file has no sound track (from its header). */
  silent?: boolean;
}

export interface CleanDialoguePlan extends ToolPlan {
  bed: BedLevel | null;
  cleaner: Cleaner | null;
  mode: DbsChannels | null;
  remux: boolean;
}

const nameOf = (i: Pick<CleanDialogueInput, "name" | "kind">) => i.name?.trim() || (i.kind === "video" ? "video soundtrack" : "recording");

/** What's in the way of a run (in words the page shows), or null. */
export function cleanDialogueProblem(i: Pick<CleanDialogueInput, "engine" | "media" | "kind" | "silent" | "seconds" | "cleaner">): string | null {
  if (!i.media) return `Add the ${i.kind === "video" ? "video" : "audio"} to clean`;
  if (i.silent) return i.kind === "video" ? "This video has no sound to clean" : "This file has no sound to clean";
  if (i.engine === "cloud" && (i.cleaner ?? DEFAULT_CLEANER) === "veed" && i.seconds && i.seconds > VEED_MAX_SECONDS) return "VEED cleans up to 30 minutes — trim it first, or pick another cleaner";
  return null;
}

/** Throws what's in the way (in words the page shows). */
export function planCleanDialogue(i: CleanDialogueInput): CleanDialoguePlan {
  const problem = cleanDialogueProblem(i);
  if (problem) throw new Error(problem);
  const video = i.kind === "video";
  const remux = video && i.remux !== false;
  const name = nameOf(i);
  const title = `Clean dialogue · ${name}`;
  const seconds = i.seconds && i.seconds > 0 ? Math.round(i.seconds * 1000) / 1000 : undefined;
  const timed = seconds ? { sourceDuration: seconds } : {};
  const inputs = video ? { video: i.media } : { audio: i.media };
  const base = { feature: CLEAN_DIALOGUE_FEATURE, batchTitle: title } satisfies Partial<GenerationRequest>;
  const steps: ToolStep[] = [];

  if (i.engine === "open") {
    const bed = i.bed === undefined ? DEFAULT_BED : bedOf(i.bed);
    const mode = dbsChannelsFor(i.stereo ? "each channel" : "mono", i.channels);
    const level = bed === "off" ? OFF_DB : bed;
    const extra: Record<string, unknown> = { channels: mode, voiceDb: 0, musicDb: level, effectsDb: level };
    if (i.quality) extra.separationModel = DBS_MODELS[i.quality];
    if (i.channels && i.channels > 0) extra.sourceChannels = Math.round(i.channels);
    const of = remux ? 2 : 1;
    steps.push({
      key: "clean",
      request: {
        ...base,
        modelId: OPEN_MODEL,
        op: "separate-audio",
        title: remux ? `${title} · soundtrack` : title,
        inputs,
        params: { extra, ...timed },
        step: { label: bed === "off" ? "Dialogue only" : `Dialogue, music & effects at −${Math.abs(bed)} dB`, index: 0, of },
      },
    });
    if (remux) {
      steps.push({
        key: "video",
        after: ["clean"],
        chain: [{ slot: "audio" }],
        request: { ...base, modelId: OPEN_MUX_MODEL, op: "mux", title, inputs: { video: i.media }, step: { label: "Clean soundtrack · picture copied", index: 1, of } },
      });
    }
    const surround = surroundSource(i.channels);
    return {
      steps,
      length: seconds ?? null,
      bed,
      cleaner: null,
      mode,
      remux,
      summary: `Takes the music and sound effects ${bed === "off" ? "out" : `down to −${Math.abs(bed)} dB under the dialogue`}${mode === "each channel" ? `, every channel on its own (${separationPasses(mode, i.channels)} passes)` : ""}${remux ? ", then puts it back on the picture (copied as it is)" : ""}.`,
      notes: [
        OPEN_NOTE,
        ...(mode === "mono" && i.channels !== 1 && !surround ? ["The result is mono. Turn on Stereo to keep it stereo."] : []),
        ...(surround ? [`This file has ${i.channels} channels: it is cleaned in mono, as ComfyUI saves mono or stereo only.`] : []),
      ],
    };
  }

  // Cloud
  const cleaner = cleanerOf(i.cleaner ?? DEFAULT_CLEANER);
  const extract = video && !cleaner.takesVideo;
  const of = (extract ? 1 : 0) + 1 + (remux ? 1 : 0);
  let index = 0;
  if (extract) {
    steps.push({
      key: "sound",
      request: { ...base, modelId: EXTRACT_MODEL, op: "separate-audio", title: `${title} · soundtrack`, inputs: { video: i.media }, params: { ...timed }, step: { label: "The video's soundtrack", index: index++, of } },
    });
  }
  const strength = cleaner.id === "veed" && typeof i.strength === "number" && Number.isFinite(i.strength) ? Math.min(1, Math.max(0, i.strength)) : undefined;
  steps.push({
    key: "clean",
    ...(extract && { after: ["sound"], chain: [{ slot: "audio" }] }),
    request: {
      ...base,
      modelId: cleaner.model,
      op: cleaner.op,
      title: remux ? `${title} · voice` : title,
      inputs: extract ? {} : inputs,
      params: { ...timed, ...(strength !== undefined && { extra: { strength } }) },
      step: { label: cleaner.label, index: index++, of },
    },
  });
  if (remux) {
    steps.push({
      key: "video",
      after: ["clean"],
      chain: [{ slot: "audio" }],
      request: { ...base, modelId: CLOUD_MUX_MODEL, op: "mux", title, inputs: { video: i.media }, params: { ...timed }, step: { label: "Clean voice back on the video", index: index++, of } },
    });
  }
  return {
    steps,
    length: seconds ?? null,
    bed: null,
    cleaner: cleaner.id,
    mode: null,
    remux,
    summary: `${cleaner.hint}${remux ? " Then the clean voice goes back on the video." : ""}`,
    notes: [CLOUD_NOTE, ...(cleaner.id === "veed" ? ["VEED bills whole minutes, at least one, and returns 48 kHz mono at a steady loudness."] : [])],
  };
}

/** About how long the open engine takes (DBS's split; the remix and mux add a second or two). */
export function cleanDialogueTime(o: { seconds: number; quality: SplitQuality; mode: DbsChannels; channels?: number | null; device?: string | null }): { low: number; high: number } {
  return splitTime(o);
}
