/**
 * Assist's scheduled tasks (Supercomputer's "Scheduled Tasks"): a prompt that runs as a new chat on
 * the server's clock — daily, on some weekdays, every N hours or once — in an IANA time zone.
 * Pure, so the server's sweep and the schedule dialog's "Next run" preview share it.
 *
 * Clock changes: a time a spring-forward skips runs as much later as the clocks jumped (02:30 on
 * the night the clocks go 02:00 → 03:00 runs at 03:30); a time a fall-back repeats runs once, the
 * first time. "Every N hours" counts real hours, so it doesn't move with the clocks.
 */

export type ScheduleRule =
  /** Every day at a wall-clock time ("09:00"). */
  | { kind: "daily"; time: string }
  /** Some weekdays (0 = Sunday … 6 = Saturday) at a wall-clock time. */
  | { kind: "weekly"; days: number[]; time: string }
  /** Every N real hours, counted from `from` (when the task was saved). */
  | { kind: "hours"; every: number; from: number }
  /** Once, at a wall-clock date and time ("2026-10-30T14:00"). */
  | { kind: "once"; at: string };

/** Ask first: the plan waits in the chat as an approval card. Auto: plans run up to `capUsd` per run. */
export type ScheduleApproval = "ask" | "auto";

export const SCHEDULE_HOURS = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168] as const;
export const MAX_SCHEDULE_HOURS = 168;
export const MAX_SCHEDULE_PROMPT = 4000;
/** The most a run may spend on its own, per run. */
export const MAX_SCHEDULE_CAP_USD = 500;
export const DEFAULT_SCHEDULE_CAP_USD = 2;

/** A scheduled task as the UI sees it. */
export interface ScheduleView {
  id: string;
  title: string;
  prompt: string;
  attachments: string[];
  projectId: string | null;
  rule: ScheduleRule;
  tz: string;
  approval: ScheduleApproval;
  capUsd: number | null;
  engine: "cloud" | "open";
  /** The mode choice runs start with (null: the default from Settings). The local agent is "local"; tasks saved before LM Studio and Unsloth Studio support say "ollama" (read as "local"). */
  mode: { mode: "free" | "smart" | "manual"; agent?: "claude" | "hosted" | "local" | "ollama" | "offline"; provider?: string | null; model?: string | null; effort?: "low" | "medium" | "high" | "xhigh" | "max" | null } | null;
  /** Whether runs may use the connectors in Settings (Claude runs only). Their tools run without asking, so it's off unless the task opts in. */
  connectors: boolean;
  paused: boolean;
  /** When it runs next (null: paused, or a one-off that has run). */
  nextRunAt: number | null;
  lastRunAt: number | null;
  last: ScheduleResult | null;
  runs: number;
  createdAt: number;
  updatedAt: number;
}

/** How the last run went, read live from its chat. */
export interface ScheduleResult {
  threadId: string | null;
  /** running: still going; waiting: a plan waits for approval; done: finished; failed: an error stopped it; skipped: the run before was still going. */
  status: "running" | "waiting" | "done" | "failed" | "skipped";
  /** Results it started, a short reason, or the error. */
  text: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/** Whether this runtime knows the IANA zone ("Europe/Berlin"). */
export function validTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The rule's problem in words, or null when it's valid. */
export function ruleError(rule: ScheduleRule): string | null {
  switch (rule.kind) {
    case "daily":
      return TIME.test(rule.time) ? null : "Pick a time";
    case "weekly":
      if (!rule.days.length || rule.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Pick at least one day";
      return TIME.test(rule.time) ? null : "Pick a time";
    case "hours":
      return Number.isInteger(rule.every) && rule.every >= 1 && rule.every <= MAX_SCHEDULE_HOURS ? null : `Every 1 to ${MAX_SCHEDULE_HOURS} hours`;
    case "once": {
      const m = LOCAL.exec(rule.at);
      if (!m) return "Pick a date and time";
      const [, y, mo, d] = m.map(Number);
      const date = new Date(Date.UTC(y, mo - 1, d));
      return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? null : "Pick a real date";
    }
  }
}

// ---------------------------------------------------------------------------
// Wall clocks in a time zone (Intl only: no time-zone library)

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, f);
  }
  return f;
}

export interface WallClock {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  /** 0 = Sunday. */
  weekday: number;
}

function clockParts(ms: number, tz: string): WallClock & { s: number } {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const y = Number(p.year);
  const mo = Number(p.month);
  const d = Number(p.day);
  return { y, mo, d, h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second), weekday: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}

/** The date and time a clock in `tz` shows at the instant `ms`. */
export function wallClock(ms: number, tz: string): WallClock {
  const { y, mo, d, h, mi, weekday } = clockParts(ms, tz);
  return { y, mo, d, h, mi, weekday };
}

/** Minutes `tz` is ahead of UTC at the instant `ms`. */
function offsetMinutes(ms: number, tz: string): number {
  const w = clockParts(ms, tz);
  return Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000) / 60_000);
}

const sameWall = (ms: number, tz: string, y: number, mo: number, d: number, h: number, mi: number) => {
  const w = wallClock(ms, tz);
  return w.y === y && w.mo === mo && w.d === d && w.h === h && w.mi === mi;
};

