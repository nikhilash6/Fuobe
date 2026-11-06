/*
 * Layouts: boxes on a canvas, one row per box (an object, a character or exact words), drawn once and read by each
 * model in its own form (docs/research/new-models-7.md §4.2-§4.3). Pure: no I/O and no catalog import, so the
 * browser, the server, Assist, MCP and the CLI share it.
 *
 * A draft keeps its boxes as 0-1 fractions of the canvas, so it stays valid when the render size changes. A compiler
 * turns it into the target model's prompt at the exact size the model renders:
 * - MOSS-Image (compileMoss): its "JSON Layout" prompt, pixel boxes from the canvas centre, y before x;
 * - FLUX.3 (compileFlux3): a caption citing <obj_N>, then the 0-1000 layout table ComfyUI's Flux3LayoutPrompt writes;
 * - Ideogram 4.x (compileIdeogram): the JSON prompt ComfyUI's BuildJsonPromptIdeogram builds;
 * - Bria FIBO 2 (compileVgl): VGL objects and text placed with words from a thirds grid (it reads no coordinates);
 * - every other model (compileWords): plain sentences.
 * parseLayout reads what people bring from ComfyUI (LinXce drafts, compiled MOSS prompts, legacy scene prompts,
 * CreateBoundingBoxes elements) and Fuobe's own drafts; validateLayout says what stops a layout from running.
 */
import type { LayoutFormat } from "./catalog/types";

export type { LayoutFormat };
export type LayoutLabel = "object" | "character" | "text";
export type LayoutCanvas = "single" | "multi_panel" | "collage";
/** [x0, y0, x1, y1] as 0-1 fractions of the canvas, from its top-left corner. */
export type LayoutBox = [number, number, number, number];

export interface LayoutItem {
  label: LayoutLabel;
  /** What it looks like. */
  caption: string;
  /** The exact words of a text box. */
  text?: string;
  box: LayoutBox;
  tags?: string[];
  palette?: string[];
  /** The editor's colour for the box (#rrggbb); no model sees it. */
  color?: string;
}

export interface LayoutSummary {
  /** The whole picture in words (the composer's prompt). */
  caption: string;
  meta: string[];
  canvas: LayoutCanvas;
  palette?: string[];
}

export interface LayoutDraft {
  summary: LayoutSummary;
  items: LayoutItem[];
  /** The shape the boxes were drawn on ("3:2"), when known. */
  aspect?: string;
}

/** Where a request carries its draft: params.extra.layout (never sent to an API as a field). */
export const LAYOUT_PARAM = "layout";
/** MOSS-Image's coordinate space and box order (USERGUIDE "Layout Prompts (Experimental)"). */
export const MOSS_COORD_SPACE = "abs_centralized";
export const MOSS_BBOX_FORMAT = "yxyx";
/** Canvas sides MOSS-Image, fal and MOSI take: multiples of 16; past 2048 px a side or 4 MP is outside what it was made for. */
export const LAYOUT_MULTIPLE = 16;
export const LAYOUT_MAX_SIDE = 2048;
export const LAYOUT_MAX_PIXELS = 4 * 1024 * 1024;
/** Prompt lengths the hosts take, in characters (MOSI's API reference; Ideogram 4.5 on fal). */
export const LAYOUT_PROMPT_LIMITS: Partial<Record<LayoutTarget, number>> = { mosi: 4000, ideogram: 10000 };
/** The formats whose models read coordinates (Bria reads location words, the rest plain sentences). */
export const BOX_READING_FORMATS: readonly LayoutFormat[] = ["moss", "flux3", "ideogram"];

const LABELS: readonly LayoutLabel[] = ["object", "character", "text"];
const CANVASES: readonly LayoutCanvas[] = ["single", "multi_panel", "collage"];
const HEX = /^#[0-9a-f]{6}$/i;

// ---------------------------------------------------------------------------
// Small helpers

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/** Python's round(v, 9): float noise from fractions and pixel maths collapses before floor / ceil (LinXce's collapseNoise). */
const round9 = (v: number) => Math.round(v * 1e9) / 1e9;

