/**
 * The recorded live edit session that guests, Home and the Apps card see (public/previews/live-edit/demo.json), and
 * the pure parts of its player: how long each step takes, where a paused loop picks up again, which frames are the
 * before and after, where the camera sits when it zooms in on a change, and which kept steps the trail shows. The
 * player itself is src/components/live/live-demo.tsx.
 */

export const LIVE_DEMO = "/previews/live-edit/demo.json";
/**
 * The file's content version: the first 8 hex digits of the SHA-256 of demo.json (line endings as \n). The player
 * fetches the file with it (?v=), so a new session reaches returning visitors at once; a test keeps it in step.
 */
export const LIVE_DEMO_V = "61b6e096";

/** A trail chip's label stays readable on a phone: the longer instruction is the typed text. */
export const CHIP_MAX = 18;
/** The Keep button's pulse, before the step joins the trail. */
export const KEEP_PULSE_MS = 380;
/** A typed character never goes faster than this. */
export const TYPE_MIN_CHAR_MS = 28;
/** A space waits a little longer, the way people type. */
export const TYPE_SPACE_MS = 40;
/** The picture fades in over the last one; at the loop's restart it fades back to the original more slowly. */
export const FADE_MS = 140;
export const REWIND_MS = 320;
/** One full round stays short enough to watch to the end. */
export const LOOP_MAX_MS = 45_000;
/** A live frame is drawn across the picture, left to right, in this long. */
export const SWEEP_MS = 520;
/** The camera glides in on the area a step changes, and back out, in this long. */
export const ZOOM_MS = 700;
/** It never comes closer than this, so a live frame stays crisp enough to read. */
export const ZOOM_MAX = 1.7;
/** Room left around the changed area, as a share of its size on each side. */
export const ZOOM_PAD = 0.12;

export interface DemoFrame {
  /** 960 px wide. It may end in ?v= and the first 8 hex digits of the file's SHA-256, so a new file is never served from cache. */
  src: string;
  /** 512 px wide, for the small card. */
  small?: string;
}

/** An area of the picture, as shares of its width and height: [left, top, right, bottom]. */
export type Box = [number, number, number, number];

export type DemoStep =
  /** live: a live frame (the pill says Live); it is drawn across the picture rather than faded in. */
  | { type: "frame"; frame: string; live?: boolean; ms: number }
  | { type: "type"; text: string; ms: number }
  | { type: "keep"; label: string; ms: number }
  /** from/to: the frames to compare (the script's first and last frames when left out). */
  | { type: "compare"; ms: number; from?: string; to?: string }
  | { type: "pause"; ms: number }
  /**
   * The camera glides in on the area the step changes (box), or back out to the whole picture (null). The glide takes
   * ZOOM_MS whatever `ms` is; `ms` is how long the script waits before its next step (0 lets the next one start at once).
   */
  | { type: "zoom"; box: Box | null; ms: number };

export interface Demo {
  v?: number;
  size: [number, number];
  frames: Record<string, DemoFrame>;
  script: DemoStep[];
}

/** Each character's wait, so a type step takes its `ms` (or longer, when that would mean typing too fast). */
export function typeDelays(text: string, ms: number): number[] {
  const chars = [...text];
  if (!chars.length) return [];
  const spaces = chars.filter((c) => c === " ").length;
  const per = Math.max(TYPE_MIN_CHAR_MS, Math.floor((ms - spaces * TYPE_SPACE_MS) / chars.length));
  return chars.map((c) => per + (c === " " ? TYPE_SPACE_MS : 0));
}

export function stepMs(s: DemoStep): number {
  if (s.type === "type") return typeDelays(s.text, s.ms).reduce((a, b) => a + b, 0);
  if (s.type === "keep") return Math.max(KEEP_PULSE_MS, s.ms);
  return s.ms;
}

/** One round of the loop. */
export const loopMs = (d: Pick<Demo, "script">) => d.script.reduce((a, s) => a + stepMs(s), 0);

