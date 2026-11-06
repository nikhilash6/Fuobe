import { voiceFile, voiceWindow } from "@/lib/catalog/clip-windows";
import { AUK_TTS_MAX_SAMPLE } from "@/lib/speech-edit";
import type { AudioFitRule } from "./fit-upload";

/**
 * The fitting step's rules (src/lib/av/fit-upload.ts) for a voice: a talking avatar's (its model's length window and the
 * files it documents, src/lib/catalog/clip-windows.ts) and AuK's voice sample (under 20 s, src/lib/speech-edit.ts). A
 * voice slot takes sound only: a clip dropped beside it is the studio's video.
 */

/** A model's name without what its picker adds after a dot ("MiniMax H3 Max Lip Sync · up to 15 min"). */
export const shortName = (name: string) => name.split(" · ")[0].trim();

/** What a model takes when it documents no file types: any sound the app stores. */
const ANY = ["*"];
/** The most a converted voice weighs when its model names no size: an account's sound cap. */
const SOUND_CAP = 50 * 1024 * 1024;

/** A talking avatar's voice, or null when its model has no window or file rule. */
export function voiceFitRule(model: { id: string; name: string }): AudioFitRule | null {
  const w = voiceWindow(model.id);
  const file = voiceFile(model.id);
  if (!w && !file) return null;
  return {
    for: model.name,
    tool: model.name,
    formats: file?.formats ?? ANY,
    maxBytes: file?.bytes,
    minSeconds: w?.min,
    maxSeconds: w?.max,
    outMaxBytes: file?.bytes ?? SOUND_CAP,
    fromVideo: false,
  };
}

/** AuK's voice sample: a part of a longer one. */
export function sampleFitRule(): AudioFitRule {
  return { for: "AuK", tool: "AuK", formats: ANY, maxSeconds: AUK_TTS_MAX_SAMPLE, outMaxBytes: SOUND_CAP, fromVideo: false };
}
