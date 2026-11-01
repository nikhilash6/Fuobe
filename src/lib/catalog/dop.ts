/**
 * Fuobe DoP (build plan O4): Higgsfield's DoP camera motions, its Mix and its effects as one Original on both
 * engines, rebuilt from open weights and LoRAs. Pure logic, no I/O: from the preset → LoRA map v2
 * (oss-loras.generated.ts, research §7) to each preset's open and cloud routes.
 *
 * - Wan 2.2 / 2.1 LoRAs → Fuobe DoP: Wan 2.2 14B on the user's GPU (LoRAs injected on their expert), fal's Wan 2.2
 *   A14B LoRA endpoint in the cloud (49 or 81 frames at 16 fps), Replicate's fast Wan as the second provider.
 * - LTX-2.3 LoRAs (FPV Drone, Wind to Face, the transitions) and LTX-2.3's built-in camera LoRA (dolly, jib, static)
 *   → Fuobe DoP · LTX. A camera move Wan 2.2 Fun Camera makes natively takes its pose on the user's GPU.
 * - LTX-2.5 LoRAs (Slow Motion, Car Jump) run on the user's GPU only: fal has no LTX-2.5 LoRA endpoint, so the
 *   cloud runs the preset's words. Focus Change is LTX-2.5's own focus_shift move, hosted (LTX-2.5 Fast).
 * - Effects that are a grade (15) animate without a LoRA, then the grade is applied in the browser; the relight
 *   effects (6) relight the start frame first (Qwen-Image-Edit 2509 + its Relight LoRA), then animate it.
 * - Licences are information: a LoRA licensed for the user's GPU only (civitai "RentCivit") goes to the cloud route
 *   too, unless Settings → Models & licences keeps such LoRAs on the GPU (fitLoras then leaves it out, saying so); a
 *   non-commercial LoRA or one whose licence the research holds is used and said in the preset's line.
 * - The Mixed Media looks (32 effects, build plan O9) draw the start frame in the Mixed Media studio's look first
 *   (Fuobe Mixed Media: Z-Image Turbo + ControlNet with the look's LoRA, one seed), then animate it on the words.
 * - A preset with nothing of the Original's own in the cloud (no hostable LoRA, camera LoRA, hosted move, grade or
 *   relight) keeps its partner route there, Kling 2.5 Turbo on the preset's words: Fuobe DoP on the words alone
 *   becomes its cloud default only when the evaluation harness (scripts/eval, O8) promotes it. On the user's GPU it
 *   is Fuobe DoP (Wan 2.2 on the words, as before).
 */
import { gpuOnlyLicence, libraryEntry, loraName, loraRef, triggerOf } from "./loras";
import { defaultValues, getMixedPreset, originalFrameRequest } from "./mixed-media";
import { mixedLoras } from "./mixed-media-looks";
import { DOP_RECIPES, OSS_LORAS, type DopRecipe, type OssLora } from "./oss-loras.generated";
import type { LoraRef, Operation, Preset, PresetRoute } from "./types";

export const DOP_MODEL = "fuobe-dop";
export const DOP_LTX_MODEL = "fuobe-dop-ltx";
/** LTX-2.5 LoRAs: the open LTX-2.5 graph (fal has no LTX-2.5 LoRA endpoint). */
const LTX25_OPEN = "oss-ltx25";
/** LTX-2.5's camera_motion on fal's fast endpoint (Focus Change's focus_shift): open weights, hosted, no LoRAs. */
export const LTX25_HOSTED = "ltx-2-5-fast";
/** The relight step before the clip: Qwen-Image-Edit 2509 + the Relight LoRA (the open graph has it built in). */
export const RELIGHT_OPEN = "oss-qwen-relight";
export const RELIGHT_CLOUD = "qwen-image-edit-2509-cloud";
/** The Relight LoRA's trigger ("relight"): the open graph prefixes it itself. */
const RELIGHT_TRIGGER = "重新照明";