/** The original and the final picture: the compare step's, or the script's first and last frames. */
export function demoEnds(d: Demo): { before: string; after: string } {
  const shown = d.script.flatMap((s) => (s.type === "frame" ? [s.frame] : []));
  const keys = Object.keys(d.frames);
  const cmp = d.script.find((s) => s.type === "compare");
  return {
    before: (cmp?.type === "compare" && cmp.from) || shown[0] || keys[0],
    after: (cmp?.type === "compare" && cmp.to) || shown.at(-1) || keys.at(-1) || keys[0],
  };
}

/** The frame ids in the order the script shows them, each once. */
export const frameOrder = (d: Pick<Demo, "script">) => [...new Set(d.script.flatMap((s) => (s.type === "frame" ? [s.frame] : [])))];

export interface DemoView {
  frame: string;
  /** The frame under it, fading out. */
  under: string | null;
  /** How long the frame on top fades in; 0 shows it at once (a loop picking up again). */
  fade: number;
  /** The frame on top is drawn across the picture (a live frame) rather than faded in. */
  sweep: boolean;
  typed: string;
  steps: string[];
  keepPulse: boolean;
  compare: number | null;
  pill: "Live" | "Kept ✓";
  /** The area the camera is on; null is the whole picture. */
  zoom: Box | null;
}

export const startView = (frame: string, under: string | null = null): DemoView => ({
  frame,
  under,
  fade: under ? REWIND_MS : FADE_MS,
  sweep: false,
  typed: "",
  steps: [],
  keepPulse: false,
  compare: null,
  pill: "Live",
  zoom: null,
});

/**
 * The view just before script step `at` runs: where a loop paused off screen picks up again. Its picture is shown at
 * once, with no fade from the dark background behind it.
 */
export function viewBefore(d: Demo, at: number): DemoView {
  const v = { ...startView(demoEnds(d).before), fade: 0 };
  for (const s of d.script.slice(0, at)) {
    if (s.type === "frame") Object.assign(v, { frame: s.frame, sweep: false, ...(s.live ? { pill: "Live" } : {}) });
    else if (s.type === "type") v.typed += s.text;
    else if (s.type === "keep") Object.assign(v, { typed: "", steps: [...v.steps, s.label], pill: "Kept ✓" });
    else if (s.type === "zoom") v.zoom = s.box;
  }
  return v;
}

/**
 * Where the camera sits to show `box` large: a scale and a shift, both as shares of the picture, for
 * `translate(x, y) scale(s)` from the top-left corner. The area is centred where it can be; the picture always fills
 * the frame, and the camera never comes closer than ZOOM_MAX. An area that already fills most of the picture keeps
 * the whole picture.
 */
export function cameraFor(box: Box | null, max = ZOOM_MAX): { s: number; x: number; y: number } {
  if (!box) return { s: 1, x: 0, y: 0 };
  const [l, t, r, b] = box;
  const w = (r - l) * (1 + 2 * ZOOM_PAD);
  const h = (b - t) * (1 + 2 * ZOOM_PAD);
  const fit = Math.min(max, 1 / Math.max(w, 1e-3), 1 / Math.max(h, 1e-3));
  if (fit < 1.15) return { s: 1, x: 0, y: 0 };
  const s = Math.round(fit * 100) / 100;
  const shift = (c: number) => Math.min(0, Math.max(1 - s, 0.5 - s * c));
  return { s, x: shift((l + r) / 2), y: shift((t + b) / 2) };
}

/**
 * Where a live frame's sweep starts and ends, so its soft edge crosses exactly the part of the picture the camera
 * shows. The new frame is masked by a gradient 2.5 picture-widths wide (opaque to 46 %, clear from 54 %, see
 * live-sweep in globals.css); `from`/`to` are its mask-position (%), and `scanFrom`/`scanTo` where the bright line
 * riding the edge goes (% of the picture's width). The edge starts just left of the view and ends just right of it.
 */
