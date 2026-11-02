import { estimateCost } from "@/lib/catalog/plan";
import type { ChainSlot, Engine, GenerationRequest, ModelDef, Operation } from "@/lib/catalog/types";
import type { ToolStep } from "./audio-tools";
import { durationWords, splitTime, SPLIT_MODEL, type SplitQuality } from "./split";

/**
 * "Clean the voice first" (DBS D6, docs/research/dbs-separation-7.md §8 and §9 D6): wherever speech feeds a model
 * (Transcribe, Captions, Lipsync & avatars, Genjutsu's "What's said", Character Swap Studio's transcript), the speech is
 * taken out from under the music and sound effects first, so the transcript and the lip sync follow the voice alone.
 * Pure: the composer, the studios and the server (src/server/voice-first.ts) share it.
 *
 * - Open engine (ComfyUI + ComfyUI-DBS, CPU or GPU): a DBS step (oss-dbs-separate, graph separate-soundtrack-dbs)
 *   before Qwen3-ASR, InfiniteTalk or LatentSync, which take its `voice` stem. Lip re-sync on a video: the clip's own
 *   soundtrack is split too, and after the lip sync the stream-copy mux (oss-mux → video-mux-audio) puts the clean
 *   voice back over the clip's music and effects (`background` stem, 0 dB), the picture copied as made.
 * - Cloud: ElevenLabs Voice Isolation (fal, $0.10 a minute) before Scribe v2 or the lip sync model. DBS is hosted
 *   nowhere, and SAM Audio in its place is the owner's call, not taken (docs/handoff/owner-decisions.json
 *   samAudioCloud: false), so the music and effects don't go back under a cloud lip sync, and the switch says so.
 *
 * Default on for a video (a soundtrack usually has music or effects under the speech), off for an audio upload (usually
 * speech alone): a guess until the separation evaluation (D4) measures transcripts with and without it.
 */

export const VOICE_FIRST_LABEL = "Clean the voice first";

/** The step that cleans the voice, per engine. */
export const VOICE_FIRST_MODELS: Record<Engine, string> = {
  open: SPLIT_MODEL,
  cloud: "elevenlabs-voice-isolation",
};
/** The mux that puts the clip's music and effects back under a lip re-sync (open engine). */
export const BED_MUX_MODEL = "oss-mux";
/** The level the music and effects go back at (dB): as they were. */
export const BED_DB = 0;

/** The operations whose speech can be cleaned first. */
export const VOICE_FIRST_OPS: ReadonlySet<Operation> = new Set<Operation>(["transcribe", "lipsync", "avatar"]);

/** One line under the switch, per engine. */
export const VOICE_FIRST_HINTS: Record<Engine, string> = {
  open: "Takes the music and sound effects out from under the speech first",
  cloud: "ElevenLabs isolates the voice first: music and noise are taken out",
};

/** What a lip re-sync on a video does with the clip's own music and effects, per engine. */
export const BED_NOTES: Record<Engine, string> = {
  open: "The clip's music and effects go back under the new lip movement.",
  cloud: "In the cloud the result keeps the clean voice only: the clip's music and effects go back under it on your GPU (open source).",
};

/** Whether the request is one a clean voice helps (an operation that listens to speech, with the speech attached). */
export function voiceFirstApplies(req: Pick<GenerationRequest, "inputs">, op: Operation | undefined): boolean {
  return !!op && VOICE_FIRST_OPS.has(op) && !!voiceSource(req, op);
}

/** The file whose speech is cleaned and where it sits: a transcript's recording or video, a lip sync's voice. */
export function voiceSource(req: Pick<GenerationRequest, "inputs">, op: Operation | undefined): { slot: "audio" | "video"; url: string } | null {
  const i = req.inputs ?? {};
  if (op === "transcribe") return i.audio ? { slot: "audio", url: i.audio } : i.video ? { slot: "video", url: i.video } : null;
  if (op === "lipsync" || op === "avatar") return i.audio ? { slot: "audio", url: i.audio } : null;
  return null;
}

/**
 * The switch's default: on when the speech comes with a picture (a video to transcribe, a clip in Lipsync), off for an
 * audio upload with a portrait, or a recording to transcribe, which is usually speech alone.
 */