/** The Original's models (both engines). */
export const DOP_MODELS = new Set([DOP_MODEL, DOP_LTX_MODEL]);
export const isDop = (modelId: string | undefined): boolean => !!modelId && DOP_MODELS.has(modelId);

/** Which model family a LoRA loads on. */
export type LoraFamily = "wan" | "ltx" | "ltx-2.5" | "edit";

export function loraFamily(base: string): LoraFamily | undefined {
  if (/^wan2\.[12]/.test(base)) return "wan";
  if (/^ltx-2(\.3-|-19b)/.test(base)) return "ltx";
  if (/^ltx-2\.5/.test(base)) return "ltx-2.5";
  if (/^qwen-image-edit/.test(base)) return "edit";
  return undefined;
}

/**
 * Statuses whose preset runs on its words alone (no LoRA, or a better route elsewhere). A licence the research holds
 * ("licence-hold": BTS) is information now, and its LoRA is in the map with it; the preset keeps the words it ran on
 * until the evaluation harness measures the LoRA, so no default changes with the licence rule (a suggestion).
 */
const WORDS_ONLY = new Set(["post-grade", "mixed-media-route", "licence-hold", "prompt-only", "train-own", "motion-library"]);

/**
 * Camera moves Wan 2.2 Fun Camera makes natively (round 1): a motion without a dedicated LoRA runs on that graph
 * with an explicit pose instead of camera words alone. The research's map v2 adds more (DOP_RECIPES.funCamera).
 */
const FUN_CAMERA_POSE: Record<string, string> = {
  "motion-pan-left": "Pan Left",
  "motion-pan-right": "Pan Right",
  "motion-tilt-up": "Pan Up",
  "motion-tilt-down": "Pan Down",
  "motion-zoom-in": "Zoom In",
  "motion-zoom-out": "Zoom Out",
  "motion-rapid-zoom-in": "Zoom In",
  "motion-rapid-zoom-out": "Zoom Out",
  "motion-dolly-out": "Zoom Out",
  "motion-static": "Static",
  "motion-dutch-angle": "ClockWise (CW)",
  "motion-roll-left": "Anti Clockwise (ACW)",
  "motion-roll-right": "ClockWise (CW)",
};

/** The colour-grade effects: animated without a LoRA, then graded in the browser (src/lib/grade.ts presets). */
export const DOP_GRADES: Record<string, string> = {
  "effect-film-colors": "film-colors",
  "effect-black-gloss": "black-gloss",
  "effect-candy-pink": "candy-pink",
  "effect-lime-jam": "lime-jam",
  "effect-nostalgic-blue": "nostalgic-blue",
  "effect-soft-palette": "soft-palette",
  "effect-overtime": "overtime",
  "effect-crimson-vigil": "crimson-vigil",
  "effect-bleach-bypass": "bleach-bypass",
  "effect-bleached-warm": "bleached-warm",
  "effect-classic-bw": "classic-bw",
  "effect-cold-steel": "cold-steel",
  "effect-hyper-neon": "hyper-neon",
  "effect-naturalistic-clean": "naturalistic-clean",
  "effect-sodium-decay": "sodium-decay",
};

/** What the relight effects ask of the Relight LoRA (Fuobe's words for each light). */
const RELIGHT_LIGHT: Record<string, string> = {
  "effect-silhouette": "strong backlight behind the subject, the subject nearly a dark silhouette with a glowing rim",
  "effect-practicals": "lit only by warm practical lamps in the scene, warm pools of light and moody falloff",
  "effect-window": "soft natural window light from the side, gentle shadows of the window frame",
  "effect-overhead-fall": "a single hard light from directly above, deep shadows under the eyes",
  "effect-contre-jour": "the sun directly behind the subject, flaring into the lens, glowing hair light",
  "effect-soft-cross": "two soft cross lights from opposite sides, even and flattering on the face",
};

