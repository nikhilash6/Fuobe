/**
 * Blockout to film (package blockout-film): a grey-box 3D blockout (uploaded from Blender, Unreal, Cinema 4D… or built in
 * Cinema's browser builder) sets the camera, the blocking and the timing; reference stills and a timecoded beat prompt say
 * what the finished shot looks like. This module is the pure part: the builder's scene (primitives, a mannequin, camera
 * keyframes with handheld shake, timing markers), the built-in example (a corridor and a door, made by Fuobe), beats from
 * markers, the reference roles, the prompt compiler in the structure Comfy's "Horror scene" workflow uses (Subject with
 * each @ reference's role, Action as "a–b s — beat: …", Camera, Style, Constraints, Audio, "No …"), the cut of a long
 * blockout into shots at its markers, and the open engine's 81-frame depth windows. No DOM, no three.js, no catalog.
 */

export type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// The scene

/** What the builder places: grey boxes and planes, a doorway, stairs, a door that swings, a mannequin, a mesh (GLB). */
export type PrimKind = "box" | "wall" | "floor" | "doorway" | "stairs" | "door" | "mannequin" | "mesh";

export interface PrimKey {
  /** Seconds. */
  t: number;
  position: Vec3;
  /** Degrees about the vertical; a door turns about its hinge (its left edge). */
  rotation: number;
}

export interface BlockoutPrim {
  id: string;
  kind: PrimKind;
  name: string;
  /** Metres, y up; a primitive stands on its position (the bottom centre). */
  position: Vec3;
  /** Degrees about the vertical. */
  rotation: number;
  /** Width (x), height (y), depth (z) in metres. */
  size: Vec3;
  /** Where it is over time: between keys it moves in a line (a mannequin walks, a door swings). None: it stays put. */
  keys?: PrimKey[];
  /** A mesh's GLB (Image to 3D, or the Library). */
  url?: string;
}

export interface BlockoutCameraKey {
  /** Seconds. */
  t: number;
  position: Vec3;
  /** The point the camera looks at. */
  target: Vec3;
  /** Focal length in mm on a full-frame body. */
  lens: number;
  /** Handheld shake: 0 = locked off, 1 = a nervous handheld. */
  shake: number;
}

export interface BlockoutMarker {
  id: string;
  /** Seconds. */
  t: number;
  /** "Lights out", "Door kicked": the beat that starts here. */
  label: string;
}

export interface BlockoutScene {
  version: 1;
  name: string;
  /** Seconds. */
  duration: number;
  /** "16:9", "9:16", "2.39:1"… */
  aspect: string;
  prims: BlockoutPrim[];
  camera: BlockoutCameraKey[];
  markers: BlockoutMarker[];
}

/** What a blockout may hold, and how it is rendered in the browser. */
export const BLOCKOUT = {
  /** The shortest and longest blockout (seconds). */
  minSeconds: 2,
  maxSeconds: 60,
  /** The browser renders the grey box (and its depth) at this rate: what Seedance and H3 Max read (24–60 fps). */
  fps: 24,
  maxPrims: 80,
  maxCameraKeys: 32,
  maxMarkers: 24,
  maxBeatWords: 600,
  /** Reference stills a blockout carries (Seedance takes 4 with the clip, H3 Max 3D 8, the open engine's first frame 3). */
  maxRefs: 8,
  lens: { min: 12, max: 200, default: 28 },
} as const;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0;
const finite = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
const vec = (v: unknown, fallback: Vec3, lim = 500): Vec3 =>
  Array.isArray(v) && v.length === 3 ? [clamp(finite(v[0], fallback[0]), -lim, lim), clamp(finite(v[1], fallback[1]), -lim, lim), clamp(finite(v[2], fallback[2]), -lim, lim)] : [...fallback];

