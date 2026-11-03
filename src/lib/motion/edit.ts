/**
 * Kinetic's editor on the timeline (pure): shot windows, motion groups and their retiming (a warp of each group's own
 * clock and a rate), the camera's clock, parameter tracks, the extra camera, and the presets. The two scene wrappers
 * (marketing/kit.ts and end-card/shared.ts) call it after building their timeline; a recipe without any of the editor's
 * fields comes out exactly as designed.
 *
 * A group edit never moves another group's events, the cuts, the typed words, the film's length or the last frame:
 * the rate scales a group's events about its first start and is held so the group still ends inside its shot and (where
 * the design allows) a second before the last frame.
 */

import { curve, CURVE_SETS, quad, cubic, sine, type CurveName, type Ease } from "./ease";
import { cameraGroupId, groupDefsFor, groupMatches, type MotionGroupDef } from "./kinetic-groups";
import { TRACK_LIMITS, type GroupTiming, type Recipe, type Track, type TrackId } from "./recipe";
import { local } from "./time";
import { sample, type MotionEvent } from "./tween";

// ---------------------------------------------------------------------------
// Shot windows and groups

export type Window = [number, number];

/** The shots between the plan's cuts: [0, c1), [c1, c2) … [cn, last]. */
export function shotWindows(plan: { cuts: readonly number[]; rest: number }): Window[] {
  const cuts = [...plan.cuts].filter((c) => c > 0 && c < plan.rest).sort((a, b) => a - b);
  const edges = [0, ...cuts, plan.rest];
  return edges.slice(0, -1).map((a, i) => [a, edges[i + 1]] as Window);
}

/** The window index a time falls in (the last window holds the last frame). */
export function windowAt(windows: readonly Window[], t: number): number {
  for (let i = 0; i < windows.length; i++) if (t < windows[i][1]) return i;
  return Math.max(0, windows.length - 1);
}

export interface MotionGroup {
  id: string;
  label: string;
  /** The shot it sits in (where its first event starts). */
  window: number;
  camera: boolean;
  events: MotionEvent[];
}

/**
 * A scene's groups on a timeline: the catalogue's groups that have events (in the shot where each starts), and a
 * Camera group in every shot (the scene's camera, its breath, the extra camera, and any camera-kind events).
 */