export function voiceFirstDefault(req: Pick<GenerationRequest, "inputs">, op: Operation | undefined): boolean {
  const src = voiceSource(req, op);
  if (!src) return false;
  if (op === "transcribe") return src.slot === "video";
  return !!req.inputs?.video;
}

/** Whether a run puts the clip's music and effects back after the lip sync (open engine, a clip with sound). */
export function putsBedBack(req: Pick<GenerationRequest, "inputs">, op: Operation | undefined, engine: Engine, clipHasSound?: boolean): boolean {
  return engine === "open" && op === "lipsync" && !!req.inputs?.video && !!req.inputs?.audio && clipHasSound !== false;
}

export interface VoiceFirstInput {
  /** The request as the studio sends it, its operation resolved. */
  request: GenerationRequest;
  op: Operation;
  engine: Engine;
  /** Seconds the speech runs, when known (prices the cloud step, times the open one). */
  seconds?: number;
  /** The speech file's channel count (a file with more than 2 is split in mono). */
  channels?: number;
  /** False when the lip re-synced clip's header says it has no sound (nothing to put back). */
  clipHasSound?: boolean;
  /** The clip's channel count. */
  clipChannels?: number;
}

export interface VoiceFirstPlan {
  steps: ToolStep[];
  /** The step whose result is the run's result (the transcript, the lip sync, or the lip sync with its music back). */
  result: string;
  /** Whether the clip's music and effects go back after the lip sync. */
  bed: boolean;
}

const round3 = (s: number | undefined) => (s && s > 0 ? Math.round(s * 1000) / 1000 : undefined);

/** A DBS split of `url` (mono, as Remove dialogue: the background is the original minus the speech). */
function dbsStep(key: string, base: Pick<GenerationRequest, "feature" | "batchTitle">, slot: "audio" | "video", url: string, seconds: number | undefined, channels: number | undefined, label: string, title: string): ToolStep {
  const extra: Record<string, unknown> = { channels: "mono" };
  if (channels && channels > 0) extra.sourceChannels = Math.round(channels);
  return {
    key,
    request: {
      ...base,
      modelId: SPLIT_MODEL,
      op: "separate-audio",
      title,
      inputs: { [slot]: url },
      params: { extra, ...(seconds && { sourceDuration: seconds }) },
      step: { label, index: 0, of: 1 },
    },
  };
}

/**
 * The steps of a run with its voice cleaned first, in one batch: the clean voice, the run on it, and on the open engine
 * for a lip re-sync of a clip with sound, the clip's split and the mux that puts its music and effects back. Throws
 * what's in the way (in words the studio shows).
 */
export function planVoiceFirst(i: VoiceFirstInput): VoiceFirstPlan {
  const { request: req, op, engine } = i;
  const src = voiceSource(req, op);
  if (!VOICE_FIRST_OPS.has(op) || !src) throw new Error(op === "transcribe" ? "Add the recording or video to transcribe" : "Add the voice first");
  const seconds = round3(i.seconds ?? req.params?.sourceDuration);
  const name = req.title?.trim() || req.batchTitle?.trim();
  const base: Pick<GenerationRequest, "feature" | "batchTitle"> = {
    feature: req.feature,
    ...(req.batchTitle && { batchTitle: req.batchTitle }),
  };
  const bed = putsBedBack(req, op, engine, i.clipHasSound);
  const n = bed ? 4 : 2;
  const voiceTitle = `Clean voice${name ? ` · ${name}` : ""}`;
  const voice: ToolStep =
    engine === "open"
      ? dbsStep("voice", base, src.slot, src.url, seconds, i.channels, "Clean voice", voiceTitle)
      : {
          key: "voice",
          request: {
            ...base,
            modelId: VOICE_FIRST_MODELS.cloud,
            op: "separate-audio",
            title: voiceTitle,
            inputs: { [src.slot]: src.url },
            ...(seconds && { params: { sourceDuration: seconds } }),
            step: { label: "Clean voice", index: 0, of: 1 },
          },
        };
  voice.request.step = { label: "Clean voice", index: 0, of: n };
  // The run takes the clean voice in place of the file it was given (a transcript of a video then reads the voice alone).
  const inputs = { ...req.inputs };
  delete inputs.audio;
  if (op === "transcribe") delete inputs.video;
  const { voiceFirst: _off, ...rest } = req;
  void _off;
  const slot: ChainSlot = engine === "open" ? { slot: "audio", stem: "voice" } : { slot: "audio" };
  const own = req.step;
  const main: ToolStep = {
    key: "main",
    after: ["voice"],
    chain: [slot],
    request: {
      ...rest,
      inputs,
      ...(seconds && { params: { ...req.params, sourceDuration: req.params?.sourceDuration ?? seconds } }),
      step: { label: own?.label ?? (op === "transcribe" ? "Words from the clean voice" : "Lip sync on the clean voice"), index: 1, of: n },
    },
  };
  if (!bed) return { steps: [voice, main], result: "main", bed: false };
  const clip = req.inputs!.video!;
  const split = dbsStep("bed", base, "video", clip, undefined, i.clipChannels, "The clip's music and effects", `Music & effects${name ? ` · ${name}` : ""}`);
  split.request.step = { label: "The clip's music and effects", index: 2, of: n };
  const film: ToolStep = {
    key: "film",
    // The lip sync's picture, the clean voice, and the clip's music and effects at their own level.
    after: ["main", "voice", "bed"],
    chain: [{ slot: "video" }, { slot: "audio", stem: "voice" }, { slot: "audio2", stem: "background" }],
    request: {
      ...base,
      modelId: BED_MUX_MODEL,
      op: "mux",
      ...(req.title && { title: req.title }),
      params: { extra: { backgroundVolumeDb: BED_DB } },
      step: { label: "Music and effects back under the voice · picture copied", index: 3, of: n },
    },
  };
  return { steps: [voice, main, split, film], result: "film", bed: true };
}

