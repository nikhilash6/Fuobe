/**
 * Audio → Design a voice: a voice made from words, heard in three takes, and the take you like saved
 * as an Element voice. Pure data and logic (client and server): the starter chips, the description they write, which
 * model runs on which engine, and how a saved voice reads in a voice picker.
 *
 * Qwen3-TTS 1.7B runs on both engines (oss-qwen3-tts on your GPU, qwen-3-tts hosted on fal); VoxCPM2 is hosted nowhere,
 * so it runs on your GPU only. A saved voice keeps the take as its clip: any model that clones a voice reuses it, and
 * fal's Qwen3-TTS clones it once into an embedding file it keeps (src/server/voices.ts).
 */
import { VOICE_DESCRIPTION_MAX, type ElementVoice } from "./catalog/elements";
import type { Engine } from "./catalog/types";

/** Takes per run: three to pick from. */
export const VOICE_TAKES = 3;
export const VOICE_FEATURE = "voice-design";
export const DEFAULT_TEST_LINE = "Hello there. This is how I sound, and I can't wait to tell your story.";
export const TEST_LINE_MAX = 300;

export type ChipGroup = "age" | "gender" | "accent" | "tone" | "pace";

/** Starter chips: one pick per group, written into the description in this order. */
export const VOICE_CHIPS: { group: ChipGroup; label: string; options: string[] }[] = [
  { group: "age", label: "Age", options: ["Young", "In their thirties", "Middle-aged", "Older"] },
  { group: "gender", label: "Gender", options: ["Female", "Male", "Androgynous"] },
  { group: "accent", label: "Accent", options: ["American", "British", "Australian", "Irish", "Indian", "Scottish"] },
  { group: "tone", label: "Tone", options: ["Warm", "Gravelly", "Bright", "Calm", "Authoritative", "Playful", "Breathy"] },
  { group: "pace", label: "Pace", options: ["Slow", "Measured", "Brisk"] },
];

export type ChipPicks = Partial<Record<ChipGroup, string>>;

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The words the model reads: the picked chips as one sentence ("A warm, older female voice with a British accent,
 * speaking at a slow pace."), then what was typed. Either may be empty; the result is held to VOICE_DESCRIPTION_MAX.
 */
export function describeVoice(picks: ChipPicks, typed = ""): string {
  const tone = picks.tone ? lower(picks.tone) : "";
  const age = picks.age ? (picks.age === "In their thirties" ? "" : lower(picks.age)) : "";
  const gender = picks.gender ? lower(picks.gender) : "";
  const thirties = picks.age === "In their thirties" ? " in their thirties" : "";
  const who = [age, gender].filter(Boolean).join(" ");
  const parts: string[] = [];
  if (tone || who || thirties || picks.accent || picks.pace) {
    // "warm, older female": the tone, then who is speaking.
    const head = [tone, who].filter(Boolean).join(", ");
    let s = `${head ? `${/^[aeiou]/i.test(head) ? "An" : "A"} ${head}` : "A"} voice${thirties}`;
    if (picks.accent) s += ` with ${/^[aeiou]/i.test(picks.accent) ? "an" : "a"} ${picks.accent} accent`;
    if (picks.pace) s += `, speaking at a ${lower(picks.pace)} pace`;
    parts.push(`${s}.`);
  }
  const typedWords = typed.trim();
  const words = typedWords.charAt(0).toUpperCase() + typedWords.slice(1);
  if (words) parts.push(/[.!?]$/.test(words) ? words : `${words}.`);
  return parts.join(" ").slice(0, VOICE_DESCRIPTION_MAX);
}

export type DesignModelKey = "qwen" | "voxcpm";

/** The models Design a voice offers, with the model each engine runs (null: none there). */
export const DESIGN_MODELS: { key: DesignModelKey; label: string; open: string; cloud: string | null; blurb: string }[] = [
  {
    key: "qwen",
    label: "Qwen3-TTS",
    open: "oss-qwen3-tts",
    cloud: "qwen-3-tts",
    blurb: "Free on your GPU, or in the cloud. 10 languages.",
  },
  {
    key: "voxcpm",
    label: "VoxCPM2",
    open: "oss-voxcpm2",
    cloud: null,
    blurb: "Studio-quality 48 kHz in 30 languages. Runs on your GPU (open source).",
  },
];

/** The model a choice runs on an engine, or null when it doesn't run there (VoxCPM2 in the cloud). */
export function designModelFor(key: DesignModelKey, engine: Engine): string | null {
  const m = DESIGN_MODELS.find((d) => d.key === key) ?? DESIGN_MODELS[0];
  return engine === "open" ? m.open : m.cloud;
}

/** Why a choice can't run on an engine (shown instead of the run button), or null when it can. */
export function designBlocker(key: DesignModelKey, engine: Engine): string | null {
  return designModelFor(key, engine) ? null : "VoxCPM2 runs on your GPU (open source). Switch to Open source, or pick Qwen3-TTS for the cloud.";
}

/** Which Design a voice choice a model id belongs to. */
export function designKeyOf(modelId: string): DesignModelKey | null {
  return DESIGN_MODELS.find((d) => d.open === modelId || d.cloud === modelId)?.key ?? null;
}

/**
 * How a saved voice reads in a voice picker: what it was designed with ("Designed with Qwen3-TTS"), or null for a
 * recorded voice. Every saved voice can be cloned by any model that clones voices.
 */
export function voiceOrigin(voice: ElementVoice | undefined): string | null {
  if (!voice) return null;
  const key = designKeyOf(voice.modelId);
  const m = DESIGN_MODELS.find((d) => d.key === key);
  return m ? `Designed with ${m.label}` : "Designed voice";
}
