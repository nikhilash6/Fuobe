import { getModel } from "@/lib/catalog";
import { estimateCost } from "@/lib/catalog/plan";
import type { ChainSlot, Engine, GenerationRequest, Operation } from "@/lib/catalog/types";
import { durationWords, splitTime } from "./split";

/**
 * "Clean the voice first" (DBS D6): wherever speech feeds a model (Transcribe and Captions, Genjutsu's and Character
 * Swap Studio's transcripts, Lipsync & avatars), the speech is separated from the music and effects before the model
 * hears it, for tighter transcripts and lip sync. After a lip re-sync on the open engine, the music and effects of the
 * same recording go back under the new mouth movement.
 *
 * A request asks for it with params.extra.cleanVoiceFirst; createGenerations (src/server/chains.ts createVoiceFirst) runs
 * the plan below as one batch. Pure: the pages price the switch with it too.
 *
 * - Open engine: DBS (oss-dbs-separate, graph A) on the recording, its voice stem into the model; for lipsync and
 *   avatars, then the stream-copy mux with the voice over the background stem at 0 dB.
 * - Cloud: ElevenLabs voice isolation (hosted) before the model. Putting the music and effects back is open-engine only:
 *   DBS isn't hosted, and the cloud says so.
 */

export const VOICE_FIRST_PARAM = "cleanVoiceFirst";
export const VOICE_FIRST_OPS = new Set<Operation>(["transcribe", "lipsync", "avatar"]);
export const VOICE_FIRST_MODELS: Record<Engine, string> = { open: "oss-dbs-separate", cloud: "elevenlabs-voice-isolation" };
export const VOICE_FIRST_MUX = "oss-mux";

export const VOICE_FIRST_LABEL = "Clean the voice first";
export const VOICE_FIRST_HINT: Record<Engine, string> = {
  open: "Takes the music and effects out of the speech before it's read, with DBS on your GPU (open source).",
  cloud: "Takes the music and noise out of the speech before it's read, with ElevenLabs voice isolation.",
};
/** What a lip re-sync does with the music and effects, per engine. */
export const VOICE_FIRST_BED: Record<Engine, string> = {
  open: "The music and effects go back under the new lip sync.",
  cloud: "In the cloud the music and effects don't go back: that runs on your GPU (open source).",
};

/** The feature's key in the record of real runs (src/server/sound-live.ts). */
export const VOICE_FIRST_FEATURE = "clean-voice-first";

/**
 * Where the switch starts: off until the chain has passed a real run (live); then on for a video's speech, off for an
 * audio-only recording (until separation is measured on transcripts).
 */
export const voiceFirstDefault = (kind: "audio" | "video", live: boolean): boolean => live && kind === "video";

export const wantsVoiceFirst = (r: Pick<GenerationRequest, "op" | "params">): boolean => r.params?.extra?.[VOICE_FIRST_PARAM] === true && !!r.op && VOICE_FIRST_OPS.has(r.op);

/** The recording the switch cleans: the speech a transcription reads, or the voice a lip sync follows. */
export function voiceFirstSource(r: Pick<GenerationRequest, "op" | "inputs">): { slot: "audio" | "video"; url: string } | null {
  const i = r.inputs ?? {};
  if (r.op === "transcribe") return i.audio ? { slot: "audio", url: i.audio } : i.video ? { slot: "video", url: i.video } : null;
  return i.audio ? { slot: "audio", url: i.audio } : null;
}

export interface VoiceFirstStep {
  key: "voice" | "main" | "bed";
  request: GenerationRequest;
  after?: string[];
  chain?: ChainSlot[];
}

/** The steps for a request with the switch on (the result is the last one); throws what's in the way. */
export function planVoiceFirst(r: GenerationRequest, engine: Engine): VoiceFirstStep[] {
  if (!r.op || !VOICE_FIRST_OPS.has(r.op)) throw new Error(`${VOICE_FIRST_LABEL} works for transcripts, captions and lip sync`);
  const src = voiceFirstSource(r);
  if (!src) throw new Error(r.op === "transcribe" ? "Add the recording or video to transcribe" : "Add the voice");
  const seconds = r.params?.sourceDuration && r.params.sourceDuration > 0 ? r.params.sourceDuration : undefined;
  const extra = { ...r.params?.extra };
  delete extra[VOICE_FIRST_PARAM];
  const lip = r.op !== "transcribe";
  const bed = lip && engine === "open";
  const of = bed ? 3 : 2;
  const base = { feature: r.feature, batchTitle: r.batchTitle ?? r.title, engine };
  const inputs = { ...r.inputs };
  delete inputs[src.slot];
  // A lip sync's video slot stays (the clip it re-syncs); a transcription of a video reads the clean voice only.
  const steps: VoiceFirstStep[] = [
    {
      key: "voice",
      request: {
        ...base,
        modelId: VOICE_FIRST_MODELS[engine],
        op: "separate-audio",
        title: `${r.title ?? "Speech"} · the voice`,
        inputs: { [src.slot]: src.url },
        params: { ...(seconds && { sourceDuration: seconds }), ...(engine === "open" && { extra: { channels: "mono" } }) },
        step: { label: engine === "open" ? "The voice, apart from the music and effects" : "The voice, isolated", index: 0, of },
      },
    },
    {
      key: "main",
      after: ["voice"],
      // DBS names the stem; ElevenLabs returns the voice alone.
      chain: [{ slot: "audio", ...(engine === "open" && { stem: "voice" }) }],
      request: {
        ...r,
        engine,
        inputs: Object.keys(inputs).length ? inputs : undefined,
        params: { ...r.params, extra: Object.keys(extra).length ? extra : undefined },
        step: { label: r.step?.label ?? (lip ? "Lip sync on the clean voice" : "Transcript of the clean voice"), index: 1, of },
      },
    },
  ];
  if (bed) {
    steps.push({
      key: "bed",
      // The re-synced clip, and the voice over the background of the one split (two stems of one step).
      after: ["main", "voice", "voice"],
      chain: [{ slot: "video" }, { slot: "audio", stem: "voice" }, { slot: "audio2", stem: "background" }],
      request: {
        ...base,
        modelId: VOICE_FIRST_MUX,
        op: "mux",
        title: `${r.title ?? "Lip sync"} · with its music and effects`,
        params: { extra: { backgroundVolumeDb: 0 } },
        step: { label: "Music and effects back under it · picture copied", index: 2, of },
      },
    });
  }
  return steps;
}

/** What the switch adds, in words: about how long on the open engine, its price in the cloud ("" when unknown). */
export function voiceFirstCost(engine: Engine, seconds?: number, device?: string | null): string {
  if (!seconds || seconds <= 0) return engine === "open" ? "adds a short step on your GPU" : "";
  if (engine === "open") return `adds ${durationWords(splitTime({ seconds, quality: device === "cuda" ? "best" : "fast", mode: "mono", device }))}`;
  const m = getModel(VOICE_FIRST_MODELS.cloud);
  const usd = m ? estimateCost(m, { sourceDuration: seconds }, 1, "separate-audio") : null;
  return usd === null ? "" : `adds $${usd.toFixed(2)}`;
}
