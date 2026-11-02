/**
 * The light-guide picture: the rig drawn over the darkened photo (each light a glow in its colour at its spot, a
 * behind light a coloured rim on the subject's edge). Sent as image 2 only when measured runs show it helps the model
 * place the light (RELIGHT_SETTINGS.guide). Pure and deterministic: the same rig and photo give the same pixels.
 */
import { hexToRgb, MAX_LIGHTS, srgbToLinear, strengthValueOf, type Light } from "./lights";
import { linearToSrgb8, type Rgba } from "./blend";
import { packLight } from "./shader";

/** The longest side of the guide. */
export const GUIDE_SIDE = 1024;
const DARKEN = 0.25;

/**
 * Draw the guide over `photo` (RGBA, w × h, already at the guide's size). `matte` (one value per pixel, 0..255) puts
 * behind lights on the subject's edge; without it they draw as a ring round their spot.
 */
export function drawGuide(photo: Rgba, w: number, h: number, lights: readonly Light[], matte?: ArrayLike<number> | null): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4);
  const aspect = w / h;
  const packed = lights.slice(0, MAX_LIGHTS).map((l) => ({ l, p: packLight(l, aspect, 0.5), lin: hexToRgb(l.color).map(srgbToLinear), power: Math.min(1.2, strengthValueOf(l) * 1.2) }));
  const edgeAt = (x: number, y: number) => {
    if (!matte) return 0;
    const at = (xx: number, yy: number) => matte[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))] / 255;
    const gx = at(x + 2, y) - at(x - 2, y);
    const gy = at(x, y + 2) - at(x, y - 2);
    return Math.min(1, Math.hypot(gx, gy) * 2.5);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const px = ((x + 0.5) / w) * aspect;
      const py = (y + 0.5) / h;
      let r = srgbToLinear(photo[i]) * DARKEN;
      let g = srgbToLinear(photo[i + 1]) * DARKEN;
      let b = srgbToLinear(photo[i + 2]) * DARKEN;
      const edge = matte ? edgeAt(x, y) : 0;
      for (const { l, p, lin, power } of packed) {
        const dx = px - p.pos[0];
        const dy = py - p.pos[1];
        const d2 = dx * dx + dy * dy;
        const radius = p.params[1];
        let k: number;
        if (l.behind) {
          const fall = Math.exp(-d2 / (radius * radius * 2.5));
          k = matte ? edge * fall * 1.6 : Math.exp(-((Math.sqrt(d2) - radius * 0.5) ** 2) / 0.002) * 0.8;
        } else {
          k = Math.exp(-d2 / (radius * radius * 0.5));
        }
        k *= power;
        // Screen in linear light: bright where the light is, never past white.
        r = 1 - (1 - r) * (1 - Math.min(1, lin[0] * k));
        g = 1 - (1 - g) * (1 - Math.min(1, lin[1] * k));
        b = 1 - (1 - b) * (1 - Math.min(1, lin[2] * k));
      }
      out[i] = linearToSrgb8(r);
      out[i + 1] = linearToSrgb8(g);
      out[i + 2] = linearToSrgb8(b);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** The guide's size for a photo: the long side GUIDE_SIDE (never larger than the photo). */
export function guideSize(w: number, h: number): { width: number; height: number } {
  const s = Math.min(1, GUIDE_SIDE / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}
