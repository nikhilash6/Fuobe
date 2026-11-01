import type { Engine, GenerationRequest } from "@/lib/catalog/types";
import type { ToolPlan, ToolStep } from "./audio-tools";
import { DBS_SPEED, durationWords, surroundSource } from "./split";

/**
 * Audio → Clean up voice (NVIDIA NemotronLabs RE-USE on Fuobe's ComfyUI-RE-USE pack): noise, echo, clipping, codec damage
 * and phone-band audio fixed in any recording or video soundtrack, the main speaker kept. Pure: the tool page, the app,
 * the slot switch and the server (src/server/audio-tools.ts) share it, and the ComfyUI provider takes its file and rate
 * rules.
 *
 * - Open engine (ComfyUI + ComfyUI-RE-USE, CPU or GPU): one job on oss-reuse-voice (graph voice-clean-reuse; with
 *   "Keep music & effects", voice-clean-bed-reuse, which splits with DBS first and cleans only the dialogue). A video
 *   gets its clean soundtrack back with a second job on oss-mux (the picture copied untouched).
 * - Cloud: none. RE-USE isn't hosted on fal or Replicate, and a noise gate in its place would be another tool, so the
 *   cloud engine says the tool runs on your GPU.
 */

export const CLEAN_FEATURE = "voice-clean";
/** A cleaned soundtrack put back on its video. */
export const CLEAN_REMUX_FEATURE = "voice-clean-remux";
export const CLEAN_MODEL = "oss-reuse-voice";
export const CLEAN_REMUX_MODEL = "oss-mux";

export const CLOUD_CLEAN_PROBLEM =
  "Clean up voice runs on your GPU (open source): NVIDIA RE-USE isn't hosted on fal or Replicate, so the cloud engine can't clean a voice. Switch to the open engine.";
export const CLOUD_ONLY_CLEAN_PROBLEM = "Clean up voice runs on your GPU (open source), but this install is set to paid cloud APIs only (Settings → Engine mode)";

/** What the tool always says, so nobody is surprised. */
export const CLEAN_NOTES = {
  speaker: "It keeps the main speaker. Other voices, music and effects are removed unless you keep music & effects.",
  gaps: "Gaps between words come out silent at Full strength.",
  keepNoise: "DBS splits the soundtrack first and only the dialogue is cleaned. The music and effects go back under it, with any background noise in them.",
};

// ---------------------------------------------------------------------------
// The RE-USE files and how a run picks one

export type ReuseModel = "voice" | "laughter";
export const REUSE_FILES: Record<ReuseModel, string> = {
  voice: "NemotronLabs-RE-USE.safetensors",
  laughter: "NemotronLabs-RE-USE-laughter.safetensors",
};
export const REUSE_LABELS: Record<ReuseModel, string> = { voice: "Voice only", laughter: "Keep laughter" };

/** The RE-USE files a host has, from GET /models/reuse (a Windows ComfyUI may list paths with back slashes); undefined when it can't say. */
export function installedReuse(files: readonly string[] | null | undefined): ReuseModel[] | undefined {
  if (!files) return undefined;
  const have = new Set(files.map((f) => f.replace(/\\/g, "/").split("/").pop()));
  return (Object.keys(REUSE_FILES) as ReuseModel[]).filter((m) => have.has(REUSE_FILES[m]));
}

/** Why a RE-USE model can't run on this host, in words (with how to fix it). */
export function missingReuse(model: ReuseModel, installed: readonly ReuseModel[]): string {
  if (model === "laughter" && installed.includes("voice")) return `Keep laughter isn't installed (models/reuse/${REUSE_FILES.laughter}, 39 MB); pick Voice only or install it from Workflows → Clean up voice.`;
  return `RE-USE isn't on your ComfyUI yet (models/reuse/${REUSE_FILES[model]}, 39 MB). Copy the install commands from Workflows → Clean up voice.`;
}

/** The file a run loads: the one asked for (voice / laughter or the file's name), refused in words when the host's list doesn't have it. */
export function reuseFileFor(asked: unknown, installed?: readonly ReuseModel[]): string {
  const model: ReuseModel = asked === "laughter" || asked === REUSE_FILES.laughter ? "laughter" : "voice";
  if (installed && !installed.includes(model)) throw new Error(missingReuse(model, installed));
  return REUSE_FILES[model];
}

