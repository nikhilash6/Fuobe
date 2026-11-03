/**
 * A cut-out's outline (pure): the outer edge of a picture's opaque part, traced from its transparency on a small grid
 * (at most 256 px on its long side). Marching squares find the edge at half opacity between pixels, the outer loop of
 * the largest piece is kept, Ramer–Douglas–Peucker drops the points a straight line already passes, and the rest is
 * joined with smooth curves (Catmull–Rom as cubic Béziers). The path starts at the lowest point, so a line drawn along
 * the ground can run straight into it. A picture with no transparency gives null: it gets a drawn frame instead.
 */

import type { Outline } from "./scene";

/** The grid's long side. */
export const OUTLINE_GRID = 256;

type Pt = [number, number];

/** The largest 8-connected piece of `mask` (1 inside), as its own mask, and its size. */
function largestPiece(mask: Uint8Array, w: number, h: number): { piece: Uint8Array; area: number } {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = 0;
  let bestArea = 0;
  let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i]) continue;
    next++;
    let area = 0;
    let top = 0;
    stack[top++] = i;
    label[i] = next;
    while (top) {
      const p = stack[--top];
      area++;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || (!dx && !dy)) continue;
          const q = yy * w + xx;
          if (mask[q] && !label[q]) {
            label[q] = next;
            stack[top++] = q;
          }
        }
      }
    }
    if (area > bestArea) {
      bestArea = area;
      best = next;
    }
  }
  const piece = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) piece[i] = label[i] === best ? 1 : 0;
  return { piece, area: bestArea };
}

/**
 * The marching-squares loops of `field` (values 0..255, padded by a zero border) at `iso`. Edge points sit where the
 * value crosses `iso` along a cell's side (interpolated), so the loop is sub-pixel smooth.
 */
function loops(field: Float32Array, W: number, H: number, iso: number): Pt[][] {
  // Corners are pixel centres; cell (x, y) spans corners x..x+1, y..y+1.
  const v = (x: number, y: number) => field[y * W + x];
  const hKey = (x: number, y: number) => (y * W + x) * 2;
  const vKey = (x: number, y: number) => (y * W + x) * 2 + 1;
  const point = new Map<number, Pt>();
  const at = (key: number): Pt => {
    let p = point.get(key);
    if (p) return p;
    const cell = key >> 1;
    const x = cell % W;
    const y = (cell - x) / W;
    if (key & 1) {
      // Vertical side from (x, y) to (x, y + 1).
      const a = v(x, y);
      const b = v(x, y + 1);
      p = [x, y + (iso - a) / (b - a || 1)];
    } else {
      const a = v(x, y);
      const b = v(x + 1, y);
      p = [x + (iso - a) / (b - a || 1), y];
    }
    point.set(key, p);
    return p;
  };
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = v(x, y) >= iso ? 8 : 0;
      const tr = v(x + 1, y) >= iso ? 4 : 0;
      const br = v(x + 1, y + 1) >= iso ? 2 : 0;
      const bl = v(x, y + 1) >= iso ? 1 : 0;
      const c = tl | tr | br | bl;
      if (c === 0 || c === 15) continue;
      const T = hKey(x, y);
      const B = hKey(x, y + 1);
      const L = vKey(x, y);
      const R = vKey(x + 1, y);
      const centre = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 >= iso;
      switch (c) {
        case 1: case 14: link(L, B); break;
        case 2: case 13: link(B, R); break;
        case 3: case 12: link(L, R); break;
        case 4: case 11: link(T, R); break;
        case 6: case 9: link(T, B); break;
        case 7: case 8: link(T, L); break;
        case 5:
          if (centre) {
            link(T, L);
            link(B, R);
          } else {
            link(T, R);
            link(L, B);
          }
          break;
        case 10:
          if (centre) {
            link(T, R);
            link(L, B);
          } else {
            link(T, L);
            link(B, R);
          }
          break;
      }
    }
  }
  const seen = new Set<number>();
  const out: Pt[][] = [];
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop: Pt[] = [];
    let prev = -1;
    let cur = start;
    for (;;) {
      seen.add(cur);
      loop.push(at(cur));
      const nbrs = links.get(cur)!;
      const nxt = nbrs[0] !== prev ? nbrs[0] : nbrs[1];
      if (nxt === undefined || nxt === start || seen.has(nxt)) break;
      prev = cur;
      cur = nxt;
    }
    if (loop.length > 2) out.push(loop);
  }
  return out;
}