/** The default size of each primitive (metres) and its name in the builder's menu. */
export const PRIMS: Record<PrimKind, { name: string; size: Vec3; hint: string }> = {
  box: { name: "Box", size: [1, 1, 1], hint: "Furniture, crates, a car: any solid" },
  wall: { name: "Wall", size: [4, 2.8, 0.2], hint: "A flat wall, 20 cm thick" },
  floor: { name: "Floor", size: [6, 0.05, 6], hint: "Ground, a floor or a ceiling" },
  doorway: { name: "Doorway", size: [3, 2.8, 0.2], hint: "A wall with a door-sized gap in the middle" },
  stairs: { name: "Stairs", size: [1.2, 1.5, 2.4], hint: "A flight of 8 steps, rising away from you" },
  door: { name: "Door", size: [0.9, 2.1, 0.06], hint: "Swings on its left edge: key its angle to open it" },
  mannequin: { name: "Mannequin", size: [0.5, 1.75, 0.3], hint: "A person: key positions and it walks between them" },
  mesh: { name: "Mesh", size: [1, 1, 1], hint: "A GLB from Image to 3D or your Library, scaled to fit" },
};

/** A doorway's gap (metres), centred at the bottom of the wall. */
export const DOOR_GAP = { width: 1, height: 2.1 } as const;
export const STAIR_STEPS = 8;

/** Where a primitive is at time t (its keys in a line between them; before the first and after the last it holds). */
export function primAt(p: Pick<BlockoutPrim, "position" | "rotation" | "keys">, t: number): { position: Vec3; rotation: number } {
  const keys = p.keys?.length ? [...p.keys].sort((a, b) => a.t - b.t) : null;
  if (!keys) return { position: [...p.position], rotation: p.rotation };
  if (t <= keys[0].t) return { position: [...keys[0].position], rotation: keys[0].rotation };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { position: [...last.position], rotation: last.rotation };
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t < t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  const lerp = (x: number, y: number) => x + (y - x) * f;
  return { position: [lerp(a.position[0], b.position[0]), lerp(a.position[1], b.position[1]), lerp(a.position[2], b.position[2])], rotation: lerp(a.rotation, b.rotation) };
}

/** How fast a primitive moves at time t (metres a second): a mannequin swings its limbs in step with it. */
export function primSpeed(p: Pick<BlockoutPrim, "position" | "rotation" | "keys">, t: number, dt = 1 / 24): number {
  const a = primAt(p, t - dt / 2).position;
  const b = primAt(p, t + dt / 2).position;
  return Math.hypot(b[0] - a[0], b[2] - a[2]) / dt;
}

/** Ease in and out between camera keys, so a move starts and lands softly (a dolly, not a jump). */
const ease = (f: number) => f * f * (3 - 2 * f);

/**
 * Handheld shake at time t for `amount` (0–1): a sum of slow sines at unrelated rates (no randomness, so a re-render is
 * the same shot), up to about 4 cm of drift and 1.5° of wobble at 1.
 */
export function shakeAt(t: number, amount: number): { offset: Vec3; aim: Vec3 } {
  const k = clamp(amount, 0, 1);
  if (!k) return { offset: [0, 0, 0], aim: [0, 0, 0] };
  const s = (f: number, p: number) => Math.sin(2 * Math.PI * f * t + p);
  const offset: Vec3 = [0.025 * (s(0.53, 0.3) + 0.6 * s(1.31, 2.1)) * k, 0.02 * (s(0.71, 1.7) + 0.5 * s(1.93, 0.4)) * k, 0.012 * s(0.37, 2.9) * k];
  const aim: Vec3 = [0.02 * (s(0.89, 0.9) + 0.4 * s(2.27, 1.3)) * k, 0.016 * (s(0.61, 2.4) + 0.4 * s(1.73, 0.2)) * k, 0];
  return { offset, aim };
}