/** Said when the ComfyUI has no ComfyUI-RE-USE nodes at all (no reuse folder to list). */
export const NO_REUSE_PACK = "Clean up voice needs the ComfyUI-RE-USE nodes on your ComfyUI. Copy the install commands from Workflows → Clean up voice.";

// ---------------------------------------------------------------------------
// Settings

export type CleanQuality = "auto" | "full" | "fast";
export type CleanStrength = "full" | "natural" | "light";
export type CleanLevel = "match" | "voice";
export type CleanBackground = "remove" | "keep";

export const QUALITY_LABELS: Record<CleanQuality, string> = { auto: "Auto", full: "Full band 48 kHz", fast: "Fast 16 kHz" };
export const QUALITY_HINTS: Record<CleanQuality, string> = {
  auto: "Keeps the source's rate on a GPU; at most 24 kHz on a CPU (16 kHz past 2 minutes).",
  full: "Full band restores muffled or phone audio (bandwidth extension).",
  fast: "About 3x faster than full band; the result is band-limited to 8 kHz.",
};
export const STRENGTH_LABELS: Record<CleanStrength, string> = { full: "Full", natural: "Natural", light: "Light" };
/** Strength is how much of the original is left under the clean voice (room tone, in dB; -60 = none). */
export const STRENGTH_DB: Record<CleanStrength, number> = { full: -60, natural: -24, light: -14 };
export const LEVEL_LABELS: Record<CleanLevel, string> = { match: "Match the original", voice: "Voice-over (−16 LUFS)" };
export const LEVEL_NODE: Record<CleanLevel, string> = { match: "match input", voice: "-16 LUFS" };
export const BACKGROUND_LABELS: Record<CleanBackground, string> = { remove: "Remove everything but the voice", keep: "Keep music & effects" };

/** The quality control's value for the model (params.extra.rate): "auto", or a rate. */
export const QUALITY_RATE: Record<CleanQuality, "auto" | "48000" | "16000"> = { auto: "auto", full: "48000", fast: "16000" };

/** A CPU cleans at most this much audio at full rate before Auto drops to 16 kHz. */
export const CPU_FULL_RATE_SECONDS = 120;

/**
 * REUSEEnhance's rate input for a run: Full band 48 kHz and Fast 16 kHz as named; Auto keeps the source's rate on a CUDA
 * GPU (8-48 kHz) and caps it on a CPU, at 24 kHz up to 2 minutes of audio and 16 kHz past that. The node knows the
 * source's rate, so a cap never raises it.
 */
export function rateFor(quality: unknown, device?: string | null, seconds?: number | null): string {
  if (quality === "full" || quality === "48000" || quality === 48000) return "48000";
  if (quality === "fast" || quality === "16000" || quality === 16000) return "16000";
  if (typeof quality === "string" && /^(source|\d{4,5}$)/.test(quality) && quality !== "auto") return quality;
  if (device === "cuda") return "source";
  return (seconds ?? 0) > CPU_FULL_RATE_SECONDS ? "source up to 16000" : "source up to 24000";
}

/** The rate a node value runs at, for the estimate (a source of unknown rate counts as 44.1 kHz). */
export function workRate(rate: string, sourceRate = 44100): number {
  const src = Math.min(48000, Math.max(8000, sourceRate));
  if (rate === "source") return src;
  const cap = /^source up to (\d+)$/.exec(rate);
  if (cap) return Math.min(src, Number(cap[1]));
  return Math.min(48000, Math.max(8000, Number(rate) || src));
}

// ---------------------------------------------------------------------------
// Time

/**
 * Seconds of work per second of audio, one pass with 1 s crossfades, as measured (RTX 5090 with Triton and an i9-13900K
 * with numba, both shared with a busy video queue: worst cases; to measure again on an idle card).
 */
export const REUSE_RTF: Record<"cpu" | "cuda", [rate: number, rtf: number][]> = {
  cuda: [
    [8000, 0.13],
    [16000, 0.26],
    [24000, 0.4],
    [44100, 1.3],
    [48000, 1.4],
  ],
  cpu: [
    [8000, 2],
    [16000, 4],
    [24000, 5],
    [44100, 13],
    [48000, 15],
  ],
};

/** Work per second of audio at a rate (linear between the measured rates). */
export function rtfAt(device: "cpu" | "cuda", rate: number): number {
  const t = REUSE_RTF[device];
  if (rate <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    const [r1, v1] = t[i];
    const [r0, v0] = t[i - 1];
    if (rate <= r1) return v0 + ((v1 - v0) * (rate - r0)) / (r1 - r0);
  }
  return t[t.length - 1][1];
}

