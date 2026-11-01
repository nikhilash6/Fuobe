/**
 * Fuobe Evolution (build plan O13): Higgsfield Evolution's Original. One clip and up to 40 references are taken
 * further in a creative direction an LLM writes from the references (or you write); the change intensity sets how
 * much of the clip stays. Research: docs/research/fuobe-originals-recipes-5.md §8 evolution and its JSON twin
 * (studios[evolution].original); what Higgsfield's does: higgsfield-originals-5.md §3.20.
 *
 * - On your GPU: per ≤81-frame segment at 16 fps, Qwen-Image 2.1 Turbo takes the segment's first frame toward the
 *   direction (the first references as images 2–4), then Wan 2.2 Fun VACE re-renders the segment from the segment
 *   itself, noised to the intensity's denoise, with depth control and that frame as its reference
 *   (video-evolution-wan22-fun-vace, which also loads a whole clip at 16 fps when Edit video sends one).
 * - In the cloud: the same model hosted on fal (Wan 2.2 Fun VACE depth), the way Fuobe Shorts runs it. Per piece of up to
 *   10 s (241 frames as fal works them), hosted Qwen-Image-Edit 2511 takes the piece's first frame toward the direction
 *   (the first references as images 2–4), and VACE re-renders the piece by its depth with that frame as its reference
 *   (ref_image_urls, as the GPU graph's reference_image; no first frame pinned, as on the GPU). The endpoint has
 *   no strength field, so the change level reaches the direction frame only: how much of the clip's own look stays
 *   (the GPU's denoise) is set on your GPU only (EVOLUTION_CLOUD_NOTE).
 * - Then the pieces are joined and the clip's own sound put back.
 *
 * Pure module, shared by the page, the server (src/server/evolution.ts) and the tests.
 */
import {
  originalBilledSeconds,
  originalSegmentProblem,
  originalSegmentSeconds,
  planCloudSegments,
  planOpenSegments,
  planStitch,
  SHORTS,
  SHORTS_TOOLS,
  vaceDownsample,
  wholeClip,
  type PlanStep,
  type ShortsPlanInput,
  type ShortsRange,
} from "./shorts";
import type { Engine, GenerationRequest } from "./types";

export const EVOLUTION = {
  model: "fuobe-evolution",
  feature: "evolution",
  /** Cuts, direction frames, segments and joins: kept apart from the finished videos. */
  stepFeature: "evolution-step",
  /** Higgsfield's limits: one video of 4–30 s, up to 40 references, a direction of up to 10,000 characters. */
  minSeconds: 4,
  maxSeconds: 30,
  maxReferences: 40,
  maxDirectionChars: 10_000,
  /** What reaches the models: the direction's first sentences, up to this many characters. */
  promptChars: 1500,
  /** Qwen-Image 2.1 Turbo takes the frame plus three references. */
  openReferences: 3,
  /** In the cloud, hosted Qwen-Image-Edit 2511 takes the frame plus as many: the GPU recipe's direction frame. */
  cloudReferences: 3,
  /** The LLM sees this many references (Claude reads up to 20 images a turn; a local vision model fewer). */
  llmReferences: { cloud: 8, open: 4 } as Record<Engine, number>,
  /** Helper on the GPU: the segment's first frame taken toward the direction (Qwen-Image 2.1 Turbo, 8 steps). */
  frameModel: "oss-qwen-image-21-turbo",
  /** Helper in the cloud: the same step on hosted Qwen-Image-Edit 2511 (Fuobe Shorts' first-frame model). */
  cloudFrameModel: SHORTS_TOOLS.cloud.frame,
  maxBytes: 500 * 1024 * 1024,
  accept: "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm",
} as const;

export type Intensity = "low" | "medium" | "high";

/**
 * Build plan O13's change intensity: the denoise the open graph starts from (the noise level it takes the clip to:
 * (1 − denoise) × clip + denoise × noise, then 4 Lightx2v steps back), and on both engines the direction frame's
 * instruction (directionFramePrompt). fal's hosted VACE has no strength field, so in the cloud the instruction is all of
 * it. The same numbers are in the research (studios[evolution].original.intensity); tests/evolution.test.ts holds them together.
 */
export const INTENSITIES: { id: Intensity; label: string; denoise: number; hint: string }[] = [
  { id: "low", label: "Low", denoise: 0.45, hint: "Same scene and people, a new finish" },
  { id: "medium", label: "Medium", denoise: 0.65, hint: "The action stays, the world around it changes" },
  { id: "high", label: "High", denoise: 0.85, hint: "Only the motion and timing stay" },
];

