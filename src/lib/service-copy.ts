/**
 * Display copy: optional sentences an install's billing service may send with its policy answer (`Policy.copy`,
 * docs/billing-hook.md), keyed by where they show. Each one may hold placeholders that the code fills in: `{when}`
 * ("at 14:20", "in about 40 min", "in a moment"), `{n}` (a count) and `{line}` (a run's place in line, "6 ahead of you ·
 * about 9 min"). A key the service doesn't send, or one whose sentence names a placeholder the code doesn't fill there,
 * shows the code's own plain sentence (the fallback at each call site), so an install with no service reads those.
 *
 * The browser gets the copy as `viewer.copy` in GET /api/status (only while hosted runs are on); the server keeps the
 * latest policy answer's copy for the sentences it writes itself (billing.ts). Both note it here (noteServiceCopy).
 */

export const COPY_KEYS = [
  /** A daily limit on free runs here: "{when}" it refreshes. */
  "limitDaily",
  /** An hourly limit on free runs here: "{when}" it refreshes. */
  "limitHour",
  /** A limit on free runs from one network: "{when}" it refreshes. */
  "limitNetwork",
  /** A limit on free text helper replies: "{when}" it refreshes. */
  "limitReplies",
  /** A run's place in line with many runs ahead of it: "{line}" (its place and wait), "{n}" ahead. */
  "queueBusy",
  /** A run that has waited long in line: it is saved and starts by itself. */
  "queueLong",
  /** Chat: the next reply to be written is this one. */
  "chatNext",
  /** Chat: "{n}" replies ahead of this one. */
  "chatAhead",
  /** The lyrics helper can't take this request now. */
  "lyricsBusy",
  /** The free text helper can't take a run's text step now. */
  "writeBusy",
] as const;

export type CopyKey = (typeof COPY_KEYS)[number];

export type ServiceCopy = Partial<Record<CopyKey, string>>;

/** The longest sentence kept (characters); a longer one is left out. */
export const COPY_MAX = 300;

const KEYS: ReadonlySet<string> = new Set(COPY_KEYS);

/** A service's copy as kept: known keys only, text only, control characters out, spaces folded. Null when none is left. */
export function cleanCopy(raw: unknown): ServiceCopy | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: ServiceCopy = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEYS.has(key) || typeof value !== "string") continue;
    const s = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
    if (s && s.length <= COPY_MAX) out[key as CopyKey] = s;
  }
  return Object.keys(out).length ? out : null;
}

declare global {
  var __fuobeServiceCopy: ServiceCopy | null | undefined;
}

/** Note the copy the service last gave (the status in the browser, a policy answer on the server). */
export function noteServiceCopy(raw: unknown): void {
  globalThis.__fuobeServiceCopy = cleanCopy(raw);
}

/** The copy as last noted (null: none). */
export const knownCopy = (): ServiceCopy | null => globalThis.__fuobeServiceCopy ?? null;

/** A sentence with its placeholders filled; null when it names one that isn't given. */
function fill(template: string, vars: Record<string, string | number>): string | null {
  let missing = false;
  const s = template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) missing = true;
    return v === undefined ? "" : String(v);
  });
  return missing ? null : s;
}

/**
 * The sentence for `key`: the service's when it sent one (filled in), else `fallback` filled in the same way.
 * `copy`: the copy to read (default: the copy last noted).
 */
export function copyLine(key: CopyKey, vars: Record<string, string | number>, fallback: string, copy: ServiceCopy | null = knownCopy()): string {
  const own = copy?.[key];
  return (own && fill(own, vars)) ?? fill(fallback, vars) ?? fallback;
}
