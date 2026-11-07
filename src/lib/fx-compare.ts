/**
 * Fuobe FX's before/after cards, as data and pure helpers (no DOM), so the card component (components/fx/fx-compare.tsx),
 * the server's page and menu, and the tests share them. An item's pair files are in public/previews/fx/<id>/
 * (fx-pairs.generated.ts says what each holds); an item without a pair keeps its own cover.
 */
import { FX_PAIRS, fxPairSrc, type FxPair } from "./fx-pairs.generated";

/** An item's pair as a card takes it (serializable: the page and the menu file carry it). */
export interface FxView extends FxPair {
  id: string;
}

/** The pair a card shows for an FX item, or undefined: it keeps its own cover. */
export function fxView(id: string): FxView | undefined {
  const p = FX_PAIRS[id];
  return p ? { id, ...p } : undefined;
}

/** Where the divider rests: the before on the left 35 %, the after on the right 65 %. */
export const FX_REST = 35;

/** How far one arrow key moves the divider (Shift: a bigger step). */
export const FX_STEP = 5;
export const FX_BIG_STEP = 25;

export const clampPos = (n: number) => Math.min(100, Math.max(0, n));

/** The divider's place (0 to 100) under a pointer at clientX in a box from `left`, `width` wide. */
export function posAt(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return FX_REST;
  return clampPos(((clientX - left) / width) * 100);
}

/** Where an arrow key moves the divider from `pos`; null for any other key (it keeps its usual job). */
export function keyPos(pos: number, key: string, shift = false): number | null {
  const step = shift ? FX_BIG_STEP : FX_STEP;
  if (key === "ArrowLeft") return clampPos(pos - step);
  if (key === "ArrowRight") return clampPos(pos + step);
  return null;
}

/**
 * What a card shows: at rest (the split, frame 1, the box outlined), or after a tap on a touch screen "after" (the whole
 * after; the flipbook playing; the outside dimmed; the loupe out) and then "before", each tap the other.
 */
export type FxShow = "rest" | "after" | "before";

export const nextShow = (s: FxShow): FxShow => (s === "after" ? "before" : "after");

/** The divider's place for what is shown: the split at rest, all after (0) or all before (100). */
export const showPos = (s: FxShow, rest = FX_REST) => (s === "after" ? 0 : s === "before" ? 100 : rest);

/** Whether a card's divider follows the pointer: a mouse, and motion allowed. A finger taps; reduced motion stays still. */
export const followsPointer = (pointerType: string, reduced: boolean) => pointerType === "mouse" && !reduced;

/** Whether a tap toggles the card instead of opening its page: a touch screen's finger or pen. */
export const tapToggles = (pointerType: string) => pointerType === "touch" || pointerType === "pen";

/** A side's files: AVIF and WebP srcsets (480 and 960 px wide), and the 480 px WebP as the fallback src. */
export interface FxSources {
  avif: string;
  webp: string;
  src: string;
}

export function fxSources(v: FxView, side: "before" | "after"): FxSources {
  const at = (f: string) => fxPairSrc(v.id, f)!;
  return {
    avif: `${at(`${side}.480.avif`)} 480w, ${at(`${side}.960.avif`)} 960w`,
    webp: `${at(`${side}.480.webp`)} 480w, ${at(`${side}.960.webp`)} 960w`,
    src: at(`${side}.480.webp`),
  };
}

/** Reframe's 16:9 still (WebP only). */
export function fxWideSources(v: FxView): { webp: string; src: string } {
  const at = (f: string) => fxPairSrc(v.id, f)!;
  return { webp: `${at("wide.480.webp")} 480w, ${at("wide.960.webp")} 960w`, src: at("wide.480.webp") };
}

/** The loupe's detail of one side: 240 px, and 480 px for a 2x screen. */
export function fxLoupeSources(v: FxView, side: "before" | "after"): { srcSet: string; src: string } {
  const at = (f: string) => fxPairSrc(v.id, f)!;
  return { srcSet: `${at(`${side}.loupe.webp`)} 240w, ${at(`${side}.loupe2x.webp`)} 480w`, src: at(`${side}.loupe.webp`) };
}

/** The flipbook's sprite: the output's frames side by side, 480x360 each. */
export const fxStripSrc = (v: FxView) => fxPairSrc(v.id, "strip.webp")!;

/** How many frames a strip has (6 unless it says). */
export const stripFrames = (v: FxView) => v.frames ?? 6;

/** A frame of the strip as the sprite's shift (a fraction of its own width, so a CSS translateX percentage). */
export const stripShift = (frame: number, frames: number) => -(Math.min(Math.max(0, Math.round(frame)), frames - 1) / frames) * 100;

/** The files a card loads at rest, before anyone points at it (what the menu's first open costs). */
export function restFiles(v: FxView): string[] {
  if (v.kind === "reframe") return ["wide.480.webp"];
  if (v.kind === "strip") return ["before.480.avif"];
  return ["before.480.avif", "after.480.avif"];
}

/** The files a card loads only once it is pointed at or tapped (the loupe's details, the flipbook's sprite). */
export function hoverFiles(v: FxView): string[] {
  if (v.kind === "loupe") return ["before.loupe.webp", "after.loupe.webp"];
  if (v.kind === "strip") return ["strip.webp"];
  return [];
}

/**
 * Reframe's layout as CSS variables: the crop's box (percent of the wide still) and its centre (fractions), which the
 * stylesheet uses to fill a card of any shape with the still and keep the box in view, centred where it can be.
 */
export function reframeVars(rect: readonly [number, number, number, number] | undefined): Record<string, string> {
  const [x, y, w, h] = rect ?? [0.34, 0, 0.32, 1];
  const pct = (n: number) => `${Math.round(n * 1000000) / 10000}%`;
  const frac = (n: number) => String(Math.round(n * 10000) / 10000);
  return { "--fxc-rx": pct(x), "--fxc-ry": pct(y), "--fxc-rw": pct(w), "--fxc-rh": pct(h), "--fxc-cx": frac(x + w / 2), "--fxc-cy": frac(y + h / 2) };
}

/** The loupe's lens and its detail (CSS px): the detail is twice the lens, panned with the pointer. */
export const LENS = 104;
export const LENS_DETAIL = LENS * 2;

/** Where the lens sits after a tap (no pointer to follow): over the loupe's own place in the frame, in px of a w x h card. */
export function lensHome(loupe: readonly [number, number, number, number] | undefined, w: number, h: number): [number, number] {
  const [x, y, lw, lh] = loupe ?? [0.4, 0.4, 0.2, 0.2];
  return [Math.round((x + lw / 2) * w), Math.round((y + lh / 2) * h)];
}

/** The loupe's detail panned with the pointer: its shift (px) so the pointer's place in the card is that place in the detail. */
export function loupePan(u: number, v: number, detail: number, lens: number): [number, number] {
  const k = Math.max(0, detail - lens);
  const c = (n: number) => Math.min(1, Math.max(0, n));
  return [-Math.round(c(u) * k), -Math.round(c(v) * k)];
}