/**
 * The instant a clock in `tz` shows this date and time. A repeated time (fall-back) gives its first
 * instant; a skipped one (spring-forward) gives the instant as late as the clocks jumped.
 */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const DAY = 86_400_000;
  // The offsets a day either side cover any clock change near this time.
  const before = offsetMinutes(guess - DAY, tz);
  const after = offsetMinutes(guess + DAY, tz);
  const candidates = [...new Set([guess - before * 60_000, guess - after * 60_000])].filter((t) => sameWall(t, tz, y, mo, d, h, mi));
  if (candidates.length) return Math.min(...candidates);
  // Skipped: read the time with the offset from before the jump.
  return guess - before * 60_000;
}

const parseTime = (t: string) => t.split(":").map(Number) as [number, number];

/** The calendar day `k` days after y-mo-d. */
function addDays(y: number, mo: number, d: number, k: number): { y: number; mo: number; d: number; weekday: number } {
  const t = new Date(Date.UTC(y, mo - 1, d + k));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: t.getUTCDay() };
}

/** When the rule runs next, strictly after `after` (null: a one-off whose time has passed, or a broken rule). */
export function nextRun(rule: ScheduleRule, tz: string, after: number): number | null {
  if (ruleError(rule) || !validTimeZone(tz)) return null;
  switch (rule.kind) {
    case "hours": {
      const period = rule.every * 3_600_000;
      if (after < rule.from) return rule.from + period;
      return rule.from + (Math.floor((after - rule.from) / period) + 1) * period;
    }
    case "once": {
      const [, y, mo, d, h, mi] = LOCAL.exec(rule.at)!.map(Number);
      const at = zonedToUtc(y, mo, d, h, mi, tz);
      return at > after ? at : null;
    }
    case "daily":
    case "weekly": {
      const [h, mi] = parseTime(rule.time);
      const today = wallClock(after, tz);
      // A day back covers a time a clock change moved past midnight; 8 ahead covers a weekly rule.
      for (let k = -1; k <= 8; k++) {
        const day = addDays(today.y, today.mo, today.d, k);
        if (rule.kind === "weekly" && !rule.days.includes(day.weekday)) continue;
        const at = zonedToUtc(day.y, day.mo, day.d, h, mi, tz);
        if (at > after) return at;
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Words

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** Monday first, as the day picker shows them. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayList(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => WEEK_ORDER.indexOf(a as 0) - WEEK_ORDER.indexOf(b as 0));
  if (set.length === 7) return "Every day";
  if (set.length === 5 && [1, 2, 3, 4, 5].every((d) => set.includes(d))) return "Weekdays";
  if (set.length === 2 && set.includes(0) && set.includes(6)) return "Weekends";
  const names = set.map((d) => `${WEEKDAYS[d]}s`);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "Every day at 09:00", "Mondays and Thursdays at 18:30", "Every 6 hours", "Once, 30 Oct 2026 at 14:00". */
export function describeRule(rule: ScheduleRule): string {
  switch (rule.kind) {
    case "daily":
      return `Every day at ${rule.time}`;
    case "weekly":
      return `${dayList(rule.days)} at ${rule.time}`;
    case "hours":
      return rule.every === 1 ? "Every hour" : rule.every % 24 === 0 && rule.every > 24 ? `Every ${rule.every / 24} days` : `Every ${rule.every} hours`;
    case "once": {
      const m = LOCAL.exec(rule.at);
      if (!m) return "Once";
      return `Once, ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]} at ${m[4]}:${m[5]}`;
    }
  }
}

/** "Tue 28 Oct, 09:00" in the task's zone. */
export function formatWhen(ms: number, tz: string): string {
  const w = wallClock(ms, tz);
  return `${WEEKDAYS[w.weekday].slice(0, 3)} ${w.d} ${MONTHS[w.mo - 1]}, ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
}

/** "in 5 min", "in 3 h", "in 2 days" (or "now" when it's due). */
export function untilText(ms: number, now: number): string {
  const s = Math.round((ms - now) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  if (s < 86_400 * 2) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86_400)} days`;
}

/** A short zone label: "Europe/Berlin (GMT+1)". */
export function zoneLabel(tz: string, at = Date.now()): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value;
    return name ? `${tz.replace(/_/g, " ")} (${name})` : tz;
  } catch {
    return tz;
  }
}

// ---------------------------------------------------------------------------
// Spending: what a scheduled run may start on its own

/**
 * Whether an auto-run plan priced `price` may start without asking, when this run has already
 * spent `spent` of `cap` (both USD). No cap: anything runs (a chat with Ask first off). An unknown
 * price, or one that would pass the cap, waits for the user, with the reason.
 */
export function withinCap(cap: number | null, spent: number, price: number | null): { ok: true } | { ok: false; reason: string } {
  if (cap === null) return { ok: true };
  if (price === null) return { ok: false, reason: "its price isn't known in advance" };
  if (spent + price > cap + 1e-9) {
    const left = Math.max(0, cap - spent);
    return { ok: false, reason: `it costs about $${price.toFixed(2)} and this run has $${left.toFixed(2)} left of its $${cap.toFixed(2)} cap` };
  }
  return { ok: true };
}

/**
 * What a plan would really spend: demo jobs cost nothing and jobs that can't run don't start; null
 * when a job that would run for real has no price.
 */
export function spendOf(jobs: { costUsd: number | null; demo: boolean; error?: string }[]): number | null {
  const real = jobs.filter((j) => !j.demo && !j.error);
  if (real.some((j) => j.costUsd === null)) return null;
  return Math.round(real.reduce((n, j) => n + (j.costUsd ?? 0), 0) * 1000) / 1000;
}
