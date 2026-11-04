import type { MediaKind } from "./catalog/types";

/**
 * A guest's whole studio draft through sign-up (hosted runs on): the words, the model and its settings, the preset and
 * the files attached (kept in this browser: held-files.ts), saved in this tab's sessionStorage per page. Run pressed by a
 * guest also saves the run itself with the price it showed: back on the same page as an account, the studio restores
 * the draft, uploads the kept files as the account's own, and starts the run by itself when the price is unchanged, the
 * draft is the one Run was pressed on and every kept file came back; otherwise it says why and waits for a click.
 */

/** An attachment as the studio draft keeps it (src/components/studio/media-slot.tsx SlotValue). */
export interface DraftValue {
  id?: string;
  ref: string;
  preview: string;
  kind: MediaKind;
  name?: string;
  uploading?: boolean;
  /** Kept in this browser until the guest signs up (held-files.ts): `ref` is a stand-in until it is uploaded. */
  held?: string;
  source?: "upload" | "generation";
  sketch?: unknown;
}

/** The parts of a studio draft that hold attachments; everything else is kept as it is. */
export interface DraftLike<V extends DraftValue = DraftValue> {
  slots: Partial<Record<string, V | null>>;
  refs: V[];
  frames?: { value: V; at: number }[];
}

/** Every attachment of a draft passed through `fn` (null takes it out: an empty slot, a reference or a frame gone). */
export function mapValues<D extends DraftLike>(d: D, fn: (v: D["refs"][number]) => D["refs"][number] | null): D {
  const slots = Object.fromEntries(Object.entries(d.slots).map(([k, v]) => [k, v ? fn(v) : v])) as D["slots"];
  const refs = d.refs.map(fn).filter((v): v is D["refs"][number] => !!v);
  const frames = d.frames?.flatMap((f) => {
    const v = fn(f.value);
    return v ? [{ ...f, value: v }] : [];
  });
  return { ...d, slots, refs, ...(d.frames && { frames }) };
}

/** The attachments a draft keeps in this browser, by kept-file id. */
export function heldValues(d: DraftLike): DraftValue[] {
  const out: DraftValue[] = [];
  mapValues(d, (v) => (v.held && out.push(v), v));
  return out;
}

/**
 * A draft as it is saved: a kept file without its preview (a page address that dies with the page), and an upload that
 * hasn't finished taken out (nothing of it would be there after a reload).
 */
export function keepDraft<D extends DraftLike>(d: D): D {
  return mapValues(d, (v) => (v.held ? { ...v, preview: "", uploading: undefined } : v.uploading || v.preview.startsWith("blob:") ? null : v));
}

const DAY = 24 * 60 * 60_000;
const draftKey = (path: string) => `fuobe:guest-draft:${path}`;
const PENDING_KEY = "fuobe:pending-run";

function store(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Save a guest's draft for this page. Never throws (a full or blocked storage keeps nothing). */
export function saveDraft(path: string, d: DraftLike & Record<string, unknown>): void {
  try {
    store()?.setItem(draftKey(path), JSON.stringify({ at: Date.now(), draft: keepDraft(d) }));
  } catch {}
}

/** The draft saved for this page within a day, or null. */
export function readDraft<D extends DraftLike>(path: string): D | null {
  try {
    const raw = store()?.getItem(draftKey(path));
    if (!raw) return null;
    const kept = JSON.parse(raw) as { at?: number; draft?: D };
    if (!kept.draft || !kept.at || Date.now() - kept.at > DAY) return null;
    return kept.draft;
  } catch {
    return null;
  }
}

export function clearDraft(path: string): void {
  try {
    store()?.removeItem(draftKey(path));
  } catch {}
}

/** The kept files every draft saved in this tab holds (any page's): the files this tab may still need. */
export function savedHeldIds(): Set<string> {
  const out = new Set<string>();
  try {
    const s = store();
    if (!s) return out;
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key?.startsWith(draftKey(""))) continue;
      const d = readDraft(key.slice(draftKey("").length));
      if (d) for (const v of heldValues(d)) out.add(v.held!);
    }
  } catch {}
  return out;
}