/** The camera at time t: keys eased between, plus its shake (the aim's shake is in radians-ish units of the distance). */
export function cameraAt(keys: readonly BlockoutCameraKey[], t: number): { position: Vec3; target: Vec3; lens: number; shake: number } {
  const list = keys.length ? [...keys].sort((a, b) => a.t - b.t) : [DEFAULT_CAMERA];
  let pos: Vec3;
  let tgt: Vec3;
  let lens: number;
  let shake: number;
  if (t <= list[0].t || list.length === 1) ({ position: pos, target: tgt, lens, shake } = list[0]);
  else if (t >= list[list.length - 1].t) ({ position: pos, target: tgt, lens, shake } = list[list.length - 1]);
  else {
    let i = 0;
    while (i < list.length - 2 && list[i + 1].t < t) i++;
    const a = list[i];
    const b = list[i + 1];
    const f = ease(b.t > a.t ? (t - a.t) / (b.t - a.t) : 1);
    const lerp = (x: number, y: number) => x + (y - x) * f;
    pos = [lerp(a.position[0], b.position[0]), lerp(a.position[1], b.position[1]), lerp(a.position[2], b.position[2])];
    tgt = [lerp(a.target[0], b.target[0]), lerp(a.target[1], b.target[1]), lerp(a.target[2], b.target[2])];
    // A zoom is even in its ratio (24 → 48 mm takes as long as 48 → 96).
    lens = Math.exp(lerp(Math.log(a.lens), Math.log(b.lens)));
    shake = lerp(a.shake, b.shake);
  }
  const sh = shakeAt(t, shake);
  const dist = Math.hypot(tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]) || 1;
  return {
    position: [pos[0] + sh.offset[0], pos[1] + sh.offset[1], pos[2] + sh.offset[2]],
    target: [tgt[0] + sh.aim[0] * dist, tgt[1] + sh.aim[1] * dist, tgt[2]],
    lens,
    shake,
  };
}

/** Vertical field of view (degrees) of a lens on a full-frame sensor cropped to `aspect` (width ÷ height). */
export function lensVFov(lensMm: number, aspect: number): number {
  const h = 24;
  const w = 36;
  // The frame is the largest `aspect` rectangle inside 36 × 24.
  const fh = aspect >= w / h ? w / aspect : h;
  return (2 * Math.atan(fh / 2 / clamp(lensMm, 1, 2000)) * 180) / Math.PI;
}

/** "16:9" → 1.778; "2.39:1" → 2.39; anything else 16:9. */
export function aspectOf(aspect: string): number {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect.trim());
  const r = m ? Number(m[1]) / Number(m[2]) : NaN;
  return Number.isFinite(r) && r > 0.2 && r < 5 ? r : 16 / 9;
}

/** The render size of a blockout frame: the long side `long` px, both sides even multiples of 16. */
export function blockoutSize(aspect: string, long = 1280): { width: number; height: number } {
  const r = aspectOf(aspect);
  const m16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return r >= 1 ? { width: m16(long), height: m16(long / r) } : { width: m16(long * r), height: m16(long) };
}

export const DEFAULT_CAMERA: BlockoutCameraKey = { t: 0, position: [0, 1.6, 4], target: [0, 1.2, 0], lens: BLOCKOUT.lens.default, shake: 0 };

let seq = 0;
/** A short id for a new primitive, key or marker (the builder's; the server never needs them unique). */
export const newId = (prefix = "p") => `${prefix}${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}`;

/** A new primitive of `kind` in front of the camera (at the origin). */
export function newPrim(kind: PrimKind, at: Vec3 = [0, 0, 0], name?: string): BlockoutPrim {
  const d = PRIMS[kind];
  return { id: newId(kind[0]), kind, name: name ?? d.name, position: [...at], rotation: 0, size: [...d.size] };
}

/** An empty set: a floor and the camera looking at it. */
export function emptyScene(): BlockoutScene {
  return {
    version: 1,
    name: "My blockout",
    duration: 6,
    aspect: "16:9",
    prims: [{ ...newPrim("floor"), id: "floor", size: [12, 0.05, 12] }],
    camera: [{ ...DEFAULT_CAMERA }],
    markers: [{ id: "m0", t: 0, label: "Opening" }],
  };
}

/**
 * The built-in example (Fuobe's own, not the horror workflow's assets): a corridor with a door at its end. A figure walks
 * down it, the door swings open by itself, she steps through; the handheld camera follows. Eight seconds, three beats.
 */