const intensity = (i: Intensity) => INTENSITIES.find((x) => x.id === i) ?? INTENSITIES[1];
export const denoiseFor = (i: Intensity): number => intensity(i).denoise;

/** What the cloud can't do of the GPU recipe, in one plain line (the page, the estimate and Settings say it). */
export const EVOLUTION_CLOUD_NOTE = "In the cloud the change level shapes each piece's direction frame; how much of the clip's own look stays is set on your GPU only";

/** Resolutions per engine (the GPU graph tops out at 1280 px; fal's hosted VACE at 720p) and the default. Both keep the clip's shape. */
export const EVOLUTION_RESOLUTIONS: Record<Engine, string[]> = { open: ["480p", "720p"], cloud: ["480p", "580p", "720p"] };
export const EVOLUTION_DEFAULT_RESOLUTION: Record<Engine, string> = { open: "480p", cloud: "720p" };

/** The resolutions an engine offers, as a choice: "480p, 580p or 720p". */
export const resolutionChoices = (engine: Engine): string => EVOLUTION_RESOLUTIONS[engine].join(", ").replace(/, ([^,]*)$/, " or $1");

/** The cloud's pieces: Fuobe Shorts' (at most 10 s and 241 frames as fal's VACE works them, by the clip's rate). */
export function cloudPieces(range: ShortsRange, fps?: number) {
  return planCloudSegments(range, originalSegmentSeconds(fps));
}

// ---------------------------------------------------------------------------
// Checks

export interface EvolutionSource {
  url: string;
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
}

/** What's wrong with a selection, or null. */
export function evolutionRangeProblem(range: ShortsRange, duration?: number): string | null {
  const len = range.end - range.start;
  if (!(len > 0) || range.start < 0) return "Pick a part of the clip";
  if (duration !== undefined && range.end > duration + 0.05) return "The selection runs past the end of the clip";
  if (len < EVOLUTION.minSeconds - 0.05) return `Select at least ${EVOLUTION.minSeconds} seconds`;
  if (len > EVOLUTION.maxSeconds + 0.05) return `Select up to ${EVOLUTION.maxSeconds} seconds`;
  return null;
}