export function groupsOf(defs: readonly MotionGroupDef[], events: readonly MotionEvent[], windows: readonly Window[]): MotionGroup[] {
  const out: MotionGroup[] = [];
  for (const d of defs) {
    const evs = events.filter((e) => e.kind !== "camera" && groupMatches(defs, e).includes(d.id));
    if (!evs.length) continue;
    const g0 = Math.min(...evs.map((e) => e.start));
    out.push({ id: d.id, label: d.label, window: windowAt(windows, Math.max(0, g0)), camera: false, events: evs });
  }
  windows.forEach((_, w) => {
    const evs = events.filter((e) => e.kind === "camera" && windowAt(windows, Math.max(0, e.start)) === w);
    out.push({ id: cameraGroupId(w), label: "Camera", window: w, camera: true, events: evs });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Warps

export type WarpKeys = [number, number][];
export const IDENTITY_KEYS: WarpKeys = [
  [0, 0],
  [1, 1],
];

/**
 * A group's warp: its keys joined by monotone cubic interpolation (Fritsch–Carlson), so it never runs backwards, with
 * warp(0) = 0 and warp(1) = 1 exactly. Two keys [0, 0] and [1, 1] give the plain identity.
 */
export function warpOf(keys: readonly (readonly [number, number])[]): (u: number) => number {
  const n = keys.length;
  if (n < 2 || (n === 2 && keys[0][1] === 0 && keys[1][1] === 1 && keys[0][0] === 0 && keys[1][0] === 1)) return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
  const x = keys.map((k) => k[0]);
  const y = keys.map((k) => k[1]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / Math.max(1e-9, x[i + 1] - x[i]));
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i];
      m[i + 1] = tau * b * d[i];
    }
  }
  return (u) => {
    if (!(u > 0)) return 0;
    if (u >= 1) return 1;
    let i = 0;
    while (i < n - 2 && u > x[i + 1]) i++;
    const h = x[i + 1] - x[i];
    const s = (u - x[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const v = (2 * s3 - 3 * s2 + 1) * y[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * y[i + 1] + (s3 - s2) * h * m[i + 1];
    // Monotone by construction; held to the segment's own ends against float error.
    return Math.min(y[i + 1], Math.max(y[i], v));
  };
}

export const isIdentityKeys = (k: readonly (readonly [number, number])[]) => k.length === 2 && k[0][0] === 0 && k[0][1] === 0 && k[1][0] === 1 && k[1][1] === 1;
export const isIdentityTiming = (g: GroupTiming | undefined) => !g || (g.rate === 1 && isIdentityKeys(g.keys));

/** The suggested shapes under the graph: each writes 5 keys sampled from a named curve. */
export const SHAPES: { id: string; label: string; f: Ease }[] = [
  { id: "even", label: "Even", f: (u) => u },
  { id: "in", label: "Ease in", f: quad.in },
  { id: "out", label: "Ease out", f: quad.out },
  { id: "in-out", label: "Ease in and out", f: cubic.inOut },
  { id: "late", label: "Late start", f: (u) => (u < 0.4 ? 0 : sine.out((u - 0.4) / 0.6)) },
];

export function shapeKeys(id: string): WarpKeys {
  const s = SHAPES.find((x) => x.id === id) ?? SHAPES[0];
  if (s.id === "even") return IDENTITY_KEYS.map((k) => [...k] as [number, number]);
  return [0, 0.25, 0.5, 0.75, 1].map((u) => [u, Math.round(s.f(u) * 1e4) / 1e4] as [number, number]);
}

// ---------------------------------------------------------------------------
// Rates

/** The shortest an event may last after a rate change (seconds). */
export const MIN_EVENT = 0.2;

const groupStart = (events: readonly MotionEvent[]) => Math.min(...events.map((e) => e.start));

/** Where a group's last event ends at `rate`. */
function groupEnd(events: readonly MotionEvent[], rate: number): number {
  const g0 = groupStart(events);
  return Math.max(...events.map((e) => g0 + (e.start - g0) / rate + Math.max(MIN_EVENT, e.dur / rate)));
}

/**
 * The rates a group may take: up to 2x quicker always; as slow as keeps it inside its shot and a second before the last
 * frame (never stricter than the scene's own timing). A Camera group never goes slower than 1x, so it still comes home on
 * the last frame.
 */
export function rateLimits(g: MotionGroup, windows: readonly Window[], last: number): { min: number; max: number } {
  if (g.camera) return { min: 1, max: 2 };
  if (!g.events.length) return { min: 1, max: 1 };
  const end = windows[g.window]?.[1] ?? last;
  const limit = Math.max(Math.min(end, last - 1), groupEnd(g.events, 1));
  let lo = 0.5;
  if (groupEnd(g.events, lo) <= limit + 1e-9) return { min: 0.5, max: 2 };
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (groupEnd(g.events, mid) <= limit + 1e-9) hi = mid;
    else lo = mid;
  }
  return { min: Math.ceil(hi * 100) / 100, max: 2 };
}

export const clampRate = (rate: number, l: { min: number; max: number }) => Math.min(l.max, Math.max(l.min, rate));

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The events with each retimed group's rate and warp: starts scale about the group's first start, durations by the rate
 * (never under MIN_EVENT), and every event of the group runs on the group's warp. Events of other groups are the same
 * objects; a recipe without timing gives back the same array.
 */
export function retime(events: MotionEvent[], timing: Recipe["groups"], groups: readonly MotionGroup[], windows: readonly Window[], last: number): MotionEvent[] {
  if (!timing || !Object.keys(timing).length) return events;
  const change = new Map<MotionEvent, MotionEvent>();
  for (const g of groups) {
    const t = timing[g.id];
    if (isIdentityTiming(t) || !g.events.length) continue;
    const rate = clampRate(t!.rate, rateLimits(g, windows, last));
    const warp = isIdentityKeys(t!.keys) ? undefined : warpOf(t!.keys);
    const g0 = groupStart(g.events);
    for (const e of g.events) {
      const next: MotionEvent = rate === 1 ? { ...e } : { ...e, start: r6(g0 + (e.start - g0) / rate), dur: r6(Math.max(MIN_EVENT, e.dur / rate)) };
      if (warp) next.warp = warp;
      change.set(e, next);
    }
  }
  if (!change.size) return events;
  return events.map((e) => change.get(e) ?? e);
}

/**
 * The camera's clock: inside each shot [a, b], t' = a + (b - a) × warp(min(1, local(t, a, a + (b - a) / rate))) with the
 * shot's Camera group timing; the identity without one. The camera still comes home on the last frame.
 */
export function cameraClock(windows: readonly Window[], timing: Recipe["groups"]): ((t: number) => number) | null {
  const per = windows.map((w, i) => {
    const g = timing?.[cameraGroupId(i)];
    if (isIdentityTiming(g)) return null;
    const rate = Math.min(2, Math.max(1, g!.rate));
    return { a: w[0], b: w[1], rate, warp: warpOf(g!.keys) };
  });
  if (per.every((p) => !p)) return null;
  return (t) => {
    const i = windowAt(windows, t);
    const p = per[i];
    if (!p) return t;
    const span = p.b - p.a;
    return p.a + span * p.warp(Math.min(1, local(t, p.a, p.a + span / p.rate)));
  };
}

// ---------------------------------------------------------------------------
// Pace

/** The Easy Pace choice as a pace (above 1 is calmer: the beats spread wider). */
export const paceOf = (controls: Recipe["controls"]): number => (controls?.pace === "calm" ? 1.2 : controls?.pace === "punchy" ? 0.82 : 1);

// ---------------------------------------------------------------------------
// Tracks

/** A track's value at `t`: keys sampled at k0 + (t − k0) × rate (k0: the first key), held before and after. */
export function trackValue(track: Track, t: number): number {
  const k0 = track.keys[0].t;
  return sample(track.keys, k0 + (t - k0) * track.rate);
}

export const trackAt = (r: Pick<Recipe, "tracks">, id: TrackId, t: number): number | undefined => {
  const tr = r.tracks?.[id];
  return tr ? trackValue(tr, t) : undefined;
};

/** At most this many tracks, of at most this many keys. */
export const TRACKS_MAX = 8;
export const TRACK_KEYS_MAX = 16;

/** The key of a track at `t` (within half a frame), or -1. */
export function keyIndexAt(track: Track | undefined, t: number, fps: number): number {
  if (!track) return -1;
  return track.keys.findIndex((k) => Math.abs(k.t - t) <= 0.5 / fps + 1e-9);
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * The recipe with a key at `t` set to `v` (held to the track's limits): the key there takes the value, or a new key is
 * added in time order; the first key makes the track. Null when it can't (16 keys, or 8 tracks already).
 */
export function putTrackKey(r: Recipe, id: TrackId, t: number, v: number, fps: number): Recipe | null {
  const [lo, hi] = TRACK_LIMITS[id];
  const value = r4(Math.min(hi, Math.max(lo, v)));
  const at = r4(Math.min(60, Math.max(0, t)));
  const tracks = { ...(r.tracks ?? {}) };
  const tr = tracks[id];
  if (!tr) {
    if (Object.keys(tracks).length >= TRACKS_MAX) return null;
    tracks[id] = { keys: [{ t: at, v: value }], rate: 1 };
    return { ...r, tracks };
  }
  const i = keyIndexAt(tr, at, fps);
  if (i >= 0) {
    tracks[id] = { ...tr, keys: tr.keys.map((k, j) => (j === i ? { ...k, v: value } : k)) };
    return { ...r, tracks };
  }
  if (tr.keys.length >= TRACK_KEYS_MAX) return null;
  tracks[id] = { ...tr, keys: [...tr.keys, { t: at, v: value }].sort((a, b) => a.t - b.t) };
  return { ...r, tracks };
}

/** The recipe without one of a track's keys (its last key removes the track). */
export function dropTrackKey(r: Recipe, id: TrackId, index: number): Recipe {
  const tr = r.tracks?.[id];
  if (!tr) return r;
  const keys = tr.keys.filter((_, j) => j !== index);
  const tracks = { ...r.tracks };
  if (keys.length) tracks[id] = { ...tr, keys };
  else delete tracks[id];
  const out: Recipe = { ...r, tracks };
  if (!Object.keys(tracks).length) delete out.tracks;
  return out;
}

/** A key moved to `t`, kept a frame from each neighbour and inside the film. */
export function moveTrackKey(r: Recipe, id: TrackId, index: number, t: number, fps: number): Recipe {
  const tr = r.tracks?.[id];
  if (!tr || !tr.keys[index]) return r;
  const lo = index > 0 ? tr.keys[index - 1].t + 1 / fps : 0;
  const hi = index < tr.keys.length - 1 ? tr.keys[index + 1].t - 1 / fps : Math.min(60, r.duration);
  if (hi < lo) return r;
  const at = r4(Math.min(hi, Math.max(lo, t)));
  return { ...r, tracks: { ...r.tracks, [id]: { ...tr, keys: tr.keys.map((k, j) => (j === index ? { ...k, t: at } : k)) } } };
}

export const hasCameraTracks = (r: Pick<Recipe, "tracks">) => !!r.tracks && Object.keys(r.tracks).some((k) => k.startsWith("camera."));

// ---------------------------------------------------------------------------
// The extra camera

export interface CameraOffset {
  zoom: number;
  /** Design units. */
  x: number;
  y: number;
  /** Radians. */
  roll: number;
}

/**
 * The extra camera's move at clock time `tc` (Push, Drift, Rise; every one is home on the last frame) combined with
 * the camera tracks at `t`, for a frame `w` design units wide; null when there is neither (the scene as designed).
 */
export function extraCamera(r: Pick<Recipe, "camera" | "tracks">, last: number): ((t: number, tc: number, w: number) => CameraOffset) | null {
  const move = r.camera?.move ?? "scene";
  const moving = move === "push" || move === "drift" || move === "rise";
  const tracks = hasCameraTracks(r);
  if (!moving && !tracks) return null;
  const a = r.camera?.amount ?? 1;
  const drift = curve("drift");
  return (t, tc, w) => {
    const away = moving ? 1 - drift(last > 0 ? Math.min(1, Math.max(0, tc / last)) : 1) : 0;
    const o: CameraOffset = { zoom: 1, x: 0, y: 0, roll: 0 };
    if (move === "push") o.zoom = 1 - 0.05 * a * away;
    else if (move === "drift") o.x = -0.015 * a * w * away;
    else if (move === "rise") o.y = 0.015 * a * w * away;
    if (tracks) {
      o.zoom *= trackAt(r, "camera.zoom", t) ?? 1;
      o.x += (trackAt(r, "camera.x", t) ?? 0) * w;
      o.y += (trackAt(r, "camera.y", t) ?? 0) * w;
      o.roll += ((trackAt(r, "camera.roll", t) ?? 0) * Math.PI) / 180;
    }
    return o;
  };
}

// ---------------------------------------------------------------------------
// What a wrapper needs

export interface KineticTiming {
  events: MotionEvent[];
  curves?: Partial<Record<CurveName, Ease>>;
  /** The camera's clock (null: real time). */
  clock: ((t: number) => number) | null;
}

/** The editor's timing for a scene's events: groups retimed, the feel's curves and the camera's clock. */
export function kineticTiming(r: Recipe, sceneId: string, events: MotionEvent[], cuts: readonly number[], last: number): KineticTiming {
  const curves = CURVE_SETS[r.motion?.curves ?? "smooth"];
  const out: KineticTiming = { events, clock: null };
  if (Object.keys(curves).length) out.curves = curves;
  if (!r.groups || !Object.keys(r.groups).length) return out;
  const windows = shotWindows({ cuts, rest: last });
  const defs = groupDefsFor(sceneId);
  // A group retimed inside a nested scene is already timed in its copies here.
  const groups = groupsOf(defs, events, windows).filter((g) => !defs.find((d) => d.id === g.id)?.inner);
  out.events = retime(events, r.groups, groups, windows, last);
  out.clock = cameraClock(windows, r.groups);
  return out;
}

// ---------------------------------------------------------------------------
// Presets

export type PresetCategory = "motion" | "appearance" | "camera";

/** A category's fields and their values when absent. */
const FIELDS = {
  motion: { "motion.curves": "smooth", "motion.pace": undefined },
  appearance: { "finish.contrast": 0, "finish.saturation": 0, "finish.grain": 0, "finish.grainSize": 1.2 },
  camera: { "camera.move": "scene", "camera.amount": 1, "camera.breath": 1 },
} as const satisfies Record<PresetCategory, Record<string, string | number | undefined>>;

type Value = string | number | undefined;

export interface Preset {
  id: string;
  name: string;
  /** One line under its name. */
  purpose: string;
  /** Every field of its category (at most 15), by path. */
  values: Record<string, Value>;
}

export const PRESETS: Record<PresetCategory, Preset[]> = {
  motion: [
    { id: "smooth", name: "Smooth", purpose: "Calm, polished arrivals", values: { "motion.curves": "smooth", "motion.pace": undefined } },
    { id: "snappy", name: "Snappy", purpose: "Quick, decisive moves", values: { "motion.curves": "snappy", "motion.pace": 0.85 } },
    { id: "springy", name: "Springy", purpose: "Playful overshoot", values: { "motion.curves": "springy", "motion.pace": 1 } },
    { id: "steady", name: "Steady", purpose: "Even, unhurried moves", values: { "motion.curves": "steady", "motion.pace": 1.15 } },
  ],
  appearance: [
    { id: "clean", name: "Clean", purpose: "Exactly your colours", values: { "finish.contrast": 0, "finish.saturation": 0, "finish.grain": 0, "finish.grainSize": 1.2 } },
    { id: "film", name: "Film", purpose: "Fine grain and a touch of contrast", values: { "finish.contrast": 0.08, "finish.saturation": -0.05, "finish.grain": 0.025, "finish.grainSize": 1.3 } },
    { id: "rich", name: "Rich", purpose: "Deeper contrast and colour", values: { "finish.contrast": 0.15, "finish.saturation": 0.15, "finish.grain": 0, "finish.grainSize": 1.2 } },
    { id: "soft", name: "Soft", purpose: "Lifted and gentle", values: { "finish.contrast": -0.1, "finish.saturation": -0.1, "finish.grain": 0.015, "finish.grainSize": 1.6 } },
  ],
  camera: [
    { id: "scene", name: "Scene's own", purpose: "The scene's authored camera", values: { "camera.move": "scene", "camera.amount": 1, "camera.breath": 1 } },
    { id: "locked", name: "Locked off", purpose: "No camera move", values: { "camera.move": "locked", "camera.amount": 1, "camera.breath": 0 } },
    { id: "push", name: "Slow push", purpose: "A gentle push in", values: { "camera.move": "push", "camera.amount": 1, "camera.breath": 1 } },
    { id: "drift", name: "Drift", purpose: "A slow sideways float", values: { "camera.move": "drift", "camera.amount": 1, "camera.breath": 1 } },
  ],
};

/** A value at a path ("finish.grain") in a recipe, or its default when absent. */
export function valueAt(r: Recipe, category: PresetCategory, path: string): Value {
  const [obj, key] = path.split(".") as [keyof Recipe, string];
  const v = (r[obj] as Record<string, Value> | undefined)?.[key];
  return v === undefined ? (FIELDS[category] as Record<string, Value>)[path] : v;
}

/** The preset whose values the recipe has exactly, or "custom". */
export function presetOf(category: PresetCategory, r: Recipe): string {
  const hit = PRESETS[category].find((p) => Object.entries(p.values).every(([path, v]) => valueAt(r, category, path) === v));
  return hit?.id ?? "custom";
}

/** Sets one value (undefined: removes it), dropping defaults and empty objects. */
export function setValue(r: Recipe, path: string, v: Value | boolean): Recipe {
  const [obj, key] = path.split(".") as ["motion" | "finish" | "camera" | "look", string];
  const next = { ...((r[obj] as Record<string, unknown> | undefined) ?? {}) };
  if (v === undefined) delete next[key];
  else next[key] = v;
  return tidyRecipe({ ...r, [obj]: next } as Recipe);
}

/** The recipe with a preset's values. */
export function applyPreset(category: PresetCategory, id: string, r: Recipe): Recipe {
  const p = PRESETS[category].find((x) => x.id === id);
  if (!p) return r;
  let out = r;
  for (const [path, v] of Object.entries(p.values)) out = setValue(out, path, v);
  return out;
}

/** The recipe without the editor's default values (so an untouched scene's recipe is exactly the designed one). */
export function tidyRecipe(r: Recipe): Recipe {
  const out: Recipe = { ...r };
  const drop = <K extends "motion" | "finish" | "camera" | "look">(k: K, defaults: Record<string, unknown>) => {
    const o = out[k] as Record<string, unknown> | undefined;
    if (!o) return;
    const kept = Object.fromEntries(Object.entries(o).filter(([key, v]) => v !== undefined && v !== defaults[key]));
    if (Object.keys(kept).length) (out as Record<string, unknown>)[k] = kept;
    else delete out[k];
  };
  drop("motion", { curves: "smooth" });
  drop("finish", { contrast: 0, saturation: 0, grain: 0, grainSize: 1.2 });
  drop("camera", { move: "scene", amount: 1, breath: 1 });
  drop("look", { light: true });
  if (out.groups) {
    const kept = Object.entries(out.groups).filter(([, g]) => !isIdentityTiming(g));
    if (kept.length) out.groups = Object.fromEntries(kept);
    else delete out.groups;
  }
  if (out.tracks && !Object.keys(out.tracks).length) delete out.tracks;
  return out;
}
