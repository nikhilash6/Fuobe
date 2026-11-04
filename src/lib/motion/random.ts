/**
 * Seeded randomness for scenes (pure). A value is a hash of the seed and a stable key ("particle", 7), not the next
 * number from a stream: particle 7's value is the same however many particles came before it, and whatever order a
 * frame asks in. Scenes never call Math.random.
 */

/** A 32-bit integer mix (an avalanche: every input bit changes about half the output bits). */
function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function absorb(h: number, key: string | number): number {
  if (typeof key === "number") {
    // Integers as themselves; a fraction by its bits.
    const lo = Number.isInteger(key) ? key | 0 : Math.round(key * 1e6) | 0;
    const hi = Number.isInteger(key) ? Math.floor(key / 2 ** 32) | 0 : 0x5bd1e995;
    return mix32((mix32(h ^ lo) + 0x9e3779b9) ^ hi);
  }
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return mix32(h ^ key.length);
}

/** A number in [0, 1) for this seed and key. */
export function rng(seed: number, ...keys: (string | number)[]): number {
  let h = mix32((seed | 0) ^ 0x2545f491);
  for (const k of keys) h = absorb(h, k);
  return mix32(h) / 4294967296;
}

/** A number in [lo, hi) for this seed and key. */
export const rngRange = (lo: number, hi: number, seed: number, ...keys: (string | number)[]): number => lo + (hi - lo) * rng(seed, ...keys);

/** Smooth seeded noise in [-1, 1] along t (value noise with a smoothstep between whole steps): a camera shake's wobble. */
export function noise1(seed: number, key: string, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const s = f * f * (3 - 2 * f);
  const a = rng(seed, key, i) * 2 - 1;
  const b = rng(seed, key, i + 1) * 2 - 1;
  return a + (b - a) * s;
}
