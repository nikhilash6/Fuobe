import "server-only";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "workflows", "comfyui");
const MANIFEST = path.join(DIR, "manifest.json");
/** The record of real runs that passed, one entry per feature (written when a feature passes its test). */
const GPU_TESTED = path.join(DIR, "gpu-tested.json");

/**
 * Sound features that open one by one, each after a real run passes (as Genjutsu's new modes do, genjutsu-live.ts):
 * - clean-voice-first: "Clean the voice first" before a transcript or a lip sync, and the music and effects put back
 *   after a lip re-sync (src/lib/av/voice-first.ts): chains of graphs that each passed, not yet run end to end.
 * - original-sound: "Original sound" starting on Music & effects only where a person is replaced or removed (Remove
 *   object, Character Swap, Genjutsu): a DBS split and a stem mux after the studio's own steps, not yet run end to end.
 * Until a feature opens, only the owner runs it, and it starts off (Original sound starts on Everything).
 */
export const SOUND_FEATURES = {
  "clean-voice-first": { workflows: ["separate-soundtrack-dbs"] },
  "original-sound": { workflows: ["separate-soundtrack-dbs"] },
} as const;
export type SoundFeature = keyof typeof SOUND_FEATURES;
export type SoundLive = Record<SoundFeature, boolean>;

const read = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/**
 * Which sound features are open to everyone: every workflow a feature needs has been accepted by ComfyUI (the manifest's
 * `validated`) AND its record says a real run passed (`features[key].passed`). A file that can't be read opens nothing.
 */
export function soundLive(manifest = MANIFEST, record = GPU_TESTED): SoundLive {
  const m = read(manifest) as { workflows?: { id?: string; validated?: boolean }[] } | null;
  const r = read(record) as { features?: Record<string, { passed?: boolean }> } | null;
  const validated = new Set((m?.workflows ?? []).filter((w) => w.validated === true).map((w) => w.id));
  return Object.fromEntries(
    (Object.keys(SOUND_FEATURES) as SoundFeature[]).map((k) => [k, SOUND_FEATURES[k].workflows.every((id) => validated.has(id)) && r?.features?.[k]?.passed === true]),
  ) as SoundLive;
}
