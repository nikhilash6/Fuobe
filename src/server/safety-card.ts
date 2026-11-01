import "server-only";
import { decodePng } from "./png";

/**
 * Ideogram 4's "Image blocked by safety filter" card: a flat, neutral mid-grey picture with one line of type, which its graph
 * saves in place of the picture when the model's own filter refuses a prompt. Ported from the preview pipeline's
 * blocked-check.mjs (FashDash's two rules, no false positive on 130 real renders), on the picture averaged down to two
 * thumbnails:
 *   rule B (128×170): mean RGB spread under 20, and over 85% of the pixels neutral mid-grey (|r−g| < 8, |g−b| < 8, 90 < r < 140);
 *   rule A, loosened (64×64): the channel means within 6 levels, luminance spread under 14, mean luminance 95–135.
 * The card is redrawn each time, slightly warm; real photographs sit far from both (the lowest RGB spread of the 130 real
 * renders was 26, the card's 9.4).
 */
export const BLOCKED_CARD_MESSAGE =
  "Ideogram 4's safety filter blocked this picture and sent its grey card instead. Run it again for a new seed, or try Qwen-Image 2.1 or Krea 2 Realism.";

/** The picture averaged down to w×h (each cell the mean of the pixels it covers), as RGB. */
function thumb(img: { width: number; height: number; data: Buffer }, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 3);
  for (let ty = 0; ty < h; ty++) {
    const y0 = Math.floor((ty * img.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * img.height) / h));
    for (let tx = 0; tx < w; tx++) {
      const x0 = Math.floor((tx * img.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * img.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      out.set([Math.round(r / n), Math.round(g / n), Math.round(b / n)], (ty * w + tx) * 3);
    }
  }
  return out;
}

/** Whether a PNG is the grey card. A picture that can't be read is not (it is kept, for a person to look at). */
export function looksBlocked(png: Buffer): boolean {
  let img: ReturnType<typeof decodePng>;
  try {
    img = decodePng(png);
  } catch {
    return false;
  }
  // Rule A's measures (luminance as PIL's "L" conversion).
  const a = thumb(img, 64, 64);
  const n = 64 * 64;
  const sum = [0, 0, 0];
  let sl = 0;
  let sl2 = 0;
  for (let i = 0; i < n; i++) {
    const [r, g, b] = [a[3 * i], a[3 * i + 1], a[3 * i + 2]];
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
    const l = Math.round((r * 299 + g * 587 + b * 114) / 1000);
    sl += l;
    sl2 += l * l;
  }
  const means = sum.map((s) => s / n);
  const spread = Math.max(...means) - Math.min(...means);
  const lumMean = sl / n;
  const lumStd = Math.sqrt(Math.max(0, sl2 / n - lumMean * lumMean));
  // Rule B.
  const t = thumb(img, 128, 170);
  const m = 128 * 170;
  const s = [0, 0, 0];
  const s2 = [0, 0, 0];
  let grey = 0;
  for (let i = 0; i < m; i++) {
    const [r, g, b] = [t[3 * i], t[3 * i + 1], t[3 * i + 2]];
    [r, g, b].forEach((v, c) => {
      s[c] += v;
      s2[c] += v * v;
    });
    if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8 && r > 90 && r < 140) grey++;
  }
  const rgbStd = s.map((v, c) => Math.sqrt(Math.max(0, s2[c] / m - (v / m) ** 2))).reduce((x, y) => x + y) / 3;
  return rgbStd < 20 && grey / m > 0.85 && spread < 6 && lumStd < 14 && lumMean > 95 && lumMean < 135;
}
