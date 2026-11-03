/**
 * Watermark Remover (app-watermark-remover): the pure parts both sides share. The scan's report (ComfyUI-Qwen-Watermark's
 * QWMDetect JSON) read into regions the page draws, the chips they wear, the kept marks checked and rebuilt before they
 * reach the graph, the size the repair works at, and the quality verdict kept on the result.
 */

export const WATERMARK_APP_ID = "app-watermark-remover";
/** The removal's feature (a Library item); the scan is a helper the Library hides (HELPER_FEATURES). */
export const WATERMARK_FEATURE = `app:${WATERMARK_APP_ID}`;
export const WATERMARK_SCAN_FEATURE = "watermark-scan";
export const WATERMARK_SCAN_MODEL = "oss-watermark-scan";
export const WATERMARK_REMOVE_MODEL = "oss-watermark-remover";

/** The pack's mark types (processing.py OVERLAY_TYPES). */
export const OVERLAY_TYPES = ["text_logo", "translucent_text_logo", "rectangle", "mosaic", "irregular_sticker", "unknown"] as const;
export type OverlayType = (typeof OVERLAY_TYPES)[number];

/** What a region's chip says. */
export type Chip = "Text" | "Logo" | "Mosaic" | "Sticker" | "Block" | "Mark";

/** At most this many marks in one removal. */
export const MAX_BOXES = 32;
/** Labels are cut to this many characters. */
export const MAX_LABEL = 80;
/** The longest side a picture may have. */
export const MAX_SIDE = 4096;
/** Marks the scan was less sure of are shown off (kept) at first. */
export const SURE = 0.65;
/** A mark whose repair box covers more of the picture than this is shown off at first: repairing it would redraw most of the photo. */
export const BIG_SHARE = 0.4;
/**
 * The scan's own margin around a mark (the scan graph's QWMDetect: expand 20, padding 0.35, capped per kind as the pack
 * caps it). The sure marks come back with it; the less sure ones come back tight and get it here.
 */
export const SCAN_EXPAND = 20;
/** The repair margin added around the kept marks: a scan box can stop a few pixels short of a soft mark edge. */
export const KEPT_EXPAND = 32;
const PAD: Record<(typeof OVERLAY_TYPES)[number], number> = {
  text_logo: 0.12,
  translucent_text_logo: 0.35,
  rectangle: 0.12,
  mosaic: 0.12,
  irregular_sticker: 0.25,
  unknown: 0.25,
};
/** A GPU with less memory than this repairs at 768 px (a "16 GB" card reports a little under 16 GiB). */
export const SMALL_GPU_BYTES = 15 * 2 ** 30;

/** Visitor words. */
export const COPY = {
  name: "Watermark Remover",
  tagline: "Clears text, logos, stickers and mosaics off a photo. The rest stays exactly as it was.",
  hero: "Clean up a photo",
  subline: "We find what's printed over your picture. Keep anything you like, remove the rest.",
  details: [
    "What was hidden under a mark is re-imagined from what's around it, so it may not match the original exactly.",
    "Everything outside the marks stays pixel for pixel the same.",
    "Use it on pictures you own or have the rights to.",
    "Runs on your own GPU.",
  ],
  scanning: "Looking for marks…",
  removing: "Removing…",
  empty: "Nothing to remove found. Brush the area you want gone.",
  rejected: "We couldn't remove that cleanly. Brush just the mark and try again.",
  tooBig: "Use a picture up to 4096 pixels on its longest side.",
  noneKept: "Pick at least one mark to remove",
  hint: "Tap to compare. Hold to see the original.",
  /** A run that failed for a reason with no plain words of its own. */
  retry: "That didn't work this time. Try again, or brush just the mark.",
  scanFailed: "The scan didn't finish. Try again.",
  scanUnreadable: "We couldn't finish checking this photo. Try again.",
  brushAgain: "Brush on the picture again, then try again.",
  connectGpu: "Connect your GPU, then try again.",
  sizeLine: "JPG, PNG or WebP, up to 4096 pixels on the longest side.",
} as const;