/** Loading the model and the audio, saving the FLAC (seconds); Triton compiles its scan on a GPU's first run. */
const OVERHEAD_SECONDS = 3;
const FIRST_RUN_SECONDS = 20;

/** About how long a clean takes, as a range in seconds. */
export function cleanTime(o: { seconds: number; rate: number; device?: string | null; passes?: number; bed?: boolean; firstRun?: boolean }): { low: number; high: number } {
  const dev = o.device === "cuda" ? "cuda" : "cpu";
  const work = Math.max(0, o.seconds) * Math.max(1, o.passes ?? 1) * rtfAt(dev, o.rate);
  // Keep music & effects: DBS runs first (its Fast model on a CPU, Best on a GPU).
  const dbs = o.bed ? Math.max(0, o.seconds) / DBS_SPEED[dev][dev === "cuda" ? "best" : "fast"] : 0;
  // The measurements were worst cases on a GPU; a CPU's spread is DBS's.
  const [lo, hi] = dev === "cuda" ? [0.3, 1.2] : [0.8, 1.6];
  const extra = OVERHEAD_SECONDS + (o.firstRun && dev === "cuda" ? FIRST_RUN_SECONDS : 0);
  return { low: Math.round(extra + (work + dbs) * lo), high: Math.round(extra + (work + dbs) * hi) };
}

/** The longest a clean may take (its low estimate): past this the plan says what to change instead. */
export const CLEAN_MAX_SECONDS = 2 * 3600;

/** Why a clean would take too long (on a CPU, a long file at full band), or null. */
export function tooLongProblem(t: { low: number }, device?: string | null): string | null {
  if (t.low <= CLEAN_MAX_SECONDS) return null;
  const h = Math.round((t.low / 3600) * 10) / 10;
  return `That's about ${h} h ${device === "cuda" ? "on your GPU" : "on a CPU"}. Pick Fast 16 kHz, use a shorter file, or connect a GPU.`;
}

export { durationWords };

// ---------------------------------------------------------------------------
// The plan

export interface CleanInput {
  engine: Engine;
  /** The audio or video file (/api/files/…). */
  media: string;
  kind: "audio" | "video";
  name?: string;
  model?: ReuseModel;
  quality?: CleanQuality;
  strength?: CleanStrength;
  background?: CleanBackground;
  level?: CleanLevel;
  /** A video: put the clean soundtrack back on the picture (a second job). */
  remux?: boolean;
  /** "each channel" keeps a stereo recording stereo (twice the work). */
  stereo?: boolean;
  channels?: number;
  seconds?: number;
  /** The file has no sound track (from its header). */
  silent?: boolean;
}

export interface CleanPlan extends ToolPlan {
  /** The settings the plan ran with (the page shows them). */
  strength: CleanStrength;
  background: CleanBackground;
  remux: boolean;
}

/** Defaults: audio is cleaned Full with nothing kept; a video keeps its music and effects at Natural strength and goes back on the picture. */
export function cleanDefaults(kind: "audio" | "video"): { strength: CleanStrength; background: CleanBackground; remux: boolean } {
  // A video too removes everything but the voice by default: "Keep music & effects" brings back the original minus the
  // speech, and the noise with it (and it needs ComfyUI-DBS).
  return kind === "video" ? { strength: "natural", background: "remove", remux: true } : { strength: "full", background: "remove", remux: false };
}

const titleOf = (i: { name?: string; kind: "audio" | "video" }) => `Clean voice · ${i.name?.trim() || (i.kind === "video" ? "video soundtrack" : "recording")}`;