/**
 * A short fingerprint of a draft as it is saved (keepDraft): the run a guest pressed starts by itself only on the same
 * draft, never on one edited after Run was pressed.
 */
export function draftPrint(d: DraftLike): string {
  const s = JSON.stringify(keepDraft(d));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length.toString(36)}.${h.toString(36)}`;
}

/** The price a guest's run showed when Run was pressed (null: none to compare, so it never starts by itself). */
export type ShownPrice = { amount: number; priceVersion: string; text: string } | null;

export interface PendingRun {
  path: string;
  shown: ShownPrice;
  at: number;
  /** The draft Run was pressed on (draftPrint). */
  draft?: string;
}

/** A guest pressed Run here on this draft: kept for this tab, to start once signed up. */
export function savePendingRun(path: string, shown: ShownPrice, draft?: DraftLike): void {
  try {
    store()?.setItem(PENDING_KEY, JSON.stringify({ path, shown, at: Date.now(), ...(draft && { draft: draftPrint(draft) }) } satisfies PendingRun));
  } catch {}
}

/** Is this the draft the guest pressed Run on (not one edited since)? */
export function sameDraft(run: Pick<PendingRun, "draft">, kept: DraftLike | null): boolean {
  return !!run.draft && !!kept && draftPrint(kept) === run.draft;
}

/** The run pressed on this page within the hour, taken (it starts at most once), or null. */
export function takePendingRun(path: string): PendingRun | null {
  try {
    const s = store();
    const raw = s?.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingRun;
    if (p.path !== path) return null;
    s!.removeItem(PENDING_KEY);
    return Date.now() - p.at < 60 * 60_000 ? p : null;
  } catch {
    return null;
  }
}

/** Is the price now the one the guest saw (the same amount and the same words)? Then the run starts by itself. */
export function priceUnchanged(shown: ShownPrice, now: { allowed: boolean; amount: number; text: string } | undefined): boolean {
  return !!shown && !!now && now.allowed && now.amount === shown.amount && now.text === shown.text;
}

/**
 * A saved draft as it comes back: its kept files listed (to show again for a guest, or to upload for an account), each
 * without a preview until its file is read, and marked uploading for an account so Run waits for them.
 */
export function restoredDraft<D extends DraftLike>(kept: D, account: boolean): { draft: D; held: DraftValue[] } {
  const held: DraftValue[] = [];
  const draft = mapValues(kept, (v) => (v.held ? (held.push(v), { ...v, preview: "", uploading: account || undefined }) : v));
  return { draft, held };
}

/**
 * The words a restored draft starts with: a prompt the link brought (?prompt=, still in the address the sign-up returns
 * to) wins over the saved words, as it does for the words kept per page; but the run its guest pressed comes back with
 * the words it was pressed on (`pressed`: that run is back, on the same draft).
 */
export function restoredPrompt(link: string, saved: string, pressed: boolean): string {
  return pressed ? saved : link || saved;
}

/**
 * What the run a guest pressed does once back as an account:
 * - lost: one of its kept files didn't come back (gone from the browser, or its upload refused): it never starts without
 *   it, and the person is asked to add it again;
 * - wait: the draft, its files or the price check haven't settled;
 * - ask: the draft was edited after Run was pressed (`same` false): it waits for a click on what is there now;
 * - start: the price is the one the guest saw;
 * - note: a new price, shown, and Run waits for a click;
 * - none: something is missing (the blocker says what), it would run elsewhere, it is refused now, or no price was shown
 *   to compare.
 */
export function pendingStep(o: {
  settled: boolean;
  blocked: boolean;
  pool: boolean;
  shown: ShownPrice;
  quote?: { allowed: boolean; amount: number; text: string };
  lost: boolean;
  same: boolean;
}): "wait" | "start" | "note" | "ask" | "lost" | "none" {
  if (o.lost) return "lost";
  if (!o.settled) return "wait";
  if (o.blocked || !o.pool) return "none";
  if (!o.same) return o.quote?.allowed ? "ask" : "none";
  if (priceUnchanged(o.shown, o.quote)) return "start";
  return o.shown && o.quote?.allowed && o.quote.text ? "note" : "none";
}