const bare = (id: string) => id.replace(/^(motion|effect|app)-/, "");

/** The Mixed Media studio look a DoP Mixed Media effect is ("effect-two-color" → "mixed-two-color"). */
export const mixedLookOf = (presetId: string) => getMixedPreset(`mixed-${bare(presetId)}`);

/**
 * A Mixed Media effect's step before the clip (O9): the still drawn in the studio look's default settings by Fuobe Mixed
 * Media on the engine the clip runs on (its LoRA, its seed; about 1 megapixel on fal, the still's own shape).
 */
function mixedPrestep(presetId: string): Preset["prestep"] {
  const look = mixedLookOf(presetId);
  if (!look) return undefined;
  const values = defaultValues(look);
  const labels = { step: `Start frame as ${look.name}`, clip: `${look.name} clip` };
  const step = (engine: "open" | "cloud") => {
    const { modelId, prompt, loras, params } = originalFrameRequest({ engine, preset: look, values, resolution: "1K", loras: mixedLoras(look.id) });
    return { modelId, op: "edit" as const, prompt: prompt ?? "", ...(loras?.length && { loras }), ...(params && { params }), labels };
  };
  return { open: step("open"), cloud: step("cloud") };
}

/** A map LoRA as a recipe's LoRA: the library's pinned download and licence when it is a library file. */
function asRef(l: OssLora): LoraRef {
  const e = libraryEntry(l);
  if (e) return { ...loraRef(e, l.strength), target: l.target };
  const { file, url, strength, trigger, target, version, licence } = l;
  return { file, url, strength, ...(trigger && { trigger }), target, ...(version && { version }), licence };
}

/** The map's LoRAs for a preset (map v2 by preset id, else a round-1 match), with their family. */
export function presetLoras(presetId: string): { ref: LoraRef; base: string; family?: LoraFamily }[] {
  const raw = OSS_LORAS[presetId] ?? OSS_LORAS[bare(presetId)] ?? [];
  return raw.map((l) => ({ ref: asRef(l), base: l.base, family: loraFamily(l.base) }));
}

export const dopRecipe = (presetId: string): DopRecipe | undefined => DOP_RECIPES[presetId];

const withTrigger = (template: string, loras: LoraRef[]) => {
  const trigger = triggerOf(loras);
  return trigger ? `${trigger}. ${template}` : undefined;
};

/** A note as a sentence, with its final period. */
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/**
 * A motion or effect preset as Fuobe DoP runs it: its open and cloud routes (model, operation, LoRAs, camera pose
 * or camera LoRA, prompt with the LoRA's trigger), what it adds (a grade, a relight step) and a line on how it runs.
 */
