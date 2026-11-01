/**
 * Picture sizes for live edit (pure). The aspect table is defined at 2048 and scaled, on the 32 grid, as the live
 * model's reference Space does. The live size adapts to the GPU: it steps down when frames come slowly and back up
 * when there is room.
 */

export const ASPECTS = {
  "1:1": [2048, 2048],
  "4:3": [2400, 1792],
  "3:4": [1792, 2400],
  "3:2": [2528, 1696],
  "2:3": [1696, 2528],
  "16:9": [2752, 1536],
  "9:16": [1536, 2752],
} as const;
export type Aspect = keyof typeof ASPECTS;
export const ASPECT_NAMES = Object.keys(ASPECTS) as Aspect[];
export const isAspect = (a: unknown): a is Aspect => typeof a === "string" && Object.hasOwn(ASPECTS, a);

const round32 = (n: number) => Math.max(32, Math.round(n / 32) * 32);

/** Text to image: the latent size of an aspect at a resolution. */
export function sizeFor(aspect: Aspect, res: number): [number, number] {
  const [w, h] = ASPECTS[aspect];
  const s = res / 2048;
  return [round32(w * s), round32(h * s)];
}

/** The nearest aspect of a picture. */
export function aspectOf(w: number, h: number): Aspect {
  const r = Math.log(w / h);
  const off = (a: Aspect) => Math.abs(Math.log(ASPECTS[a][0] / ASPECTS[a][1]) - r);
  return ASPECT_NAMES.reduce((best, a) => (off(a) < off(best) ? a : best), "1:1" as Aspect);
}

/** An edit: the model's size for a picture at a resolution (same area as res², the picture's shape, on the 32 grid). */
export function editSize(res: number, w: number, h: number): [number, number] {
  const ratio = w / h;
  return [round32(Math.sqrt(res * res * ratio)), round32(Math.sqrt((res * res) / ratio))];
}

/** Live sizes, smallest first. */
export const LIVE_LADDER = [384, 512, 640, 768] as const;
export type LiveSize = (typeof LIVE_LADDER)[number];
export const isLiveSize = (n: unknown): n is LiveSize => (LIVE_LADDER as readonly unknown[]).includes(n);

/** Keep (master) resolutions the person can pick. */
export const KEEP_LADDER = [1024, 1536, 2048] as const;
export type KeepRes = (typeof KEEP_LADDER)[number];
export const isKeepRes = (n: unknown): n is KeepRes => (KEEP_LADDER as readonly unknown[]).includes(n);

/** Every resolution a live graph may carry: the warm-up's 384, the live ladder and the keep ladder. */
export const GRAPH_RESOLUTIONS: readonly number[] = [...new Set<number>([...LIVE_LADDER, ...KEEP_LADDER])];

/** "Auto" keep detail: the base's long side, between 1024 and 1536. */
export function keepAuto(baseLongSide: number | undefined): KeepRes {
  if (!baseLongSide || baseLongSide < 1536) return 1024;
  return 1536;
}

/** The largest master side Fuobe keeps. */
export const MAX_MASTER_SIDE = 4096;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Auto live size, with hysteresis: down a rung when the median of the last 5 frames is over 1.1 s, up a rung when the
 * median of the last 8 is under 0.45 s. The window starts again after each change, so one slow frame never flips it.
 */
export class AutoSize {
  static readonly SLOW_MS = 1100;
  static readonly FAST_MS = 450;
  private times: number[] = [];
  size: LiveSize;
  private readonly cap: LiveSize;
  constructor(size: LiveSize = 512, cap: LiveSize = 768) {
    this.size = size;
    this.cap = cap;
  }

  /** A frame's render time; returns the size for the next frame. */
  record(ms: number): LiveSize {
    if (!Number.isFinite(ms) || ms <= 0) return this.size;
    this.times.push(ms);
    if (this.times.length > 8) this.times.shift();
    const at = LIVE_LADDER.indexOf(this.size);
    if (this.times.length >= 5 && median(this.times.slice(-5)) > AutoSize.SLOW_MS && at > 0) return this.move(LIVE_LADDER[at - 1]);
    if (this.times.length >= 8 && median(this.times) < AutoSize.FAST_MS && at < LIVE_LADDER.length - 1 && LIVE_LADDER[at + 1] <= this.cap) return this.move(LIVE_LADDER[at + 1]);
    return this.size;
  }

  private move(to: LiveSize): LiveSize {
    this.size = to;
    this.times = [];
    return to;
  }
}
