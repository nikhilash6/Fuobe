/**
 * The poster kit (pure): what the Kinetic templates are built from. A template is a poster that moves: one voice (a
 * type pairing), a palette from the brand kit, a field that is never flat (gradient, light, photography, texture,
 * grain), huge type set to fill its box and moved letter by letter with the text presets, tiny facts on the grid's
 * corners, one overlay, and depth. Layers are drawn bottom to top (fx/stack.ts) so a camera move parallaxes them and
 * each pushes in at its own rate; grain sits under the readable type and the last frame is the poster.
 *
 * Every typed word is set exactly as typed (type/glyphs.ts). A field that doesn't fit at its smallest size is named in
 * `overflow` and nothing renders. Readable copy stays inside the safe area of where the piece is shown (grid.ts);
 * only fields, shapes, photos and decorative ghost copies (text nodes marked `decor`) bleed.
 */

import { about, group, multiply, translate, type Box, type DisplayList, type DisplayNode, type Paint, type TextNode, type TextRun } from "../../display";
import type { CurveName } from "../../ease";
import { curve } from "../../ease";
import { chroma, contrastOf, ensureContrast, fieldStops, kineticPalette, mixOk, okStops, withLightness, toLab, type KineticPalette, type Look } from "../../color";
import { bokeh as bokehField, meshGradient, nightGround, orbGlow, pool, rgba } from "../../fx/background";
import { flash as flashNode, grain, vignette } from "../../fx/finish";
import { pillBox } from "../../fx/materials";
import { arrow, pillTag } from "../../fx/overlays";
import { stack, type Layer } from "../../fx/stack";
import { twoShadow } from "../../fx/depth";
import { gridFor, placementOf, type Grid, type Placement } from "../../grid";
import type { Recipe } from "../../recipe";
import type { Scene, SceneInput, ScenePlan } from "../../scene";
import { designSize, tileCover } from "../../sizes";
import { frameCount } from "../../time";
import { DURATION_LIMITS, linearProgress, progress, timeline, type EventKind, type MotionEvent, type StaggerUnit, type Timeline } from "../../tween";
import { extraCamera, kineticTiming } from "../../edit";
import { finishAt } from "../../finish";
import { clipLayer, clipNodes, CLIP_GROUND } from "../../video-layer";
import { drawType, planType, type TextMotion, type TypePlan, type TypeStyle } from "../../type/animate";
import { fontOf } from "../../type/faces";
import { setType, type BoxMeasure, type TypeSet, type TypeSpec } from "../../type/glyphs";
import { PAIRINGS, type Pairing, type PairingId, type RoleFace } from "../../type/pairings";
import { PRESETS, type PresetId } from "../../type/presets";
import { logoNode, sampleMark } from "./kit";

export type Role = "hero" | "accent" | "meta" | "body" | "figures";

export interface SetOptions {
  role: Role;
  x: number;
  y: number;
  width: number;
  maxLines: number;
  max: number;
  min: number;
  align?: "left" | "centre" | "right";
  /** The preset it enters with (its widest state is what has to fit). */
  preset?: PresetId;
  family?: string;
  weight?: number;
  style?: "normal" | "italic";
  tracking?: number;
  leading?: number;
  tabular?: boolean;
  /** Even lines (see layoutText). */
  even?: number;
  /** The narrowest a word space may look (em); by size and style when absent. */
  wordSpace?: number;
}

export interface PosterContext {
  recipe: Recipe;
  input: SceneInput;
  measure: BoxMeasure;
  design: { w: number; h: number };
  /** The short side (1080). */
  S: number;
  grid: Grid;
  /** Where readable copy may go. */
  safe: Box;
  placement: Placement;
  cover: boolean;
  pairing: Pairing;
  pal: KineticPalette;
  look: Look;
  dark: boolean;
  /** Text presets' speed: calm 0.85, punchy 1.15. */
  speed: number;
  /** How far apart a scene's beats are for the clip's length (1 at its own timing for `base` seconds). */
  spread(base: number, hi?: number): number;
  /** Everything is set by then (the last second holds). */
  room: number;
  duration: number;
  /** The last frame's time. */
  last: number;
  seed: number;
  wide: boolean;
  tall: boolean;
  /** A typed field (trimmed), or the fallback. */
  field(key: string, fallback?: string): string;
  /** Lay out a field in the pairing's face for a role (null when it is empty). */
  set(field: string, text: string, o: SetOptions): TypeSet | null;
  /** Plan a type set's motion; its events join the timeline. */
  move(set: TypeSet, motion: TextMotion, id?: string): TypePlan;
  /** Add an event (its length held to its kind's limits). */
  ev(id: string, kind: EventKind, start: number, dur: number, c: CurveName, g?: { group: string; unit: StaggerUnit }): void;
}

export interface DrawKit {
  /** An event's eased and plain progress. */
  P(id: string): number;
  L(id: string): number;
  /** A planned type set at this time, in a style (its stomp nudges and flashes are kept for the frame). */
  type(plan: TypePlan, style: TypeStyle): DisplayNode[];
}

export interface PosterBuilt {
  overflow: string[];
  /** The frame's layers at `t`. */
  draw(t: number, k: DrawKit): Layer[];
  /** The camera's pan at the hero's plane (design units); home (0, 0) on the last frame. */
  camera?: (t: number) => { x: number; y: number };
  /** The subject goes in front of the hero type (the magazine cover). */
  sandwich?: boolean;
  /** Layers push in over the clip (default on). */
  push?: boolean;
  signature?: number;
  cuts?: number[];
  /** Grain amount (default by the ground), or none. */
  grain?: number | false;
  /** Vignette strength (default 0.14), or none. */
  vignette?: number | false;
  /** The list's background (the ground by default). */
  background?: string;
}

export interface PosterDef {
  id: string;
  name: string;
  pairing: PairingId;
  look?: Look;
  durations?: { min: number; max: number; default: number };
  build(c: PosterContext): PosterBuilt;
}

