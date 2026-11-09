import "server-only";
import { db } from "./db";

/**
 * The line's install-wide settings (the owner's, through GET and PATCH /api/admin/queue/settings; docs/admin-api.md):
 *
 * - `runCeilingS`: the longest one attempt at a job on this install's GPUs may run, in seconds: a default, and a value
 *   per lane that overrides it. It ends the generation's own clock and is the most a worker's run limit may be.
 * - `ownerWaitLimitS`: how long the owner's own jobs on the workers may wait in line before a worker first takes them
 *   (null: no limit). People's runs go first, so the owner's jobs can wait a long time.
 * - `fairShare`: off, the line goes strictly by class, then by when each job came. On, an account's (or the owner's)
 *   next job goes after every other account's job that came before it and is the first of its own.
 * - `pickAllowanceMs`: how long a job in the lane a worker has loaded may go ahead of an older one in another lane, so a
 *   worker doesn't reload its models for every job (0: strict order).
 * - `pausedBudgetS`: how long, in all, a run that has started may spend back in line while its worker steps aside (another
 *   program on its GPU, a pause) and still be inside its hold's deadline. With the run ceiling, it sets the time a run
 *   asks its hold to stay open (holdTiming). A run past it still delivers its result.
 *
 * Kept in the settings table under one key, as JSON. Nothing set: the defaults, which are today's fixed values.
 */

export interface QueueSettings {
  runCeilingS: { default: number; lanes: Record<string, number> };
  ownerWaitLimitS: number | null;
  fairShare: boolean;
  pickAllowanceMs: number;
  pausedBudgetS: number;
}

export const QUEUE_DEFAULTS: QueueSettings = { runCeilingS: { default: 2700, lanes: {} }, ownerWaitLimitS: null, fairShare: false, pickAllowanceMs: 0, pausedBudgetS: 7200 };

/** The bounds each value may take. */
export const QUEUE_BOUNDS = {
  ceilingS: { min: 60, max: 24 * 3600 },
  ownerWaitS: { min: 60, max: 7 * 24 * 3600 },
  pickAllowanceMs: { min: 0, max: 3_600_000 },
  pausedBudgetS: { min: 0, max: 7 * 24 * 3600 },
  lanes: 200,
};

const KEY = "queue.settings";
const LANE = /^[0-9a-f]{12}$|^small$/;

declare global {
  var __fuobeQueueSettings: { at: number; raw: string | null; value: QueueSettings } | undefined;
}

const copy = (s: QueueSettings): QueueSettings => ({ ...s, runCeilingS: { default: s.runCeilingS.default, lanes: { ...s.runCeilingS.lanes } } });

/** The settings this version knows. */
const QUEUE_KEYS = ["runCeilingS", "ownerWaitLimitS", "fairShare", "pickAllowanceMs", "pausedBudgetS"];

/**
 * A stored value read leniently: anything that isn't valid is the default (a bad row never stops a run). A setting
 * this version doesn't know (one an earlier or later version stored) is left out, so the others still count.
 */
function fromStored(raw: string | null): QueueSettings {
  if (!raw) return copy(QUEUE_DEFAULTS);
  try {
    const v = JSON.parse(raw) as unknown;
    const known = v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => QUEUE_KEYS.includes(k))) : v;
    const r = checkQueuePatch(known, QUEUE_DEFAULTS);
    return "error" in r ? copy(QUEUE_DEFAULTS) : r.settings;
  } catch {
    return copy(QUEUE_DEFAULTS);
  }
}

/** The settings in effect (read again at most every 2 s: both of a deploy's processes see a change within that). */
export function queueSettings(now = Date.now()): QueueSettings {
  const c = globalThis.__fuobeQueueSettings;
  if (c && now - c.at < 2000) return copy(c.value);
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  const raw = row?.value ?? null;
  const value = c && c.raw === raw ? c.value : fromStored(raw);
  globalThis.__fuobeQueueSettings = { at: now, raw, value };
  return copy(value);
}

const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const inRange = (v: unknown, b: { min: number; max: number }): v is number => whole(v) && v >= b.min && v <= b.max;

/**
 * A change checked against `base`: every field is optional, and a given `runCeilingS` replaces the default and the
 * whole lane list. The error says what is wrong, in words.
 */