export function sweepPath(cam: { s: number; x: number }) {
  const M = 2.5;
  const half = ((0.54 - 0.46) / 2) * M;
  const centre = 0.5 * M;
  const left = -cam.x / cam.s - half;
  const right = (1 - cam.x) / cam.s + half;
  const pos = (c: number) => Math.round(((centre - c) / (M - 1)) * 1000) / 10;
  const pct = (c: number) => Math.round(c * 1000) / 10;
  return { from: pos(left), to: pos(right), scanFrom: pct(left), scanTo: pct(right) };
}

const isBox = (b: unknown): b is Box =>
  Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number" && n >= 0 && n <= 1) && b[0] < b[2] && b[1] < b[3];

/** The pill's words: compact cards add the step count after a keep. */
export function pillText(v: Pick<DemoView, "pill" | "steps">, compact = false) {
  const count = compact && v.pill === "Kept ✓" && v.steps.length > 1 ? String(v.steps.length) : null;
  return { main: v.pill, count };
}

/** A frame's file, without the ?v= content version. */
export const framePath = (src: string) => src.split("?")[0];

/** The trail: Original, how many earlier steps are folded away, then the newest `keep` steps (numbered from 1). */
export function trailWindow(steps: readonly string[], keep: number) {
  const from = Math.max(0, steps.length - keep);
  return { hidden: from, shown: steps.slice(from).map((label, i) => ({ n: from + i + 1, label })) };
}

export const stepsWord = (n: number) => `${n} ${n === 1 ? "step" : "steps"}`;

/** What is wrong with a demo file, in words; empty when it plays. `exists` checks that a frame's file is there. */
export function demoProblems(d: Demo, exists?: (src: string) => boolean): string[] {
  const out: string[] = [];
  if (!Array.isArray(d.size) || d.size.length !== 2 || d.size.some((n) => !(n > 0))) out.push("size must be [width, height]");
  const ids = Object.keys(d.frames ?? {});
  if (!ids.length) out.push("no frames");
  for (const [id, f] of Object.entries(d.frames ?? {})) {
    for (const src of [f.src, f.small].filter(Boolean) as string[]) {
      if (!src.startsWith("/previews/")) out.push(`frame ${id}: ${src} is not under /previews/`);
      else if (exists && !exists(framePath(src))) out.push(`frame ${id}: ${src} is missing`);
    }
  }
  if (!d.script?.length) return [...out, "no script"];
  if (d.script[0].type !== "frame") out.push("the script must start with a frame");
  const used = new Set<string>();
  d.script.forEach((s, i) => {
    if (s.type === "zoom") {
      if (!(Number.isFinite(s.ms) && s.ms >= 0)) out.push(`step ${i}: ms must be 0 or more`);
      if (s.box !== null && !isBox(s.box)) out.push(`step ${i}: a zoom box is [left, top, right, bottom], each 0 to 1`);
      return;
    }
    if (!(Number.isFinite(s.ms) && s.ms > 0)) out.push(`step ${i}: ms must be positive`);
    if (s.type === "frame") {
      if (s.live && s.ms < SWEEP_MS) out.push(`step ${i}: a live frame shows for at least ${SWEEP_MS} ms`);
      used.add(s.frame);
      if (!d.frames[s.frame]) out.push(`step ${i}: no frame ${s.frame}`);
    } else if (s.type === "type") {
      if (!s.text) out.push(`step ${i}: nothing to type`);
    } else if (s.type === "keep") {
      if (!s.label || s.label.length > CHIP_MAX) out.push(`step ${i}: a keep label is 1 to ${CHIP_MAX} characters`);
      if (s.ms < KEEP_PULSE_MS) out.push(`step ${i}: a keep lasts at least ${KEEP_PULSE_MS} ms`);
    } else if (s.type === "compare") {
      for (const f of [s.from, s.to]) if (f && !d.frames[f]) out.push(`step ${i}: no frame ${f}`);
    } else if (s.type !== "pause") out.push(`step ${i}: unknown step`);
  });
  for (const id of ids) if (!used.has(id)) out.push(`frame ${id} is never shown`);
  if (loopMs(d) > LOOP_MAX_MS) out.push(`one round takes ${loopMs(d)} ms, over ${LOOP_MAX_MS}`);
  return out;
}
