/**
 * Fuobe Soul ID (build plan O3): a character or a style trained as a LoRA on open weights, on either engine
 * (AI-Toolkit on the user's GPU, or fal's hosted trainers), then used whenever the element is @mentioned on a
 * model of the family it was trained for: Fuobe Soul and Soul Cinema (Z-Image Turbo), Fuobe Soul HD
 * (Qwen-Image 2512), and every other base fal or AI-Toolkit trains (FLUX.1 / FLUX.2 [dev], FLUX.2 [klein] 4B and 9B, FLUX 3 Klein,
 * Krea 2) on the models of that base. Pure logic, no I/O.
 *
 * - A LoRA belongs to a family (its base), not to one model, and works on both engines where the family has models:
 *   a LoRA trained on fal is downloaded into ComfyUI for open runs, one trained on the user's GPU is copied to the
 *   cloud provider for cloud runs (src/server/loras.ts). Another family means training again on the same photos
 *   ("Upgrade character"), as Higgsfield retrains a Soul ID per model family.
 * - The hosted trainers' fields, prices, response fields and licences are generated from the research
 *   (trainers.generated.ts by scripts/gen-trainers.py). Licences are information, never a gate (the owner's decision
 *   of 2026-10-27): every target says the licence of the weights it trains on and whether they allow selling
 *   outputs, and the admin turns models on or off in Settings.
 * - Photo rules and the consent line follow Higgsfield's character flow (docs/research/higgsfield-originals-5.md
 *   §3.4, higgsfield-delta-4.md G18): 20+ photos recommended, 80 at most, one person, a full-body shot, consent
 *   before a person's photos are trained.
 */
import type { ElementKind, ElementLora } from "./elements";
import { HOSTED_TRAINERS } from "./trainers.generated";
import type { Engine, ModelDef } from "./types";

export type TrainingProvider = "fal" | "ai-toolkit";

/** The base a LoRA is trained on. A trained LoRA works on every model of its family. */
export type TrainingFamily = "z-image-turbo" | "qwen-image-2512" | "flux1-dev" | "flux2-dev" | "flux2-klein-4b" | "flux2-klein-9b" | "krea-2" | "flux3-klein";

/** What a training learns: a subject (a person, a place, an object) or a style (a moodboard). */
export type TrainingKind = "subject" | "style";

/** A field of a hosted trainer's request (from its OpenAPI schema). */
export interface TrainerField {
  type: string;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  enum?: (string | number)[];
}

/** A hosted LoRA trainer (generated from the research by scripts/gen-trainers.py). */
export interface HostedTrainer {
  /** The fal endpoint, e.g. "fal-ai/z-image-turbo-trainer-v2". */
  id: string;
  provider: "fal";
  /** The base model as the research names it ("Z-Image Turbo"). */
  family: string;
  /** The base as a slug ("z-image-turbo", "z-image", "qwen-image-2512"). */
  base: string;
  /** What it learns from: photos (a subject or a look) or clips (a motion). */
  media: "image" | "video";
  role: string;
  /** Where the zip of 001.jpg + 001.txt pairs goes (image_data_url, images_data_url or training_data_url). */
  dataField: string;
  /** The response fields that hold the trained LoRA, the one to use first (diffusers_lora_file, lora_file). */
  loraOutput: string[];
  fields: Record<string, TrainerField>;
  licence: string;
  /** The weights it trains on allow selling outputs: true, false (non-commercial) or null (a revenue tier decides). Information, not a gate. */
  commercial: boolean | null;
  status: string;
  checked: string;
  schemaUrl: string;
  priceText: string;
  usdPerStep?: number;
  /** fal bills at least this many steps. */
  minBilledSteps?: number;
}

export interface TrainingTarget {
  id: string;
  /** Short: where it trains ("Your GPU", "Cloud"). The family says what for. */
  name: string;
  /** The engine the training runs on (the LoRA then works on both where its family has models). */
  engine: Engine;
  provider: TrainingProvider;
  family: TrainingFamily;
  kinds: TrainingKind[];
  /** Only these kinds of element (FLUX's portrait trainer crops to faces: people only); every kind of its training kinds when unset. */
  onlyFor?: ElementKind[];
  /** fal: the hosted trainer's endpoint (HOSTED_TRAINERS). */
  trainer?: string;
  steps: number;
  learningRate?: number;
  /** Other fields sent to the trainer when its schema has them (fal's training_type, Krea 2's resolution). */
  extra?: Record<string, string | number | boolean>;
  /** Models the trained LoRA applies to (the family's, on the engines each runs on). */
  modelIds: string[];
  minImages: number;
  description: string;
  /** "Free" on the user's GPU, else the price fal charges for this many steps. */
  price: string;
  /** The same price as a number (0 when free). */
  costUsd: number;
  /** Rough wall-clock time. */
  eta: string;
  /** The licence of the weights it trains on (the LoRA inherits it), shown as information. */
  licence: string;
  /** Those weights allow selling outputs: true, false (non-commercial) or null (a revenue tier decides). */
  commercial: boolean | null;
}

