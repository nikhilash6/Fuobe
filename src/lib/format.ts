export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "";
  if (usd === 0) return "Free";
  if (usd < 0.01) return "<$0.01";
  return `$${usd < 1 ? usd.toFixed(3).replace(/0$/, "") : usd.toFixed(2)}`;
}

export function ratioValue(ar: string | undefined, fallback = 1): number {
  const m = ar ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ar) : null;
  return m ? Number(m[1]) / Number(m[2]) : fallback;
}

export function elapsed(from: number, to = Date.now()): string {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** File space in binary units, as the account limits are written (1 GB = 2^30 bytes): "0 MB", "512 KB", "340 MB", "1.3 GB", "3 GB". */
export function storageSize(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 2 ** 20) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 2 ** 30) return `${Math.round(bytes / 2 ** 20)} MB`;
  return `${Number((bytes / 2 ** 30).toFixed(1))} GB`;
}

/** The first of "Untitled project", "Untitled project 2", "Untitled project 3"… that isn't taken (case-insensitive). */
export function untitledName(taken: readonly string[], base = "Untitled project"): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** A progress report: when it was written (the generation's updatedAt) and how far the job was. */
export interface ProgressMark {
  at: number;
  progress: number;
}

/**
 * What a running tile remembers of its job's progress: the last value it saw, where the pace starts
 * (`first`) and when progress last moved (`last`). The runner rewrites updatedAt on every poll even
 * when progress stands still, so only a change moves `last`, and between changes the time left
 * counts down instead of growing. A tile that opens on a job already part-way through can't know
 * when that value was reached, so it starts at the first change it sees; progress going back (a new
 * stage) starts over.
 */
export interface Pace {
  seen: number | null;
  first: ProgressMark | null;
  last: ProgressMark | null;
}

/** The pace after one more report (`progress` null while queued or unknown); the same object when nothing moved. */
export function notePace(pace: Pace | null, at: number, progress: number | null): Pace {
  if (!pace) return { seen: progress, first: null, last: null };
  if (progress == null || progress === pace.seen) return pace;
  const mark = { at, progress };
  if (!pace.first || progress < (pace.seen ?? 0)) return { seen: progress, first: mark, last: null };
  return { seen: progress, first: pace.first, last: mark };
}

/**
 * Seconds left on a running job, from how fast its progress moved between `first` and `last` (the
 * latest change, see notePace), counted down to `now`. Null until there's a rate to go on (two
 * changes a second or more apart, 5 % done), and at 0 it stays 0 ("almost done") rather than going
 * negative.
 */
export function timeLeft(first: { at: number; progress: number }, last: { at: number; progress: number }, now = Date.now()): number | null {
  const dp = last.progress - first.progress;
  const dt = last.at - first.at;
  if (last.progress < 0.05 || last.progress >= 1 || dp <= 0 || dt < 1000) return null;
  const total = ((1 - last.progress) * dt) / dp;
  return Math.max(0, Math.round((total - (now - last.at)) / 1000));
}

/** 75 → "1m 15s left", 12 → "12s left", 0 → "almost done". */
export function leftLabel(s: number): string {
  if (s <= 0) return "almost done";
  return s < 60 ? `${s}s left` : `${Math.floor(s / 60)}m ${s % 60}s left`;
}
