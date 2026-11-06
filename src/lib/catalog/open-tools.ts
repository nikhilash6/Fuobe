/**
 * The parity studio's rebranded open tools and Speak, rebuilt as Fuobe Originals (build plan O11; research
 * docs/research/fuobe-originals-recipes-5.json studios[angles], studios[speak], presets[PixeletedFace].post). Pure:
 * the recipes' constants and the words, steps and LoRAs they need, used by the catalog, the planner and the server.
 *
 * - Fuobe Angles: Qwen-Image-Edit 2509 with dx8152's Multiple-angles LoRA. fal's hosted route takes the camera as
 *   fields (rotate, vertical angle, move forward, wide-angle) and writes the LoRA's words itself; on the GPU Fuobe
 *   writes them ({@link anglesWords}), the instructions the LoRA was trained on, in Chinese with English.
 * - Fuobe Speak: InfiniteTalk with the parity studio's Infinite Talk settings on the GPU (the FusioniX LoRA, 15 motion
 *   frames, 25 steps, shift 10, text and audio guidance 5, colour correction), fal's InfiniteTalk in the cloud.
 *   Fuobe Speak · Motion is Wan 2.2 S2V on both engines (a Speak v1-like route: the body and the scene move).
 * - The face mosaic (Fuobe Soul's PixeletedFace look): SAM 3.1 finds the faces, a mosaic covers them. On the GPU one
 *   graph does both; in the cloud fal's SAM 3.1 answers with the masks and the server pixelates under them (the browser,
 *   for a picture the server can't decode).
 */
import { loraEntry, loraRef } from "./loras";
import type { Engine, LoraRef } from "./types";

export const ANGLES_ORIGINAL = "fuobe-angles";
export const SPEAK_ORIGINAL = "fuobe-speak";
export const SPEAK_MOTION_ORIGINAL = "fuobe-speak-motion";

/** dx8152's Multiple-angles LoRA for Qwen-Image-Edit 2509 at 1.25 (the research's adapterLoras record). */
const ANGLES_ENTRY = loraEntry("qwen-edit-2509-multiple-angles");
export const ANGLES_LORA: LoraRef | undefined = ANGLES_ENTRY && loraRef(ANGLES_ENTRY);

/**
 * lilylilith's AnyAngle LoRA for Qwen-Image 2.1 at 1.0 (Any Angle, src/lib/catalog/any-angle.ts): its graph loads it
 * itself; as the recipe's LoRA it is downloaded and checked before a run.
 */
const ANY_ANGLE_ENTRY = loraEntry("qwen-image-21-any-angle");
export const ANY_ANGLE_LORA: LoraRef | undefined = ANY_ANGLE_ENTRY && loraRef(ANY_ANGLE_ENTRY);

/**
 * fal's Multiple-Angles LoRA for Qwen-Image-Edit 2511 (its `<sks>` pose words): the Angles app's open route, Cinema's
 * recomposition and Soul Location's other views on the GPU, next to Fuobe Angles' 2509 recipe (its own app until the angles
 * eval suite promotes it).
 */
export const ANGLES_2511_LORA: LoraRef = {
  file: "qwen-image-edit-2511-multiple-angles-lora.safetensors",
  url: "https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA/resolve/main/qwen-image-edit-2511-multiple-angles-lora.safetensors",
  strength: 1,
};

/** FusioniX for Wan 2.1 I2V 14B, the LoRA the parity studio's Infinite Talk loads at 1 (adapterLoras). */
const SPEAK_ENTRY = loraEntry("fusionix-i2v-14b");
export const SPEAK_LORA: LoraRef | undefined = SPEAK_ENTRY && loraRef(SPEAK_ENTRY);

/**
 * Fuobe Speak's InfiniteTalk settings on kijai's wrapper graph (infinitetalk-wanwrapper's bindings; research
 * studios[speak].original.open.defaults): motion_frame 15, 25 steps, shift 10, text guidance 5, audio guidance 5,
 * InfiniteTalk's UniPC solver, and its colour correction as the wrapper's Reinhard colour match (a Lab mean and
 * spread match to the portrait, on or off). A run's own settings (params.extra) win.
 */
export const SPEAK_GRAPH: Readonly<Record<string, number | string>> = {
  motionFrame: 15,
  steps: 25,
  shift: 10,
  cfg: 5,
  audioCfg: 5,
  scheduler: "unipc",
  colormatch: "reinhard",
};

/** What Fuobe Speak (and · Motion) says when the run has no words: InfiniteTalk and Wan S2V both ask for a prompt. */
export const SPEAK_PROMPT = "A person talking to the camera, natural head movement and facial expressions";