export interface FamilyInfo {
  /** What the dialog calls it: the models a trained LoRA runs on. */
  name: string;
  /** The base model the LoRA is trained on. */
  base: string;
  /** A Fuobe Original's family (Fuobe Soul, Soul HD): shown first; the others are under "More models". */
  original: boolean;
  /** The model a trained element opens on, per engine (an Original's is the same model on both). */
  lead: Partial<Record<Engine, string>>;
  /** Every model a LoRA of this family runs on (on the engines each runs on). */
  models: string[];
  /** fal's trainer for this base: the family's licence is the licence of the weights it trains. */
  trainer: string;
}

/**
 * The families, in the order the Train dialog shows them: Fuobe's Originals first, then every other base a hosted
 * trainer or AI-Toolkit trains, on the models of that base Fuobe runs (both engines where it has them).
 */
export const TRAINING_FAMILIES: Record<TrainingFamily, FamilyInfo> = {
  "z-image-turbo": {
    name: "Fuobe Soul and Soul Cinema",
    base: "Z-Image Turbo",
    original: true,
    lead: { open: "fuobe-soul", cloud: "fuobe-soul" },
    models: ["fuobe-soul", "fuobe-soul-cinema", "oss-z-image-turbo", "z-image-turbo-cloud"],
    trainer: "fal-ai/z-image-turbo-trainer-v2",
  },
  "qwen-image-2512": {
    name: "Fuobe Soul HD",
    base: "Qwen-Image 2512",
    original: true,
    lead: { open: "fuobe-soul-hd", cloud: "fuobe-soul-hd" },
    models: ["fuobe-soul-hd", "oss-qwen-image", "oss-qwen-image-lightning", "qwen-image-2512-cloud"],
    trainer: "fal-ai/qwen-image-2512-trainer",
  },
  "flux1-dev": {
    name: "FLUX.1 [dev] and Krea [dev]",
    base: "FLUX.1 [dev]",
    original: false,
    lead: { open: "oss-flux1-dev", cloud: "flux-1-dev-lora-cloud" },
    models: ["oss-flux1-dev", "oss-flux1-krea", "flux-1-dev-lora-cloud", "flux-1-krea-lora-cloud"],
    trainer: "fal-ai/flux-lora-portrait-trainer",
  },
  "flux2-dev": {
    name: "FLUX.2 [dev]",
    base: "FLUX.2 [dev]",
    original: false,
    lead: { open: "oss-flux2-dev", cloud: "flux-2-dev-lora-cloud" },
    models: ["oss-flux2-dev", "oss-flux2-dev-turbo", "flux-2-dev-lora-cloud"],
    trainer: "fal-ai/flux-2-trainer-v2",
  },
  "flux2-klein-4b": {
    name: "FLUX.2 [klein] 4B",
    base: "FLUX.2 [klein] 4B",
    original: false,
    lead: { cloud: "flux-2-klein-4b-cloud" },
    models: ["flux-2-klein-4b-cloud"],
    trainer: "fal-ai/flux-2-klein-4b-base-trainer",
  },
  "flux2-klein-9b": {
    name: "FLUX.2 [klein] 9B",
    base: "FLUX.2 [klein] 9B",
    original: false,
    lead: { cloud: "flux-2-klein-9b-lora-cloud" },
    models: ["flux-2-klein-9b-lora-cloud"],
    trainer: "fal-ai/flux-2-klein-9b-base-trainer",
  },
  "krea-2": {
    name: "Krea 2",
    base: "Krea 2",
    original: false,
    lead: { cloud: "krea-2-turbo-lora-cloud" },
    models: ["krea-2-turbo-lora-cloud"],
    trainer: "fal-ai/krea-2-trainer",
  },
  // FLUX 3 Image Klein (nm10-flux3-klein): trained on Klein Base, which a LoRA runs on first (fal recommends it); the distilled
  // Klein takes it too, on both engines.
  "flux3-klein": {
    name: "FLUX 3 Klein",
    base: "FLUX 3 Image Klein Base",
    original: false,
    lead: { open: "oss-flux3-klein-base", cloud: "flux-3-klein-base" },
    models: ["oss-flux3-klein-base", "oss-flux3-klein", "flux-3-klein-base", "flux-3-klein"],
    trainer: "blackforestlabs/flux-3/klein/base/trainer",
  },
};

