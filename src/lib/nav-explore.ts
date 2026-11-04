/**
 * How much of Fuobe this browser has tried, and what to try next. Kept in this browser only (localStorage, read and
 * written by components/nav/explore-tracker.tsx, every access guarded): no server, no cookie, no analytics. Pure, so
 * the counting and the suggestion are testable.
 */
import { entriesFor, entry, type NavEntry, type ViewerKind } from "./nav-model";

/** A JSON list of entry ids, oldest first. */
export const EXPLORE_KEY = "fuobe:explored";
/** The most ids kept (the oldest go first). */
export const EXPLORE_MAX = 200;

/** The stored list, tolerant of anything unexpected: not JSON, not a list, numbers in it, repeats. */
export function parseExplored(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(-EXPLORE_MAX);
  } catch {
    return [];
  }
}

/** The list with one more id at its end (the same list when it's there already), at most EXPLORE_MAX long. */
export function withExplored(list: string[], id: string): string[] {
  if (!id || list.includes(id)) return list;
  return [...list, id].slice(-EXPLORE_MAX);
}

/** What counts towards exploring: the studios this viewer sees (the "28 studios" the launcher and the sheet show). */
export function explorable(kind: ViewerKind | undefined): NavEntry[] {
  return entriesFor(kind).filter((e) => e.kind === "studio" && !!e.group);
}

/** "9 of 28 studios tried": tried ids among what this viewer may explore. */
export function exploreProgress(kind: ViewerKind | undefined, explored: string[]): { done: number; total: number } {
  const all = explorable(kind);
  const seen = new Set(explored);
  return { done: all.filter((e) => seen.has(e.id)).length, total: all.length };
}

/**
 * The next studio to try: one not tried yet that shares the most goals with the last one tried (a film studio after
 * a film studio), then a group's lead (Cinema, Shorts, Marketing, Fashion Factory: the premium ones), then a popular
 * one, then the launcher's order. Nothing this viewer can't see.
 */
export function nextToTry(kind: ViewerKind | undefined, explored: string[], lastId?: string): NavEntry | undefined {
  const seen = new Set(explored);
  const goals = new Set(lastId ? (entry(lastId)?.goals ?? []) : []);
  let best: NavEntry | undefined;
  let bestScore = -1;
  for (const e of explorable(kind)) {
    if (seen.has(e.id)) continue;
    // Goals in common first, popular as a tie-break; the first in the model's order wins a tie (strictly greater).
    const score = e.goals.filter((g) => goals.has(g)).length * 10 + (e.lead ? 3 : 0) + (e.popular ? 1 : 0);
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}
