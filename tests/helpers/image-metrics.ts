/**
 * Picture measures for live edit's drift checks: SSIM (grayscale, 8 x 8 windows) and the variance of the Laplacian
 * (sharpness), each over a region (the pixels no edit touched). Decoding through sharp; plain TypeScript.
 */
import sharp from "sharp";

export interface Gray {
  w: number;
  h: number;
  px: Float64Array;
}

export async function gray(bytes: Buffer, size?: { w: number; h: number }): Promise<Gray> {
  let img = sharp(bytes).removeAlpha();
  if (size) img = img.resize(size.w, size.h, { kernel: "lanczos3", fit: "fill" });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const px = new Float64Array(info.width * info.height);
  for (let i = 0; i < px.length; i++) px[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
  return { w: info.width, h: info.height, px };
}

/** A region: true where a pixel counts. */
export type Region = (x: number, y: number) => boolean;

export const outside =
  (rects: [number, number, number, number][]): Region =>
  (x, y) =>
    !rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);

/** Mean SSIM over the 8 x 8 windows that lie wholly in the region. */
export function ssim(a: Gray, b: Gray, region: Region = () => true): number {
  if (a.w !== b.w || a.h !== b.h) throw new Error("SSIM needs pictures of one size");
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let sum = 0;
  let n = 0;
  for (let y = 0; y + 8 <= a.h; y += 8)
    for (let x = 0; x + 8 <= a.w; x += 8) {
      if (!region(x, y) || !region(x + 7, y) || !region(x, y + 7) || !region(x + 7, y + 7)) continue;
      let ma = 0, mb = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        const k = (y + j) * a.w + x + i;
        ma += a.px[k];
        mb += b.px[k];
      }
      ma /= 64;
      mb /= 64;
      let va = 0, vb = 0, cov = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        const k = (y + j) * a.w + x + i;
        const da = a.px[k] - ma;
        const db = b.px[k] - mb;
        va += da * da;
        vb += db * db;
        cov += da * db;
      }
      va /= 63;
      vb /= 63;
      cov /= 63;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  return n ? sum / n : 1;
}

/** Variance of the 4-neighbour Laplacian over the region (higher is sharper). */
export function laplacianVariance(a: Gray, region: Region = () => true): number {
  let sum = 0, sq = 0, n = 0;
  for (let y = 1; y < a.h - 1; y++)
    for (let x = 1; x < a.w - 1; x++) {
      if (!region(x, y)) continue;
      const k = y * a.w + x;
      const l = a.px[k - 1] + a.px[k + 1] + a.px[k - a.w] + a.px[k + a.w] - 4 * a.px[k];
      sum += l;
      sq += l * l;
      n++;
    }
  if (!n) return 0;
  const mean = sum / n;
  return sq / n - mean * mean;
}
