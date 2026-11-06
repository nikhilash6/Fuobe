/**
 * Painted instructions on an image: an inpaint mask or drawn arrows/notes.
 *
 * Models with a native mask input get the mask (op "inpaint"). Everything else gets the
 * painted image as an extra reference plus a prompt that says what the paint means — the
 * same trick the parity studio's "Draw to Edit" and Nano Banana inpainting rely on.
 */
import type { GenerationRequest, ModelDef } from "./types";

const tidy = (p: string | undefined) => (p ?? "").trim().replace(/[.\s]+$/, "");

export function applySketch(req: GenerationRequest, model: ModelDef): { request: GenerationRequest; note?: string } {
  const i = req.inputs ?? {};
  if (!i.mask && !i.sketch) return { request: req };
  const has = (op: string) => model.routes.some((r) => r.op === op);
  const images = [...(i.images ?? [])];
  const { mask, sketch, ...rest } = i;

  // Video erasers, swaps and inserts read the mask themselves (a first-frame PNG or a mask video), as does the Character
  // swap's composite (the person's mask video): it stays as it is.
  if (mask && model.kind === "video" && (["remove-object", "video-swap", "video-insert", "composite"] as const).some(has)) return { request: req };
  // Inpaint: a mask (white = change) and, for models without a mask input, a red-tinted copy.
  if (mask) {
    if (model.kind === "image" && has("inpaint")) {
      return { request: { ...req, op: "inpaint", inputs: { ...rest, images, mask } } };
    }
    if (model.kind === "image" && has("edit") && sketch && images.length) {
      const n = images.length + 1;
      return {
        request: {
          ...req,
          op: "edit",
          prompt: `${tidy(req.prompt) || "Fill the area naturally"}. Only change the region tinted red in image ${n}; image ${n} is image 1 with that region marked. Keep everything outside it pixel-identical, and don't include the red tint in the result.`,
          inputs: { ...rest, images: [...images, sketch] },
        },
        note: `${model.name} has no mask input — the painted area is shown to it as image ${n}`,
      };
    }
    return { request: { ...req, inputs: rest }, note: `${model.name} can't use a mask — pick an inpaint model` };
  }

  // Draw to edit / draw to video: arrows, shapes and notes on the first image.
  if (model.kind === "image" && has("edit") && images.length) {
    const n = images.length + 1;
    return {
      request: {
        ...req,
        op: "edit",
        prompt: `${tidy(req.prompt) ? `${tidy(req.prompt)}. ` : ""}Image ${n} is image 1 with drawn instructions — arrows, outlines and handwritten notes. Apply exactly what they ask to image 1, then remove every drawn mark: the result is a clean photo with no arrows, lines or text from the drawing.`,
        inputs: { ...rest, images: [...images, sketch!] },
      },
    };
  }
  // Wan-Move follows the strokes themselves (sent as motion paths) on the clean start frame.
  if (model.kind === "video" && model.options.motionPaths) {
    return { request: { ...req, op: "i2v", inputs: rest } };
  }
  if (model.kind === "video" && has("i2v")) {
    return {
      request: {
        ...req,
        op: req.op === "flf2v" && i.endImage ? "flf2v" : "i2v",
        prompt: `${tidy(req.prompt) ? `${tidy(req.prompt)}. ` : ""}The first frame carries drawn directions: arrows show where things move, outlines show what changes and notes describe the action. Follow them, and make every drawn mark disappear immediately — none of the arrows, lines or text appear in the video.`,
        inputs: { ...rest, images: [sketch!, ...images.slice(1)] },
      },
    };
  }
  return { request: { ...req, inputs: rest }, note: `${model.name} can't follow a drawing — pick an edit or image-to-video model` };
}

/** Drop drawn motion paths from models that can't use them (they'd be sent as an unknown field). */
export function stripMotionPaths(req: GenerationRequest, model: ModelDef): GenerationRequest {
  if (model.options.motionPaths || !req.params?.extra || !("motionPaths" in req.params.extra)) return req;
  const extra = { ...req.params.extra };
  delete extra.motionPaths;
  return { ...req, params: { ...req.params, extra } };
}