/** Python's round(): halves go to the even neighbour (CreateBoundingBoxes' 0-1000 grid). */
function pyRound(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** json.dumps(value, ensure_ascii=False) with Python's default separators (", " and ": "), as ComfyUI's nodes write it. */
function pyJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(pyJson).join(", ")}]`;
  if (isObj(v)) return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${pyJson(x)}`).join(", ")}}`;
  return JSON.stringify(v) ?? "null";
}

/** A box with its edges in order (x0 ≤ x1, y0 ≤ y1). */
function ordered(b: LayoutBox): LayoutBox {
  return [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** "1536 × 1024" → "3:2". */
export function aspectOf(width: number, height: number): string | undefined {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) return undefined;
  const g = gcd(width, height);
  return `${width / g}:${height / g}`;
}

const sentence = (s: string) => {
  const t = s.trim();
  return !t || /[.!?。！？]$/.test(t) ? t : `${t}.`;
};

// ---------------------------------------------------------------------------
// MOSS-Image

/**
 * A box in MOSS-Image's pixels: the edges enclosing it (top / left floored, bottom / right ceiled after Python's
 * round(v, 9)), with the canvas centre (W // 2, H // 2) as the origin, y before x: the maths of OpenMOSS's reference
 * compiler and LinXce's editor.
 */
export function mossBox(box: LayoutBox, width: number, height: number): [number, number, number, number] {
  const [x0, y0, x1, y1] = ordered(box);
  const hw = Math.floor(width / 2);
  const hh = Math.floor(height / 2);
  return [Math.floor(round9(y0 * height)) - hh, Math.floor(round9(x0 * width)) - hw, Math.ceil(round9(y1 * height)) - hh, Math.ceil(round9(x1 * width)) - hw];
}

/**
 * The draft as MOSS-Image's JSON Layout prompt at width × height: compact JSON with every character as written (no
 * ASCII escaping), keys in MOSS's documented order (summary: meta, canvas, caption, palette; item: label, caption, text,
 * bbox, tags, palette), the editor colour left out. With no boxes it is the summary caption alone, trimmed.
 */
export function compileMoss(draft: LayoutDraft, width: number, height: number): string {
  const s = draft.summary;
  if (!draft.items.length) return s.caption.trim();
  const summary: Record<string, unknown> = { meta: s.meta ?? [], canvas: s.canvas ?? "single", caption: s.caption };
  if (s.palette?.length) summary.palette = s.palette;
  const items = draft.items.map((it) => {
    const out: Record<string, unknown> = { label: it.label, caption: it.caption };
    if (it.label === "text") out.text = it.text ?? "";
    out.bbox = mossBox(it.box, width, height);
    if (it.tags?.length) out.tags = it.tags;
    if (it.palette?.length) out.palette = it.palette;
    return out;
  });
  return JSON.stringify({ summary, items, bbox_coord_space: MOSS_COORD_SPACE, bbox_format: MOSS_BBOX_FORMAT });
}

/** A summary read from any of the shapes below, in any key order. */
function readSummary(v: unknown): LayoutSummary {
  const s = isObj(v) ? v : {};
  const canvas = CANVASES.find((c) => c === s.canvas) ?? "single";
  const palette = strings(s.palette);
  return { caption: str(s.caption), meta: strings(s.meta), canvas, ...(palette.length && { palette }) };
}

/** An item's label, caption, words, tags and palettes read in any key order; `box` is added by the caller. */
function readItem(v: Record<string, unknown>): Omit<LayoutItem, "box"> {
  const raw = str(v.label).trim().toLowerCase();
  const label: LayoutLabel = LABELS.find((l) => l === raw) ?? (raw === "person" ? "character" : "object");
  const tags = strings(v.tags);
  const palette = strings(v.palette);
  const color = str(v.color);
  const text = str(v.text);
  return {
    label,
    caption: str(v.caption),
    ...(label === "text" || text ? { text } : {}),
    ...(tags.length && { tags }),
    ...(palette.length && { palette }),
    ...(HEX.test(color) && { color }),
  };
}

const finiteBox = (v: unknown): number[] | null => {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const n = v.map(num);
  return n.every(Number.isFinite) ? n : null;
};

/** Pixel boxes → fractions: MOSS's centred yxyx, or a LinXce draft's top-left xyxy. */
function fromPixels(items: unknown[], width: number, height: number, centred: boolean): LayoutItem[] {
  const hw = Math.floor(width / 2);
  const hh = Math.floor(height / 2);
  return items.flatMap((v) => {
    if (!isObj(v)) return [];
    const b = finiteBox(v.bbox);
    if (!b) return [];
    const box: LayoutBox = centred
      ? [(b[1] + hw) / width, (b[0] + hh) / height, (b[3] + hw) / width, (b[2] + hh) / height]
      : [b[0] / width, b[1] / height, b[2] / width, b[3] / height];
    return [{ ...readItem(v), box: ordered(box) }];
  });
}

/** Parse JSON, then again with Stable Diffusion's \( \) escapes made legal (LinXce's repair); undefined when it isn't JSON. */
function parseLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(text.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])|\\/g, (m, ok: string | undefined) => (ok ? m : "\\\\")));
    } catch {
      return undefined;
    }
  }
}

/**
 * MOSS-Image's prompt back to a draft at the size it was rendered: blind to key order (fal's actual_prompt puts bbox
 * before text) and to the root's bbox fields when they're missing. Plain words come back as a caption with no boxes
 * (what compileMoss makes of a draft with none); null for JSON that isn't a layout.
 */
export function decodeMoss(prompt: string, width: number, height: number): LayoutDraft | null {
  const text = prompt.trim();
  if (!/^[[{]/.test(text)) return { summary: { caption: text, meta: [], canvas: "single" }, items: [], ...aspectField(width, height) };
  const v = parseLoose(text);
  if (!isObj(v) || !(Array.isArray(v.items) || isObj(v.summary))) return null;
  const centred = v.bbox_coord_space !== "abs" && v.bbox_format !== "xyxy";
  return { summary: readSummary(v.summary), items: fromPixels(Array.isArray(v.items) ? v.items : [], width, height, centred), ...aspectField(width, height) };
}

const aspectField = (width: number, height: number) => {
  const aspect = aspectOf(width, height);
  return aspect ? { aspect } : {};
};

// ---------------------------------------------------------------------------
// Importing layouts

export type LayoutSource = "fuobe" | "linxce" | "compiled" | "scene" | "elements";

export interface ParsedLayout {
  draft: LayoutDraft;
  /** The canvas the import was drawn on: its own size when it has one, else the canvas given. */
  width: number;
  height: number;
  from: LayoutSource;
}

/** Every balanced {...} (or [...]) in some prose, in order, skipping braces inside strings. */
function* balanced(text: string, open: "{" | "["): Generator<string> {
  const close = open === "{" ? "}" : "]";
  for (let start = text.indexOf(open); start !== -1; start = text.indexOf(open, start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        yield text.slice(start, i + 1);
        break;
      }
    }
  }
}

const looksLikeLayout = (v: unknown): v is Record<string, unknown> => isObj(v) && ("summary" in v || "items" in v || "elements" in v);

/** ComfyUI CreateBoundingBoxes elements: {type: "obj" | "text", bbox: 0-1000 yxyx, text?, desc, color_palette?}. */
const isElement = (v: unknown): boolean =>
  isObj(v) && !!finiteBox(v.bbox) && ("desc" in v || v.type === "obj" || v.type === "text") && !("identity" in v || "shape" in v || "note" in v);
const looksLikeElements = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0 && v.every(isElement);

/** The JSON in some text: the text itself (a string when it was encoded twice), else the first layout-shaped value in it. */
function parseOnce(text: string): unknown {
  const direct = parseLoose(text);
  if (typeof direct === "string" || isObj(direct) || looksLikeElements(direct)) return direct;
  for (const candidate of balanced(text, "{")) {
    const v = parseLoose(candidate);
    if (looksLikeLayout(v) || (isObj(v) && ("width" in v || "height" in v))) return v;
  }
  for (const candidate of balanced(text, "[")) {
    const v = parseLoose(candidate);
    if (looksLikeElements(v)) return v;
  }
  return null;
}

/** Scale boxes around the centre so an import that spills past the canvas fits it (LinXce's fitDraftToCanvas). */
function fitToCanvas(items: LayoutItem[]): LayoutItem[] {
  let hw = 0;
  let hh = 0;
  for (const { box } of items) {
    hw = Math.max(hw, Math.abs(box[0] - 0.5), Math.abs(box[2] - 0.5));
    hh = Math.max(hh, Math.abs(box[1] - 0.5), Math.abs(box[3] - 0.5));
  }
  if (!hw || !hh || (hw <= 0.5 + 1e-9 && hh <= 0.5 + 1e-9)) return items;
  const k = Math.min(0.5 / hw, 0.5 / hh);
  const at = (v: number) => (v - 0.5) * k + 0.5;
  return items.map((it) => ({ ...it, box: [at(it.box[0]), at(it.box[1]), at(it.box[2]), at(it.box[3])] }));
}

const SCENE_LABELS: Record<string, LayoutLabel> = { panel: "object", obj: "object", object: "object", shape: "object", character: "character", person: "character", text: "text" };

/**
 * A legacy MOSS scene prompt (scene_type / gen_brief / elements / must_not): each element's identity, shape and note
 * become its caption, a text element without words becomes an object, boxes are centred yxyx unless the prompt says "abs".
 */
function fromScene(v: Record<string, unknown>, width: number, height: number): LayoutDraft {
  const centred = v.bbox_coord_space !== "abs";
  const items: LayoutItem[] = [];
  for (const el of Array.isArray(v.elements) ? v.elements : []) {
    if (!isObj(el)) continue;
    const b = finiteBox(el.bbox);
    if (!b) continue;
    let label = SCENE_LABELS[str(el.type).trim().toLowerCase()] ?? "object";
    const caption = ["identity", "shape", "note"].map((k) => str(el[k]).trim()).filter(Boolean).join(" ");
    const words = str(el.text).trim() || str(el.identity).trim();
    if (label === "text" && !words) label = "object";
    // LinXce adds half the canvas (not its floor) to a centred box: the same here.
    const box: LayoutBox = centred
      ? [(b[1] + width / 2) / width, (b[0] + height / 2) / height, (b[3] + width / 2) / width, (b[2] + height / 2) / height]
      : [b[0] / width, b[1] / height, b[2] / width, b[3] / height];
    items.push({ label, caption, ...(label === "text" && { text: words }), box: ordered(box) });
  }
  const avoid = (Array.isArray(v.must_not) ? v.must_not : [v.must_not])
    .map((x) => str(x).trim())
    .map((x) => (x.slice(0, 4).toLowerCase() === "not " ? x.slice(4).trim() : x))
    .filter(Boolean)
    .join("; ");
  let caption = [str(v.scene_type).trim(), str(v.gen_brief).trim()].filter(Boolean).join(". ");
  if (avoid) caption = `${caption} Avoid: ${avoid}`.trim();
  const palette = strings(v.palette);
  return { summary: { caption, meta: [], canvas: "single", ...(palette.length && { palette }) }, items };
}

function fromElements(elements: unknown[]): LayoutDraft {
  const items = elements.flatMap((el): LayoutItem[] => {
    if (!isObj(el)) return [];
    const b = finiteBox(el.bbox)!;
    const text = el.type === "text";
    const palette = strings(el.color_palette);
    return [{ label: text ? "text" : "object", caption: str(el.desc), ...(text && { text: str(el.text) }), box: ordered([b[1] / 1000, b[0] / 1000, b[3] / 1000, b[2] / 1000]), ...(palette.length && { palette }) }];
  });
  return { summary: { caption: "", meta: [], canvas: "single" }, items };
}

/** A Fuobe draft (fractional `box` on every item), else null. */
export function readLayout(value: unknown): LayoutDraft | null {
  if (!isObj(value) || !Array.isArray(value.items)) return null;
  const items: LayoutItem[] = [];
  for (const v of value.items) {
    const b = isObj(v) ? finiteBox(v.box) : null;
    if (!b || !isObj(v)) return null;
    items.push({ ...readItem(v), box: ordered(b as LayoutBox) });
  }
  const aspect = str(value.aspect);
  return { summary: readSummary(value.summary), items, ...(/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(aspect) && { aspect }) };
}

const sideOf = (v: unknown, fallback: number) => {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};

/**
 * Whether a pixel layout's boxes are MOSS's centred yxyx (a compiled prompt) or a LinXce draft's top-left xyxy: what its
 * root says, else centred when a box has a negative edge (only the centre is an origin that gives one) or when it carries
 * no size of its own (LinXce drafts always do) — as decodeMoss reads a prompt with the root's fields missing.
 */
function centredBoxes(v: Record<string, unknown>): boolean {
  if (v.bbox_coord_space === MOSS_COORD_SPACE || v.bbox_format === MOSS_BBOX_FORMAT) return true;
  if (v.bbox_coord_space === "abs" || v.bbox_format === "xyxy") return false;
  const sized = num(v.width) > 0 && num(v.height) > 0;
  const negative = (Array.isArray(v.items) ? v.items : []).some((it) => isObj(it) && (finiteBox(it.bbox) ?? []).some((n) => n < 0));
  return negative || !sized;
}

function fromLayoutValue(v: Record<string, unknown> | unknown[], width: number, height: number): ParsedLayout | null {
  if (Array.isArray(v)) return { draft: fromElements(v), width, height, from: "elements" };
  const w = sideOf(v.width, width);
  const h = sideOf(v.height, height);
  if (Array.isArray(v.elements)) {
    const cbb = looksLikeElements(v.elements) && !("scene_type" in v || "gen_brief" in v);
    return cbb ? { draft: fromElements(v.elements), width: w, height: h, from: "elements" } : { draft: fromScene(v, w, h), width: w, height: h, from: "scene" };
  }
  const own = readLayout(v);
  if (own) return { draft: own, width: w, height: h, from: "fuobe" };
  const compiled = centredBoxes(v);
  const items = fromPixels(Array.isArray(v.items) ? v.items : [], w, h, compiled);
  return { draft: { summary: readSummary(v.summary), items }, width: w, height: h, from: compiled ? "compiled" : "linxce" };
}

/**
 * A layout from what someone pastes or imports, as tolerant as LinXce's browser editor: prose around the JSON, a JSON
 * string encoded twice, {layout | draft | source} envelopes (up to 4 levels), \( escapes; LinXce drafts (pixel boxes,
 * "abs" / "xyxy", their own width and height), compiled MOSS prompts (decoded on their own size, else `canvas`),
 * legacy scene prompts, CreateBoundingBoxes elements (0-1000, yxyx) and Fuobe's own drafts. Boxes that spill past
 * the canvas are scaled to fit. Null when the text holds no layout.
 */
export function parseLayout(input: string | object, canvas: { width: number; height: number } = { width: 1024, height: 1024 }): ParsedLayout | null {
  let value: unknown = typeof input === "string" ? input.trim() : input;
  for (let depth = 0; depth < 4 && value; depth++) {
    if (typeof value === "string") {
      value = parseOnce(value);
      if (typeof value === "string") {
        value = value.trim();
        continue;
      }
    }
    if (looksLikeElements(value) || looksLikeLayout(value)) {
      const parsed = fromLayoutValue(value as Record<string, unknown> | unknown[], canvas.width, canvas.height);
      if (!parsed) return null;
      const items = fitToCanvas(parsed.draft.items);
      const aspect = parsed.draft.aspect ?? aspectOf(parsed.width, parsed.height);
      return { ...parsed, draft: { ...parsed.draft, items, ...(aspect && { aspect }) } };
    }
    if (!isObj(value)) return null;
    const v: Record<string, unknown> = value;
    const wrapped = ["layout", "draft", "source"].map((k) => v[k]).find((x) => (typeof x === "string" && x.trim()) || isObj(x));
    if (!wrapped) return null;
    value = typeof wrapped === "string" ? wrapped.trim() : wrapped;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Checks

/** What a layout is checked for: a model's form, plain words, MOSI, or fal's FLUX 3 Klein boxes ("flux3-boxes"). */
export type LayoutTarget = LayoutFormat | "words" | "mosi" | "flux3-boxes";

export interface LayoutIssue {
  level: "error" | "warning";
  message: string;
  /** The box it is about (0-based), when it is about one. */
  item?: number;
}

const EPS = 1e-9;

/**
 * What stops the draft from running at width × height on `target` (errors), and what may make the model drift
 * (warnings): sides in multiples of 16, words in every text box, boxes inside the picture; past 2048 px a side or
 * 4 MP; MOSI's 4,000 characters (and Ideogram's 10,000) for the compiled prompt.
 */
export function validateLayout(draft: LayoutDraft, width: number, height: number, target: LayoutTarget = "moss"): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const side = (n: number) => Number.isInteger(n) && n > 0 && n % LAYOUT_MULTIPLE === 0;
  if (!side(width) || !side(height)) issues.push({ level: "error", message: `Width and height must be multiples of ${LAYOUT_MULTIPLE} px (this canvas is ${width} × ${height})` });
  draft.items.forEach((it, i) => {
    const n = i + 1;
    const [x0, y0, x1, y1] = it.box;
    if (it.label === "text" && !it.text?.trim()) issues.push({ level: "error", message: `Type the words for box ${n}`, item: i });
    if (!it.box.every(Number.isFinite) || x1 - x0 <= EPS || y1 - y0 <= EPS) issues.push({ level: "error", message: `Box ${n} has no size: draw it again`, item: i });
    else if (x0 < -EPS || y0 < -EPS || x1 > 1 + EPS || y1 > 1 + EPS) issues.push({ level: "error", message: `Box ${n} goes past the edge of the picture`, item: i });
  });
  if (Math.max(width, height) > LAYOUT_MAX_SIDE || width * height > LAYOUT_MAX_PIXELS) {
    issues.push({ level: "warning", message: `${width} × ${height} is past what MOSS-Image was made for (${LAYOUT_MAX_SIDE} px a side, 4 megapixels): the boxes may drift` });
  }
  // fal's FLUX 3 Klein boxes ("flux3-boxes"): 32 at most, each described in up to 500 characters.
  if (target === "flux3-boxes") {
    if (draft.items.length > FLUX3_BOX_LIMITS.boxes) issues.push({ level: "error", message: `FLUX 3 Klein takes up to ${FLUX3_BOX_LIMITS.boxes} boxes (this layout has ${draft.items.length})` });
    draft.items.forEach((it, i) => {
      if (flux3Desc(it).length > FLUX3_BOX_LIMITS.description) issues.push({ level: "error", message: `Box ${i + 1}'s words are past the ${FLUX3_BOX_LIMITS.description} characters FLUX 3 Klein reads for a box: shorten them`, item: i });
    });
  }
  const limit = LAYOUT_PROMPT_LIMITS[target];
  if (limit && !issues.some((x) => x.level === "error")) {
    const compiled = target === "ideogram" ? compileIdeogram(draft) : compileMoss(draft, width, height);
    if (compiled.length > limit) {
      const host = target === "mosi" ? "MOSI" : "Ideogram 4.5";
      issues.push({ level: "error", message: `${host} takes prompts up to ${limit.toLocaleString("en-US")} characters; this layout is ${compiled.length.toLocaleString("en-US")}` });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Other models

/** A box on ComfyUI's 0-1000 grid, y before x, rounded as Python rounds (CreateBoundingBoxes' _norm_bbox). */
export function gridBox(box: LayoutBox): [number, number, number, number] {
  const g = (v: number) => Math.max(0, Math.min(1000, pyRound(v * 1000)));
  const [x0, y0, x1, y1] = ordered(box);
  return [g(y0), g(x0), g(y1), g(x1)];
}

/** Where a box sits on a thirds grid, in words: "top left", "center", "across the bottom", "filling the frame". */
export function locationWords(box: LayoutBox): string {
  const [x0, y0, x1, y1] = ordered(box);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w >= 0.8 && h >= 0.8) return "filling the frame";
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const col = cx < 1 / 3 ? "left" : cx > 2 / 3 ? "right" : "center";
  const row = cy < 1 / 3 ? "top" : cy > 2 / 3 ? "bottom" : "middle";
  if (w >= 2 / 3) return `across the ${row}`;
  if (h >= 2 / 3) return col === "center" ? "down the center" : `down the ${col} side`;
  if (row === "middle") return col === "center" ? "center" : `middle ${col}`;
  return `${row} ${col}`;
}

/** A caption without its closing full stop, to sit inside a sentence. */
const bare = (s: string) => s.trim().replace(/[.。]+$/, "");

/** What an item is, in a few words: the words of a text box, else its caption. */
function itemWords(it: LayoutItem): string {
  if (it.label === "text") return `the words "${it.text ?? ""}"${bare(it.caption) ? ` (${bare(it.caption)})` : ""}`;
  return bare(it.caption) || (it.label === "character" ? "a person" : "an object");
}

/**
 * FLUX.3's layout prompt (ComfyUI's Flux3LayoutPrompt): the caption, a sentence citing each box as <obj_N>, then the
 * table [{"id": "obj_N", "bbox": [0-1000, y before x], "desc": …}] with a text box's words quoted after its desc.
 */
export function compileFlux3(draft: LayoutDraft): string {
  const caption = flux3Caption(draft);
  if (!draft.items.length) return caption;
  const rows = draft.items.map((it, i) => ({ id: flux3Label(i), bbox: gridBox(it.box), desc: flux3Desc(it) }));
  return `${caption} ${pyJson(rows)}`;
}

/** A FLUX.3 box's id, the <id> the caption names it by: obj_1, obj_2… */
const flux3Label = (i: number) => `obj_${i + 1}`;

/** What a FLUX.3 box holds: its caption, with a text box's words quoted after it. */
const flux3Desc = (it: LayoutItem) => (it.label === "text" && it.text ? `${it.caption} "${it.text}"`.trim() : it.caption);

/**
 * The words of FLUX.3's layout prompt without its table: the caption, then a sentence citing each box as <obj_N>. The
 * prompt fal's FLUX 3 Klein gets beside its bounding_boxes (flux3Boxes), which carry the table's boxes.
 */
export function flux3Caption(draft: LayoutDraft): string {
  const caption = draft.summary.caption.trim();
  if (!draft.items.length) return caption;
  const cites = draft.items.map((it, i) => `<${flux3Label(i)}> ${itemWords(it)}`).join(", ");
  return [sentence(caption), `${cites}.`].filter(Boolean).join(" ");
}

/** One of fal's FLUX 3 Klein bounding_boxes: where an element goes as 0-1 fractions of the picture, from its top-left corner. */
export interface Flux3Box {
  label: string;
  description: string;
  box: { x_min: number; y_min: number; x_max: number; y_max: number };
}

/** fal takes a box's description up to 500 characters and up to 32 boxes (the FLUX 3 Klein schemas, read 2026-11-01). */
export const FLUX3_BOX_LIMITS = { boxes: 32, description: 500 } as const;

/**
 * compileFlux3's table as fal's FLUX 3 Klein bounding_boxes: the same boxes (the 0-1000 grid's, as fractions, so both engines
 * place an element at the same spot), labels and descriptions, which the caption (flux3Caption) names as <obj_N>.
 */
export function flux3Boxes(draft: LayoutDraft): Flux3Box[] {
  return draft.items.map((it, i) => {
    const [y0, x0, y1, x1] = gridBox(it.box).map((v) => v / 1000);
    return { label: flux3Label(i), description: flux3Desc(it), box: { x_min: x0, y_min: y0, x_max: x1, y_max: y1 } };
  });
}

/** The share of the canvas a box covers that reads as its background (ComfyUI's Ideogram node takes one apart from the elements). */
const BACKDROP = 0.9;

/**
 * Ideogram 4's JSON prompt (ComfyUI's BuildJsonPromptIdeogram): {high_level_description, style_description?,
 * compositional_deconstruction: {background, elements}}, the elements as CreateBoundingBoxes writes them (0-1000, y
 * before x). An object box covering the frame is the background; without one, the summary caption describes it.
 */
export function compileIdeogram(draft: LayoutDraft, opts: { background?: string; lighting?: string; medium?: string } = {}): string {
  const s = draft.summary;
  const backdrop = draft.items.findIndex((it) => it.label !== "text" && it.box[2] - it.box[0] >= BACKDROP && it.box[3] - it.box[1] >= BACKDROP);
  const elements = draft.items
    .filter((_, i) => i !== backdrop)
    .map((it) => {
      const el: Record<string, unknown> = { type: it.label === "text" ? "text" : "obj", bbox: gridBox(it.box) };
      if (it.label === "text") el.text = it.text ?? "";
      el.desc = it.caption;
      if (it.palette?.length) el.color_palette = it.palette.slice(0, 5).map((c) => c.toUpperCase());
      return el;
    });
  const out: Record<string, unknown> = {};
  if (s.caption.trim()) out.high_level_description = s.caption;
  if (s.meta.length || s.palette?.length || opts.lighting || opts.medium) {
    out.style_description = {
      aesthetics: s.meta.join(", "),
      lighting: opts.lighting ?? "",
      medium: opts.medium ?? "",
      art_style: "",
      ...(s.palette?.length && { color_palette: s.palette.map((c) => c.toUpperCase()) }),
    };
  }
  const background = opts.background ?? (backdrop >= 0 ? draft.items[backdrop].caption : s.caption);
  out.compositional_deconstruction = { background, elements };
  return JSON.stringify(out);
}

/** Bria FIBO 2's structured prompt (its fal `vgl` field), the parts a layout fills. */
export interface VglPrompt {
  short_description: string;
  objects: { description: string; location: string; relationship: string; relative_size: string; shape_and_color?: string }[];
  text_render: { text: string; location: string; size: string; color?: string; appearance_details?: string }[];
  aesthetics?: { composition: string; color_scheme?: string; mood_atmosphere?: string };
}

const sizeWords = (box: LayoutBox) => {
  const area = (box[2] - box[0]) * (box[3] - box[1]);
  return area < 0.05 ? "small" : area < 0.25 ? "medium" : "large";
};
const textSize = (box: LayoutBox) => {
  const h = box[3] - box[1];
  return h < 0.08 ? "small" : h < 0.2 ? "medium" : "large";
};
const CANVAS_WORDS: Record<LayoutCanvas, string> = { single: "a single picture", multi_panel: "a multi-panel layout", collage: "a collage" };

/** How a box sits next to its nearest neighbour ("to the left of the lit candle"); Bria wants one per object. */
function relationship(items: LayoutItem[], i: number): string {
  const me = items[i];
  const c = (b: LayoutBox) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const [mx, my] = c(me.box);
  let best = -1;
  let dist = Infinity;
  items.forEach((it, j) => {
    if (j === i) return;
    const [x, y] = c(it.box);
    const d = Math.hypot(x - mx, y - my);
    if (d < dist) [best, dist] = [j, d];
  });
  if (best < 0) return "the only element in the picture";
  const other = items[best];
  const [ox, oy] = c(other.box);
  const name = other.label === "text" ? `the words "${other.text ?? ""}"` : other.caption.trim() || (other.label === "character" ? "the person" : "the other object");
  const dir = Math.abs(ox - mx) >= Math.abs(oy - my) ? (mx < ox ? "to the left of" : "to the right of") : my < oy ? "above" : "below";
  return `${dir} ${name}`;
}

/**
 * The layout as Bria FIBO 2's VGL: objects and characters with location words from a thirds grid, their size and
 * their place next to the nearest box; text boxes as text_render with the exact words. Bria reads no coordinates.
 */
export function compileVgl(draft: LayoutDraft): VglPrompt {
  const s = draft.summary;
  const objects: VglPrompt["objects"] = [];
  const text_render: VglPrompt["text_render"] = [];
  draft.items.forEach((it, i) => {
    if (it.label === "text") {
      text_render.push({
        text: it.text ?? "",
        location: locationWords(it.box),
        size: textSize(it.box),
        ...(it.palette?.[0] && { color: it.palette[0] }),
        ...(it.caption.trim() && { appearance_details: it.caption.trim() }),
      });
      return;
    }
    objects.push({
      description: it.caption.trim() || (it.label === "character" ? "a person" : "an object"),
      location: locationWords(it.box),
      relationship: relationship(draft.items, i),
      relative_size: sizeWords(it.box),
      ...(it.palette?.length && { shape_and_color: `in ${it.palette.join(", ")}` }),
    });
  });
  const aesthetics = {
    composition: CANVAS_WORDS[s.canvas] ?? CANVAS_WORDS.single,
    ...(s.palette?.length && { color_scheme: s.palette.join(", ") }),
    ...(s.meta.length && { mood_atmosphere: s.meta.join(", ") }),
  };
  return { short_description: s.caption.trim(), objects, text_render, aesthetics };
}

/** "At the top left", "In the center", "Across the bottom", "Filling the frame". */
function placePhrase(loc: string): string {
  if (/^(across|down|filling)/.test(loc)) return loc[0].toUpperCase() + loc.slice(1);
  return loc === "center" ? "In the center" : `At the ${loc}`;
}

/** The layout as plain sentences, for models that read neither boxes nor location fields. */
export function compileWords(draft: LayoutDraft): string {
  const s = draft.summary;
  const parts = [sentence(s.caption)];
  if (draft.items.length && s.canvas !== "single") parts.push(sentence(`Laid out as ${CANVAS_WORDS[s.canvas]}`));
  for (const it of draft.items) parts.push(sentence(`${placePhrase(locationWords(it.box))}: ${itemWords(it)}`));
  if (s.meta.length) parts.push(sentence(`Style: ${s.meta.join(", ")}`));
  if (s.palette?.length) parts.push(sentence(`Color palette: ${s.palette.join(", ")}`));
  return parts.filter(Boolean).join(" ");
}

export interface CompiledLayout {
  format: LayoutFormat | "words";
  /** The prompt the model gets. */
  prompt: string;
  /** Bria FIBO 2's structured prompt, sent beside the words. */
  vgl?: VglPrompt;
}

/** True when the model places boxes by their coordinates (MOSS-Image, FLUX.3, Ideogram 4.x). */
/** Which of a layout's summary settings the model's layout form reads: the canvas type (single, panels, collage) and the style tags. */
export function layoutReads(model: { options?: { layout?: LayoutFormat } } | undefined): { canvas: boolean; tags: boolean } {
  const f = model?.options?.layout;
  return { canvas: f !== "flux3" && f !== "ideogram", tags: f !== "flux3" };
}

export const readsBoxes = (model: { options?: { layout?: LayoutFormat } } | undefined): boolean => !!model?.options?.layout && BOX_READING_FORMATS.includes(model.options.layout);

/** The compiler a model reads layouts with (ModelOptions.layout), plain sentences for the rest. */
export function layoutCompilerFor(model: { options?: { layout?: LayoutFormat } } | undefined): (draft: LayoutDraft, width: number, height: number) => CompiledLayout {
  switch (model?.options?.layout) {
    case "moss":
      return (d, w, h) => ({ format: "moss", prompt: compileMoss(d, w, h) });
    case "flux3":
      return (d) => ({ format: "flux3", prompt: compileFlux3(d) });
    case "ideogram":
      return (d) => ({ format: "ideogram", prompt: compileIdeogram(d) });
    case "vgl":
      return (d) => ({ format: "vgl", prompt: compileWords(d), vgl: compileVgl(d) });
    default:
      return (d) => ({ format: "words", prompt: compileWords(d) });
  }
}

/** True when a request's params.extra carries a layout draft (an API's own prompt expansion would rewrite it). */
export const carriesLayout = (extra: Record<string, unknown> | undefined): boolean => isObj(extra?.[LAYOUT_PARAM]);

/**
 * True when a request's layout draft places at least one box. FLUX 3 Image Klein's Prompt helper (BFL's upsampler on your GPU,
 * fal's prompt expansion in the cloud) is overridden only then: an empty draft's prompt is the caption alone (compileFlux3).
 */
export const carriesBoxes = (extra: Record<string, unknown> | undefined): boolean => {
  const layout = extra?.[LAYOUT_PARAM];
  return isObj(layout) && Array.isArray(layout.items) && layout.items.length > 0;
};
