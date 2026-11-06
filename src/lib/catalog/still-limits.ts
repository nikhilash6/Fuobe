/**
 * The limits fal documents for an endpoint's still inputs (the field descriptions in its OpenAPI, fetched 2026-11-06),
 * and what a picture needs before it's sent: a smaller or larger copy, another format, no alpha, or a refusal in
 * Fuobe's words. The hosted hand-over (src/server/generations.ts prep) makes the copy; this file only decides.
 * Pure data and logic (client and server).
 */

export type StillFormat = "png" | "jpeg" | "webp" | "gif" | "svg" | "other";

export interface StillLimits {
  /** Each side at least this many pixels. */
  minSide?: number;
  /** Each side at most this many pixels. */
  maxSide?: number;
  minPixels?: number;
  maxPixels?: number;
  /** Longest side over shortest side. */
  maxAspect?: number;
  maxBytes?: number;
  /** The formats the endpoint reads; another is converted to the first of these. */
  formats?: StillFormat[];
  /** A PNG must have no alpha channel (Qwen Image 3 edit): it's flattened on white. */
  noAlpha?: boolean;
}

const MB = 1024 * 1024;
const LAYERIZE: StillLimits = { minPixels: 512 * 512, maxPixels: 6000 * 6000, maxAspect: 16, maxBytes: 30 * MB };

/** By endpoint. Each line quotes its source; "less than" limits are kept strictly below. */
export const STILL_LIMITS: Readonly<Record<string, StillLimits>> = {
  // "Resolution: 384-2048px each dimension. Max size: 10MB each. Formats: JPEG, JPG, PNG (no alpha), WEBP."
  "alibaba/qwen-image-3/edit": { minSide: 384, maxSide: 2048, maxBytes: 10 * MB, formats: ["jpeg", "png", "webp"], noAlpha: true },
  // "PNG, JPG or WEBP format, less than 5 MB in size, have resolution less than 16 MP and max dimension less than
  // 4096 pixels, min dimension more than 256 pixels."
  "fal-ai/recraft/vectorize": { minSide: 257, maxSide: 4095, maxPixels: 16_000_000 - 1, maxBytes: 5 * MB - 1, formats: ["png", "jpeg", "webp"] },
  // "The URL of the image to be upscaled. Must be in PNG format."
  "fal-ai/recraft/upscale/crisp": { formats: ["png"] },
  // "between 512x512 and 6000x6000 total pixels, have an aspect ratio between 1/16 and 16, and be no larger than 30 MB."
  "bytedance/seedream/v5/pro/layerize": LAYERIZE,
  "bytedance/seedream/v5/flash/layerize": LAYERIZE,
  // "JPEG, PNG and WebP formats are supported (maximum file size 10MB)."
  "fal-ai/ideogram/remove-background": { maxBytes: 10 * MB, formats: ["png", "jpeg", "webp"] },
  // "Must be JPEG, PNG, or WebP (max 10MB)."
  "fal-ai/ideogram/v3/layerize-text": { maxBytes: 10 * MB, formats: ["png", "jpeg", "webp"] },
  // "Accepted formats are jpeg, jpg, png, webp. Maximum file size 12MB."
  "fal-ai/bria/product-shot": { maxBytes: 12 * MB, formats: ["png", "jpeg", "webp"] },
  // "Each must be at least 256 pixels per dimension. Oversized images are automatically downscaled".
  "blackforestlabs/flux-3/edit-image": { minSide: 256 },
};

export interface StillFacts {
  width: number;
  height: number;
  bytes: number;
  format: StillFormat;
}

export interface StillPlan {
  /** A copy at this size (aspect kept, rounded down; up only for a minimum side). */
  resize?: { width: number; height: number };
  toFormat?: "png" | "jpeg" | "webp";
  flatten?: boolean;
}

/** What the picture needs before it's sent to the endpoint; null when it's fine as it is (or the endpoint states none). */
export function stillPlan(endpoint: string, f: StillFacts): StillPlan | null {
  const lim = STILL_LIMITS[endpoint];
  if (!lim || f.width <= 0 || f.height <= 0) return null;
  const plan: StillPlan = {};
  const long = Math.max(f.width, f.height);
  const short = Math.min(f.width, f.height);
  let s = 1;
  if (lim.maxSide && long > lim.maxSide) s = Math.min(s, lim.maxSide / long);
  if (lim.maxPixels && f.width * f.height > lim.maxPixels) s = Math.min(s, Math.sqrt(lim.maxPixels / (f.width * f.height)));
  if (s === 1 && lim.minSide && short < lim.minSide) {
    const up = lim.minSide / short;
    if (!lim.maxSide || long * up <= lim.maxSide) s = up;
  }
  if (s === 1 && lim.minPixels && f.width * f.height < lim.minPixels) s = Math.sqrt(lim.minPixels / (f.width * f.height));
  if (s !== 1) {
    const round = s < 1 ? Math.floor : Math.ceil;
    plan.resize = { width: Math.max(1, round(f.width * s)), height: Math.max(1, round(f.height * s)) };
  }
  if (lim.formats && !lim.formats.includes(f.format)) plan.toFormat = lim.formats[0] as StillPlan["toFormat"];
  if (lim.noAlpha && (plan.toFormat ?? f.format) === "png") plan.flatten = true;
  // A file over the byte limit at its own size is written again (JPEG where it may be, else the same format).
  if (lim.maxBytes && f.bytes > lim.maxBytes && !plan.toFormat) plan.toFormat = lim.formats && !lim.formats.includes("jpeg") ? (lim.formats[0] as StillPlan["toFormat"]) : "jpeg";
  return plan.resize || plan.toFormat || plan.flatten ? plan : null;
}

/** Why the endpoint would still refuse the picture (after any copy), in Fuobe's words; null when it's within its limits. */
export function stillProblem(endpoint: string, f: StillFacts): string | null {
  const lim = STILL_LIMITS[endpoint];
  if (!lim) return null;
  const long = Math.max(f.width, f.height);
  const short = Math.min(f.width, f.height);
  if (lim.minSide && short < lim.minSide) return `This model needs a picture at least ${lim.minSide} pixels on each side.`;
  if (lim.maxSide && long > lim.maxSide) return `This model takes pictures up to ${lim.maxSide} pixels on a side.`;
  if (lim.minPixels && f.width * f.height < lim.minPixels) return "This picture is too small for this model.";
  if (lim.maxPixels && f.width * f.height > lim.maxPixels) return "This picture is too large for this model.";
  if (lim.maxAspect && long / short > lim.maxAspect) return `This model takes pictures up to ${lim.maxAspect}:1 in shape.`;
  if (lim.maxBytes && f.bytes > lim.maxBytes) return `This model takes picture files up to ${Math.floor(lim.maxBytes / MB)} MB.`;
  if (lim.formats && !lim.formats.includes(f.format)) return `This model takes ${lim.formats.map((x) => x.toUpperCase()).join(", ")} pictures.`;
  return null;
}