export const TRAINING_FAMILY_IDS = Object.keys(TRAINING_FAMILIES) as TrainingFamily[];

/** The model a family's LoRA is recorded for, and a trained element opens on: the engine's own lead, else the other's. */
export function familyLead(f: TrainingFamily, engine?: Engine): string {
  const lead = TRAINING_FAMILIES[f].lead;
  return (engine && lead[engine]) || lead.cloud || lead.open || "";
}

/** Higgsfield's character flow, as limits (research §3.4): 20+ photos recommended, 80 at most on the web. */
export const SOUL_ID_PHOTOS = { min: 5, recommended: 20, max: 80, minSide: 512 } as const;

/**
 * The photo rules and the consent line (Higgsfield's character-creation copy, docs/research/higgsfield-image-studios.md
 * §2 and higgsfield-delta-4.md G18), shared by every place that makes or trains a character.
 */
export const SOUL_ID_COPY = {
  moreTitle: "More Photos, Better Results",
  more: "Upload 20+ photos for best results",
  avoidTitle: "Avoid These Types of Photos",
  avoid: "No duplicates, group shots, pets, nudes, filters, face-covering accessories, or masks",
  rules: [
    "One person in every photo, the face fully in frame",
    "Different angles, expressions and light, and at least one full-body shot",
    "Recent photos: no sunglasses, heavy shadows, filters or group shots",
  ],
  consent:
    "I consent to this biometric data processing and confirm these photos are of me or of a person at least 18 years old who gave written permission.",
  needsConsent: "Confirm the consent line first: a character is only trained with the person's permission",
} as const;

const trainers = new Map(HOSTED_TRAINERS.map((t) => [t.id, t]));
export const getTrainer = (id: string | undefined): HostedTrainer | undefined => (id ? trainers.get(id) : undefined);

/** The licence of a family's base weights (its fal trainer's), as information. */
export function familyLicence(f: TrainingFamily): { licence: string; commercial: boolean | null } {
  const tr = getTrainer(TRAINING_FAMILIES[f].trainer);
  return { licence: tr?.licence ?? "", commercial: tr?.commercial ?? null };
}

/** How the licence reads next to a price: "Apache-2.0 · commercial use", "… · non-commercial weights", "… · check its revenue tiers". */
export function licenceNote(l: { licence: string; commercial: boolean | null }): string {
  const use = l.commercial === true ? "commercial use" : l.commercial === false ? "non-commercial weights" : "check its revenue tiers";
  return l.licence ? `${l.licence} · ${use}` : use;
}

