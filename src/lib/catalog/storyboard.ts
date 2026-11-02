/**
 * Storyboards (Higgsfield Popcorn): up to 8 consistent frames. Frame 1 is made from the
 * references (or text alone); every later frame is an edit of the previous frame, so faces,
 * wardrobe, location and grade carry through.
 *
 * Since build plan O13 a board can take one of Fuobe Soul's looks (research §8 popcorn): frame 1
 * is made on Fuobe Soul with the look on either engine (with references it stays on the reference
 * model, with the look's words), the next frames carry the look's words, and every frame gets the
 * look's grade and overlay after it is made (each next frame is made from the previous one as it
 * came out, so the grade is applied once).
 *
 * The board is Fuobe's open recipe on both engines: on your GPU each next frame is Qwen-Image 2.1 with akhaliq's 2.1
 * Next-Scene LoRA, or the classic Qwen-Image-Edit 2509 + next-scene LoRA when the board asks for it
 * (`nextScene`); in the cloud fal's hosted Qwen-Image-Edit 2509 with the 2509 LoRA (sent as a URL), as fal's hosted Qwen-Image
 * 2.1 takes no LoRAs. Nano Banana Pro stays a separate choice in the cloud (`partner`), every frame on it as boards ran before.
 */
import { loraEntry, loraRef } from "./loras";
import type { ChainSlot, Engine, GenerationRequest, LoraRef } from "./types";

export const MAX_FRAMES = 8;

export interface StoryboardModels {
  first: string;
  firstWithRefs: string;
  next: string;
  chainFrom: "first" | "last";
  /** LoRAs each next frame carries (the cloud's next-scene LoRA; the GPU graph loads its own). */
  nextLoras?: LoraRef[];
}

/** The next-scene LoRA (research adapterLoras): the one the GPU graph loads, at its strength. */
const NEXT_SCENE = loraEntry("next-scene-qwen-edit-2509");

/** Which models make the first frame and the follow-ups on each engine (Fuobe's recipe). */
export const STORYBOARD_MODELS: Record<Engine, StoryboardModels> = {
  // Hosted open weights: Z-Image Turbo, Qwen-Image-Edit 2511 with references, then Qwen-Image-Edit 2509 + next-scene.
  cloud: { first: "z-image-turbo-cloud", firstWithRefs: "qwen-image-edit-2511-cloud", next: "qwen-image-edit-2509-cloud", chainFrom: "first", ...(NEXT_SCENE && { nextLoras: [loraRef(NEXT_SCENE)] }) },
  // Frame 1 on Qwen-Image 2.1 (text to image, or an edit of up to 4 references); then Qwen-Image 2.1 + the 2.1 Next-Scene
  // LoRA takes the previous panel as image 1 and the character as image 2.
  open: { first: "oss-qwen-image-21", firstWithRefs: "oss-qwen-image-21", next: "oss-qwen-image-21-next-scene", chainFrom: "first" },
};

/**
 * The model each next frame runs on your GPU: Qwen-Image 2.1's Next-Scene LoRA (the default), or the classic
 * Qwen-Image-Edit 2509 + next-scene LoRA (the graph boards used before, and the cloud's recipe).
 */
export const STORYBOARD_NEXT_SCENE = { "qwen-21": "oss-qwen-image-21-next-scene", classic: "oss-qwen-next-scene" } as const;
export type StoryboardNextScene = keyof typeof STORYBOARD_NEXT_SCENE;
export const STORYBOARD_NEXT_SCENE_IDS = Object.keys(STORYBOARD_NEXT_SCENE) as [StoryboardNextScene, ...StoryboardNextScene[]];

/** Partner models a cloud board can run on instead (a separate choice): every frame on it, each from the last one. */
export const STORYBOARD_PARTNERS = {
  "nano-banana-pro": { first: "nano-banana-pro", firstWithRefs: "nano-banana-pro", next: "nano-banana-pro", chainFrom: "last" },
} as const satisfies Record<string, StoryboardModels>;
export type StoryboardPartner = keyof typeof STORYBOARD_PARTNERS;
export const STORYBOARD_PARTNER_IDS = Object.keys(STORYBOARD_PARTNERS) as [StoryboardPartner, ...StoryboardPartner[]];

/**
 * The models a board runs on: the partner when one is picked in the cloud, else Fuobe's recipe for the engine, whose next
 * frames on your GPU take the next-scene model asked for.
 */
export function storyboardModels(engine: Engine, partner?: StoryboardPartner, nextScene?: StoryboardNextScene): StoryboardModels {
  if (engine === "cloud") return partner ? STORYBOARD_PARTNERS[partner] : STORYBOARD_MODELS.cloud;
  return nextScene ? { ...STORYBOARD_MODELS.open, next: STORYBOARD_NEXT_SCENE[nextScene] } : STORYBOARD_MODELS.open;
}

/** The model a board with a Soul look makes its first frame on (no references): the look's LoRAs, words and grade. */
export const STORYBOARD_LOOK_MODEL = "fuobe-soul";

/** Shapes a board offers; Fuobe Soul has no 21:9, so a look board makes 16:9 frames and crops them to 21:9 after. */
export const STORYBOARD_ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;
export const LOOK_CROPPED = "21:9";

const SHOTS = [
  "establishing wide shot",
  "medium shot",
  "close-up",
  "over-the-shoulder shot",
  "low-angle shot",
  "detail insert shot",
  "tracking shot",
  "wide closing shot",
];