/** Why this run can't start, or null. */
export function evolutionProblem(o: { engine: Engine; source: Pick<EvolutionSource, "duration" | "fps">; range: ShortsRange; references: number; direction?: string; resolution?: string }): string | null {
  const r = evolutionRangeProblem(o.range, o.source.duration);
  if (r) return r;
  if (o.references > EVOLUTION.maxReferences) return `Use up to ${EVOLUTION.maxReferences} references`;
  if ((o.direction?.length ?? 0) > EVOLUTION.maxDirectionChars) return `Keep the direction under ${EVOLUTION.maxDirectionChars.toLocaleString("en")} characters`;
  if (o.resolution && !EVOLUTION_RESOLUTIONS[o.engine].includes(o.resolution)) return `${o.resolution} isn't offered ${o.engine === "open" ? "on your GPU" : "in the cloud"} — pick ${resolutionChoices(o.engine)}`;
  // fal's VACE refuses a piece under 17 frames or a clip under 5 fps: said before the cuts and frames are paid for.
  if (o.engine === "cloud") return cloudPieces(o.range, o.source.fps).map((p) => originalSegmentProblem(p.end - p.start, o.source.fps)).find(Boolean) ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// The creative direction

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** Said when a direction is longer than the models take (the estimate's note; the page says it as you type). */
export const DIRECTION_CUT_NOTE = `Only the first ${EVOLUTION.promptChars.toLocaleString("en")} characters of the direction reach the model, up to the last full sentence`;

/** The prompt the models get: the direction, cut after a sentence once it passes EVOLUTION.promptChars. */
export function directionPrompt(direction: string): { text: string; cut: boolean } {
  const t = tidy(direction);
  if (t.length <= EVOLUTION.promptChars) return { text: t, cut: false };
  const head = t.slice(0, EVOLUTION.promptChars);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  return { text: end > EVOLUTION.promptChars / 2 ? head.slice(0, end + 1) : head.replace(/\s+\S*$/, ""), cut: true };
}

const FRAME_VERB: Record<Intensity, string> = {
  low: "Refine image 1 gently toward this direction",
  medium: "Change image 1 toward this direction",
  high: "Reimagine image 1 boldly in this direction",
};

/** "image 2", "images 2 and 3", "images 2, 3 and 4": the references after the frame. */
function refImages(refs: number): string {
  const n = Array.from({ length: refs }, (_, k) => String(k + 2));
  return n.length === 1 ? `image ${n[0]}` : `images ${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
}

/** On both engines: the edit model's instruction for the segment's first frame (references are images 2 onward). */
export function directionFramePrompt(direction: string, i: Intensity, refs: number): string {
  const d = directionPrompt(direction).text.replace(/[.\s]+$/, "");
  const keep = i === "high" ? "Keep the composition and the poses of image 1." : "Keep the composition, the people, their faces and poses, and the framing of image 1.";
  const match = refs ? ` Use the characters, objects and style of ${refImages(refs)} where they fit.` : "";
  return `${FRAME_VERB[i]}: ${d}. ${keep}${match}`;
}

/** The LLM's brief (Fuobe's own words). */
export const DIRECTION_SYSTEM = `You write the creative direction for a video-to-video model that re-renders the user's clip. The clip's motion, timing and camera stay; how much else changes depends on the change intensity:
- low: keep the scene, the people and the setting; refine the look (light, colour, texture, small wardrobe details).
- medium: keep what the people do and how the camera moves; change the setting, wardrobe, light and style.
- high: keep only the motion and timing; reinvent the world, how the characters look and the style.
Use the reference images: take their characters, objects, places, colours and style where they fit. If the user gave an idea, build on it.
Write a description of the finished video, what we see, in the present tense: one paragraph of 50 to 120 words. Not instructions, no camera moves the clip doesn't have, no on-screen text, no lists, no preamble or quotes. Reply with the paragraph only.`;

/** The LLM's question: the intensity, the user's words and what is attached. */
export function directionRequest(o: { intensity: Intensity; idea?: string; references: number; sent: number; frame: boolean; seconds?: number }): string {
  const lines = [`Change intensity: ${o.intensity}.`];
  lines.push(o.idea?.trim() ? `The user's idea: ${tidy(o.idea).slice(0, 2000)}` : "The user gave no idea: propose one that fits the references and the clip.");
  if (o.seconds) lines.push(`The clip is ${Math.round(o.seconds)} s long.`);
  const parts: string[] = [];
  if (o.frame) parts.push("the first image is a frame of the clip");
  if (o.sent) parts.push(`${o.frame ? "the others are" : "the images are"} ${o.sent === o.references ? `the ${o.sent} reference${o.sent > 1 ? "s" : ""}` : `${o.sent} of the ${o.references} references`}`);
  else if (o.references) parts.push(`the user has ${o.references} reference image${o.references > 1 ? "s" : ""} you can't see`);
  if (parts.length) lines.push(`Attached: ${parts.join("; ")}.`);
  return lines.join("\n");
}

const LEAD: Record<Intensity, string> = {
  low: "The same scene, the same people and the same camera,",
  medium: "The same action and the same camera move, now in a new world:",
  high: "The same motion and timing, reimagined from the ground up:",
};
const IDEA: Record<Intensity, string> = {
  low: "with richer light, deeper colour and finer texture, like a high-end film grade",
  medium: "a dreamlike version of the place with new wardrobe and set dressing, soft volumetric light",
  high: "a bold stylised world where the characters take on a new look, vivid colour and dramatic light",
};

/** Fuobe's offline writer: the direction without an LLM (no Claude key or Ollama, demo mode, or the text model off). */
export function offlineDirection(o: { intensity: Intensity; idea?: string; references: number }): string {
  const idea = o.idea?.trim() ? tidy(o.idea).replace(/[.\s]+$/, "") : IDEA[o.intensity];
  const lead = o.intensity === "low" && o.idea?.trim() ? `${LEAD.low} now ${idea[0].toLowerCase()}${idea.slice(1)}` : `${LEAD[o.intensity]} ${idea}`;
  const refs = o.references ? ` It takes the characters, objects, colours and style of the ${o.references === 1 ? "reference image" : `${o.references} reference images`}.` : "";
  return `${lead}.${refs} Smooth, natural motion, consistent from the first frame to the last.`.slice(0, EVOLUTION.maxDirectionChars);
}

/** An LLM's answer as a direction: quotes, labels and lists taken off; null when nothing usable came back. */
export function tidyDirection(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text
    .replace(/^\s*(creative direction|direction)\s*:\s*/i, "")
    .split("\n")
    .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/^["“'\s]+|["”'\s]+$/g, "");
  const out = tidy(t).slice(0, EVOLUTION.maxDirectionChars);
  return out.length >= 12 ? out : null;
}

// ---------------------------------------------------------------------------
// The pipeline: steps for createPipeline (src/server/chains.ts)

export interface EvolutionPlanInput {
  engine: Engine;
  title: string;
  source: EvolutionSource;
  range: ShortsRange;
  intensity: Intensity;
  /** The creative direction (written by you, an LLM or the offline writer). */
  direction: string;
  references: string[];
  resolution?: string;
  seed?: number;
}

export interface EvolutionPlan {
  steps: PlanStep[];
  /** The finished video's step. */
  final: string;
  /** Pieces (cloud) or segments (GPU). */
  pieces: number;
  /** The clip's own sound is put back. */
  sound: boolean;
  /** The direction was longer than the models take: only its first sentences go. */
  cut: boolean;
  /** References that reach a model (the direction frames, on both engines); the rest only shape the direction. */
  referencesUsed: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pieceLabel = (i: number, n: number, what: string) => ({ label: n > 1 ? `Piece ${i + 1} of ${n} · ${what}` : what[0].toUpperCase() + what.slice(1), index: i, of: n });

/**
 * The whole job. GPU: per segment, cut it (16 fps), take its first frame toward the direction, evolve it from itself
 * at the intensity's denoise. Cloud: per piece of up to 10 s, cut it (unless it is the whole clip), take its first frame
 * toward the direction on hosted Qwen-Image-Edit 2511, and re-render the piece by its depth on fal's Wan 2.2 Fun VACE
 * with that frame as its reference, frames and rate kept (billed on frames ÷ 16). Then join and put the sound back.
 */
export function planEvolution(input: EvolutionPlanInput): EvolutionPlan {
  const { engine } = input;
  const base = { feature: EVOLUTION.feature, batchTitle: input.title };
  const helper = { feature: EVOLUTION.stepFeature, batchTitle: input.title };
  const seed = input.seed !== undefined ? { seed: input.seed } : {};
  const resolution = input.resolution && EVOLUTION_RESOLUTIONS[engine].includes(input.resolution) ? input.resolution : EVOLUTION_DEFAULT_RESOLUTION[engine];
  const { text: prompt, cut } = directionPrompt(input.direction);
  const sound = !!input.source.hasAudio;
  const steps: PlanStep[] = [];
  const keys: string[] = [];
  let referencesUsed = 0;
  let n: number;

  if (engine === "open") {
    const t = SHORTS_TOOLS.open;
    const segs = planOpenSegments(input.range);
    n = segs.length;
    const refs = input.references.slice(0, EVOLUTION.openReferences);
    referencesUsed = refs.length;
    segs.forEach((s, i) => {
      const own = n === 1 && !sound;
      steps.push({
        key: `cut${i}`,
        request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: s.start, endTime: s.end, fps: SHORTS.openFps, aspectRatio: "auto", resolution }, step: pieceLabel(i, n, "cut") },
      });
      steps.push({
        key: `frame${i}`,
        request: {
          ...helper,
          modelId: EVOLUTION.frameModel,
          op: "edit",
          prompt: directionFramePrompt(input.direction, input.intensity, refs.length),
          ...(refs.length ? { inputs: { images: refs } } : {}),
          params: { ...seed },
          step: pieceLabel(i, n, "direction frame"),
        },
        after: [`cut${i}`],
        chain: [{ slot: "images", position: "first" }],
      });
      steps.push({
        key: `evolve${i}`,
        request: {
          ...(own ? { ...base, title: input.title } : helper),
          modelId: EVOLUTION.model,
          engine: "open",
          op: "v2v",
          prompt,
          params: { aspectRatio: "auto", resolution, duration: r3((s.frames ?? Math.round((s.end - s.start) * SHORTS.openFps)) / SHORTS.openFps), extra: { denoise: denoiseFor(input.intensity) }, ...seed },
          step: pieceLabel(i, n, "evolve"),
        },
        after: [`cut${i}`, `frame${i}`],
        chain: [{ slot: "video" }, { slot: "images" }],
      });
      keys.push(`evolve${i}`);
    });
  } else {
    const t = SHORTS_TOOLS.cloud;
    const pieces = cloudPieces(input.range, input.source.fps);
    n = pieces.length;
    const whole = n === 1 && wholeClip(input.range, input.source.duration);
    const refs = input.references.slice(0, EVOLUTION.cloudReferences);
    referencesUsed = refs.length;
    const downsample = vaceDownsample(input.source.fps);
    pieces.forEach((p, i) => {
      const own = n === 1 && !sound;
      const seconds = p.end - p.start;
      // The whole clip goes as it is; a part is cut first.
      const cut = whole ? null : `cut${i}`;
      const video = cut ? {} : { inputs: { video: input.source.url } };
      if (cut) {
        steps.push({
          key: cut,
          request: { ...helper, modelId: t.cut, op: "trim", inputs: { video: input.source.url }, params: { startTime: p.start, endTime: p.end }, step: pieceLabel(i, n, "cut") },
        });
      }
      steps.push({
        key: `still${i}`,
        request: { ...helper, modelId: t.still, op: "frame", ...video, params: { extra: { frame_type: "first" } }, step: pieceLabel(i, n, "first frame") },
        ...(cut ? { after: [cut], chain: [{ slot: "video" as const }] } : {}),
      });
      steps.push({
        key: `frame${i}`,
        request: {
          ...helper,
          modelId: EVOLUTION.cloudFrameModel,
          op: "edit",
          prompt: directionFramePrompt(input.direction, input.intensity, refs.length),
          ...(refs.length ? { inputs: { images: refs } } : {}),
          params: { ...seed },
          step: pieceLabel(i, n, "direction frame"),
        },
        after: [`still${i}`],
        chain: [{ slot: "images", position: "first" }],
      });
      steps.push({
        key: `evolve${i}`,
        request: {
          ...(own ? { ...base, title: input.title } : helper),
          modelId: EVOLUTION.model,
          engine: "cloud",
          op: "v2v",
          prompt,
          ...video,
          // fal bills frames ÷ 16 as "video seconds" (duration); sourceDuration is the piece's own length.
          params: {
            resolution,
            duration: originalBilledSeconds(seconds, input.source.fps),
            sourceDuration: r3(seconds),
            ...seed,
            ...(downsample ? { extra: { temporal_downsample_factor: downsample } } : {}),
          },
          step: pieceLabel(i, n, "evolve"),
        },
        after: cut ? [cut, `frame${i}`] : [`frame${i}`],
        chain: cut ? [{ slot: "video" }, { slot: "images", position: "first" }] : [{ slot: "images", position: "first" }],
      });
      keys.push(`evolve${i}`);
    });
  }

  // Join and put the sound back with Shorts' stitch (folding joins, the selection's own sound), then name the steps ours.
  const stitchInput: ShortsPlanInput = {
    engine,
    title: input.title,
    source: input.source,
    range: input.range,
    look: { presetId: "evolution", name: "Evolution", look: prompt },
    aspectRatio: "16:9",
    keepShape: true,
    language: "auto",
    modelId: EVOLUTION.model,
    maxRefs: 0,
  };
  const stitch = planStitch(
    stitchInput,
    keys.map((key) => ({ key })),
  );
  const final = stitch.final ?? keys[0];
  for (const s of stitch.steps) {
    const own = s.key === final;
    const request: GenerationRequest = { ...s.request, ...(own ? { ...base, title: input.title } : helper) };
    // The GPU's joins keep the segments' size (Shorts joins at 480p).
    if (engine === "open" && request.op === "concat") request.params = { ...request.params, resolution };
    steps.push({ ...s, request });
  }
  return { steps, final, pieces: n, sound, cut, referencesUsed };
}

/** A short name for the run: the direction's first words. */
export function evolutionTitle(direction: string, clipName?: string): string {
  let d = tidy(direction);
  // The offline writer's lead ("The same action …: a sunken temple") says nothing about this run: what follows does.
  const colon = d.indexOf(":");
  if (colon > 0 && colon < 100) d = d.slice(colon + 1).trim();
  while (/^the same [^,.:]*,\s*/i.test(d)) d = d.replace(/^the same [^,.:]*,\s*/i, "");
  const words = d
    .replace(/^now\s+/i, "")
    .split(/(?<=[.!?])\s/)[0]
    .split(" ")
    .slice(0, 6)
    .join(" ")
    .replace(/[,.;:!?]+$/, "");
  const head = words ? `Evolution · ${words[0].toUpperCase()}${words.slice(1)}` : "Evolution";
  const name = clipName?.replace(/\.[a-z0-9]{2,4}$/i, "").trim().slice(0, 40);
  return name ? `${head} · ${name}` : head;
}