export const EXAMPLE_SCENE: BlockoutScene = {
  version: 1,
  name: "Corridor and door",
  duration: 8,
  aspect: "16:9",
  prims: [
    { id: "floor", kind: "floor", name: "Floor", position: [0, 0, -6], rotation: 0, size: [2.6, 0.05, 14] },
    { id: "ceiling", kind: "floor", name: "Ceiling", position: [0, 2.8, -6], rotation: 0, size: [2.6, 0.05, 14] },
    { id: "wall-l", kind: "wall", name: "Left wall", position: [-1.4, 0, -6], rotation: 90, size: [14, 2.8, 0.2] },
    { id: "wall-r", kind: "wall", name: "Right wall", position: [1.4, 0, -6], rotation: 90, size: [14, 2.8, 0.2] },
    { id: "end", kind: "doorway", name: "End wall", position: [0, 0, -12], rotation: 0, size: [2.6, 2.8, 0.2] },
    {
      id: "door",
      kind: "door",
      name: "Door",
      position: [-0.5, 0, -12],
      rotation: 0,
      size: [1, 2.1, 0.06],
      keys: [
        { t: 4.5, position: [-0.5, 0, -12], rotation: 0 },
        { t: 5.6, position: [-0.5, 0, -12], rotation: 100 },
      ],
    },
    { id: "cabinet", kind: "box", name: "Cabinet", position: [1.05, 0, -4.5], rotation: 0, size: [0.5, 1.2, 1.2] },
    {
      id: "walker",
      kind: "mannequin",
      name: "Woman",
      position: [0, 0, -1],
      rotation: 180,
      size: [0.5, 1.7, 0.3],
      keys: [
        { t: 0, position: [0, 0, -1], rotation: 180 },
        { t: 4.4, position: [0, 0, -9.6], rotation: 180 },
        { t: 6, position: [0, 0, -9.8], rotation: 180 },
        { t: 8, position: [0, 0, -13.2], rotation: 180 },
      ],
    },
  ],
  camera: [
    { t: 0, position: [0.35, 1.55, 1.8], target: [0, 1.3, -6], lens: 28, shake: 0.45 },
    { t: 4.4, position: [0.3, 1.55, -6.6], target: [0, 1.2, -12], lens: 32, shake: 0.35 },
    { t: 8, position: [0.15, 1.5, -9.4], target: [0, 1.2, -14], lens: 35, shake: 0.6 },
  ],
  markers: [
    { id: "arrival", t: 0, label: "Arrival" },
    { id: "door", t: 4.5, label: "The door opens" },
    { id: "dark", t: 6, label: "Into the dark" },
  ],
};

/** The example's beat words (the builder fills them in when the example opens). */
export const EXAMPLE_WORDS: Record<string, string> = {
  arrival: "A woman walks slowly down the narrow corridor, holding a torch, glancing at the cabinet as she passes.",
  door: "She stops. The door at the end swings open by itself with a long creak.",
  dark: "She hesitates, then steps through the doorway into the dark room.",
};

/**
 * A scene as an API or MCP caller (or an old draft) sent it, made safe: numbers finite and in range, lists capped,
 * times inside the length, at least one camera key.
 */