/** The app's own words a failed run may carry: shown as they are. Anything else (a node's own error) never reaches a visitor. */
const PLAIN_ERRORS = new Set<string>([COPY.rejected, COPY.tooBig, COPY.noneKept, COPY.scanFailed, COPY.scanUnreadable, COPY.brushAgain, COPY.connectGpu]);
const PLAIN_CHECKS = /^(Pick up to \d+ marks at a time|The marks to remove couldn't be read\. Scan the picture again\.)$/;

/**
 * What a failed or stopped run says on the page: nothing for a cancel, the app's own words as they are, the raw error to
 * the owner only, else `fallback`.
 */
export function visitorError(run: { status?: string; error?: string | null } | null | undefined, owner: boolean, fallback: string): string | null {
  if (!run || run.status === "canceled") return null;
  const e = run.error?.trim();
  if (e && (PLAIN_ERRORS.has(e) || PLAIN_CHECKS.test(e) || owner)) return e;
  return fallback;
}

/** The download's file name: "catwalk-clean.png" (the picture's own name, made safe, and the result's own extension). */
export function cleanFileName(name: string, url: string): string {
  const ext = (/\.(png|jpe?g|webp)(?:[?#]|$)/i.exec(url)?.[1] ?? "png").toLowerCase().replace("jpeg", "jpg");
  const base =
    name
      .replace(/\.[a-z0-9]{2,4}$/i, "")
      .replace(/[^A-Za-z0-9_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "photo";
  return `${base}-clean.${ext}`;
}

const TEXT_WORDS = /text|caption|word|letter|url|www|@|©|date|signature/i;

export function normalizeType(value: unknown): OverlayType {
  const t = String(value ?? "").trim().toLowerCase();
  return (OVERLAY_TYPES as readonly string[]).includes(t) ? (t as OverlayType) : "unknown";
}

/** The chip a mark wears: Text or Logo for printed marks (by the words the scan used), else its kind. */
export function chipFor(type: OverlayType, label = ""): Chip {
  if (type === "text_logo" || type === "translucent_text_logo") return TEXT_WORDS.test(label) ? "Text" : "Logo";
  if (type === "mosaic") return "Mosaic";
  if (type === "irregular_sticker") return "Sticker";
  if (type === "rectangle") return "Block";
  return "Mark";
}

export type Box = [x0: number, y0: number, x1: number, y1: number];

export interface Region {
  id: string;
  type: OverlayType;
  label: string;
  chip: Chip;
  /** The tight box around the mark, in the picture's pixels: what the page outlines. */
  box: Box;
  /** The padded box the repair works in, in pixels. */
  repair: Box;
  /** On at first (the scan was sure of it); a less sure mark starts kept. */
  on: boolean;
  /** The material around the mark in the scan's words ("fabric", "skin"…): the repair's hint. Empty when it said none. */
  background: string;
}

export interface ScanResult {
  width: number;
  height: number;
  regions: Region[];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const box4 = (v: unknown): Box | null => (Array.isArray(v) && v.length === 4 && v.every(finite) ? (v as Box) : null);

function ordered(b: Box, width: number, height: number): Box | null {
  const x0 = Math.max(0, Math.min(width, Math.min(b[0], b[2])));
  const x1 = Math.max(0, Math.min(width, Math.max(b[0], b[2])));
  const y0 = Math.max(0, Math.min(height, Math.min(b[1], b[3])));
  const y1 = Math.max(0, Math.min(height, Math.max(b[1], b[3])));
  return x1 > x0 && y1 > y0 ? [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)] : null;
}

/** A tight box with the scan's margin for its kind (the pack's parse_boxes, adaptive padding), inside the picture. */
export function padBox(b: Box, type: OverlayType, width: number, height: number): Box {
  const ex = Math.ceil(SCAN_EXPAND + (b[2] - b[0]) * PAD[type]);
  const ey = Math.ceil(SCAN_EXPAND + (b[3] - b[1]) * PAD[type]);
  return [Math.max(0, b[0] - ex), Math.max(0, b[1] - ey), Math.min(width, b[2] + ex), Math.min(height, b[3] + ey)];
}

/**
 * The scan's report (QWMDetect's JSON, pixels) as regions: the sure marks first and on, the less sure ones (rejected_boxes)
 * after them and off. The sure marks' boxes already carry the scan's margin; the less sure ones come back tight and get the
 * same margin here. Null when the words aren't a report.
 */
export function parseScanReport(text: string | undefined | null): ScanResult | null {
  if (!text) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  const d = doc as { image_size?: unknown; boxes?: unknown; rejected_boxes?: unknown; coordinate_space?: unknown };
  const size = Array.isArray(d.image_size) && d.image_size.length === 2 && d.image_size.every((n) => finite(n) && n > 0) ? (d.image_size as [number, number]) : null;
  if (!size || (d.coordinate_space !== undefined && d.coordinate_space !== "pixels")) return null;
  const [width, height] = size;
  const regions: Region[] = [];
  const take = (list: unknown, on: boolean) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const it = item as { bbox?: unknown; source_bbox?: unknown; overlay_type?: unknown; label?: unknown; confidence?: unknown; background?: unknown };
      const given = box4(it.bbox) && ordered(box4(it.bbox)!, width, height);
      if (!given) continue;
      const type = normalizeType(it.overlay_type);
      const tight = (box4(it.source_bbox) && ordered(box4(it.source_bbox)!, width, height)) || given;
      const repair = on ? given : padBox(tight, type, width, height);
      const label = cleanLabel(it.label);
      const big = (repair[2] - repair[0]) * (repair[3] - repair[1]) > BIG_SHARE * width * height;
      const sure = on && !big && (!finite(it.confidence) || it.confidence >= SURE);
      regions.push({ id: `r${regions.length + 1}`, type, label, chip: chipFor(type, label), box: tight, repair, on: sure, background: cleanLabel(it.background) });
    }
  };
  take(d.boxes, true);
  take(d.rejected_boxes, false);
  return { width, height, regions };
}

/**
 * The scan reads the photo whole and again in four overlapping quarters (each 4/7 of the width and height, so neighbours
 * share 1/7): a mark repeated over the photo comes back copy by copy, where one look at the whole photo can draw a single
 * box around all of them. The scan graph crops the same tiles (GetImageSize, then a*4//7 and a - a*4//7).
 */
export function scanTiles(width: number, height: number): Box[] {
  const tw = Math.floor((width * 4) / 7);
  const th = Math.floor((height * 4) / 7);
  return [
    [0, 0],
    [width - tw, 0],
    [0, height - th],
    [width - tw, height - th],
  ].map(([x, y]) => [x, y, x + tw, y + th] as Box);
}

interface ScanItem {
  label: string;
  box: Box;
  type: OverlayType;
  confidence: number;
  background: string;
}

const boxArea = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const overlap = (a: Box, b: Box) => boxArea([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);

function scanItems(doc: Record<string, unknown>, src: number, dx: number, dy: number, width: number, height: number): ScanItem[] {
  const out: ScanItem[] = [];
  for (const list of [doc.boxes, doc.rejected_boxes]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const it = item as { bbox?: unknown; source_bbox?: unknown; overlay_type?: unknown; label?: unknown; confidence?: unknown; background?: unknown };
      const b = box4(it.source_bbox) ?? box4(it.bbox);
      const box = b && ordered([b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy], width, height);
      if (!box) continue;
      out.push({ src, label: cleanLabel(it.label), box, type: normalizeType(it.overlay_type), confidence: finite(it.confidence) ? it.confidence : 0.5, background: cleanLabel(it.background) });
    }
  }
  return out;
}

/**
 * One report from the whole-photo scan and its four tiles' scans (in scanTiles order): the tiles' marks moved to the
 * photo's pixels, a whole-photo box that holds two or more of the tiles' marks (or covers most of the photo while the
 * tiles found marks in it) dropped for them, and the boxes that overlap (one mark seen twice, or cut by a tile's edge)
 * joined. Each sure mark gets the scan's margin again. The whole-photo report as it came when a tile can't be read; null
 * when the whole-photo report can't be read.
 */
export function mergeScanReports(full: string | undefined | null, tiles: (string | undefined | null)[]): string | null {
  if (!full) return null;
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(full) as Record<string, unknown>;
  } catch {
    return null;
  }
  const size = Array.isArray(doc?.image_size) && doc.image_size.length === 2 && doc.image_size.every((n) => finite(n) && n > 0) ? (doc.image_size as [number, number]) : null;
  if (!size) return null;
  const [width, height] = size;
  const grid = scanTiles(width, height);
  if (tiles.length !== grid.length) return full;
  const tileDocs: Record<string, unknown>[] = [];
  for (const t of tiles) {
    try {
      const d = t ? (JSON.parse(t) as Record<string, unknown>) : null;
      if (!d || typeof d !== "object") return full;
      tileDocs.push(d);
    } catch {
      return full;
    }
  }
  const found = [...scanItems(doc, 0, 0, 0, width, height), ...tileDocs.flatMap((d, i) => scanItems(d, i + 1, grid[i][0], grid[i][1], width, height))];
  const frameArea = (src: number) => (src === 0 ? width * height : boxArea(grid[src - 1]));
  // A box is one look drawing a single box around several marks when the other looks found two or more separate marks
  // inside it (each under half its size), or one mark inside a box that fills half of what that look saw: dropped for them.
  const coarse = (a: ScanItem) => {
    const marks: Box[] = [];
    for (const b of found) {
      if (b.src === a.src || overlap(a.box, b.box) < 0.6 * boxArea(b.box) || boxArea(b.box) >= 0.5 * boxArea(a.box)) continue;
      if (!marks.some((m) => overlap(m, b.box) >= 0.2 * Math.min(boxArea(m), boxArea(b.box)))) marks.push(b.box);
    }
    return marks.length >= 2 || (marks.length === 1 && boxArea(a.box) >= 0.5 * frameArea(a.src));
  };
  const kept = found.filter((a) => !coarse(a));
  // Join what overlaps (a fifth of the smaller box), until nothing more joins.
  let items = kept;
  for (let joined = true; joined; ) {
    joined = false;
    outer: for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (overlap(a.box, b.box) < 0.2 * Math.min(boxArea(a.box), boxArea(b.box))) continue;
        items[i] = {
          label: b.label.length > a.label.length ? b.label : a.label,
          box: [Math.min(a.box[0], b.box[0]), Math.min(a.box[1], b.box[1]), Math.max(a.box[2], b.box[2]), Math.max(a.box[3], b.box[3])],
          type: a.type === "unknown" || b.type === "translucent_text_logo" ? b.type : a.type,
          confidence: Math.max(a.confidence, b.confidence),
          background: a.background || b.background,
        };
        items.splice(j, 1);
        joined = true;
        break outer;
      }
    }
  }
  items = items.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  const entry = (it: ScanItem, sure: boolean) => ({
    label: it.label || "watermark",
    bbox: sure ? padBox(it.box, it.type, width, height) : it.box,
    source_bbox: it.box,
    overlay_type: it.type,
    confidence: Math.round(it.confidence * 1e4) / 1e4,
    ...(it.background && { background: it.background }),
  });
  const boxes = items.filter((it) => it.confidence >= SURE).map((it) => entry(it, true));
  const rejected = items.filter((it) => it.confidence < SURE).map((it) => entry(it, false));
  const unread = [doc, ...tileDocs].some((d) => d.status === "indeterminate");
  const status = boxes.length ? (rejected.length ? "needs_review" : "detected") : rejected.length ? "needs_review" : unread ? "indeterminate" : "no_overlay_detected";
  return JSON.stringify({ coordinate_space: "pixels", image_size: [width, height], boxes, rejected_boxes: rejected, status, source: "auto_qwen_tiled" });
}

/** The region a tap at (x, y) in pixels picks: the smallest one under it, with a margin so small marks are easy to hit. */
export function regionAt(regions: Region[], x: number, y: number, margin = 0): Region | null {
  let best: Region | null = null;
  let area = Infinity;
  for (const r of regions) {
    const [x0, y0, x1, y1] = r.box;
    if (x < x0 - margin || x > x1 + margin || y < y0 - margin || y > y1 + margin) continue;
    const a = (x1 - x0) * (y1 - y0);
    if (a < area) {
      best = r;
      area = a;
    }
  }
  return best;
}

/**
 * A tap at (x, y) in pixels: a mark the finger is inside wins (the smallest one), else the nearest small mark within
 * `margin` of it. A tap inside a big caption never flips the small logo beside it.
 */
export function pickRegion(regions: Region[], x: number, y: number, margin: number): Region | null {
  return regionAt(regions, x, y, 0) ?? regionAt(regions, x, y, margin);
}

/** The header over the regions, as the marks stand: "Found 3. Tap any you want to keep." */
export function foundLine(count: number, on = count): string {
  if (on >= count) return count === 1 ? "Found 1. Tap it if you want to keep it." : `Found ${count}. Tap any you want to keep.`;
  if (on <= 0) return count === 1 ? "Found 1. Tap it to remove it." : `Found ${count}. Tap the ones to remove.`;
  return `Found ${count}. Tap a mark to keep or remove it.`;
}

/** The main button: "Remove 3", or "Everything is kept" when every mark is kept. */
export function removeLabel(on: number): string {
  return on > 0 ? `Remove ${on}` : "Everything is kept";
}

/** The marks to remove as the request's params.extra.boxes (pixels, the pack's manual_boxes JSON). */
export function keptBoxesJson(regions: Region[]): string {
  const boxes = regions
    .filter((r) => r.on)
    .map((r) => ({ bbox: r.repair, source_bbox: r.box, overlay_type: r.type, label: r.label, ...(r.background && { background: r.background }) }));
  return JSON.stringify({ coordinate_space: "pixels", boxes });
}

function cleanLabel(v: unknown): string {
  return String(v ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LABEL);
}

/**
 * The kept marks as they may reach the graph: JSON, 1–32 boxes of 4 finite numbers, clamped to the picture (its size when
 * known, else 16384 px), each with an area, a known type (else "unknown"), a label and a background hint of at most 80
 * characters with no control characters, in pixels. Rebuilt from scratch: nothing the client sent passes through as it was. Throws in words.
 */
export function checkWatermarkBoxes(raw: unknown, size?: { width?: number; height?: number }): { json: string; count: number } {
  let doc: unknown = raw;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw);
    } catch {
      throw new Error("The marks to remove couldn't be read. Scan the picture again.");
    }
  }
  const list = Array.isArray(doc) ? doc : doc && typeof doc === "object" ? (doc as { boxes?: unknown }).boxes : undefined;
  if (!Array.isArray(list)) throw new Error("The marks to remove couldn't be read. Scan the picture again.");
  if (list.length > MAX_BOXES) throw new Error(`Pick up to ${MAX_BOXES} marks at a time`);
  const width = size?.width && size.width > 0 ? size.width : 16384;
  const height = size?.height && size.height > 0 ? size.height : 16384;
  const boxes: { bbox: Box; source_bbox?: Box; overlay_type: OverlayType; label: string; background?: string }[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const it = item as { bbox?: unknown; source_bbox?: unknown; overlay_type?: unknown; label?: unknown; background?: unknown };
    const b = box4(it.bbox);
    const bbox = b && ordered(b, width, height);
    if (!bbox) continue;
    const s = box4(it.source_bbox);
    const source = s && ordered(s, width, height);
    const bg = cleanLabel(it.background);
    boxes.push({ bbox, ...(source && { source_bbox: source }), overlay_type: normalizeType(it.overlay_type), label: cleanLabel(it.label) || "watermark", ...(bg && { background: bg }) });
  }
  if (!boxes.length) throw Object.assign(new Error(COPY.noneKept), { status: 400 });
  return { json: JSON.stringify({ coordinate_space: "pixels", boxes }), count: boxes.length };
}