/** One RE-USE job on the open engine, and the mux back onto a video; throws what's in the way (in words the page shows). */
export function planClean(i: CleanInput): CleanPlan {
  if (i.engine === "cloud") throw new Error(CLOUD_CLEAN_PROBLEM);
  if (!i.media) throw new Error(`Add the ${i.kind === "video" ? "video" : "audio"} to clean`);
  if (i.silent) throw new Error(i.kind === "video" ? "This video has no sound to clean" : "This file has no sound to clean");
  const d = cleanDefaults(i.kind);
  const strength = i.strength ?? d.strength;
  const background = i.background ?? d.background;
  const remux = i.kind === "video" && (i.remux ?? d.remux);
  const surround = surroundSource(i.channels);
  const channels = i.stereo && !surround && i.channels !== 1 ? "each channel" : "mono";
  const title = titleOf(i);
  const extra: Record<string, unknown> = {
    reuseModel: i.model ?? "voice",
    rate: QUALITY_RATE[i.quality ?? "auto"],
    strength,
    level: LEVEL_NODE[i.level ?? "match"],
    channels,
    ...(background === "keep" && { background: "keep" }),
    ...(i.channels && i.channels > 0 && { sourceChannels: Math.round(i.channels) }),
  };
  const of = remux ? 2 : 1;
  const request: GenerationRequest = {
    modelId: CLEAN_MODEL,
    op: "enhance-voice",
    feature: CLEAN_FEATURE,
    batchTitle: title,
    title,
    inputs: i.kind === "video" ? { video: i.media } : { audio: i.media },
    params: { extra, ...(i.seconds && i.seconds > 0 && { sourceDuration: Math.round(i.seconds * 1000) / 1000 }) },
    step: { label: background === "keep" ? "Cleaning the dialogue · music & effects kept" : "Cleaning the voice", index: 0, of },
  };
  const steps: ToolStep[] = [{ key: "clean", request }];
  if (remux) {
    steps.push({
      key: "remux",
      after: ["clean"],
      chain: [{ slot: "audio" }],
      request: {
        modelId: CLEAN_REMUX_MODEL,
        op: "mux",
        feature: CLEAN_REMUX_FEATURE,
        batchTitle: title,
        title: `${title} · on the video`,
        inputs: { video: i.media },
        step: { label: "Clean soundtrack · picture copied", index: 1, of },
      },
    });
  }
  const what = i.kind === "video" ? "the video's soundtrack" : "the recording";
  return {
    steps,
    length: i.seconds && i.seconds > 0 ? i.seconds : null,
    strength,
    background,
    remux,
    summary:
      background === "keep"
        ? `Splits ${what} with DBS, cleans the dialogue with RE-USE and puts the music and effects back under it${remux ? ", then puts it back on the picture (copied as it is)" : ""}.`
        : `Cleans ${what} with RE-USE${remux ? ", then puts it back on the picture (copied as it is)" : ""}.`,
    // The speaker and silent-gap notes show under Background and Strength, so they aren't repeated here.
    notes: [
      ...(surround ? [`This file has ${i.channels} channels: it is cleaned in mono, as ComfyUI saves mono or stereo only.`] : []),
    ],
  };
}

/** The estimate for a plan on a host: its rate on that device, every pass, and DBS when music & effects are kept. */
export function planTime(i: { seconds: number; quality?: CleanQuality; device?: string | null; stereo?: boolean; channels?: number; background?: CleanBackground; sourceRate?: number }): { low: number; high: number; rate: number } {
  const rate = workRate(rateFor(i.quality ?? "auto", i.device, i.seconds), i.sourceRate);
  const passes = i.stereo && !surroundSource(i.channels) && i.channels !== 1 ? Math.max(1, i.channels ?? 2) : 1;
  return { ...cleanTime({ seconds: i.seconds, rate, device: i.device, passes, bed: i.background === "keep" }), rate };
}

/** "16 kHz", "44.1 kHz" */
export const khz = (rate: number): string => `${Math.round(rate / 100) / 10} kHz`;

/** What a finished run's report says, in a line ("GPU · Triton · 1.9x real time"). */
export function reportLine(report: unknown): string | null {
  const r = typeof report === "string" ? safeJson(report) : report;
  if (!r || typeof r !== "object") return null;
  const o = r as { device?: string; scan?: string; times_real_time?: number; rate?: number };
  const dev = /^cuda/.test(o.device ?? "") ? "GPU" : o.device ? "CPU" : null;
  const scan = o.scan === "triton" ? "Triton" : o.scan === "numba" ? "numba" : o.scan === "torch-loop" ? "PyTorch loop" : null;
  const speed = typeof o.times_real_time === "number" ? `${o.times_real_time}x real time` : null;
  const parts = [dev, o.rate ? khz(o.rate) : null, scan, speed].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** A hint when a CUDA host ran without Triton (about 6x slower). */
export function scanHint(report: unknown): string | null {
  const r = typeof report === "string" ? safeJson(report) : report;
  const o = (r ?? {}) as { device?: string; scan?: string };
  return /^cuda/.test(o.device ?? "") && o.scan === "torch-loop" ? "Install Triton for about 6x faster cleaning" : null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