const perimeter = (pts: Pt[]) => pts.reduce((s, p, i) => s + Math.hypot(p[0] - pts[(i + 1) % pts.length][0], p[1] - pts[(i + 1) % pts.length][1]), 0);

/** Ramer–Douglas–Peucker on an open polyline. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > far) {
        far = d;
        at = i;
      }
    }
    if (far > eps && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A closed loop through `pts` as smooth cubic Béziers (uniform Catmull–Rom), with its length. */
export function smoothClosedPath(pts: Pt[]): { d: string; length: number } {
  const n = pts.length;
  const parts = [`M${r2(pts[0][0])} ${r2(pts[0][1])}`];
  let length = 0;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    parts.push(`C${r2(c1[0])} ${r2(c1[1])} ${r2(c2[0])} ${r2(c2[1])} ${r2(p2[0])} ${r2(p2[1])}`);
    // The curve's length, from 12 points along it.
    let px = p1[0];
    let py = p1[1];
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      const u = 1 - t;
      const x = u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0];
      const y = u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1];
      length += Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
  }
  parts.push("Z");
  return { d: parts.join(""), length };
}

/**
 * The outline of a picture's opaque part from its alpha (one byte a pixel, `w` × `h`, on the traced grid), or null
 * when the picture has no real transparency or no piece big enough to trace.
 */
export function traceOutline(alpha: ArrayLike<number>, w: number, h: number): Outline | null {
  const n = w * h;
  if (!n) return null;
  let clear = 0;
  for (let i = 0; i < n; i++) if (alpha[i] < 128) clear++;
  // Nearly no transparency: a photo, not a cut-out.
  if (clear < n * 0.02) return null;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = alpha[i] >= 128 ? 1 : 0;
  const { piece, area } = largestPiece(mask, w, h);
  if (area < n * 0.005) return null;
  // The piece's own alpha on a grid with a clear border one pixel wide.
  const W = w + 2;
  const H = h + 2;
  const field = new Float32Array(W * H);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Pixels next to the piece keep their soft alpha (the edge stays smooth); the rest is clear.
      let near = piece[i];
      if (!near) {
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && piece[yy * w + xx]) near = 1;
        }
      }
      field[(y + 1) * W + x + 1] = near ? alpha[i] : 0;
    }
  }
  const all = loops(field, W, H, 127.5);
  if (!all.length) return null;
  const outer = all.reduce((a, b) => (perimeter(b) > perimeter(a) ? b : a));
  // Back to picture pixels (the border shifts by one), the pixel centres at +0.5.
  let pts: Pt[] = outer.map(([x, y]) => [x - 0.5, y - 0.5]);
  // Clockwise on screen (y down): a positive signed area.
  const signed = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0);
  if (signed < 0) pts.reverse();
  // Start at the lowest point (nearest the middle on a flat base).
  const maxY = Math.max(...pts.map((p) => p[1]));
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  let start = 0;
  let best = Infinity;
  pts.forEach((p, i) => {
    if (p[1] < maxY - 0.75) return;
    const d = Math.abs(p[0] - cx);
    if (d < best) {
      best = d;
      start = i;
    }
  });
  pts = [...pts.slice(start), ...pts.slice(0, start)];
  // A closed loop is simplified as two halves, split at the point farthest from the start.
  let far = 0;
  pts.forEach((p, i) => {
    if (Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = i;
  });
  const simple = [...simplify(pts.slice(0, far + 1), 0.6).slice(0, -1), ...simplify([...pts.slice(far), pts[0]], 0.6).slice(0, -1)];
  if (simple.length < 3) return null;
  const { d, length } = smoothClosedPath(simple);
  return { w, h, d, length, start: [r2(simple[0][0]), r2(simple[0][1])] };
}