/** The longest side the repair works at: 1024; 1536 for a picture past 3000 px; 768 on a GPU smaller than a 16 GB card. */
export function maxSideFor(width?: number, height?: number, vramBytes?: number): number {
  if (vramBytes && vramBytes > 0 && vramBytes < SMALL_GPU_BYTES) return 768;
  if (Math.max(width ?? 0, height ?? 0) > 3000) return 1536;
  return 1024;
}

/** The repair's verdict (QWMFinal's report) as kept on the result's meta.quality. */
export interface WatermarkQuality {
  status: string;
  selectedPass?: number;
  outsideMaskMaxDifference?: number;
  needsReview?: boolean;
  reasons?: string[];
}

export function qualityOf(text: string | undefined | null): WatermarkQuality | null {
  if (!text) return null;
  try {
    const r = JSON.parse(text) as Record<string, unknown>;
    if (!r || typeof r !== "object" || typeof r.status !== "string") return null;
    return {
      status: r.status,
      ...(finite(r.selected_pass) && { selectedPass: r.selected_pass }),
      ...(finite(r.outside_mask_max_difference) && { outsideMaskMaxDifference: r.outside_mask_max_difference }),
      ...(typeof r.needs_review === "boolean" && { needsReview: r.needs_review }),
      ...(Array.isArray(r.reasons) && { reasons: r.reasons.filter((x): x is string => typeof x === "string").slice(0, 12) }),
    };
  } catch {
    return null;
  }
}

/** The original came back: the repair couldn't be made cleanly (the run fails in words, no new result). */
export const rejectedRepair = (q: WatermarkQuality | null | undefined): boolean => q?.status === "rejected_first_pass";