/** What fal bills for this many steps on this trainer (its per-step price above its minimum), in US dollars. */
export function trainerCost(trainer: Pick<HostedTrainer, "usdPerStep" | "minBilledSteps"> | undefined, steps: number): number | null {
  if (!trainer?.usdPerStep) return null;
  return Math.round(Math.max(steps, trainer.minBilledSteps ?? 1) * trainer.usdPerStep * 100) / 100;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const thousands = (n: number) => n.toLocaleString("en-US");

function target(t: Omit<TrainingTarget, "modelIds" | "price" | "costUsd" | "minImages" | "licence" | "commercial">): TrainingTarget {
  const cost = t.provider === "fal" ? trainerCost(getTrainer(t.trainer), t.steps) : 0;
  if (cost === null) throw new Error(`${t.id}: its trainer ${t.trainer} has no price (run pnpm gen:catalog)`);
  const tr = getTrainer(t.trainer);
  return {
    ...t,
    modelIds: TRAINING_FAMILIES[t.family].models,
    minImages: SOUL_ID_PHOTOS.min,
    costUsd: cost,
    price: cost === 0 ? "Free" : `≈ ${usd(cost)} (${thousands(t.steps)} steps)`,
    ...(tr ? { licence: tr.licence, commercial: tr.commercial } : familyLicence(t.family)),
  };
}

const LOCAL = "Nothing leaves your machine.";
const TO_FAL = "Your photos go to fal for the training.";

/**
 * Where a Soul ID trains (research §3.3, §4.5, plan O3), family by family. Fuobe Soul (Z-Image Turbo): AI-Toolkit
 * with ostris's training adapter v2 on the user's GPU, or fal's Z-Image Turbo trainer v2 (2,000 steps at 5e-4); a
 * style (a moodboard) in the cloud trains on fal's Z-Image trainer with training_type style. Fuobe Soul HD: fal's
 * Qwen-Image 2512 trainer, or AI-Toolkit. The other bases train on their fal trainer at its own defaults (steps,
 * learning rate), and on AI-Toolkit where it supports the base and Fuobe runs it on the open engine.
 */
export const TRAINING_TARGETS: TrainingTarget[] = [
  target({
    id: "aitk-z-image",
    name: "Your GPU",
    engine: "open",
    provider: "ai-toolkit",
    family: "z-image-turbo",
    kinds: ["subject", "style"],
    steps: 2000,
    description: `AI-Toolkit on your own GPU (24 GB), with ostris's Z-Image Turbo training adapter. ${LOCAL}`,
    eta: "~30–60 min on a 24 GB GPU",
  }),
  target({
    id: "fal-z-image",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "z-image-turbo",
    kinds: ["subject"],
    trainer: "fal-ai/z-image-turbo-trainer-v2",
    steps: 2000,
    learningRate: 0.0005,
    description: `fal's Z-Image Turbo trainer. ${TO_FAL}`,
    eta: "~10 min",
  }),
  target({
    id: "fal-z-image-style",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "z-image-turbo",
    kinds: ["style"],
    trainer: "fal-ai/z-image-trainer",
    steps: 1500,
    extra: { training_type: "style" },
    description: "fal's Z-Image trainer in style mode: the look, not the subjects. Your images go to fal for the training.",
    eta: "~15–30 min",
  }),
  target({
    id: "aitk-qwen-2512",
    name: "Your GPU",
    engine: "open",
    provider: "ai-toolkit",
    family: "qwen-image-2512",
    kinds: ["subject", "style"],
    steps: 2000,
    description: `AI-Toolkit on your own GPU (32 GB; 20B weights in 8-bit). ${LOCAL}`,
    eta: "~1–2 h on a 32 GB GPU",
  }),
  target({
    id: "fal-qwen-2512",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "qwen-image-2512",
    kinds: ["subject", "style"],
    trainer: "fal-ai/qwen-image-2512-trainer",
    steps: 1000,
    learningRate: 0.0005,
    description: `fal's Qwen-Image 2512 trainer, for Fuobe Soul HD (clean lettering). ${TO_FAL}`,
    eta: "~10–20 min",
  }),
  target({
    id: "aitk-flux1-dev",
    name: "Your GPU",
    engine: "open",
    provider: "ai-toolkit",
    family: "flux1-dev",
    kinds: ["subject", "style"],
    steps: 2000,
    description: `AI-Toolkit on your own GPU (24 GB, 8-bit). Needs a Hugging Face token with FLUX.1 [dev]'s licence accepted. ${LOCAL}`,
    eta: "~1–2 h on a 24 GB GPU",
  }),
  target({
    id: "fal-flux1-portrait",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "flux1-dev",
    kinds: ["subject"],
    onlyFor: ["character"],
    trainer: "fal-ai/flux-lora-portrait-trainer",
    steps: 2500,
    description: `fal's FLUX portrait trainer: it crops to the face and trains at several sizes. ${TO_FAL}`,
    eta: "~20–30 min",
  }),
  target({
    id: "aitk-flux2-dev",
    name: "Your GPU",
    engine: "open",
    provider: "ai-toolkit",
    family: "flux2-dev",
    kinds: ["subject", "style"],
    steps: 2000,
    description: `AI-Toolkit on your own GPU (32B weights: 48 GB, or 24 GB in 8-bit with offloading, slower). Needs a Hugging Face token with FLUX.2 [dev]'s licence accepted. ${LOCAL}`,
    eta: "~2–4 h on a 48 GB GPU",
  }),
  target({
    id: "fal-flux2-dev",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "flux2-dev",
    kinds: ["subject", "style"],
    trainer: "fal-ai/flux-2-trainer-v2",
    steps: 1000,
    description: `fal's FLUX.2 [dev] trainer. ${TO_FAL}`,
    eta: "~20–40 min",
  }),
  target({
    id: "aitk-flux2-klein-4b",
    name: "Your GPU",
    engine: "open",
    provider: "ai-toolkit",
    family: "flux2-klein-4b",
    kinds: ["subject", "style"],
    steps: 2000,
    description: `AI-Toolkit on your own GPU (16 GB), on the FLUX.2 [klein] 4B base; Fuobe sends the LoRA to fal when a run uses it. ${LOCAL}`,
    eta: "~30–60 min on a 16 GB GPU",
  }),
  target({
    id: "fal-flux2-klein-4b",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "flux2-klein-4b",
    kinds: ["subject", "style"],
    trainer: "fal-ai/flux-2-klein-4b-base-trainer",
    steps: 1000,
    description: `fal's FLUX.2 [klein] 4B base trainer. ${TO_FAL}`,
    eta: "~10–20 min",
  }),
  target({
    id: "fal-flux2-klein-9b",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "flux2-klein-9b",
    kinds: ["subject", "style"],
    trainer: "fal-ai/flux-2-klein-9b-base-trainer",
    steps: 1000,
    description: `fal's FLUX.2 [klein] 9B base trainer. ${TO_FAL}`,
    eta: "~15–30 min",
  }),
  target({
    id: "fal-krea-2",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "krea-2",
    kinds: ["subject", "style"],
    trainer: "fal-ai/krea-2-trainer",
    steps: 1000,
    extra: { resolution: 1024 },
    description: `fal's Krea 2 trainer, at 1024 px. ${TO_FAL}`,
    eta: "~15–30 min",
  }),
  // FLUX 3 Klein (nm10-flux3-klein): BFL's licence lets Qualifying Users (under US$5M revenue) sell outputs, but it is not
  // blanket permission for commercial fine-tuning or distribution: the description says so beside the price.
  target({
    id: "aitk-flux3-klein",
    name: "Your GPU",
    engine: "open",
    provider: "ai-toolkit",
    family: "flux3-klein",
    kinds: ["subject", "style"],
    steps: 2000,
    description: `AI-Toolkit on your own GPU (24 GB; Klein Base in 8-bit), its flux3 trainer. Needs a Hugging Face token with the FLUX Kommunity licence accepted, which is not blanket permission for commercial fine-tuning. ${LOCAL}`,
    eta: "~1–2 h on a 24 GB GPU",
  }),
  target({
    id: "fal-flux3-klein",
    name: "Cloud",
    engine: "cloud",
    provider: "fal",
    family: "flux3-klein",
    kinds: ["subject", "style"],
    trainer: "blackforestlabs/flux-3/klein/base/trainer",
    steps: 1000,
    extra: { resolution: 1024 },
    description: `BFL's FLUX 3 Klein trainer on fal, on Klein Base at 1024 px. The FLUX Kommunity licence is not blanket permission for commercial fine-tuning. ${TO_FAL}`,
    eta: "~15–30 min",
  }),
];

export const getTrainingTarget = (id: string) => TRAINING_TARGETS.find((t) => t.id === id);

/** Where a training blocker that's about the install's engine mode sends people (src/server/training.ts says it). */
export const ENGINE_MODE_PLACE = "Settings → Engine mode";

/**
 * The Settings section that lifts a target's blocker (the Train dialogs' "Open Settings"): the engine mode when the
 * blocker names it (a trainer on an engine this install turned off), else the trainer's connection (fal.ai's key, or
 * AI-Toolkit under Training).
 */
export function trainingSettingsHref(t: { provider: TrainingProvider; blocker?: string | null }): string {
  if (t.blocker?.includes(ENGINE_MODE_PLACE)) return "/settings#engine";
  return t.provider === "fal" ? "/settings#fal" : "/settings#training";
}

/** A style element trains as a style; characters, places and objects as subjects. */
export const trainingKind = (kind: ElementKind): TrainingKind => (kind === "style" ? "style" : "subject");

/** This target trains this kind of element: its training kind, and the element kinds it's limited to (people for a face trainer). */
export const trainsKind = (t: Pick<TrainingTarget, "kinds" | "onlyFor">, kind: ElementKind): boolean =>
  kind !== "voice" && t.kinds.includes(trainingKind(kind)) && (!t.onlyFor || t.onlyFor.includes(kind));

/** The targets an element of this kind can train on, in the dialog's order. */
export const targetsFor = (kind: ElementKind): TrainingTarget[] => TRAINING_TARGETS.filter((t) => trainsKind(t, kind));

/** Only a person needs the consent line (biometric data). */
export const needsConsent = (kind: ElementKind): boolean => kind === "character";

/** What stops a training from starting with this many photos (null when it can start). */
export function photosBlocker(count: number, name = "them"): string | null {
  if (count < SOUL_ID_PHOTOS.min) return `Add at least ${SOUL_ID_PHOTOS.min} photos of ${name} first (you have ${count})`;
  if (count > SOUL_ID_PHOTOS.max) return `A training takes up to ${SOUL_ID_PHOTOS.max} photos (you have ${count})`;
  return null;
}

/**
 * Tips on a set of photos before training (shown, never blocking): fewer than 20, photos smaller than 512 px on a
 * side (the trainers learn at 512–1024), and duplicates. `photos` carry their size when the browser knows it.
 */
export function photoTips(photos: { key: string; width?: number; height?: number }[]): string[] {
  const tips: string[] = [];
  if (photos.length >= SOUL_ID_PHOTOS.min && photos.length < SOUL_ID_PHOTOS.recommended) tips.push(`${SOUL_ID_COPY.more}: you have ${photos.length}`);
  const small = photos.filter((p) => p.width && p.height && Math.min(p.width, p.height) < SOUL_ID_PHOTOS.minSide).length;
  if (small) tips.push(`${small} photo${small > 1 ? "s are" : " is"} smaller than ${SOUL_ID_PHOTOS.minSide} px on a side: larger ones train better`);
  const dupes = photos.length - new Set(photos.map((p) => p.key)).size;
  if (dupes) tips.push(`${dupes} duplicate photo${dupes > 1 ? "s" : ""}: each adds nothing`);
  return tips;
}

// ---------------------------------------------------------------------------
// Which trained LoRA a run uses

/** The family a model's LoRAs belong to (undefined for a model no Soul ID applies to). */
export function familyOfModel(modelId: string): TrainingFamily | undefined {
  return TRAINING_FAMILY_IDS.find((f) => TRAINING_FAMILIES[f].models.includes(modelId));
}

/** A trained LoRA's family: recorded since O3; read from the model it was trained for before that. */
export function loraFamily(l: Pick<ElementLora, "family" | "modelId" | "referenceId">): TrainingFamily | undefined {
  if (l.referenceId) return undefined;
  return l.family ?? familyOfModel(l.modelId);
}

/**
 * A trained LoRA can run on this engine: the open engine needs a file name for ComfyUI's loras folder (downloaded
 * from its URL or copied from Fuobe's own copy when ComfyUI lacks it); the cloud needs a URL the provider can fetch,
 * or Fuobe's own copy of the file to send it.
 */
export function usableOn(l: Pick<ElementLora, "file" | "url" | "own" | "referenceId" | "demo">, engine: Engine): boolean {
  if (l.referenceId || l.demo) return false;
  return engine === "open" ? !!l.file : !!l.url || (!!l.own && !!l.file);
}

/** An older Soul ID (Higgsfield's, from before O3): it can't be exported, so the element is retrained on its photos. */
export const isLegacySoulId = (l: Pick<ElementLora, "referenceId">): boolean => !!l.referenceId;

/**
 * The trained LoRA an @mention uses on this model: one attached for this exact model (a LoRA trained elsewhere),
 * else the newest one of the model's family that runs on its engine (the one trained on that engine first).
 */
export function identityFor(loras: ElementLora[], model: Pick<ModelDef, "id" | "engine">): ElementLora | undefined {
  const exact = loras.find((l) => !l.referenceId && l.modelId === model.id && l.engine === model.engine && usableOn(l, model.engine));
  if (exact) return exact;
  const fam = familyOfModel(model.id);
  if (!fam) return undefined;
  const fits = loras.filter((l) => loraFamily(l) === fam && usableOn(l, model.engine));
  return fits.sort((a, b) => Number(b.engine === model.engine) - Number(a.engine === model.engine) || (b.trainedAt ?? 0) - (a.trainedAt ?? 0))[0];
}

/**
 * How the Train dialog names one of an element's LoRAs to remove it: an older Soul ID by its reference id, a trained LoRA by
 * its family and file (one file attached for two families is two LoRAs).
 */
export const identityKey = (l: Pick<ElementLora, "file" | "referenceId" | "modelId" | "family">): string =>
  l.referenceId || `${loraFamily(l) ?? l.modelId}:${l.file || l.modelId}`;

/** A trained LoRA some run can use (not a demo's stand-in or an older Soul ID, and on an engine where its family has a model). */
export function runsSomewhere(l: Pick<ElementLora, "file" | "url" | "own" | "referenceId" | "demo" | "family" | "modelId">): boolean {
  const fam = loraFamily(l);
  const lead = fam ? TRAINING_FAMILIES[fam].lead : { open: l.modelId, cloud: l.modelId };
  return (!!lead.open && usableOn(l, "open")) || (!!lead.cloud && usableOn(l, "cloud"));
}

/** The families an element has a trained LoRA for. */
export const trainedFamilies = (loras: ElementLora[]): TrainingFamily[] => [...new Set(loras.map(loraFamily).filter((f): f is TrainingFamily => !!f))];

// ---------------------------------------------------------------------------
// The dataset and the requests

/** A short, rare trigger token for an element, e.g. "mayalpz". */
export function triggerFor(handle: string): string {
  const base = handle.toLowerCase().replace(/[^a-z0-9]/g, "");
  const consonants = base.replace(/[aeiou]/g, "");
  return `${(consonants.length >= 3 ? consonants : base).slice(0, 6) || "elem"}fz`;
}

/** What a dataset's captions say: a person ("photo of <trigger>") or a look ("<trigger> style"). */
export function trainingCaption(kind: "character" | "style", trigger: string, description?: string | null): string {
  const extra = description?.trim().replace(/[.\s]+$/, "");
  return `${kind === "style" ? `${trigger} style` : `photo of ${trigger}`}${extra ? `, ${extra}` : ""}`;
}

/** The dataset's file names: 001.jpg with its caption 001.txt (what fal's image trainers read). */
export const datasetName = (index: number, ext: string): string => `${String(index + 1).padStart(3, "0")}.${ext}`;

const clampField = (f: TrainerField | undefined, v: number) => (f ? Math.min(f.max ?? v, Math.max(f.min ?? v, v)) : v);

/**
 * The request a hosted trainer gets: the dataset zip in its data field, then only the fields its schema has (steps
 * within its limits, the caption every photo shares, the trigger for trainers that take one, the learning rate,
 * and the target's own fields such as training_type for a style).
 */
export function falTrainingInput(t: TrainingTarget, zipUrl: string, caption: string, trigger?: string): Record<string, unknown> {
  const tr = getTrainer(t.trainer);
  if (!tr) throw new Error(`${t.id} has no hosted trainer`);
  const f = tr.fields;
  const body: Record<string, unknown> = { [tr.dataField]: zipUrl };
  if (f.steps) body.steps = clampField(f.steps, t.steps);
  if (f.default_caption) body.default_caption = caption;
  if (trigger && f.trigger_phrase) body.trigger_phrase = trigger;
  else if (trigger && f.trigger_word) body.trigger_word = trigger;
  if (f.learning_rate && t.learningRate !== undefined) body.learning_rate = t.learningRate;
  // The FLUX.2 trainers name the LoRA's weights fal's way unless asked ("Dictates the naming scheme for the output
  // weights", schema read 2026-10-27): a family that also runs on ComfyUI gets ComfyUI's names, the same file an
  // AI-Toolkit training makes, which Fuobe sends to fal for cloud runs too.
  if (f.output_lora_format?.enum?.includes("comfy") && TRAINING_FAMILIES[t.family].lead.open) body.output_lora_format = "comfy";
  for (const [k, v] of Object.entries(t.extra ?? {})) if (f[k] && (!f[k].enum || f[k].enum.includes(v as string | number))) body[k] = v;
  return body;
}

/** The trained LoRA's URL in a hosted trainer's response: the trainer's own LoRA field first. */
export function trainedLoraUrl(t: Pick<TrainingTarget, "trainer">, out: Record<string, unknown>): string | undefined {
  const fields = [...(getTrainer(t.trainer)?.loraOutput ?? []), "diffusers_lora_file", "lora_file"];
  for (const k of fields) {
    const url = (out[k] as { url?: unknown } | undefined)?.url;
    if (typeof url === "string" && url) return url;
  }
  return undefined;
}

/**
 * The AI-Toolkit model and sample settings per base (its supported models and example configs, read 2026-10-27:
 * arch names from extensions_built_in/diffusion_models; FLUX.1 and Qwen-Image from config/examples). Z-Image Turbo
 * trains with ostris's training adapter v2 (research §4.5); the gated FLUX [dev] repos need an HF token.
 */
const AITK_MODELS: Partial<Record<TrainingFamily, { model: Record<string, unknown>; guidance: number; sampleSteps: number; timestepType?: string }>> = {
  "z-image-turbo": {
    model: {
      name_or_path: "Tongyi-MAI/Z-Image-Turbo",
      arch: "zimage:turbo",
      assistant_lora_path: "ostris/zimage_turbo_training_adapter/zimage_turbo_training_adapter_v2.safetensors",
      quantize: true,
      qtype: "qfloat8",
      quantize_te: true,
      qtype_te: "qfloat8",
      low_vram: true,
    },
    guidance: 1,
    sampleSteps: 9,
  },
  "qwen-image-2512": {
    model: { name_or_path: "Qwen/Qwen-Image-2512", arch: "qwen_image", quantize: true, qtype: "qfloat8", quantize_te: true, qtype_te: "qfloat8", low_vram: true },
    guidance: 3,
    sampleSteps: 25,
  },
  "flux1-dev": {
    model: { name_or_path: "black-forest-labs/FLUX.1-dev", arch: "flux", quantize: true, low_vram: true },
    guidance: 4,
    sampleSteps: 20,
  },
  "flux2-dev": {
    model: { name_or_path: "black-forest-labs/FLUX.2-dev", arch: "flux2", quantize: true, qtype: "qfloat8", quantize_te: true, qtype_te: "qfloat8", low_vram: true },
    guidance: 4,
    sampleSteps: 25,
  },
  "flux2-klein-4b": {
    model: { name_or_path: "black-forest-labs/FLUX.2-klein-base-4B", arch: "flux2_klein_4b", quantize: true, qtype: "qfloat8", quantize_te: true, qtype_te: "qfloat8", low_vram: true },
    guidance: 4,
    sampleSteps: 25,
  },
  // FLUX 3 Image Klein Base (AI-Toolkit's flux3 model, main at e9c72b7, 2026-10-31: its UI's defaults, convrot8 quantization,
  // shift timesteps; a repack file already in ComfyUI's models folder is used in place). The repo is gated: an HF token.
  "flux3-klein": {
    model: {
      name_or_path: "black-forest-labs/flux-3-image-klein-base",
      arch: "flux3",
      quantize: true,
      qtype: "convrot8",
      quantize_te: true,
      qtype_te: "convrot8",
      low_vram: true,
      model_kwargs: { match_target_res: true },
    },
    guidance: 3.5,
    sampleSteps: 28,
    timestepType: "shift",
  },
};

/** The bases AI-Toolkit trains for Fuobe (the training kit's choices). */
export const AITK_FAMILIES = Object.keys(AITK_MODELS) as TrainingFamily[];

/**
 * AI-Toolkit job config for a LoRA on a family's base (research §4.5 for Z-Image Turbo: ostris's training adapter v2,
 * rank 16–32, 1,500–2,500 steps). A larger photo set gets rank 32 (more to learn); a style (a moodboard) gets fewer
 * steps and samples of new scenes in the look, instead of portraits of the person.
 */
export function aiToolkitJob(opts: {
  name: string;
  trigger: string;
  datasetFolder: string;
  outputFolder: string;
  steps?: number;
  kind?: "character" | "style";
  photos?: number;
  family?: TrainingFamily;
}) {
  const style = opts.kind === "style";
  const rank = !style && (opts.photos ?? 0) >= SOUL_ID_PHOTOS.recommended ? 32 : 16;
  const base = AITK_MODELS[opts.family ?? "z-image-turbo"];
  if (!base) throw new Error(`AI-Toolkit doesn't train ${TRAINING_FAMILIES[opts.family!].base} for Fuobe: train it in the cloud`);
  return {
    job: "extension",
    config: {
      name: opts.name,
      process: [
        {
          type: "diffusion_trainer",
          training_folder: opts.outputFolder,
          device: "cuda",
          trigger_word: opts.trigger,
          network: { type: "lora", linear: rank, linear_alpha: rank },
          save: { dtype: "bf16", save_every: 500, max_step_saves_to_keep: 3, save_format: "safetensors" },
          datasets: [
            { folder_path: opts.datasetFolder, caption_ext: "txt", caption_dropout_rate: 0.05, cache_latents_to_disk: true, resolution: [512, 768, 1024], num_repeats: 1 },
          ],
          train: {
            batch_size: 1,
            gradient_accumulation: 1,
            train_unet: true,
            train_text_encoder: false,
            gradient_checkpointing: true,
            noise_scheduler: "flowmatch",
            optimizer: "adamw8bit",
            lr: 0.0001,
            optimizer_params: { weight_decay: 0.0001 },
            dtype: "bf16",
            cache_text_embeddings: true,
            ema_config: { use_ema: false },
            steps: opts.steps ?? (style ? 1500 : 2000),
            timestep_type: base.timestepType ?? "weighted",
          },
          model: base.model,
          sample: {
            sampler: "flowmatch",
            sample_every: 500,
            width: 1024,
            height: 1024,
            seed: 42,
            walk_seed: true,
            prompts: style
              ? [`a city street at night, ${opts.trigger} style`, `a bowl of fruit on a wooden table, ${opts.trigger} style`, `a portrait of a woman in a garden, ${opts.trigger} style`]
              : [`photo of ${opts.trigger}, close-up portrait, natural window light`, `${opts.trigger} walking in a neon-lit street at night, full body`],
            neg: "",
            guidance_scale: base.guidance,
            sample_steps: base.sampleSteps,
          },
        },
      ],
    },
    meta: { name: opts.name, version: "1.0" },
  };
}
