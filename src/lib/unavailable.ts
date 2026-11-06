/**
 * One rule for every choice the current model or mode can't do (a resolution, a quality, a length, a mode):
 * it stays in view, looks clearly unavailable, and pressing it says why in plain words and offers the way to get it.
 * Nothing is hidden and nothing is refused without a word.
 */

/** Why a choice can't be picked now, and the one step that makes it possible (when there is one). */
export interface Unavailable {
  /** Plain words, no full stop: "720p and 1080p need MiniMax H3". */
  why: string;
  /** The way to get it: a short verb ("Switch", "Use 720p") and what it does. */
  fix?: { label: string; run: () => void };
}

/** The words said for a turned-off choice that came without its own reason. */
export const UNAVAILABLE_FALLBACK = "Not available with this setup";

/**
 * An option's unavailable state: its own `unavailable`, else a plain `disabled` (older call sites) read the same way,
 * with its `title` as the reason.
 */
export function unavailableOf(o: { unavailable?: Unavailable | false | null; disabled?: boolean; title?: string }): Unavailable | undefined {
  if (o.unavailable) return o.unavailable;
  if (o.disabled) return { why: o.title?.trim() || UNAVAILABLE_FALLBACK };
  return undefined;
}

/**
 * What pressing an option does: an available one is picked; an unavailable one is never picked, and its reason is
 * said instead (the caller shows the note with the way to get it).
 */
export function pressOption<T>(o: { value: T; unavailable?: Unavailable | false | null; disabled?: boolean; title?: string }, pick: (v: T) => void, say: (v: T, u: Unavailable) => void): void {
  const u = unavailableOf(o);
  if (u) say(o.value, u);
  else pick(o.value);
}

/**
 * The note's fix, run: the step itself, then the note closes. Kept apart so a test can run it without a page.
 */
export function runFix(u: Unavailable, close: () => void): void {
  u.fix?.run();
  close();
}

/** "720p", "720p and 1080p", "720p, 1080p and 2K". */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The ARIA a choice gets when it can't be picked: still focusable and pressable (to hear why), never `disabled`. */
export function unavailableAria(u: Unavailable | undefined): { "aria-disabled"?: true } {
  return u ? { "aria-disabled": true } : {};
}
