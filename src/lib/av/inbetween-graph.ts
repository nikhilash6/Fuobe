import type { ComfyNode, ComfyWorkflow } from "@/lib/comfy";
import { gapSelection, MAX_KEYS, MIN_KEYS, type GapTiming } from "@/lib/inbetween";

/**
 * Fuobe Animation on your GPU (wan22-inbetween-anisora): N keyframes become N − 1 Wan 2.2 start/end-frame passes in ONE
 * ComfyUI prompt that share one set of loaders (both experts with their LoRAs, the text encoder, the VAE, the negative
 * words), each pass with its own length, words and seed; then each pass's every-Nth frames (VideoHelperSuite's
 * SelectEveryNthImage, counted back from the next keyframe so every pose lands on screen and no joint shows twice:
 * src/lib/inbetween.ts gapSelection), keyframe 1 in front, all batched in order and made into one video.
 *
 * The library's graph holds two keyframes (one pass): loaders "1"–"9", the keyframes "k1", "k2", the pass's nodes "p1"
 * (words), "f1" (WanFirstLastFrameToVideo), "h1" / "l1" (high / low expert), "d1" (decode), "s1" (selection), then
 * "first" (keyframe 1's frame), "batch", "video", "save". The provider binds the request onto it as usual (size, fps,
 * the first pass's words and seed, the first two keyframes), then this rewrites it for every keyframe. Pure.
 */

export interface InbetweenPass extends Pick<GapTiming, "frames" | "speed"> {
  /** The pass's words (the film's prompt with the gap's own words). */
  prompt: string;
  seed: number;
}

const PASS_NODES = ["p", "f", "h", "l", "d", "s"] as const;
const link = (id: string, slot = 0) => [id, slot];

export function expandInbetweenWorkflow(wf: ComfyWorkflow, keyframes: string[], passes: InbetweenPass[]): ComfyWorkflow {
  if (keyframes.length < MIN_KEYS) throw new Error("Add at least two keyframes: the in-betweens go between them");
  if (keyframes.length > MAX_KEYS) throw new Error(`Up to ${MAX_KEYS} keyframes`);
  if (passes.length !== keyframes.length - 1) throw new Error(`${keyframes.length} keyframes need ${keyframes.length - 1} passes`);
  for (const id of ["k1", "k2", ...PASS_NODES.map((p) => `${p}1`), "first", "batch", "video", "save"])
    if (!wf[id]) throw new Error(`Not the in-between workflow (no node ${id})`);
  const out: ComfyWorkflow = {};
  // The shared loaders and the output nodes stay; the keyframes and the passes are made per request.
  for (const [id, n] of Object.entries(wf)) if (!/^(k|p|f|h|l|d|s)\d+$/.test(id)) out[id] = structuredClone(n);
  const add = (id: string, from: ComfyNode, inputs: ComfyNode["inputs"], title: string) =>
    (out[id] = { class_type: from.class_type, inputs: { ...from.inputs, ...inputs }, _meta: { title } });

  keyframes.forEach((image, i) => add(`k${i + 1}`, wf.k1, { image }, `Keyframe ${i + 1}`));
  const batch: ComfyNode["inputs"] = { "images.image0": link("first") };
  passes.forEach((pass, i) => {
    const k = i + 1;
    const gap = `keyframes ${k} → ${k + 1}`;
    const { skip, every } = gapSelection(pass);
    add(`p${k}`, wf.p1, { text: pass.prompt }, `Words, ${gap}`);
    add(`f${k}`, wf.f1, { length: pass.frames, positive: link(`p${k}`), start_image: link(`k${k}`), end_image: link(`k${k + 1}`) }, `First / last frame, ${gap}`);
    add(`h${k}`, wf.h1, { noise_seed: pass.seed, positive: link(`f${k}`, 0), negative: link(`f${k}`, 1), latent_image: link(`f${k}`, 2) }, `High noise (AniSora), ${gap}`);
    add(`l${k}`, wf.l1, { positive: link(`f${k}`, 0), negative: link(`f${k}`, 1), latent_image: link(`h${k}`) }, `Low noise (4 steps), ${gap}`);
    add(`d${k}`, wf.d1, { samples: link(`l${k}`) }, `Decode, ${gap}`);
    add(`s${k}`, wf.s1, { images: link(`d${k}`), select_every_nth: every, skip_first_images: skip }, `Every ${every === 1 ? "" : `${every}th `}frame, ${gap}`);
    batch[`images.image${k}`] = link(`s${k}`);
  });
  out.first = { ...out.first, inputs: { ...out.first.inputs, image: link("d1") } };
  out.batch = { ...out.batch, inputs: batch };
  return out;
}
