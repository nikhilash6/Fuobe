import "server-only";

/**
 * A sliding-window limiter in memory, keyed by a string ("up:<accountId>", "run:<accountId>", "gpu:<accountId>"). Each
 * key keeps the times of its recent hits. One server process: a restart starts every count again, which is fine for
 * limits that only keep one account from crowding out the others.
 */

/** A key's recent hits, and when the last of them leaves its window (then the key can go). */
interface Entry {
  times: number[];
  until: number;
}

declare global {
  var __fuobeRates: Map<string, Entry> | undefined;
  var __fuobeRatesSwept: number | undefined;
  var __fuobeRateBusy: Map<string, number> | undefined;
}

/** The most keys kept: past it the least recently used go first. Keys whose window has passed go anyway (sweep). */
export const MAX_RATE_KEYS = 100_000;
/** How often the expired keys are looked for (a walk over every key: not on every hit). */
const SWEEP_MS = 5_000;

const hits = (): Map<string, Entry> => (globalThis.__fuobeRates ??= new Map());

function sweep(map: Map<string, Entry>, now: number): void {
  if (now - (globalThis.__fuobeRatesSwept ?? 0) >= SWEEP_MS) {
    globalThis.__fuobeRatesSwept = now;
    for (const [k, e] of map) if (e.until <= now) map.delete(k);
  }
  // Still too many: the least recently used go (a key moves to the end of the map on each hit), one step each.
  while (map.size > MAX_RATE_KEYS) map.delete(map.keys().next().value!);
}

const retryAfter = (times: number[], limit: number, windowMs: number, now: number) => Math.max(1, Math.ceil((times[times.length - limit] + windowMs - now) / 1000));

/** What a key's hits look like now: ok when another fits; retryAfterS when it doesn't. */
export function peek(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterS: number } {
  const times = (hits().get(key)?.times ?? []).filter((t) => t > now - windowMs);
  if (times.length < limit) return { ok: true, retryAfterS: 0 };
  return { ok: false, retryAfterS: retryAfter(times, limit, windowMs, now) };
}

/** Count a hit when it fits under `limit` in `windowMs`; else refuse it, with the seconds until one fits. */
export function hit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterS: number } {
  const map = hits();
  const times = (map.get(key)?.times ?? []).filter((t) => t > now - windowMs);
  const ok = times.length < limit;
  if (ok) times.push(now);
  if (times.length) {
    map.delete(key);
    map.set(key, { times, until: times[times.length - 1] + windowMs });
  } else map.delete(key);
  sweep(map, now);
  return ok ? { ok, retryAfterS: 0 } : { ok, retryAfterS: retryAfter(times, limit, windowMs, now) };
}

/** Take back the last hit of a key (a request refused for another reason after it was counted). */
export function unhit(key: string): void {
  hits().get(key)?.times.pop();
}

/** How many keys the limiter holds (tests: it must not grow without end). */
export const rateKeyCount = () => hits().size;

/** At most `limit` at once for a key: returns a release function, or null when the key is full. */
export function enter(key: string, limit: number): (() => void) | null {
  const busy = (globalThis.__fuobeRateBusy ??= new Map());
  const n = busy.get(key) ?? 0;
  if (n >= limit) return null;
  busy.set(key, n + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (busy.get(key) ?? 1) - 1;
    if (left > 0) busy.set(key, left);
    else busy.delete(key);
  };
}

/** Tests: forget every count. */
export function resetRates(): void {
  globalThis.__fuobeRates?.clear();
  globalThis.__fuobeRatesSwept = undefined;
  globalThis.__fuobeRateBusy?.clear();
}