export function normalizeScene(raw: unknown): BlockoutScene {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<BlockoutScene>;
  const duration = clamp(finite(s.duration, 6), BLOCKOUT.minSeconds, BLOCKOUT.maxSeconds);
  const time = (t: unknown) => r3(clamp(finite(t, 0), 0, duration));
  const kinds = new Set(Object.keys(PRIMS));
  const prims = (Array.isArray(s.prims) ? s.prims : [])
    .filter((p): p is BlockoutPrim => !!p && kinds.has((p as BlockoutPrim).kind))
    .slice(0, BLOCKOUT.maxPrims)
    .map((p, i) => ({
      id: String(p.id || `p${i}`).slice(0, 40),
      kind: p.kind,
      name: String(p.name || PRIMS[p.kind].name).slice(0, 60),
      position: vec(p.position, [0, 0, 0]),
      rotation: clamp(finite(p.rotation, 0), -3600, 3600),
      size: vec(p.size, PRIMS[p.kind].size, 200).map((n) => Math.max(0.01, Math.abs(n))) as Vec3,
      ...(Array.isArray(p.keys) && p.keys.length
        ? { keys: p.keys.slice(0, BLOCKOUT.maxCameraKeys).map((k) => ({ t: time(k?.t), position: vec(k?.position, vec(p.position, [0, 0, 0])), rotation: clamp(finite(k?.rotation, 0), -3600, 3600) })).sort((a, b) => a.t - b.t) }
        : {}),
      ...(p.kind === "mesh" && typeof p.url === "string" && p.url.startsWith("/api/files/") ? { url: p.url.slice(0, 500) } : {}),
    }));
  const camera = (Array.isArray(s.camera) ? s.camera : [])
    .slice(0, BLOCKOUT.maxCameraKeys)
    .map((k) => ({
      t: time(k?.t),
      position: vec(k?.position, DEFAULT_CAMERA.position),
      target: vec(k?.target, DEFAULT_CAMERA.target),
      lens: clamp(finite(k?.lens, BLOCKOUT.lens.default), BLOCKOUT.lens.min, BLOCKOUT.lens.max),
      shake: clamp(finite(k?.shake, 0), 0, 1),
    }))
    .sort((a, b) => a.t - b.t);
  const markers = (Array.isArray(s.markers) ? s.markers : [])
    .slice(0, BLOCKOUT.maxMarkers)
    .map((m, i) => ({ id: String(m?.id || `m${i}`).slice(0, 40), t: time(m?.t), label: String(m?.label ?? "").trim().slice(0, 80) || `Beat ${i + 1}` }))
    .sort((a, b) => a.t - b.t);
  return {
    version: 1,
    name: String(s.name || "My blockout").slice(0, 80),
    duration,
    aspect: typeof s.aspect === "string" && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(s.aspect) ? s.aspect : "16:9",
    prims,
    camera: camera.length ? camera : [{ ...DEFAULT_CAMERA }],
    markers,
  };
}

// ---------------------------------------------------------------------------
// Beats

export interface Beat {
  /** The marker it starts at ("start" when the blockout's first marker is later than 0 s). */
  id: string;
  /** Seconds. */
  start: number;
  end: number;
  label: string;
  /** What happens, in the user's words. */
  words: string;
}

/**
 * The beats of a blockout `duration` seconds long: one per marker, from it to the next (the last to the end); a stretch
 * before the first marker is its own "Opening" beat. Markers at the same time count once; `words` by marker id.
 */
export function beatsFrom(markers: readonly Pick<BlockoutMarker, "id" | "t" | "label">[], duration: number, words: Record<string, string> = {}): Beat[] {
  const end = Math.max(0, duration);
  const list = [...markers].filter((m) => Number.isFinite(m.t) && m.t >= 0 && m.t < end - 0.05).sort((a, b) => a.t - b.t);
  const unique = list.filter((m, i) => i === 0 || m.t - list[i - 1].t > 0.05);
  const starts = unique.length && unique[0].t <= 0.05 ? unique : [{ id: "start", t: 0, label: "Opening" }, ...unique];
  return starts.map((m, i) => ({
    id: m.id,
    start: r3(i === 0 ? 0 : m.t),
    end: r3(i + 1 < starts.length ? starts[i + 1].t : end),
    label: m.label.trim() || `Beat ${i + 1}`,
    words: (words[m.id] ?? "").trim().slice(0, BLOCKOUT.maxBeatWords),
  }));
}