/** Fuobe Angles' camera: the hosted route's own fields, which the open graph reads as words. */
export interface AnglesCamera {
  /** Degrees, −90…90: positive turns the camera to the left (fal's rotate_right_left). */
  rotate_right_left?: number;
  /** −1 (a bird's-eye view, looking down) … 1 (a worm's-eye view, looking up). */
  vertical_angle?: number;
  /** 0–10: 1–5 moves the camera forward, above 5 is a close-up. */
  move_forward?: number;
  wide_angle_lens?: boolean;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const yes = (v: unknown): boolean => v === true || v === "true" || v === "on" || v === 1;

/**
 * The Multiple-angles LoRA's instruction for a camera (the words it was trained on, as its card and the public
 * Hugging Face Space write them): a turn left or right by whole degrees, a move forward or a close-up, a bird's-eye or
 * worm's-eye view at the ends of the tilt, a wide-angle lens. "" when the camera doesn't move.
 */
export function anglesWords(camera: AnglesCamera | Record<string, unknown> | undefined): string {
  const c = (camera ?? {}) as Record<string, unknown>;
  const rotate = Math.max(-90, Math.min(90, Math.round(num(c.rotate_right_left))));
  const forward = Math.max(0, Math.min(10, num(c.move_forward)));
  const tilt = Math.max(-1, Math.min(1, num(c.vertical_angle)));
  const parts: string[] = [];
  if (rotate > 0) parts.push(`将镜头向左旋转${rotate}度 Rotate the camera ${rotate} degrees to the left.`);
  else if (rotate < 0) parts.push(`将镜头向右旋转${-rotate}度 Rotate the camera ${-rotate} degrees to the right.`);
  if (forward > 5) parts.push("将镜头转为特写镜头 Turn the camera to a close-up.");
  else if (forward >= 1) parts.push("将镜头向前移动 Move the camera forward.");
  if (tilt <= -1) parts.push("将相机转向鸟瞰视角 Turn the camera to a bird's-eye view.");
  else if (tilt >= 1) parts.push("将相机切换到仰视视角 Turn the camera to a worm's-eye view.");
  if (yes(c.wide_angle_lens)) parts.push("将镜头转为广角镜头 Turn the camera to a wide-angle lens.");
  return parts.join(" ");
}

/**
 * Fuobe Angles' prompt on the GPU: the camera's words, then the user's note. A camera that doesn't move (and no
 * note) is refused: the edit would only redraw the picture.
 */
export function anglesPrompt(extra: Record<string, unknown> | undefined, words: string | undefined): string {
  const camera = anglesWords(extra);
  const note = words?.trim() ?? "";
  if (!camera && !note) throw new Error("Move the camera first: rotate it, tilt it, move it closer or go wide");
  return [camera, note].filter(Boolean).join(" ");
}

/** The camera fields Fuobe Angles reads (they go to fal as they are; the GPU graph takes them as words instead). */
export const ANGLES_FIELDS = ["rotate_right_left", "vertical_angle", "move_forward", "wide_angle_lens"] as const;

/** The face mosaic's step per engine: the GPU graph does the whole mosaic; fal's SAM 3.1 makes the masks. */
export const FACE_MOSAIC_MODELS: Record<Engine, string> = { open: "oss-face-mosaic", cloud: "sam-3-1-face-mask" };

/** What SAM 3.1 looks for when the run names nothing. */
export const MOSAIC_TARGET = "face";

/**
 * The mosaic's scale: the picture is shrunk to this (each block averages its pixels) and blown back up with hard edges,
 * so a block is 1 / MOSAIC_SCALE pixels wide on both engines (the open graph's mosaicScale; 0.04 = 25 px).
 */
export const MOSAIC_SCALE = 0.04;

/** The post step a look asks for after its picture is made. */
export type SoulPost = "face-mosaic";

/** The face mosaic as the second step of a Soul run: its model on the engine the picture is made on. */
export function faceMosaicStep(engine: Engine): { modelId: string; op: "face-mosaic"; prompt: string } {
  return { modelId: FACE_MOSAIC_MODELS[engine], op: "face-mosaic", prompt: MOSAIC_TARGET };
}

/** The grid of a mosaic over a `width` × `height` picture: square blocks of 1 / scale pixels, the last ones cut off. */
export function mosaicGrid(width: number, height: number, scale = MOSAIC_SCALE): { cell: number; cols: number; rows: number } {
  const cell = Math.max(1, Math.round(1 / Math.max(0.001, scale)));
  return { cell, cols: Math.ceil(width / cell), rows: Math.ceil(height / cell) };
}
