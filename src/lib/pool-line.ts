/**
 * The words for a run's place in line on this studio's GPUs (hosted runs), shared by the price check before Run and the
 * run's tile: "Next in line · about 40 s", "In line · 3rd · about 2 min". A run shows only "In line" (with its place and
 * wait), "Working" (with its progress), then its result.
 */

/** "In line · 3rd · about 40 s": a run's place on this studio's GPUs (1: next), and the wait, about. */
export function lineWords(q: { place: number; etaSeconds: number | null }): string {
  const n = Math.max(1, Math.floor(q.place));
  const ord = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  const s = q.etaSeconds;
  const eta = s === null || !Number.isFinite(s) || s < 0 ? "" : s < 60 ? ` · about ${Math.max(5, Math.round(s / 5) * 5)} s` : ` · about ${Math.round(s / 60)} min`;
  return n === 1 ? `Next in line${eta}` : `In line · ${n}${ord}${eta}`;
}