// ---------------------------------------------------------------------------
// What the switch says: the time it adds on the open engine, the price in the cloud

/**
 * ElevenLabs Voice Isolation on fal: $0.10 a minute (the catalog's price, which a test keeps this equal to). Pages that
 * don't load the catalog (Captions, Genjutsu) price the step with it.
 */
export const ISOLATION_USD_PER_MINUTE = 0.1;

/**
 * The price the clean voice adds in the cloud (USD; ElevenLabs Voice Isolation per minute of speech, a minute when the
 * length isn't known), 0 on the open engine. With the catalog, its price; without, ISOLATION_USD_PER_MINUTE.
 */
export function voiceFirstCost(engine: Engine, seconds: number | undefined, getModel?: (id: string) => ModelDef | undefined): number {
  if (engine === "open") return 0;
  const m = getModel?.(VOICE_FIRST_MODELS.cloud);
  if (!m) return Math.round(ISOLATION_USD_PER_MINUTE * ((seconds && seconds > 0 ? seconds : 60) / 60) * 10000) / 10000;
  return estimateCost(m, seconds && seconds > 0 ? { sourceDuration: seconds } : {}, 1, "separate-audio") ?? 0;
}

/**
 * About how long the clean voice adds on the open engine (a range in seconds): one DBS pass over the speech (Fast,
 * mono), and for a lip re-sync with its music put back, a second over the clip and the mux.
 */
export function voiceFirstTime(o: { seconds: number; device?: string | null; bed?: boolean }): { low: number; high: number } {
  // The host's own pick (DBS-TIGER on CUDA, DBS-BSRNN otherwise), in mono: one pass whatever the channels.
  const quality: SplitQuality = o.device === "cuda" ? "best" : "fast";
  const one = splitTime({ seconds: o.seconds, quality, mode: "mono", device: o.device });
  return o.bed ? { low: one.low * 2 + 2, high: one.high * 2 + 4 } : one;
}

/** The switch's time or price line: "Free · adds about 1–2 min", "+$0.05", "+$0.10 a minute". */
export function voiceFirstLine(o: { engine: Engine; seconds?: number; device?: string | null; bed?: boolean; getModel?: (id: string) => ModelDef | undefined }): string {
  if (o.engine === "open") {
    if (!o.seconds || o.seconds <= 0) return "Free · adds a little time";
    const t = voiceFirstTime({ seconds: o.seconds, device: o.device, bed: o.bed });
    return `Free · adds ${t.high < 60 ? "under a minute" : durationWords(t)}`;
  }
  if (!o.seconds || o.seconds <= 0) {
    const per = voiceFirstCost("cloud", 60, o.getModel);
    return per > 0 ? `+$${per.toFixed(2)} a minute` : "Priced by the minute";
  }
  const usd = voiceFirstCost("cloud", o.seconds, o.getModel);
  return `+$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;
}
