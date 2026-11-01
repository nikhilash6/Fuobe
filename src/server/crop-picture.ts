import "server-only";
import { decodePng, encodePng } from "./png";

/** Fractional crop window: [x, y, width, height], each 0–1 of the image's dimensions. */
export type CropWindow = [x: number, y: number, w: number, h: number];

/** Whether `v` is a valid crop window (four finite numbers in 0–1). */
export function isCropWindow(v: unknown): v is CropWindow {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1);
}

/**
 * Crop a PNG image by fractional coordinates. The result is the extracted sub-region at its natural pixel
 * size (smaller than the original). An end-frame step's recipe crops the start frame before editing it,
 * so the edited end frame shows a zoomed-in portion of the scene.
 */
export function cropPicture(png: Buffer, crop: CropWindow): Buffer {
  const img = decodePng(png);
  const [fx, fy, fw, fh] = crop;
  const x = Math.max(0, Math.min(Math.round(fx * img.width), img.width - 1));
  const y = Math.max(0, Math.min(Math.round(fy * img.height), img.height - 1));
  const w = Math.max(1, Math.min(Math.round(fw * img.width), img.width - x));
  const h = Math.max(1, Math.min(Math.round(fh * img.height), img.height - y));
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcOff = ((y + row) * img.width + x) * 4;
    const dstOff = row * w * 4;
    img.data.copy(out, dstOff, srcOff, srcOff + w * 4);
  }
  return encodePng({ width: w, height: h, data: out });
}
