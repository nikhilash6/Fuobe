import type { ChainSlot, Engine, GenerationRequest } from "@/lib/catalog/types";
import { clampLowerDb, LOWER_DEFAULT_DB } from "./remove-dialogue";
import { SPLIT_MODEL } from "./split";

/**
 * "Original sound" (DBS D7): when a studio puts a clip's sound back under its new picture (Shorts, Mixed Media,
 * Genjutsu, Remove object, Character Swap Studio), what goes back: Everything (as before), the music and effects only,
 * the dialogue only, or the dialogue over the music and effects lowered. Pure: each studio's plan runs its own put-back
 * step through {@link withOriginalSound}.
 *
 * - Open engine: DBS (graph A, oss-dbs-separate) on the working clip's sound, then the studio's own stream-copy mux with
 *   the chosen stem (or the voice over the background at a lower level), as Remove dialogue does.
 * - Cloud: Everything only. DBS isn't hosted and no other model stands in for it: the other choices run on your GPU.
 */

export type OriginalSound = "everything" | "music-effects" | "dialogue" | "lower-music";
export const ORIGINAL_SOUNDS: { id: OriginalSound; label: string; hint: string }[] = [
  { id: "everything", label: "Everything", hint: "The clip's sound as it was" },
  { id: "music-effects", label: "Music & effects only", hint: "The talking taken out" },
  { id: "dialogue", label: "Dialogue only", hint: "Just the talking" },
  { id: "lower-music", label: "Lower the music", hint: "The talking, with the music and effects quieter under it" },
];
export const originalSoundLabel = (id: OriginalSound): string => ORIGINAL_SOUNDS.find((o) => o.id === id)!.label;
export const ORIGINAL_SOUND_IDS = ORIGINAL_SOUNDS.map((o) => o.id) as [OriginalSound, ...OriginalSound[]];

export const CLOUD_ORIGINAL_SOUND = "In the cloud the clip's sound goes back as it was. Music & effects only, Dialogue only and Lower the music run on your GPU (open source).";

/** The feature's key in the record of real runs (src/server/sound-live.ts). */
export const ORIGINAL_SOUND_FEATURE = "original-sound";

/**
 * What a studio starts on: Everything, except where the person in the clip is replaced or removed (their speech is new)
 * once the split and stem mux have passed a real run (live): then Music & effects only.
 */
export function originalSoundDefault(o: { replacesPerson?: boolean; engine: Engine; live?: boolean }): OriginalSound {
  return o.live && o.replacesPerson && o.engine === "open" ? "music-effects" : "everything";
}

/** The choice a run takes on this engine (the cloud has Everything only). */
export const originalSoundOn = (choice: OriginalSound | undefined, engine: Engine): OriginalSound => (engine === "cloud" ? "everything" : (choice ?? "everything"));

interface Step {
  key: string;
  request: GenerationRequest;
  after?: string[];
  chain?: ChainSlot[];
}

const AUDIO_FILE = /\.(wav|mp3|flac|m4a|aac|ogg|opus)(\?|$)/i;

/**
 * The plan with its put-back step (`muxKey`) taking the chosen part of the sound: a DBS split of what the mux would have
 * put back (a file, or an earlier step's clip), then the mux on its stem(s). Everything, the cloud, a mux with no sound
 * going in (a silent clip) or one already mixing two tracks: the plan as it was.
 */
export function withOriginalSound<T extends Step>(steps: T[], muxKey: string, choice: OriginalSound | undefined, engine: Engine, o: { lowerDb?: number; seconds?: number } = {}): T[] {
  const pick = originalSoundOn(choice, engine);
  const at = steps.findIndex((s) => s.key === muxKey);
  if (pick === "everything" || at < 0) return steps;
  const mux = steps[at];
  const chain = [...(mux.chain ?? mux.request.chain ?? [])];
  const after = [...(mux.after ?? [])];
  if (chain.some((c) => c.slot === "audio2") || mux.request.inputs?.audio2) return steps;
  const url = mux.request.inputs?.audio;
  const k = chain.findIndex((c) => c.slot === "audio");
  if (!url && k < 0) return steps;
  // A silent bed (the studio's own silence for a clip with no sound) has nothing to split.
  if (url && /silence/i.test(url)) return steps;
  const from = url ? null : after[k];
  if (!url) {
    chain.splice(k, 1);
    after.splice(k, 1);
  }
  const key = `${muxKey}-split`;
  const index = mux.request.step?.index;
  const split = {
    key,
    ...(from && { after: [from], chain: [{ slot: "audio" }] }),
    request: {
      feature: mux.request.feature,
      batchTitle: mux.request.batchTitle,
      modelId: SPLIT_MODEL,
      op: "separate-audio",
      title: `${mux.request.title ?? "Clip"} · its sound, split`,
      ...(url && { inputs: AUDIO_FILE.test(url) ? { audio: url } : { video: url } }),
      params: { extra: { channels: "mono" }, ...(o.seconds && o.seconds > 0 && { sourceDuration: o.seconds }) },
      step: { label: "The clip's sound, split", index: typeof index === "number" ? index - 1 : 0, of: mux.request.step?.of ?? 1 },
    },
  } as unknown as T;
  const lower = pick === "lower-music";
  const stems: ChainSlot[] = lower ? [{ slot: "audio", stem: "voice" }, { slot: "audio2", stem: "background" }] : [{ slot: "audio", stem: pick === "dialogue" ? "voice" : "background" }];
  const inputs = { ...mux.request.inputs };
  delete inputs.audio;
  const next: T = {
    ...mux,
    after: [...after, ...stems.map(() => key)],
    chain: [...chain, ...stems],
    request: {
      ...mux.request,
      inputs: Object.keys(inputs).length ? inputs : undefined,
      chain: undefined,
      ...(lower && { params: { ...mux.request.params, extra: { ...mux.request.params?.extra, backgroundVolumeDb: clampLowerDb(o.lowerDb ?? LOWER_DEFAULT_DB) } } }),
    },
  };
  delete (next.request as Partial<GenerationRequest>).chain;
  return [...steps.slice(0, at), split, next, ...steps.slice(at + 1)];
}