/** Beats as an API or MCP caller sent them: in order, inside the blockout, no overlaps, the last one running to its end. */
export function normalizeBeats(beats: readonly Partial<Beat>[], duration: number): Beat[] {
  const list = beats
    .filter((b) => b && Number.isFinite(b.start))
    .map((b, i) => ({ id: String(b.id || `b${i}`).slice(0, 40), start: clamp(b.start!, 0, duration), label: String(b.label ?? "").trim().slice(0, 80), words: String(b.words ?? "").trim().slice(0, BLOCKOUT.maxBeatWords) }))
    .sort((a, b) => a.start - b.start);
  return beatsFrom(
    list.map((b) => ({ id: b.id, t: b.start, label: b.label })),
    duration,
    Object.fromEntries(list.map((b) => [b.id, b.words])),
  );
}

// ---------------------------------------------------------------------------
// References

export type RefRole = "interior" | "exterior" | "location" | "character" | "prop" | "style";

export const REF_ROLES: { id: RefRole; name: string; hint: string }[] = [
  { id: "character", name: "Character", hint: "Who the mannequin becomes" },
  { id: "interior", name: "Interior", hint: "The room or corridor the grey boxes stand for" },
  { id: "exterior", name: "Exterior", hint: "The outside the blockout shows" },
  { id: "location", name: "Location", hint: "The place, inside or out" },
  { id: "prop", name: "Prop", hint: "An object one of the boxes stands for" },
  { id: "style", name: "Look", hint: "Only the colour, light and texture" },
];

export interface BlockoutRef {
  url: string;
  role: RefRole;
  /** What it is ("Mara", "the red door"): from its element's name when it came from Elements. */
  name?: string;
}

/** A reference's role from where it came from: Soul Cast and character elements are characters, Soul Location places. */
export function roleFor(source: { category?: string; kind?: string } | undefined): RefRole {
  const c = `${source?.category ?? ""} ${source?.kind ?? ""}`.toLowerCase();
  if (/character|cast|person|face|soul-?id/.test(c)) return "character";
  if (/location|place|set/.test(c)) return "location";
  if (/interior|room/.test(c)) return "interior";
  if (/exterior|outside/.test(c)) return "exterior";
  if (/prop|object|product/.test(c)) return "prop";
  if (/style|look|mood/.test(c)) return "style";
  return "location";
}

const named = (r: Pick<BlockoutRef, "name">, fallback: string) => (r.name?.trim() ? `${r.name.trim()}, ${fallback}` : fallback);

/** One reference's role, written for the prompt ("@Image2 is the main character: …"). `tag` is how the model names it. */
export function roleSentence(r: Pick<BlockoutRef, "role" | "name">, tag: string): string {
  switch (r.role) {
    case "character":
      return `${tag} is ${named(r, "the main character")}: the mannequin becomes this person, with this face, hair, build and wardrobe in every shot.`;
    case "interior":
      return `${tag} is ${named(r, "the interior")}: the grey boxes become this room, with its architecture, materials, set dressing and light.`;
    case "exterior":
      return `${tag} is ${named(r, "the exterior")}: what is seen outside, with its buildings, weather and light.`;
    case "location":
      return `${tag} is ${named(r, "the location")}: the grey boxes become this place, with its surfaces, set dressing and light.`;
    case "prop":
      return `${tag} is ${named(r, "a prop")}: the box that stands for it becomes this object, at the same size and place.`;
    case "style":
      return `${tag} is the look: match its colour, contrast, light and texture, not its content.`;
  }
}

// ---------------------------------------------------------------------------
// The prompt

export type PromptTarget = "seedance" | "h3" | "open";

export interface BlockoutPromptInput {
  beats: readonly Beat[];
  refs: readonly Pick<BlockoutRef, "role" | "name">[];
  style?: string;
  /** Extra rules ("She never looks at the camera"). */
  constraints?: string;
  /** What is heard: one sound per item ("Footsteps on concrete", "A distant siren"). */
  audio?: readonly string[];
  /** What must not happen or be seen. */
  avoid?: readonly string[];
  /** Seedance: @Video1 and @Image1…; H3 Max 3D: a plain scene intent of at most 2000 characters; open: Wan's short prompt. */
  target: PromptTarget;
  /** The tag of the last frame of the shot before (a later shot of a long blockout), when it rides along as an image. */
  previousFrame?: number;
  /** Sound is made (Seedance's audio on): the Audio section is written. */
  sound?: boolean;
}

