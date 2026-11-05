/**
 * The words for a run's place in line on this install's GPUs (hosted runs). Before Run, the line under the toolbar says
 * when the result would be ready ("Ready in about 2 min", "Starts when a GPU is free", "Ready in seconds"); a run's tile
 * says where it is and when ("Next in line · ready in about 40 s", "In line · 3rd · starts when a GPU is free"). A run
 * shows only "In line", "Working", then its result: it is taken whatever the line, and never ends for a wait.
 */

/**
 * A place in line (1: next) and the wait, about (`etaSeconds`, until the result; null: unknown). `unknown`: no GPU that
 * could run it can take it now, so it starts when one is free; `returnAt` (epoch ms): when the first of them is due
 * back, when one says. `light`: light work only (joins, trims), which needs no GPU.
 */
export interface LineFacts {
  place: number;
  etaSeconds: number | null;
  unknown?: boolean;
  returnAt?: number;
  light?: boolean;
}

/** "about 40 s", "about 2 min", "about 3 h". */
export function aboutWords(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s`;
  if (seconds < 90 * 60) return `about ${Math.max(1, Math.round(seconds / 60))} min`;
  return `about ${Math.round(seconds / 3600)} h`;
}

/**
 * When the run would be done, or start, in words inside a sentence: "ready in about 40 s", "ready in seconds", "starts
 * when a GPU is free", "starts in about 3 h". Null when nothing is known (no estimate yet): nothing is guessed.
 */
export function waitWords(q: LineFacts, now = Date.now()): string | null {
  if (q.light) return "ready in seconds";
  if (q.unknown) {
    const ms = q.returnAt ? q.returnAt - now : 0;
    return ms > 0 ? `starts in ${aboutWords(ms / 1000)}` : "starts when a GPU is free";
  }
  const s = q.etaSeconds;
  return s === null || !Number.isFinite(s) || s < 0 ? null : `ready in ${aboutWords(s)}`;
}

/** The same words opening a line of their own ("Ready in about 2 min"). */
export const capitalFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "In line · 3rd · ready in about 2 min": a run's place on this install's GPUs (1: next), and its wait (waitWords). */
export function lineWords(q: LineFacts, now = Date.now()): string {
  const n = Math.max(1, Math.floor(q.place));
  const ord = n % 100 >= 11 && n % 100 <= 13 ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  const head = n === 1 ? "Next in line" : `In line · ${n}${ord}`;
  const wait = waitWords(q, now);
  return wait ? `${head} · ${wait}` : head;
}
