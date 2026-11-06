"use client";

/**
 * The browser half of fitting a photo (src/lib/av/fit-image.ts says when): decoded here and saved again as a JPEG, or a
 * WebP when it may have see-through parts, at most `maxPixels` and `maxBytes`. Nothing is sent anywhere while it runs.
 */

export interface ImageFitOut {
  file: File;
  width: number;
  height: number;
}

const cantOpen = (name?: string) => {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(name ?? "")?.[1]?.toUpperCase();
  return new Error(`This browser can't open ${ext ? `${ext} photos` : "this photo"}. Save it as a JPEG and add it again`);
};

async function decode(file: Blob, name?: string): Promise<{ draw: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const b = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { draw: b, width: b.width, height: b.height, close: () => b.close() };
    } catch {
      // An <img> below (some browsers open more types there).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (!img.naturalWidth) throw cantOpen(name);
    return { draw: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw cantOpen(name);
  }
}

const toBlob = (c: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, quality));

/** "IMG_2041.HEIC" -> "IMG_2041.jpg". */
export function renamed(name: string | undefined, ext: string): string {
  const base = (name ?? "").split(/[\\/]/).pop()?.replace(/\.[a-z0-9]{1,5}$/i, "").trim();
  return `${base || "Photo"}.${ext}`;
}

/**
 * The photo (its first frame, for a GIF) as a JPEG, or a WebP when `keepAlpha` and the browser saves one, no bigger than
 * `maxPixels` and `maxBytes`, and cropped to `crop` (in the photo's pixels) when given. Throws in plain words when the
 * browser can't open it or can't get it under `maxBytes`.
 */
export async function fitImage(
  file: Blob,
  opts: {
    name?: string;
    maxPixels?: number;
    maxBytes?: number;
    keepAlpha?: boolean;
    crop?: { x: number; y: number; width: number; height: number };
    /** Exactly this size (an endpoint's own limits, src/lib/catalog/still-limits.ts). */
    size?: { width: number; height: number };
    /** Saved as a PNG (an endpoint that reads PNG only), else JPEG or WebP. */
    png?: boolean;
  },
): Promise<ImageFitOut> {
  const src = await decode(file, opts.name);
  try {
    const crop = opts.crop ?? { x: 0, y: 0, width: src.width, height: src.height };
    let scale = opts.size ? opts.size.width / crop.width : 1;
    if (opts.maxPixels && crop.width * crop.height > opts.maxPixels) scale = Math.sqrt(opts.maxPixels / (crop.width * crop.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const w = attempt === 0 && opts.size ? opts.size.width : Math.max(1, Math.floor(crop.width * scale));
      const h = attempt === 0 && opts.size ? opts.size.height : Math.max(1, Math.floor(crop.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw cantOpen(opts.name);
      if (!opts.keepAlpha) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src.draw, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
      if (opts.png) {
        const blob = await toBlob(canvas, "image/png", 1);
        if (!blob) throw cantOpen(opts.name);
        if (!opts.maxBytes || blob.size <= opts.maxBytes) return { file: new File([blob], renamed(opts.name, "png"), { type: "image/png" }), width: w, height: h };
        scale *= 0.8;
        continue;
      }
      for (const q of [0.92, 0.86, 0.8]) {
        let blob = opts.keepAlpha ? await toBlob(canvas, "image/webp", q) : null;
        // A browser that doesn't save WebP answers with a PNG: a JPEG then (on white).
        if (!blob || blob.type !== "image/webp") {
          if (opts.keepAlpha) {
            ctx.globalCompositeOperation = "destination-over";
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = "source-over";
          }
          blob = await toBlob(canvas, "image/jpeg", q);
        }
        if (!blob) throw cantOpen(opts.name);
        if (!opts.maxBytes || blob.size <= opts.maxBytes) {
          const ext = blob.type === "image/webp" ? "webp" : "jpg";
          return { file: new File([blob], renamed(opts.name, ext), { type: blob.type }), width: w, height: h };
        }
      }
      scale *= 0.8;
    }
    throw new Error("We couldn't make this photo small enough here. Save it smaller and add it again");
  } finally {
    src.close();
  }
}

/** A photo's size in pixels, read by the browser (null when it can't open it). */
export async function imageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const src = await decode(file);
    src.close();
    return { width: src.width, height: src.height };
  } catch {
    return null;
  }
}