export function dopPreset(p: Preset): Preset {
  if (p.type !== "motion" && p.type !== "effect") return p;
  const recipe = DOP_RECIPES[p.id];
  const status = recipe?.status;
  const op: Operation = p.inputs.some((i) => i.key === "endImage") ? "flf2v" : "i2v";
  const all = status && WORDS_ONLY.has(status) ? [] : presetLoras(p.id);
  const of = (f: LoraFamily) => all.filter((l) => l.family === f).map((l) => l.ref);
  // The relight effects' LoRAs relight the still (Qwen 2509) or an existing clip (an LTX IC-LoRA): neither animates it.
  const relight = status === "relight-route";
  const wan = relight ? [] : of("wan");
  const ltx = relight ? [] : of("ltx");
  const ltx25 = relight ? [] : of("ltx-2.5");
  const pose = op === "i2v" ? (recipe?.funCamera ?? FUN_CAMERA_POSE[p.id]) : undefined;
  const base = { duration: 5 };
  const route = (modelId: string, loras: LoraRef[], params: PresetRoute["params"] = {}): PresetRoute => {
    const promptTemplate = loras.length ? withTrigger(p.promptTemplate, loras) : undefined;
    return { modelId, op, params: { ...base, ...params }, ...(loras.length && { loras }), ...(promptTemplate && { promptTemplate }) };
  };

  // What the Details popover says each engine does, in plain words. The route keeps the model, the LoRA files and
  // the camera pose; the popover's route rows name the model.
  const thing = p.type === "motion" ? "move" : "effect";
  const withLora = `uses a LoRA trained for this ${thing}`;
  const onWords = `follows the ${thing}'s description`;
  const cameraControl = "uses a built-in camera control for this move";

  // On the user's GPU: Wan first (most LoRAs, Mix stacks there), then LTX-2.3, then LTX-2.5; else a pose; else words.
  let open: PresetRoute;
  let openSays: string;
  if (wan.length) {
    // A Wan 2.1 LoRA runs on Wan 2.2 too (its strength is checked on a GPU run); the Details popover just names it.
    open = route(DOP_MODEL, wan);
    openSays = withLora;
  } else if (ltx.length) {
    // An LTX-2 LoRA runs on LTX-2.3 too (not verified yet); the Details popover just names it.
    open = route(DOP_LTX_MODEL, ltx);
    openSays = withLora;
  } else if (ltx25.length && op === "i2v") {
    open = { ...route(LTX25_OPEN, ltx25), params: { duration: 5, resolution: "720p" } };
    openSays = withLora;
  } else if (pose) {
    open = route(DOP_MODEL, [], { extra: { cameraMotion: pose } });
    // Wan 2.2 Fun Camera's own pose.
    openSays = cameraControl;
  } else {
    open = route(DOP_MODEL, []);
    openSays = onWords;
  }

  // What the effect adds around the clip: a grade the browser applies after it, or a relight of the start frame first.
  const extras: Pick<Preset, "grade" | "prestep"> = {};
  const grade = DOP_GRADES[p.id];
  if (grade) extras.grade = grade;
  const light = RELIGHT_LIGHT[p.id];
  const relightLora = relight ? all.find((l) => l.family === "edit")?.ref : undefined;
  if (light && relightLora) {
    extras.prestep = {
      open: { modelId: RELIGHT_OPEN, op: "edit", prompt: light },
      cloud: { modelId: RELIGHT_CLOUD, op: "edit", prompt: `${RELIGHT_TRIGGER}, ${light}`, loras: [relightLora] },
    };
  }
  // The Mixed Media looks: the still in the look first (Fuobe Mixed Media), then Wan 2.2 animates it on the words.
  const mixedLook = status === "mixed-media-route" ? mixedLookOf(p.id) : undefined;
  if (mixedLook) extras.prestep = mixedPrestep(p.id);

  // In the cloud: LTX-2.5's own move, LTX-2.3's camera LoRA, the Wan or LTX LoRAs a host runs, a grade or a relight on
  // Wan. A LoRA licensed for the GPU only rides along on Fuobe DoP (said below; the admin can keep such LoRAs on the
  // GPU), but doesn't make Fuobe DoP the cloud default by itself: that preset keeps its partner route on the words
  // (Wiggle), like anything else, until the evaluation harness promotes Fuobe DoP's.
  const wanHosted = wan.some((l) => !gpuOnlyLicence(l)) ? wan : [];
  const ltxHosted = ltx.some((l) => !gpuOnlyLicence(l)) ? ltx : [];
  let cloud: PresetRoute;
  let cloudSays: string | undefined;
  if (recipe?.cameraMotion) {
    // The fast endpoint at 720p in the start frame's shape, silent like every DoP clip (its defaults say so too).
    cloud = { modelId: LTX25_HOSTED, op: "i2v", params: { duration: 6, resolution: "720p", aspectRatio: "auto", generateAudio: false, extra: { camera_motion: recipe.cameraMotion } } };
    // LTX-2.5's own camera move.
    cloudSays = cameraControl;
  } else if (recipe?.cameraLora) {
    cloud = route(DOP_LTX_MODEL, ltxHosted, { extra: { camera_lora: recipe.cameraLora } });
    // LTX-2.3's camera LoRA, with the preset's LTX LoRAs when a host runs them.
    cloudSays = withLora;
  } else if (wanHosted.length) {
    cloud = route(DOP_MODEL, wanHosted);
    cloudSays = withLora;
  } else if (ltxHosted.length) {
    cloud = route(DOP_LTX_MODEL, ltxHosted);
    cloudSays = withLora;
  } else if (extras.grade || extras.prestep || !p.cloud) {
    cloud = route(DOP_MODEL, []);
    cloudSays = onWords;
  } else {
    // The partner route stays until the evaluation harness measures Fuobe DoP on these words (fal has no LTX-2.5 LoRA
    // endpoint, so an LTX-2.5 LoRA stays on the GPU).
    cloud = { ...p.cloud, partner: true };
  }

  const local = [...wan, ...ltx].filter(gpuOnlyLicence);
  const used = [...wan, ...ltx, ...(open.modelId === LTX25_OPEN ? ltx25 : [])];
  const nonCommercial = used.filter((l) => (l.licence ?? libraryEntry(l)?.licence)?.commercial === false);
  // "Its LoRA is", "Its LoRAs are" or "One of its LoRAs is": the LoRA files' names stay in the route, not in Details.
  const its = (some: LoraRef[]) => {
    const n = new Set(some.map(loraName)).size;
    const of = new Set(used.map(loraName)).size;
    if (n < of) return n > 1 ? "Some of its LoRAs are" : "One of its LoRAs is";
    return n > 1 ? "Its LoRAs are" : "Its LoRA is";
  };
  let parity: string;
  if (grade) parity = "Fuobe DoP animates your still, then your browser grades the clip.";
  else if (mixedLook && extras.prestep) {
    // Fuobe Mixed Media is Z-Image Turbo + ControlNet, with the look's LoRA when the map has one.
    parity = `Fuobe Mixed Media draws your still as ${mixedLook.name} first, then Fuobe DoP animates it, on your GPU and in the cloud. For a whole clip restyled frame by frame, use Mixed Media.`;
  } else if (extras.prestep) {
    // The relight is Qwen-Image-Edit 2509 with its Relight LoRA.
    parity = "Fuobe DoP relights your still first, then animates it.";
  } else if (status === "mixed-media-route") parity = `${p.parity ? `${sentence(p.parity)} ` : ""}For a whole clip restyled frame by frame, use Mixed Media.`;
  else if (!cloudSays && local.length) parity = `On your GPU, Fuobe DoP ${openSays}. ${its(local)} licensed for your GPU only, so in the cloud it runs on a partner model.`;
  else if (!cloudSays) parity = `On your GPU, Fuobe DoP ${openSays}. In the cloud it runs on a partner model.`;
  else if (openSays === cloudSays) parity = `Fuobe DoP ${openSays}, on your GPU and in the cloud.`;
  else parity = `On your GPU, Fuobe DoP ${openSays}. In the cloud, it ${cloudSays}.`;
  // A LoRA licensed for the GPU only (civitai lists no "Rent") rides along on Fuobe DoP in the cloud unless the admin
  // keeps such LoRAs on the GPU.
  if (local.length && cloudSays) parity += ` ${its(local)} licensed for your GPU only. Settings → Models & licences can keep ${local.length > 1 ? "them" : "it"} off the cloud.`;
  if (nonCommercial.length) parity += ` ${its(nonCommercial)} for non-commercial use.`;
  // A LoRA whose licence the research holds ("licence-hold": BTS, whose Hugging Face and civitai pages disagree) stays
  // in the library; the preset runs on its words until it is evaluated, which the line above already says.
  return { ...p, open, cloud, parity, ...extras };
}