/** fal's reference syntax for Seedance 2.5: "@Image1", "@Video1". */
export const imageTag = (i: number) => `@Image${i}`;
export const VIDEO_TAG = "@Video1";
/** The most H3 Max 3D to video's scene intent holds (its schema's maxLength). */
export const H3_INTENT_MAX = 2000;
/** Wan's text encoder reads about 512 tokens: the open engine's prompt is kept short. */
export const OPEN_PROMPT_MAX = 1200;

const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  return !t ? "" : /[.!?…]$/.test(t) ? t : `${t}.`;
};
const secs = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const beatLine = (b: Beat) => `${secs(b.start)}–${secs(b.end)}s — ${b.label}${b.words ? `: ${sentence(b.words)}` : ""}`;

/** The structured prompt (Subject, Action, Camera, Style, Constraints, Audio, No) for a blockout or one shot of it. */
export function compileBlockoutPrompt(i: BlockoutPromptInput): string {
  const beats = i.beats.filter((b) => b.end > b.start);
  const style = sentence(i.style ?? "");
  const order = beats.map((b) => b.label).filter(Boolean);
  const avoid = (i.avoid ?? []).map((a) => a.trim().replace(/[.]+$/, "")).filter(Boolean);
  const audio = (i.audio ?? []).map((a) => a.trim().replace(/[.]+$/, "")).filter(Boolean);
  if (i.target === "open") {
    // Wan follows the depth for camera and blocking: the words say what it looks like and what happens, briefly.
    const who = i.refs.filter((r) => r.role === "character" && r.name?.trim()).map((r) => r.name!.trim());
    const parts = [style, who.length ? `${who.join(" and ")} in the scene.` : "", ...beats.map((b) => sentence(b.words || b.label)), "Cinematic, photographic, natural motion, consistent identity and set."];
    return cap(parts.filter(Boolean).join(" "), OPEN_PROMPT_MAX);
  }
  const seedance = i.target === "seedance";
  const tag = (n: number) => (seedance ? imageTag(n) : `Reference ${n}`);
  const subject = [
    seedance
      ? `${VIDEO_TAG} is a grey-box 3D blockout: it sets the camera path, framing, blocking, environment geometry and timing. Its grey boxes, planes and mannequins are stand-ins.`
      : "The video is a grey-box 3D blockout: its grey boxes, planes and mannequins are stand-ins for the real set and people.",
    ...i.refs.map((r, k) => roleSentence(r, tag(k + 1))),
    ...(i.previousFrame ? [`${tag(i.previousFrame)} is the last frame of the shot before this one: start exactly from it, with the same people, set and light.`] : []),
  ];
  const camera = seedance
    ? `Follow ${VIDEO_TAG} exactly: preserve the blockout's shot sizes, angles, camera positions, lens, handheld movement and cuts; nothing moves the camera that the blockout doesn't.`
    : "Camera, movement and timing come from the video: keep them exactly.";
  const rules = [
    order.length > 1 ? `Events happen in this order: ${order.join(", then ")}.` : "",
    "Every person, place and object stays consistent with its reference in every shot.",
    "Replace every grey box with the real surface it stands for; never show grey geometry, a mannequin or a wireframe.",
    sentence(i.constraints ?? ""),
  ].filter(Boolean);
  const sections: [string, string][] = [
    ["Subject", subject.join(" ")],
    ["Action", beats.map(beatLine).join("\n")],
    ["Camera", camera],
    ["Style", style],
    ["Constraints", rules.join(" ")],
    ["Audio", i.sound && audio.length ? `${audio.join("; ")}.` : ""],
    ["No", avoid.length ? `${avoid.join(", ")}.` : ""],
  ];
  const text = sections
    .filter(([, body]) => body)
    .map(([h, body]) => (h === "Action" ? `${h}:\n${body}` : `${h}: ${body}`))
    .join("\n\n");
  return seedance ? text : cap(text, H3_INTENT_MAX);
}