export const POSTER_DURATIONS = { min: 5, max: 8, default: 5 } as const;

/** How long a tile cover's clip holds and dissolves its finished poster before the opening plays (seconds). */
export const COVER_LEAD = 0.45;

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** The face a role is set in (the pairing's). */
export const faceOf = (p: Pairing, role: Role): RoleFace => (role === "accent" ? (p.accent ?? p.hero) : p[role]);

/** The Kinetic families a pairing draws with (for loading). */
export function pairingFamilies(id: PairingId): string[] {
  const p = PAIRINGS[id];
  return [...new Set([p.hero, p.accent, p.meta, p.body, p.figures].filter((f): f is RoleFace => !!f).map((f) => f.family))];
}

/** The person picked their own brand fonts over the template's type pairing (`controls.type` "brand"). */
export const brandType = (r: Pick<Recipe, "controls">): boolean => r.controls?.type === "brand";

/**
 * A pairing in the brand's own fonts: the heading font for the hero, its accent and the figures (heavy, upright), the
 * body font for the corner facts and copy; the template's leading and tracking kept where they suit any face.
 */
export function brandPairing(p: Pairing, fonts: { heading?: string; body?: string }): Pairing {
  const heading = fonts.heading?.trim() || fonts.body?.trim();
  const body = fonts.body?.trim() || heading;
  if (!heading || !body) return p;
  const big = (f: RoleFace, weight: number): RoleFace => ({ family: heading, weight, style: "normal", leading: Math.max(0.95, f.leading), tracking: Math.min(0, f.tracking) });
  return {
    ...p,
    hero: big(p.hero, 800),
    accent: p.accent ? big(p.accent, 700) : null,
    figures: big(p.figures, 800),
    meta: { ...p.meta, family: body, weight: 500, style: "normal" },
    body: { ...p.body, family: body, weight: 400, style: "normal" },
  };
}

export function posterScene(def: PosterDef): Scene {
  return {
    id: def.id,
    name: def.name,
    durations: def.durations ?? POSTER_DURATIONS,
    pairing: def.pairing,
    sizes: ["9:16", "1:1", "16:9", "4:5"],
    plan(input: SceneInput): ScenePlan {
      const recipe = input.recipe;
      const design = designSize(recipe.size);
      const S = Math.min(design.w, design.h);
      const placement = placementOf(recipe);
      const grid = gridFor(design, placement);
      const look = (["light", "dark", "brand"] as const).find((l) => l === recipe.controls?.look) ?? def.look ?? "light";
      const pal = kineticPalette(recipe.brand.colors, look);
      const last = (frameCount(recipe.duration, recipe.fps) - 1) / recipe.fps;
      // Kinetic's Pro pace wins over the Easy choice.
      const pace = recipe.motion?.pace ?? (recipe.controls?.pace === "calm" ? 1.2 : recipe.controls?.pace === "punchy" ? 0.85 : 1);
      const room = Math.max(1.5, recipe.duration - 1.3);
      const events: MotionEvent[] = [];
      const plans: TypePlan[] = [];
      const planEvents = new Map<TypePlan, [number, number]>();
      const pairing = brandType(recipe) ? brandPairing(PAIRINGS[def.pairing], recipe.brand.fonts) : PAIRINGS[def.pairing];
      const measure = input.measure as BoxMeasure;
      const ctx: PosterContext = {
        recipe,
        input,
        measure,
        design,
        S,
        grid,
        safe: grid.safe,
        placement,
        cover: placement === "cover",
        pairing,
        pal,
        look,
        dark: toLab(pal.ground).L < 0.5,
        speed: pace > 1 ? 0.85 : pace < 1 ? 1.15 : 1,
        spread: (base, hi = 2) => Math.max(0.9, Math.min(hi, (room / base) * pace, room / base)),
        room,
        duration: recipe.duration,
        last,
        seed: recipe.seed,
        wide: design.w / design.h > 1.2,
        tall: design.h / design.w > 1.5,
        field: (key, fallback = "") => (recipe.fields[key] ?? fallback).trim(),
        set(field, text, o) {
          if (!text.trim()) return null;
          const f = faceOf(pairing, o.role);
          const brand = o.family !== undefined;
          const spec: TypeSpec = {
            field,
            text,
            family: o.family ?? f.family,
            weight: o.weight ?? (brand ? 700 : f.weight),
            style: o.style ?? (brand ? "normal" : f.style),
            max: o.max,
            min: Math.min(o.min, o.max),
            x: o.x,
            y: o.y,
            width: o.width,
            maxLines: o.maxLines,
            leading: o.leading ?? f.leading,
            tracking: o.tracking ?? f.tracking,
            align: o.align ?? "left",
            ...(o.preset && PRESETS[o.preset].widest && { widest: PRESETS[o.preset].widest }),
            ...(o.tabular && { tabular: true }),
            even: o.even ?? 0.5,
            ...(o.wordSpace !== undefined && { wordSpace: o.wordSpace }),
          };
          return setType(spec, measure);
        },
        move(set, motion, id) {
          const plan = planType(id ?? set.field, set, { seed: recipe.seed, speed: Math.min(1.4, Math.max(0.7, (motion.speed ?? 1) * ctx.speed)), dark: ctx.dark, loopUntil: last - 0.1, ...motion }, design);
          plans.push(plan);
          planEvents.set(plan, [events.length, events.length + plan.events.length]);
          events.push(...plan.events);
          return plan;
        },
        ev(id, kind, start, dur, c, g) {
          const [lo, hi] = DURATION_LIMITS[kind];
          events.push({ id, kind, start: round6(start), dur: round6(Math.min(hi, Math.max(lo, dur))), curve: c, ...(g && { group: g.group, unit: g.unit }) });
        },
      };
      const built = def.build(ctx);
      // Kinetic's editor: retimed groups, the motion feel and the camera's clock (the scene as designed without them).
      const timing = kineticTiming(recipe, def.id, events, built.cuts ?? [], last);
      const tl: Timeline = timeline(timing.events, timing.curves);
      const settled = Math.min(last, timing.events.filter((e) => e.kind !== "camera").reduce((m, e) => Math.max(m, e.start + e.dur), 0));
      const P = (t: number) => (id: string) => progress(tl, id, t);
      const Lp = (t: number) => (id: string) => linearProgress(tl, id, t);
      // A type set's own clock: a retimed group moves its letters with it (the set's span mapped onto its new span).
      const clocks = new Map<TypePlan, (t: number) => number>();
      for (const [plan, [a, b]] of planEvents) {
        if (timing.events === events || !timing.events.slice(a, b).some((e, i) => e !== events[a + i])) continue;
        const o = events.slice(a, b);
        const n = timing.events.slice(a, b);
        const oA = Math.min(...o.map((e) => e.start));
        const oB = Math.max(...o.map((e) => e.start + e.dur));
        const nA = Math.min(...n.map((e) => e.start));
        const nB = Math.max(...n.map((e) => e.start + e.dur));
        const warp = n.find((e) => e.warp)?.warp;
        // After its span the set's clock eases back onto the film's, so its loops and the last frame are as designed.
        const tail = (t: number) => (last > nB ? t + (oB - nB) * Math.max(0, 1 - (t - nB) / (last - nB)) : t);
        clocks.set(plan, (t) => (t <= nA ? t - nA + oA : t >= nB ? tail(t) : oA + (warp ?? ((u: number) => u))((t - nA) / Math.max(1e-6, nB - nA)) * (oB - oA)));
      }
      const background = built.background ?? pal.ground;
      const clip = clipLayer(input);
      const unlit = recipe.look?.light === false;
      const locked = recipe.camera?.move === "locked";
      const breath = locked ? 0 : (recipe.camera?.breath ?? 1);
      const extra = extraCamera(recipe, last);
      const cx = design.w / 2;
      const cy = design.h / 2;
      const draw = (t: number, home: boolean): DisplayList => {
        let nudge = { x: 0, y: 0 };
        let flash = 0;
        const tc = timing.clock ? timing.clock(t) : t;
        const kit: DrawKit = {
          P: P(t),
          L: Lp(t),
          type(plan, style) {
            const f = drawType(plan, style, home ? t : (clocks.get(plan)?.(t) ?? t));
            nudge = { x: nudge.x + f.camera.x, y: nudge.y + f.camera.y };
            flash = Math.max(flash, f.flash);
            return f.nodes;
          },
        };
        let layers = built.draw(t, kit);
        // The person's clip takes the place of the field (and its tonal ghost); without ground light the field has no pools of light.
        if (clip) layers = layers.filter((l) => l.role !== "ground" && l.role !== "atmosphere" && l.role !== "ghost");
        else if (unlit) layers = layers.filter((l) => l.role !== "atmosphere");
        // The person's own clip keeps its own picture: no grain or vignette over it (its dim and scrim are the only shade).
        if (built.grain !== false && !clip) layers.push({ role: "grain", nodes: [grain({ w: design.w, h: design.h, seed: recipe.seed, frame: Math.round(t * recipe.fps), dark: ctx.dark, ...(typeof built.grain === "number" && { amount: built.grain }) })] });
        if (built.vignette !== false && !unlit && !clip) layers.push({ role: "finish", nodes: [vignette({ w: design.w, h: design.h, strength: typeof built.vignette === "number" ? built.vignette : 0.14, color: withLightness(pal.ground, 0.08) })] });
        const fl = flashNode(design.w, design.h, flash);
        if (fl) layers.push({ role: "light", nodes: [fl] });
        const cam = home || locked ? { x: 0, y: 0 } : (built.camera?.(tc) ?? { x: 0, y: 0 });
        const camera = { x: cam.x + nudge.x, y: cam.y + nudge.y };
        let nodes = stack(layers, { w: design.w, h: design.h, t: tc, duration: last, camera, sandwich: built.sandwich, push: built.push !== false && breath > 0 });
        // The extra camera (Kinetic's camera tracks and moves) over the whole poster; the last frame keeps its values there.
        const o = extra?.(t, tc, design.w);
        if (o && (o.zoom !== 1 || o.x !== 0 || o.y !== 0 || o.roll !== 0)) nodes = [group(nodes, { id: "camera", transform: multiply(translate(o.x, o.y), about(cx, cy, o.zoom, o.roll)) })];
        else if (!home) nodes = [group(nodes, { id: "camera" })];
        const list: DisplayList = { w: design.w, h: design.h, background: clip ? CLIP_GROUND : background, nodes: [...(clip ? clipNodes(recipe, clip, design, pal.ground, t) : []), ...nodes] };
        const finish = finishAt(recipe, t);
        if (finish) list.finish = finish;
        return list;
      };
      const still = draw(last, true);
      // A gallery tile's clip opens on the finished poster (the tile's still) and dissolves into the opening, so a
      // tile that starts playing never flashes an empty field; the scene then plays a little quicker to the same end.
      const lead = tileCover(recipe) && last > 2 ? COVER_LEAD : 0;
      const evaluate = (t: number): DisplayList => {
        if (t >= last) return still;
        if (!lead) return draw(Math.max(0, t), false);
        const u = Math.max(0, t);
        const scene = draw(u < lead ? 0 : ((u - lead) * last) / (last - lead), false);
        if (u >= lead) return scene;
        const fade = 1 - curve("move")(Math.min(1, Math.max(0, (u - lead * 0.35) / (lead * 0.65))));
        return fade <= 0 ? scene : { ...scene, nodes: [...scene.nodes, group([{ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: still.background }, ...still.nodes], { id: "lead", opacity: fade })] };
      };
      return {
        design,
        timeline: tl,
        rest: last,
        settled,
        ...(built.signature !== undefined && { signature: Math.min(last, built.signature) }),
        cuts: built.cuts ?? [],
        overflow: [...new Set(built.overflow)],
        evaluate,
        still: (t) => t >= last,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Fields (L0–L1)

/** A field of moving colour: the ground, its tonal steps and the accent in soft pools (light added on a dark ground). */
export function meshField(c: PosterContext, t: number, o: { colors?: string[]; amplitude?: number; glow?: string; glowAlpha?: number } = {}): DisplayNode[] {
  const { design, pal } = c;
  const colors = o.colors ?? (c.dark ? [pal.tone2, pal.accent, pal.brand[0], pal.tone1] : [pal.tone1, pal.brand[1], pal.tone2, pal.accent]);
  const nodes: DisplayNode[] = [];
  if (c.dark) nodes.push(...nightGround({ w: design.w, h: design.h, night: pal.ground, glow: o.glow ?? pal.accent, alpha: o.glowAlpha ?? 0.3 }));
  else nodes.push({ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: pal.ground });
  nodes.push(group([meshGradient({ w: design.w, h: design.h, colors, seed: c.seed, t, duration: c.duration, dark: c.dark, amplitude: o.amplitude })], { opacity: c.dark ? 0.55 : 0.7 }));
  return nodes;
}

/**
 * The lit field (§3.2): a two-stop analogous gradient from the look's `fieldStops` (deep brand hue to a lighter turned
 * hue; tinted paper on a light look), one off-axis light (an ellipse 140 % of the width at 25 %) drifting slowly, and
 * visible grain from the poster's finish. `from` is the light's corner.
 */
export function litField(c: PosterContext, t: number, o: { from?: "tl" | "tr" | "bl" | "br"; light?: string; lightAlpha?: number; stops?: { dark: string; light: string } } = {}): DisplayNode[] {
  const { design, pal } = c;
  const { w, h } = design;
  const st = o.stops ?? fieldStops(pal);
  const from = o.from ?? "tr";
  const lx = from === "tl" || from === "bl" ? 0 : w;
  const ly = from === "tl" || from === "tr" ? 0 : h;
  const u = curve("drift")(Math.min(1, t / Math.max(0.01, c.last)));
  const W = Math.max(w, h);
  const lightColor = o.light ?? (c.dark ? mixOk(st.light, "#ffffff", 0.35) : "#ffffff");
  return [
    { type: "rect", x: 0, y: 0, w, h, fill: { kind: "linear", x0: lx, y0: ly, x1: w - lx, y1: h - ly, stops: okStops(st.light, st.dark, 6) } },
    // The off-axis light: an ellipse 140 % of the width, its centre drifting 6 % over the clip.
    { type: "rect", x: 0, y: 0, w, h, fill: pool(lx + (lx ? -1 : 1) * w * (0.12 + 0.06 * u), ly + (ly ? -1 : 1) * h * (0.08 + 0.03 * u), W * 0.7, lightColor, o.lightAlpha ?? 0.25) },
  ];
}

/** Paper: a warm light ground with a soft pool of window light drifting across it (for serif and quiet looks). */
export function paperField(c: PosterContext, t: number, o: { tint?: string; light?: number } = {}): DisplayNode[] {
  const { design, pal } = c;
  const u = curve("drift")(Math.min(1, t / Math.max(0.01, c.last)));
  const W = Math.max(design.w, design.h);
  return [
    { type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: pal.ground },
    { type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: { kind: "linear", x0: 0, y0: 0, x1: design.w * 0.3, y1: design.h, stops: [{ at: 0, color: rgba(o.tint ?? pal.brand[1], 0.1) }, { at: 1, color: rgba(o.tint ?? pal.brand[1], 0) }] } },
    { type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: pool(design.w * (0.25 + 0.2 * u), design.h * (0.18 + 0.06 * u), W * 0.75, "#ffffff", o.light ?? 0.55) },
  ];
}

/** Soft bokeh and an orb of glow behind the hero (dark grounds). */
export function glowAtmosphere(c: PosterContext, t: number, o: { cx: number; cy: number; r: number; color?: string; alpha?: number; bokeh?: number }): DisplayNode[] {
  const nodes: DisplayNode[] = [orbGlow({ cx: o.cx, cy: o.cy, r: o.r, color: o.color ?? c.pal.accent, alpha: o.alpha ?? 0.4 })];
  if (o.bokeh) nodes.push(bokehField({ w: c.design.w, h: c.design.h, count: o.bokeh, colors: [c.pal.accent, c.pal.brand[1]], seed: c.seed, t, duration: c.duration }));
  return nodes;
}

// ---------------------------------------------------------------------------
// Ghost type (L2): a giant tonal copy of the hero, drifting, decorative only

/** The ghost's tone: one step from the ground (OKLab ΔL 0.045 lighter on a dark ground, 0.04 darker on a light one), the ground's own hue. */
export const ghostTone = (ground: string, step = 1): string => {
  const L = toLab(ground).L;
  return withLightness(ground, L < 0.5 ? Math.min(0.95, L + 0.045 * step) : Math.max(0.05, L - 0.04 * step));
};

/**
 * A ghost: the words set huge in the hero face, one run per line from (x, y), filled one tonal step from the ground
 * (`ghostTone`; never a hairline outline), cropped by the frame. It drifts at a steady 2.5 % of the frame's width a second
 * (or `drift` design units over the clip, whichever is more) and arrives at its place on the last frame, so the holds keep
 * moving and the cover rests on a still frame. Decorative: never the readable copy. `color` overrides the tone (a ghost
 * over a photo); `outline` and `alpha` are kept for callers but a ghost is always filled and opaque.
 */
export function ghost(c: PosterContext, o: { field: string; lines: string[]; size: number; x: number; y: number; leading?: number; color?: string; outline?: number; drift?: number; t: number; family?: string; weight?: number; tracking?: number; alpha?: number; align?: "left" | "right" | "centre"; tone?: boolean; ground?: string; dir?: 1 | -1; vertical?: boolean; step?: number }): DisplayNode {
  const f = c.pairing.hero;
  const family = o.family ?? f.family;
  const weight = o.weight ?? f.weight;
  const font = fontOf(family, o.size, weight, f.style);
  const lh = o.size * (o.leading ?? f.leading);
  const color = o.tone === false && o.color ? o.color : ghostTone(o.ground ?? c.pal.ground, o.step);
  let x0 = Infinity;
  let x1 = -Infinity;
  const runs: TextRun[] = o.lines.map((line, i) => {
    const w = c.measure(line, font);
    const x = o.align === "right" ? o.x - w : o.align === "centre" ? o.x - w / 2 : o.x;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x + w);
    return { text: line, gap: i ? " " : "", font, x, y: o.y + i * lh, fill: color };
  });
  const node: TextNode = { type: "text", field: o.field, runs, decor: true };
  // A steady drift that arrives on the last frame.
  const u = c.last > 0 ? Math.min(1, o.t / c.last) : 1;
  const span = Math.max(o.drift ?? 0, 0.025 * c.design.w * c.last);
  const d = (o.dir ?? 1) * span * (1 - u);
  // Drawn once and reused while it drifts (it only moves).
  const pad = o.size * 0.35;
  const bounds = { x: x0 - pad, y: o.y - pad, w: x1 - x0 + 2 * pad, h: (o.lines.length - 1) * lh + o.size + 2 * pad };
  const cache = { key: `ghost|${font}|${o.lines.join("|")}|${color}|${bounds.x.toFixed(1)}|${bounds.y.toFixed(1)}`, bounds };
  return group([node], { id: "ghost", cache, ...(d && { transform: o.vertical ? translate(0, d) : translate(-d, 0) }) });
}

/**
 * A ghost word that spans the frame: one line of the hero's words set so it runs 6 % past both side edges, its cap top
 * at `top` (share of the height) and cropped by the bottom edge, so every letter shows whole across and nothing reads as
 * a cut-off word. It rises 2.5 % of the height a second into place (arriving on the last frame).
 */
export function ghostSpan(c: PosterContext, o: { field: string; text: string; top: number; t: number; ground?: string; family?: string; weight?: number; span?: number; maxSize?: number }): DisplayNode {
  const f = c.pairing.hero;
  const family = o.family ?? f.family;
  const weight = o.weight ?? f.weight;
  const w100 = c.measure(o.text, fontOf(family, 100, weight, f.style));
  const span = o.span ?? 1.12;
  const size = Math.min(o.maxSize ?? Infinity, w100 > 0 ? (100 * c.design.w * span) / w100 : c.S * 0.5);
  const w = (w100 * size) / 100;
  const box = c.measure.box?.(o.text, fontOf(family, size, weight, f.style));
  const capTop = box ? box.top : size * 0.1;
  return ghost(c, { field: o.field, lines: [o.text], size, x: (c.design.w - w) / 2, y: c.design.h * o.top - capTop, t: o.t, family, weight, ground: o.ground, vertical: true, dir: 1, drift: 0.025 * c.design.h * c.last });
}

/** A tone between the ground and the ink (0: the ground, 1: the ink). */
export const toneOf = (pal: KineticPalette, k: number): string => mixOk(pal.ground, pal.ink, k);

/** Quieter words on the ground (still 4.5:1). */
export const metaInk = (pal: KineticPalette): string => ensureContrast(mixOk(pal.ink, pal.ground, 0.25), pal.ground, 4.5);

/** Words on the accent (4.5:1). */
export const onAccentInk = (pal: KineticPalette): string => ensureContrast(pal.onAccent, pal.accent, 4.5);

// ---------------------------------------------------------------------------
// The brand's sign-off

export interface Sign {
  w: number;
  h: number;
  overflow: boolean;
  /** Its nodes with its top-left at (x, y). */
  nodes(x: number, y: number, color: Paint): DisplayNode[];
  /** Its type set when it is the brand's name (for a type preset), else null. */
  set: TypeSet | null;
}

/**
 * The brand: its logo (a lockup at most `maxW` × `h`), else its name in the brand's own heading face (its look is
 * the brand's), sized to fit `maxW` from `h` down to `min`.
 */
export function brandSign(c: PosterContext, o: { maxW: number; h: number; min?: number; x?: number; y?: number; align?: "left" | "centre" | "right" }): Sign | null {
  const logo = c.input.logo;
  if (logo && logo.w > 0 && logo.h > 0) {
    const s = Math.min(o.maxW / logo.w, o.h / logo.h);
    const w = logo.w * s;
    const h = logo.h * s;
    return { w, h, overflow: false, set: null, nodes: (x, y, color) => [logoNode(c, { x, y, w, h }, color)] };
  }
  const name = c.recipe.brand.name.trim();
  if (!name) return null;
  const family = c.recipe.brand.fonts.heading?.trim() || c.pairing.hero.family;
  const set = c.set("brand", name, { role: "hero", family, weight: 700, tracking: 0, leading: 1.1, x: o.x ?? 0, y: o.y ?? 0, width: o.maxW, maxLines: 1, max: o.h * 0.9, min: Math.min(o.h * 0.9, o.min ?? c.S * 0.03), align: o.align });
  if (!set) return null;
  return { w: set.ink.w, h: set.cap.bottom - set.cap.top, overflow: set.overflow, set, nodes: () => [] };
}

// ---------------------------------------------------------------------------
// Corner facts (L8): tiny type on the grid's corners, for scale contrast against the hero

export type Corner = "tl" | "tr" | "bl" | "br";

export interface CornerFact {
  at: Corner;
  /** The field it shows (its words exactly as typed), or "" for a fixed mark such as an index. */
  field: string;
  text: string;
}

export interface CornerFacts {
  overflow: string[];
  /** Where each fact's ink sits (for keeping other things clear of them). */
  boxes: Box[];
  draw(kit: DrawKit, fill: Paint): DisplayNode[];
}

/**
 * Up to four facts on the corners of a box (the safe area by default), in the pairing's meta face: the top ones hang
 * from its top edge, the bottom ones stand on its bottom edge, left ones flush left, right ones flush right. Each
 * types on from `at`, a beat apart. An empty fact is skipped.
 */
export function corners(c: PosterContext, facts: CornerFact[], o: { at: number; size?: number; box?: Box; width?: number }): CornerFacts {
  const box = o.box ?? c.safe;
  const size = o.size ?? c.S * (c.cover ? 0.024 : 0.02);
  const width = o.width ?? box.w * 0.46;
  const sets: { set: TypeSet; plan: TypePlan; mark: boolean }[] = [];
  const overflow: string[] = [];
  facts
    .filter((f) => f.text.trim())
    .forEach((f, i) => {
      const right = f.at === "tr" || f.at === "br";
      const x = right ? box.x + box.w - width : box.x;
      const opts: SetOptions = { role: "meta", x, y: box.y, width, maxLines: 1, max: size, min: Math.max(c.S * 0.017, size * 0.8), align: right ? "right" : "left", preset: "fade-rise" };
      let set = c.set(f.field || `corner.${f.at}`, f.text, opts);
      if (!set) return;
      // Top facts hang their em box from the top edge; bottom ones stand theirs on the bottom edge.
      set = c.set(f.field || `corner.${f.at}`, f.text, { ...opts, max: set.size, min: set.size, y: f.at === "bl" || f.at === "br" ? box.y + box.h - set.size + set.cap.top : box.y + set.cap.top });
      if (!set) return;
      if (set.overflow && f.field) overflow.push(f.field);
      sets.push({ set, mark: !f.field, plan: c.move(set, { in: "fade-rise", at: o.at + i * 0.12, rate: 34 }, `corner.${f.at}`) });
    });
  return {
    overflow,
    boxes: sets.map((s) => s.set.ink),
    // A fixed mark (an index, an arrow) is part of the design, not anyone's words.
    draw: (kit, fill) => sets.flatMap((s) => (s.mark ? asDecor(kit.type(s.plan, { fill })) : kit.type(s.plan, { fill }))),
  };
}

/** Nodes marked decorative (not the typed words). */
export const asDecor = (nodes: readonly DisplayNode[]): DisplayNode[] => nodes.map((n): DisplayNode => (n.type === "text" ? { ...n, decor: true } : n.type === "group" ? { ...n, children: asDecor(n.children) } : n));

/** The two-shadow rule under type or a shape (contact and ambient, tinted to the ground): never a glow on a mid-tone ground. */
export const shadowed = (c: PosterContext, nodes: readonly DisplayNode[], size: number, bounds: Box, key: string, opacity = 1): DisplayNode[] => twoShadow({ nodes, size, ground: c.pal.ground, bounds, key, opacity });

/** Whether a ground is dark enough for light to glow on it (OKLab L under 0.2). */
export const glowsOn = (ground: string): boolean => toLab(ground).L < 0.2;

/** Whether the logo is one of Fuobe's sample marks (drawn in one colour). */
export { sampleMark };

// ---------------------------------------------------------------------------
// Overlays

/** A pill round a set (its ink box), tilted, popping in with `p`. */
export function pillOn(set: TypeSet, content: DisplayNode[], fill: Paint, o: { deg?: number; p?: number; stroke?: { paint: Paint; width: number } } = {}): DisplayNode {
  const ink = { x: set.ink.x, y: set.lines[0].y + set.cap.top, w: set.ink.w, h: set.cap.bottom - set.cap.top };
  return pillTag(pillBox(ink, set.size), fill, content, o);
}

/** A set's cap band (top of the first line's capitals to the last baseline). */
export const capBand = (set: TypeSet): Box => {
  const top = set.lines[0].y + set.cap.top;
  const bottom = set.lines[set.lines.length - 1].baseline;
  return { x: set.ink.x, y: top, w: set.ink.w, h: bottom - top };
};

/** A set's total height from its first cap top to its last baseline. */
export const setHeight = (set: TypeSet): number => capBand(set).h;

/** Shift a set so its first cap top sits at `y` (setType places the em box). */
export function capAt(c: PosterContext, field: string, text: string, o: SetOptions): TypeSet | null {
  const first = c.set(field, text, o);
  if (!first) return null;
  const dy = o.y - (first.lines[0].y + first.cap.top);
  if (Math.abs(dy) < 0.01) return first;
  return c.set(field, text, { ...o, y: o.y + dy });
}

/** A set whose first line follows a typed break or space (a line of a block set line by line, spelled as typed). */
export function withLeadGap(set: TypeSet, gap: string): TypeSet {
  if (!gap) return set;
  const first = set.lines[0];
  return {
    ...set,
    lines: set.lines.map((l, i) => (i ? l : { ...l, gap })),
    words: set.words.map((w, i) => (i ? w : { ...w, gap })),
    glyphs: set.glyphs.map((g, i) => (i || !first.glyphs ? g : { ...g, gap })),
  };
}

export interface LineStack {
  /** One set per line, top to bottom, each fitted to the width on its own. */
  sets: TypeSet[];
  overflow: boolean;
  /** From the first line's cap top to the last line's baseline (ink below the last baseline not counted). */
  band: Box;
  /** The smallest line's size (for the scale of everything round it). */
  size: number;
}

/**
 * Display type set line by line, each line fitted to the width on its own (the poster's justified stack): the words
 * break as one set would break them (balanced, never on a little joining word, best after a clause's comma), then each
 * line takes the largest size at which it fills `fill` of the width, no line more than `ratio` times the smallest. The
 * block shrinks until it fits `room` and sits at `anchor` (0 top, 0.5 middle, 1 bottom) of it. The lines are spelled
 * exactly as typed (the break's space is kept on the next line). Null when the text is empty.
 */
export function fitLines(c: PosterContext, field: string, text: string, o: { role?: Role; x: number; top: number; room: number; width: number; maxLines: number; max: number; min: number; anchor?: number; centre?: number; stack?: boolean; align?: "left" | "centre" | "right"; preset?: PresetId; fill?: number; ratio?: number; gap?: number; family?: string; weight?: number; tracking?: number; leading?: number; style?: "normal" | "italic"; wordSpace?: number }): LineStack | null {
  if (!text.trim()) return null;
  const role = o.role ?? "hero";
  const common = { role, x: o.x, width: o.width, align: o.align ?? "left", ...(o.preset && { preset: o.preset }), ...(o.family && { family: o.family }), ...(o.weight && { weight: o.weight }), ...(o.tracking !== undefined && { tracking: o.tracking }), ...(o.leading && { leading: o.leading }), ...(o.style && { style: o.style }), ...(o.wordSpace !== undefined && { wordSpace: o.wordSpace }) } as const;
  const build = (max: number, top: number): LineStack | null => {
    let base = c.set(field, text, { ...common, y: top, maxLines: o.maxLines, max, min: Math.min(o.min, max) });
    if (!base) return null;
    // A stack wants two lines or more: a text of several words that set on one line breaks as it would in a narrower box.
    for (const narrow of o.stack ? [0.72, 0.58, 0.46] : []) {
      if (base.lines.length > 1 || base.words.length < 2 || base.overflow) break;
      const n = c.set(field, text, { ...common, y: top, width: o.width * narrow, maxLines: o.maxLines, max, min: Math.min(o.min, max) });
      if (n && !n.overflow) base = n;
    }
    if (base.overflow) return { sets: [base], overflow: true, band: capBand(base), size: base.size };
    const fill = o.fill ?? 0.96;
    const lines = base.lines.map((l) => ({ text: l.text, gap: l.gap }));
    // Each line on its own: the largest size (up to `ratio` × the block's) that fills the width.
    const own = lines.map((l) => c.set(field, l.text, { ...common, y: top, width: o.width * fill, maxLines: 1, max: base.size * (o.ratio ?? 1.45), min: base.size })?.size ?? base.size);
    const smallest = Math.min(...own);
    const sizes = own.map((s) => Math.min(s, smallest * (o.ratio ?? 1.45)));
    const sets: TypeSet[] = [];
    let y = top;
    for (let i = 0; i < lines.length; i++) {
      let s = capAt(c, field, lines[i].text, { ...common, y, maxLines: 1, max: sizes[i], min: sizes[i] });
      if (!s) return null;
      const capH = s.cap.bottom - s.cap.top;
      // Ascenders taller than the capitals (b, d, l) never reach into the line above.
      const rise = s.lines[0].y + s.cap.top - s.lines[0].ink.y;
      if (i && rise > capH * 0.02) s = capAt(c, field, lines[i].text, { ...common, y: y + rise, maxLines: 1, max: sizes[i], min: sizes[i] }) ?? s;
      sets.push(i ? withLeadGap(s, lines[i].gap) : s);
      const l = s.lines[0];
      const descends = l.ink.y + l.ink.h > l.baseline + capH * 0.06;
      y = Math.max(l.baseline + capH * (o.gap ?? 0.11), descends ? l.ink.y + l.ink.h + capH * 0.06 : -Infinity);
    }
    const first = sets[0];
    const last = sets[sets.length - 1];
    const top0 = first.lines[0].y + first.cap.top;
    const x0 = Math.min(...sets.map((s) => s.ink.x));
    const x1 = Math.max(...sets.map((s) => s.ink.x + s.ink.w));
    return { sets, overflow: sets.some((s) => s.overflow), band: { x: x0, y: top0, w: x1 - x0, h: last.lines[0].baseline - top0 }, size: Math.min(...sets.map((s) => s.size)) };
  };
  let max = o.max;
  let st = build(max, o.top);
  for (let i = 0; st && !st.overflow && i < 16 && st.band.h > o.room; i++) {
    max *= 0.93;
    st = build(max, o.top);
  }
  if (!st || st.overflow) return st;
  const free = Math.max(0, o.room - st.band.h);
  const y = o.centre !== undefined ? o.top + Math.min(free, Math.max(0, o.centre - st.band.h / 2 - o.top)) : o.top + free * (o.anchor ?? 0.5);
  return Math.abs(y - o.top) < 0.01 ? st : build(max, y);
}

/** A line stack's sets moved together: each line's entrance `each` seconds after the one above. */
export function moveLines(c: PosterContext, st: LineStack, motion: TextMotion, id: string, each = 0.12): TypePlan[] {
  return st.sets.map((s, i) => c.move(s, { ...motion, at: motion.at + i * each, ...(motion.loopAt !== undefined && { loopAt: motion.loopAt + i * 0.12 }) }, `${id}.${i}`));
}

/** When the last of a stack's lines has landed. */
export const stackLanded = (plans: TypePlan[]): number => Math.max(0, ...plans.map((p) => p.settled));

/**
 * The vertical bands of a frame: the top corner row (brand, address) hangs from the safe area's top, the bottom
 * corner row stands on its bottom (the safe line), and the hero lives between, its optical centre near 45 % of the
 * height. `top` and `bottom` are the room left between the rows (after a gap); `centre` the hero's target.
 */
export function bands(c: PosterContext, o: { topRow?: number; bottomRow?: number; gap?: number } = {}): { top: number; bottom: number; centre: number; room: number } {
  const { safe, S, design } = c;
  const gap = o.gap ?? S * 0.05;
  const top = safe.y + (o.topRow ?? S * 0.05) + gap;
  const bottom = safe.y + safe.h - (o.bottomRow ?? S * 0.03) - gap;
  return { top, bottom, centre: design.h * 0.45, room: bottom - top };
}

/**
 * The highlighter's colour: of the kit's colours (and paper / night), the one at least 0.25 OKLab lightness away from
 * the ground that the ink reads best on (3:1 or more), so the bar always shows against the field and the words on it read.
 */
export function markColor(c: PosterContext, ground: string, ink: string): string {
  const { pal } = c;
  const gL = toLab(ground).L;
  const cands = [pal.accent, pal.brand[1], pal.brand[0], pal.paper, pal.night];
  const far = cands.filter((k) => Math.abs(toLab(k).L - gL) >= 0.25 && contrastOf(ink, k) >= 3);
  if (far.length) return far.sort((a, b) => contrastOf(ink, b) + chroma(b) * 4 - (contrastOf(ink, a) + chroma(a) * 4))[0];
  // None qualifies: the accent moved in lightness until it stands 0.25 off the ground.
  return withLightness(pal.accent, gL < 0.5 ? Math.min(0.92, gL + 0.3) : Math.max(0.12, gL - 0.3));
}

/**
 * The bottom corner row: the corner note (field "note") standing on the safe line at the left, and a drawn ↗ index
 * at the right. `rowH` is the room it takes above the safe line.
 */
export function footRow(c: PosterContext, at: number, o: { box?: Box; size?: number; arrow?: boolean } = {}): { overflow: string[]; boxes: Box[]; rowH: number; draw(kit: DrawKit, fill: Paint, mark?: Paint): DisplayNode[] } {
  const box = o.box ?? c.safe;
  const size = o.size ?? c.S * (c.cover ? 0.024 : 0.02);
  const facts = corners(c, [{ at: "bl", field: "note", text: c.field("note") }], { at, size, box, width: box.w * 0.55 });
  c.ev("foot.arrow", "draw", at + 0.15, 0.5, "draw");
  const a = size * 0.9;
  const ax = box.x + box.w - a;
  const ay = box.y + box.h - a - size * 0.05;
  return {
    overflow: facts.overflow,
    boxes: [...facts.boxes, ...(o.arrow === false ? [] : [{ x: ax, y: ay, w: a, h: a }])],
    rowH: size * 1.1,
    draw(kit, fill, mark) {
      const out = facts.draw(kit, fill);
      if (o.arrow !== false && kit.L("foot.arrow") > 0) out.push(arrow({ x: ax, y: ay, size: a, color: mark ?? fill, p: kit.P("foot.arrow"), width: Math.max(1.5, size * 0.08) }));
      return out;
    },
  };
}

/** A one-line set whose baseline sits on `baseline` (for rows of facts of different sizes on one line). */
export function onBaseline(c: PosterContext, field: string, text: string, o: SetOptions, baseline: number): TypeSet | null {
  const probe = c.set(field, text, { ...o, y: 0 });
  if (!probe) return null;
  const dy = baseline - probe.lines[0].baseline;
  return c.set(field, text, { ...o, max: probe.size, min: probe.size, y: dy });
}

/** Seconds: when a set's entrance has landed (from its plan). */
export const landed = (p: TypePlan): number => p.settled;

/** A whole frame of one colour at an alpha (a scrim over a photo). */
export const scrim = (c: PosterContext, paint: Paint): DisplayNode => ({ type: "rect", x: 0, y: 0, w: c.design.w, h: c.design.h, fill: paint });

/** A vertical scrim: transparent at `from` (share of the height) to the colour at `to`. */
export function fadeScrim(c: PosterContext, color: string, from: number, to: number, alpha = 0.85): DisplayNode {
  const { w, h } = c.design;
  return { type: "rect", x: 0, y: 0, w, h, fill: { kind: "linear", x0: 0, y0: h * from, x1: 0, y1: h * to, stops: [{ at: 0, color: rgba(color, 0) }, { at: 0.6, color: rgba(color, alpha * 0.75) }, { at: 1, color: rgba(color, alpha) }] } };
}

export { rgba, pool };

/**
 * The brand's sign-off as it enters: a name set in type moves with its own plan; a logo rises 2 % and fades in on the
 * event `id` (its plain progress for the fade).
 */
export function signNodes(c: PosterContext, kit: DrawKit, sign: Sign | null, plan: TypePlan | null, id: string, x: number, y: number, color: string): DisplayNode[] {
  if (!sign) return [];
  if (plan) return kit.type(plan, { fill: color });
  const lin = kit.L(id);
  if (lin <= 0) return [];
  const p = kit.P(id);
  const nodes = sign.nodes(x, y, color);
  if (p >= 1 && lin >= 1) return nodes;
  return [group(nodes, { transform: translate(0, (1 - p) * c.S * 0.02), ...(lin < 0.5 && { opacity: lin / 0.5 }) })];
}

/** Bring the sign in at `at`: its own text motion when it is the name, else a logo event `id`. */
export function signIn(c: PosterContext, sign: Sign | null, id: string, at: number, preset: PresetId = "word-lift"): TypePlan | null {
  if (!sign) return null;
  if (sign.set) return c.move(sign.set, { in: preset, at }, id);
  c.ev(id, "enter", at, 0.55, "glide");
  return null;
}

/**
 * The address on the top corner row, flush right, its baseline on the brand's (the name's baseline, or a logo's
 * foot), so the two top corners read as one line.
 */
export function topSite(c: PosterContext, sign: Sign | null, size: number, o: { width?: number; field?: string } = {}): TypeSet | null {
  const { safe } = c;
  const width = o.width ?? safe.w * 0.5;
  const base = sign ? (sign.set ? sign.set.lines[0].baseline : safe.y + sign.h) : safe.y + size;
  return onBaseline(c, o.field ?? "website", c.field(o.field ?? "website"), { role: "meta", x: safe.x + safe.w - width, y: 0, width, maxLines: 1, max: size, min: size * 0.8, align: "right", preset: "fade-rise" }, base);
}

/** Place a sign's name set at (x, y) (its em box top-left), re-laid out there. */
export function placeSign(c: PosterContext, sign: Sign | null, o: { x: number; y: number; maxW: number; h: number; min?: number; align?: "left" | "centre" | "right" }): Sign | null {
  if (!sign?.set) return sign;
  return brandSign(c, { ...o });
}
