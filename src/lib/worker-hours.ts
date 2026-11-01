/**
 * A worker's allowed hours (docs/gpu-workers.md): a time zone and weekly windows, as the owner sets them in Settings →
 * Workers. `{ "tz": "Asia/Kolkata", "days": { "mon": [["01:00", "09:00"]], … } }`; `{ "always": true }` for all day,
 * every day. No hours at all: never (a new worker takes nothing until the owner sets them). A window whose end is not
 * after its start runs past midnight ("22:00"–"06:00"). "24:00" is the end of the day.
 *
 * Pure: the server and the tests share it. Daylight-saving jumps move a window by the jump at most.
 */

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof DAYS)[number];

export type Hours = { always: true } | { tz: string; days: Partial<Record<Day, [string, string][]>> };

const HHMM = /^([01]\d|2[0-4]):([0-5]\d)$/;
const minutes = (t: string) => {
  const m = HHMM.exec(t);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v <= 24 * 60 ? v : null;
};

/** Hours as stored, checked: null when they are not valid. */
export function parseHours(value: unknown): Hours | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.always === true) return { always: true };
  if (typeof v.tz !== "string" || !validZone(v.tz) || !v.days || typeof v.days !== "object") return null;
  const days: Partial<Record<Day, [string, string][]>> = {};
  for (const [d, list] of Object.entries(v.days as Record<string, unknown>)) {
    if (!(DAYS as readonly string[]).includes(d) || !Array.isArray(list) || list.length > 8) return null;
    const ok = list.every((w) => Array.isArray(w) && w.length === 2 && typeof w[0] === "string" && typeof w[1] === "string" && minutes(w[0]) !== null && minutes(w[1]) !== null && w[0] !== w[1]);
    if (!ok) return null;
    days[d as Day] = list as [string, string][];
  }
  return { tz: v.tz, days };
}

export function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The weekday (0 = Sunday) and minute of the day at `now` in `tz`. */
function local(now: number, tz: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Every window as [start, end) in minutes from the start of this local week (Sunday 00:00), over two weeks. */
function spans(h: Exclude<Hours, { always: true }>): [number, number][] {
  const out: [number, number][] = [];
  for (let week = 0; week < 2; week++) {
    DAYS.forEach((d, i) => {
      for (const [a, b] of h.days[d] ?? []) {
        const s = minutes(a)!;
        let e = minutes(b)!;
        if (e <= s) e += 24 * 60;
        const base = (week * 7 + i) * 24 * 60;
        out.push([base + s, base + e]);
      }
    });
  }
  // Windows that touch become one (Monday until 24:00 and Tuesday from 00:00).
  out.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const w of out) {
    const last = merged.at(-1);
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  return merged;
}

/** Where `now` is: inside a window (and when it ends), or outside (and when the next one starts). Null hours: never. */
export function hoursAt(hours: Hours | null, now: number): { inside: boolean; endsAt: number | null; nextChangeAt: number | null } {
  if (!hours) return { inside: false, endsAt: null, nextChangeAt: null };
  if ("always" in hours) return { inside: true, endsAt: null, nextChangeAt: null };
  const { day, minute } = local(now, hours.tz);
  // Minutes since the start of this local week; also look at last week's windows that run into this one.
  const at = day * 24 * 60 + minute;
  const all = spans(hours);
  const shifted = all.flatMap(([s, e]) => [[s, e] as [number, number], [s - 7 * 24 * 60, e - 7 * 24 * 60] as [number, number]]);
  const nowMs = now - (now % 60_000);
  const toMs = (m: number) => nowMs + (m - at) * 60_000;
  const cur = shifted.find(([s, e]) => s <= at && at < e);
  if (cur) {
    // An all-week window never ends.
    return cur[1] - cur[0] >= 7 * 24 * 60 ? { inside: true, endsAt: null, nextChangeAt: null } : { inside: true, endsAt: toMs(cur[1]), nextChangeAt: toMs(cur[1]) };
  }
  const next = shifted.filter(([s]) => s > at).sort((x, y) => x[0] - y[0])[0];
  return { inside: false, endsAt: null, nextChangeAt: next ? toMs(next[0]) : null };
}

/** "back at 01:00" in the worker's own zone. */
export function clock(ms: number, tz?: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
}