/** Offline split of one story idea into n scenes (used when no LLM is configured). */
export function heuristicScenes(story: string, n: number): string[] {
  const s = story.trim().replace(/[.\s]+$/, "");
  return Array.from({ length: n }, (_, i) => `${SHOTS[i % SHOTS.length]}: ${s} — beat ${i + 1} of ${n}`);
}

/** Parse an LLM answer into n scene lines (JSON array or numbered list). */
export function parseScenes(text: string, n: number): string[] | null {
  const json = /\[[\s\S]*\]/.exec(text)?.[0];
  if (json) {
    try {
      const arr = (JSON.parse(json) as unknown[]).map((x) => String(typeof x === "object" && x ? ((x as { scene?: string }).scene ?? JSON.stringify(x)) : x).trim()).filter(Boolean);
      if (arr.length >= Math.min(2, n)) return arr.slice(0, n);
    } catch {}
  }
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim())
    .filter((l) => l.length > 8);
  return lines.length >= Math.min(2, n) ? lines.slice(0, n) : null;
}

export const SPLIT_SYSTEM = `You are a storyboard artist. Split the user's story into the requested number of consecutive frames of one film.
Each frame is one sentence describing a single still image: shot type, what the characters do, where, the light.
Keep the same characters, wardrobe and location style across frames. Return ONLY a JSON array of strings.`;

/** Prompt for one frame. `refs` = number of reference images sent before/after the previous frame. */
export function framePrompt(scene: string, index: number, opts: { refs: number; chainFrom: "first" | "last"; style?: string }): string {
  const s = scene.trim().replace(/[.\s]+$/, "");
  const style = opts.style?.trim() ? ` Style: ${opts.style.trim().replace(/[.\s]+$/, "")}.` : "";
  if (index === 0) {
    const refs = opts.refs ? ` Use the reference image${opts.refs > 1 ? "s" : ""} for the characters and look.` : "";
    return `Frame 1 of a storyboard: ${s}.${refs}${style} Cinematic still, consistent production design.`;
  }
  if (opts.chainFrom === "first") return `Next Scene: ${s}.${style}`;
  const prev = opts.refs + 1;
  return `Next frame of the same storyboard: ${s}. Image ${prev} is the previous frame — continue from it with the same characters, faces, wardrobe, props, location style, lighting and color grade, like consecutive shots of one film.${style}`;
}

// ---------------------------------------------------------------------------
// The board's frames (the server creates them, one waiting on the one before)

export interface StoryboardLook {
  id: string;
  /** The look in words (soulLook(id).look), carried into every next frame's prompt. */
  words: string;
  /** The look's strength (scales its LoRAs on frame 1). */
  strength?: number;
}

export interface StoryboardPlanInput {
  engine: Engine;
  /** A partner model for the whole board (cloud only). */
  partner?: StoryboardPartner;
  /** The next frames' model on your GPU (open only): Qwen-Image 2.1's Next-Scene LoRA unless "classic". */
  nextScene?: StoryboardNextScene;
  scenes: string[];
  references?: string[];
  style?: string;
  look?: StoryboardLook;
  aspectRatio?: string;
  resolution?: string;
  batchTitle?: string;
}

export type FrameRequest = GenerationRequest & { batchTitle?: string };

/**
 * Each frame's request, in order (frame 1 first). A frame after the first waits on the one before and takes its
 * picture as it came out (`raw`: before a look's grade, which every frame gets on its own).
 */
export function planStoryboard(input: StoryboardPlanInput): FrameRequest[] {
  const m = storyboardModels(input.engine, input.partner, input.nextScene);
  const refs = (input.references ?? []).slice(0, 4);
  const look = input.look;
  const cropped = !!look && input.aspectRatio === LOOK_CROPPED;
  const params = { aspectRatio: cropped ? "16:9" : input.aspectRatio, resolution: input.resolution, numOutputs: 1 };
  const lookWords = look?.words.trim().replace(/[.\s]+$/, "");
  // The next frames keep the look in words; frame 1 on Fuobe Soul gets them from its recipe.
  const style = [input.style?.trim().replace(/[.\s]+$/, ""), lookWords].filter(Boolean).join(". ") || undefined;
  return input.scenes.map((scene, i) => {
    const first = i === 0;
    // The open next-scene workflow takes the previous panel plus one character reference.
    const frameRefs = first ? refs : m.chainFrom === "first" ? refs.slice(0, 1) : refs;
    const onSoul = first && !!look && !refs.length;
    // A look board's next frame takes the previous picture as it came out (raw); otherwise the single-image chainFrom.
    const chain: ChainSlot[] | undefined = first || !look ? undefined : [{ slot: "images", position: m.chainFrom, raw: true }];
    return {
      feature: "storyboard",
      modelId: onSoul ? STORYBOARD_LOOK_MODEL : first ? (refs.length ? m.firstWithRefs : m.first) : m.next,
      ...(onSoul && { engine: input.engine, presetId: look.id, ...(look.strength !== undefined && { presetStrength: look.strength }) }),
      prompt: framePrompt(scene, i, { refs: frameRefs.length, chainFrom: m.chainFrom, style: onSoul ? input.style : style }),
      inputs: frameRefs.length ? { images: frameRefs } : undefined,
      params,
      ...(!first && m.nextLoras?.length && { loras: m.nextLoras }),
      ...(chain ? { chain } : !first && { chainFrom: m.chainFrom }),
      frame: { scene, index: i, of: input.scenes.length, ...(look && { look: look.id }), ...(cropped && { crop: LOOK_CROPPED }) },
      ...(input.batchTitle && { batchTitle: input.batchTitle }),
    };
  });
}