export function checkQueuePatch(body: unknown, base: QueueSettings = queueSettings()): { settings: QueueSettings } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send the settings as an object" };
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !QUEUE_KEYS.includes(k));
  if (unknown.length) return { error: `Unknown setting: ${unknown[0]}` };
  const out = copy(base);
  const { min, max } = QUEUE_BOUNDS.ceilingS;
  if (b.runCeilingS !== undefined) {
    const r = b.runCeilingS as { default?: unknown; lanes?: unknown } | null;
    if (!r || typeof r !== "object") return { error: "runCeilingS is { default, lanes }" };
    if (!inRange(r.default, QUEUE_BOUNDS.ceilingS)) return { error: `runCeilingS.default is ${min} to ${max} seconds` };
    const lanes: Record<string, number> = {};
    if (r.lanes !== undefined && r.lanes !== null) {
      if (typeof r.lanes !== "object" || Array.isArray(r.lanes)) return { error: "runCeilingS.lanes maps a lane to seconds" };
      const entries = Object.entries(r.lanes as Record<string, unknown>);
      if (entries.length > QUEUE_BOUNDS.lanes) return { error: `runCeilingS.lanes holds up to ${QUEUE_BOUNDS.lanes} lanes` };
      for (const [lane, s] of entries) {
        if (!LANE.test(lane)) return { error: `No such lane: ${lane.slice(0, 40)}` };
        if (!inRange(s, QUEUE_BOUNDS.ceilingS)) return { error: `The run ceiling for ${lane} is ${min} to ${max} seconds` };
        lanes[lane] = s;
      }
    }
    out.runCeilingS = { default: r.default, lanes };
  }
  if (b.ownerWaitLimitS !== undefined) {
    const w = QUEUE_BOUNDS.ownerWaitS;
    if (b.ownerWaitLimitS !== null && !inRange(b.ownerWaitLimitS, w)) return { error: `ownerWaitLimitS is ${w.min} to ${w.max} seconds, or null for no limit` };
    out.ownerWaitLimitS = b.ownerWaitLimitS as number | null;
  }
  if (b.fairShare !== undefined) {
    if (typeof b.fairShare !== "boolean") return { error: "fairShare is true or false" };
    out.fairShare = b.fairShare;
  }
  if (b.pickAllowanceMs !== undefined) {
    const p = QUEUE_BOUNDS.pickAllowanceMs;
    if (!inRange(b.pickAllowanceMs, p)) return { error: `pickAllowanceMs is ${p.min} to ${p.max}` };
    out.pickAllowanceMs = b.pickAllowanceMs;
  }
  if (b.pausedBudgetS !== undefined) {
    const p = QUEUE_BOUNDS.pausedBudgetS;
    if (!inRange(b.pausedBudgetS, p)) return { error: `pausedBudgetS is ${p.min} to ${p.max} seconds` };
    out.pausedBudgetS = b.pausedBudgetS;
  }
  return { settings: out };
}

/** Save the settings (checked first with checkQueuePatch). */
export function saveQueueSettings(s: QueueSettings): QueueSettings {
  const value = JSON.stringify(s);
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, value);
  globalThis.__fuobeQueueSettings = undefined;
  return queueSettings();
}

/** The run ceiling of a lane, in ms (the default when the lane has none of its own, or isn't known). */
export function runCeilingMs(lane: string | null | undefined, s: QueueSettings = queueSettings()): number {
  const own = lane ? s.runCeilingS.lanes[lane] : undefined;
  return (own ?? s.runCeilingS.default) * 1000;
}

/**
 * How long a run on this install's GPUs asks its hold to stay open once a worker first takes it (the billing service adds
 * the run's wait limit before that): `runMs`, every job of every step given all its attempts (`attemptMs`: the longest
 * one attempt may take in a lane, from its claim to its results sent, which its run ceiling sets), and `pausedMs`, the
 * time a started run may spend back in line (pausedBudgetS).
 */
export function holdTiming(
  steps: { lane: string | null; jobs: number }[],
  attempts: number,
  attemptMs: (lane: string | null) => number,
  s: QueueSettings = queueSettings(),
): { runMs: number; pausedMs: number } {
  const runMs = steps.reduce((sum, j) => sum + Math.max(1, Math.floor(j.jobs) || 1) * attempts * attemptMs(j.lane), 0);
  return { runMs, pausedMs: s.pausedBudgetS * 1000 };
}

/** How long the owner's own job on the workers may wait for its first start (ms), or undefined for no limit. */
export function ownerWaitMs(s: QueueSettings = queueSettings()): number | undefined {
  return s.ownerWaitLimitS === null ? undefined : s.ownerWaitLimitS * 1000;
}