/** At most `max` characters, cut at a sentence or a line where it can be. */
function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return (at > max * 0.6 ? cut.slice(0, at + 1) : cut.slice(0, max - 1) + "…").trim();
}

/** The beats inside a stretch of the blockout, clipped to it and timed from its start (a shot's own clock). */
export function beatsIn(beats: readonly Beat[], start: number, end: number): Beat[] {
  return beats
    .filter((b) => b.end > start + 0.01 && b.start < end - 0.01)
    .map((b) => ({ ...b, start: r3(Math.max(b.start, start) - start), end: r3(Math.min(b.end, end) - start) }));
}

// ---------------------------------------------------------------------------
// Shots (a blockout longer than one call) and the open engine's windows

export interface Shot {
  index: number;
  /** Seconds of the blockout. */
  start: number;
  end: number;
}

/**
 * Cut a blockout `duration` seconds long into shots of at most `max` seconds, at the markers (`cuts`, seconds) where it
 * can: each shot ends at the latest marker that keeps it within `max` (and leaves at least `min` for what follows), else
 * at `max` exactly. A blockout within `max` is one shot.
 */
export function splitShots(duration: number, cuts: readonly number[], max: number, min = 2): Shot[] {
  const total = Math.max(0, duration);
  const marks = [...new Set(cuts.filter((c) => c > 0 && c < total).map(r3))].sort((a, b) => a - b);
  const shots: Shot[] = [];
  let start = 0;
  while (total - start > 1e-6) {
    if (total - start <= max + 1e-6) {
      shots.push({ index: shots.length, start: r3(start), end: r3(total) });
      break;
    }
    const fits = marks.filter((c) => c - start >= min - 1e-6 && c - start <= max + 1e-6 && total - c >= min - 1e-6);
    let end = fits.length ? fits[fits.length - 1] : start + max;
    if (total - end < min) end = total - min;
    shots.push({ index: shots.length, start: r3(start), end: r3(end) });
    start = end;
  }
  return shots;
}

/** The open engine works at 16 fps in windows of 81 frames (Wan 2.2 Fun VACE). */
export const OPEN_FPS = 16;
export const OPEN_WINDOW = 81;
/** The most windows one blockout makes on the open engine (12 ≈ 60 s). */
export const OPEN_MAX_WINDOWS = 12;

export interface DepthWindow {
  index: number;
  /** Frames of the 16 fps depth video. */
  startFrame: number;
  frames: number;
  /** Seconds (what the segment cut is given): exact, so the cut keeps exactly `frames` frames. */
  start: number;
  end: number;
}

/**
 * The 81-frame windows over a blockout `seconds` long at `fps`: each starts on the last frame of the one before (that
 * frame, as the window rendered it, is the next window's first frame, so they chain without a jump), and each holds 4n+1
 * frames (Wan's grid). A tail shorter than 9 frames is folded into nothing: the film ends with the last full window's
 * frame, at most half a second early.
 */
export function depthWindows(seconds: number, fps = OPEN_FPS, size = OPEN_WINDOW): DepthWindow[] {
  const total = Math.floor(Math.max(0, seconds) * fps + 1e-6);
  const out: DepthWindow[] = [];
  let at = 0;
  while (out.length < OPEN_MAX_WINDOWS) {
    const left = total - at;
    const frames = Math.min(size, Math.floor((left - 1) / 4) * 4 + 1);
    if (frames < 9 && out.length) break;
    if (frames < 5) break;
    out.push({ index: out.length, startFrame: at, frames, start: at / fps, end: (at + frames) / fps });
    if (frames < size) break;
    at += frames - 1;
  }
  return out;
}

/** How many seconds the windows render (the joined film repeats one frame at each seam: the chain's hand-over). */
export const windowsSeconds = (w: readonly DepthWindow[]) => (w.length ? r3((w[w.length - 1].startFrame + w[w.length - 1].frames) / OPEN_FPS) : 0);
