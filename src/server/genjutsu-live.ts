import "server-only";
import fs from "node:fs";
import path from "node:path";
import { GENJUTSU_FEATURE_KEYS, GENJUTSU_FEATURES, type GenjutsuFeature } from "@/lib/catalog/genjutsu";

const DIR = path.join(process.cwd(), "workflows", "comfyui");
const MANIFEST = path.join(DIR, "manifest.json");
/** The record of real renders that passed, one entry per feature (written when a feature passes its test on a GPU). */
const GPU_TESTED = path.join(DIR, "gpu-tested.json");

export type GenjutsuLive = Record<GenjutsuFeature, boolean>;

const read = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/**
 * Which of Genjutsu's Openjutsu features are open to everyone: every workflow a feature needs has been accepted by ComfyUI
 * (the manifest's `validated`) AND its record says a real render passed (`features[key].passed`). The manifest flag alone
 * never opens one: it is set by a check that never renders. Until then only the owner sees and runs it. A file that can't
 * be read opens nothing.
 */
export function genjutsuLive(manifest = MANIFEST, record = GPU_TESTED): GenjutsuLive {
  const m = read(manifest) as { workflows?: { id?: string; validated?: boolean }[] } | null;
  const r = read(record) as { features?: Record<string, { passed?: boolean }> } | null;
  const validated = new Set((m?.workflows ?? []).filter((w) => w.validated === true).map((w) => w.id));
  return Object.fromEntries(
    GENJUTSU_FEATURE_KEYS.map((k) => [k, GENJUTSU_FEATURES[k].workflows.every((id) => validated.has(id)) && r?.features?.[k]?.passed === true]),
  ) as GenjutsuLive;
}
