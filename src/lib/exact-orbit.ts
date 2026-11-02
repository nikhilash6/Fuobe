/**
 * Exact orbits (research new-models-7.md §3.10 rows 3-5): an orbit move picked in Fuobe DoP, Cinema's
 * Director or Image to 3D, set by numbers instead of a LoRA's or a prompt's idea of an orbit: how far round (30-360°),
 * which way (seen from above), a height tilt (0-20°, a ring tilted like the camera path library's Tilted ring) and a
 * radius pulse (none or 25% in, twice). The numbers become the camera path library's keys (src/lib/camera-path.ts), so
 * both engines film them the way Fly path does: H3 Max camera-controls on the cloud, Uni3C on your GPU.
 *
 * Pure: no DOM, no server.
 */

import { PHOTO_KEY, type CameraKey } from "./camera-path";

export type OrbitDirection = "cw" | "ccw";

export interface ExactOrbit {
  /** Degrees round the subject, 30-360. */
  degrees: number;
  /** Seen from above: counter-clockwise moves the camera round to the right (camera-path's + azimuth). */
  direction: OrbitDirection;
  /** Degrees the ring is tilted (0 = level) about the line of sight: it rises over the first half turn and dips below over the second. */
  tilt: number;
  /** How far the camera moves in and out on the way round (0 or 0.25 = 25% closer, twice). */
  pulse: number;
}

export const EXACT_LIMITS = { degrees: { min: 30, max: 360, step: 5 }, tilt: { min: 0, max: 20, step: 1 }, pulses: [0, 0.25] } as const;

export const DIRECTION_NAMES: Record<OrbitDirection, string> = { cw: "Clockwise", ccw: "Counter-clockwise" };

const DEG = Math.PI / 180;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const tidy = (n: number, digits = 3) => Number(n.toFixed(digits)) + 0;

/**
 * The orbit moves that take the Exact switch, by Fuobe DoP preset id and by Cinema move slug, with the numbers each starts
 * from. Arc Left moves the camera round to the left (clockwise from above), Arc Right to the right.
 */
export const EXACT_DEFAULTS: Readonly<Record<string, ExactOrbit>> = {
  // Fuobe DoP / Motions (src/lib/catalog/motions.ts, Orbit)
  "motion-360-orbit": { degrees: 360, direction: "ccw", tilt: 0, pulse: 0 },
  "motion-arc-left": { degrees: 90, direction: "cw", tilt: 0, pulse: 0 },
  "motion-arc-right": { degrees: 90, direction: "ccw", tilt: 0, pulse: 0 },
  "motion-lazy-orbit": { degrees: 60, direction: "ccw", tilt: 5, pulse: 0 },
  // Cinema's Director (src/lib/catalog/cinema.ts CAMERA_MOVES)
  "drone-orbit": { degrees: 360, direction: "ccw", tilt: 15, pulse: 0 },
  "arc-left": { degrees: 90, direction: "cw", tilt: 0, pulse: 0 },
  "arc-right": { degrees: 90, direction: "ccw", tilt: 0, pulse: 0 },
  "bullet-time": { degrees: 180, direction: "ccw", tilt: 0, pulse: 0 },
};

/** Whether a DoP preset or a Cinema move takes the Exact switch. */
export const takesExact = (id: string | null | undefined): boolean => !!id && Object.hasOwn(EXACT_DEFAULTS, id);

/** The numbers a move starts from (360° counter-clockwise, level, for anything else). */
export function exactDefaults(id?: string | null): ExactOrbit {
  return { ...(id && Object.hasOwn(EXACT_DEFAULTS, id) ? EXACT_DEFAULTS[id] : { degrees: 360, direction: "ccw" as const, tilt: 0, pulse: 0 }) };
}

/** The numbers inside their ranges: degrees 30-360 in 5° steps, tilt 0-20°, pulse 0 or 25%. */
export function normalizeExact(o: Partial<ExactOrbit> | undefined, fallback: ExactOrbit = exactDefaults()): ExactOrbit {
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const { degrees, tilt } = EXACT_LIMITS;
  return {
    degrees: clamp(Math.round(num(o?.degrees, fallback.degrees) / degrees.step) * degrees.step, degrees.min, degrees.max),
    direction: o?.direction === "cw" || o?.direction === "ccw" ? o.direction : fallback.direction,
    tilt: clamp(Math.round(num(o?.tilt, fallback.tilt)), tilt.min, tilt.max),
    pulse: num(o?.pulse, fallback.pulse) >= 0.125 ? 0.25 : 0,
  };
}

/** The most keys an exact orbit has: 12, all of which H3 Max takes, so both engines follow the same keys. */
export const EXACT_MAX_KEYS = 12;

/**
 * The orbit as camera-path keys, evenly spaced in time from the photo's pose: a key at least every 30° (at least 5 keys,
 * so a tilt and a pulse show on a short arc). The tilt is a ring tilted about the photo's line of sight (elevation =
 * asin(sin tilt · sin turned)), rising first whichever way it turns; the pulse takes the camera 25% in and out twice.
 */
export function exactOrbitKeys(input: Partial<ExactOrbit>): CameraKey[] {
  const o = normalizeExact(input);
  const n = clamp(Math.ceil(o.degrees / 30 - 1e-9), 4, EXACT_MAX_KEYS - 1);
  const sign = o.direction === "ccw" ? 1 : -1;
  return Array.from({ length: n + 1 }, (_, i) => {
    const f = i / n;
    const turned = o.degrees * f;
    if (i === 0) return { ...PHOTO_KEY };
    return {
      t: tidy(f, 4),
      azimuth: tidy(sign * turned, 2),
      elevation: tidy(Math.asin(Math.sin(o.tilt * DEG) * Math.sin(turned * DEG)) / DEG, 2),
      distance: tidy(1 - o.pulse * Math.sin(2 * Math.PI * f) ** 2, 4),
    };
  });
}

/** The numbers in a few words: "360° counter-clockwise · tilt 10° · pulse 25%". */
export function exactSummary(input: Partial<ExactOrbit>): string {
  const o = normalizeExact(input);
  return [`${o.degrees}° ${DIRECTION_NAMES[o.direction].toLowerCase()}`, o.tilt ? `tilt ${o.tilt}°` : "level", ...(o.pulse ? [`pulse ${Math.round(o.pulse * 100)}%`] : [])].join(" · ");
}

/** Where a tilted ring takes the camera's height over `degrees` (elevation = asin(sin tilt · sin turned)). */
function tiltPath(degrees: number): string {
  if (degrees <= 90) return "rises as it goes";
  if (degrees <= 180) return "rises above eye level and comes back down";
  if (degrees < 360) return "rises above eye level, then dips below it";
  return "rises above eye level, dips as far below it and comes back to eye level";
}

/** Words for a model that reads the path from the prompt (the cloud's reference route): where the camera goes. */
export function exactWords(input: Partial<ExactOrbit>): string {
  const o = normalizeExact(input);
  const way = o.direction === "ccw" ? "to the right" : "to the left";
  const how = o.degrees >= 360 ? "a full 360-degree orbit" : `a ${o.degrees}-degree arc`;
  const tilt = o.tilt ? `, the ring tilted ${o.tilt} degrees so the camera ${tiltPath(o.degrees)}` : ", at a constant height";
  const pulse = o.pulse ? ", moving in and out twice on the way" : "";
  return `The camera makes ${how} around the subject, moving ${way}${tilt}${pulse}, keeping the subject centered`;
}
