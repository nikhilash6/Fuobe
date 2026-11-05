/**
 * Where this browser keeps the studios' engine switch (Cloud / Open source), and what a studio starts on. Pure, for
 * src/lib/api.ts (useEngine) and its tests.
 *
 * Hosted runs off (every self-hosted install by default), and the owner: one switch for the browser, `fuobe.engine`,
 * starting on Cloud, as always. While runs can go to the install's own GPUs (`viewer.hosted`), open models run free
 * there, so the switch starts on Open source: each account keeps its own (a second account on the same browser keeps
 * its own too), starting on Cloud only when the account picked its key as the place for its runs (`runOn` "key"). A
 * guest keeps one for the browser. Saving a key never moves it.
 */
import type { Engine } from "./catalog/types";

/** The browser's one switch: hosted runs off, and the owner. */
export const ENGINE_KEY = "fuobe.engine";
/** The switch this browser used last while hosted runs were on, so a page opens on it before the status answers. */
export const ENGINE_SLOT_KEY = "fuobe.engineSlot";
/** An account's own switch while hosted runs are on: this, then a short tag of the account. */
export const ACCOUNT_ENGINE_PREFIX = "fuobe.engine.a.";
/** A guest's switch while hosted runs are on. */
export const GUEST_ENGINE_KEY = "fuobe.engine.guest";

export interface EngineSlot {
  /** The storage key, or null when there is none yet (an account whose email hasn't answered): the pick then lasts for the page. */
  key: string | null;
  /** What the switch starts on while nothing is kept there. */
  start: Engine;
}

/** The browser's one switch, starting on Cloud. */
export const SHARED_SLOT: EngineSlot = { key: ENGINE_KEY, start: "cloud" };

/**
 * A short tag for an account in a storage key: a hash of its email (FNV-1a), so no address is written to the browser's
 * storage. Two accounts sharing a tag would only share a switch.
 */
export function accountTag(email: string): string {
  let h = 0x811c9dc5;
  for (const ch of email.trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** What the slot needs to know: the status's viewer and who is signed in. */
export interface SlotFacts {
  /** The status has answered (until then the browser's last slot is used). */
  known: boolean;
  viewer?: { kind: "guest" | "account"; hosted?: boolean; runOn?: string };
  /** The signed-in account's email (GET /api/auth/me), when it has answered. */
  email?: string | null;
  /** ENGINE_SLOT_KEY as stored. */
  cached?: string | null;
}

const isAccountKey = (k: string | null | undefined): k is string => !!k && k.startsWith(ACCOUNT_ENGINE_PREFIX) && k.length > ACCOUNT_ENGINE_PREFIX.length;
const isHostedKey = (k: string | null | undefined): k is string => k === GUEST_ENGINE_KEY || isAccountKey(k);

/** Where this viewer's switch is kept, and what it starts on. */
export function engineSlot(f: SlotFacts): EngineSlot {
  if (!f.known) return isHostedKey(f.cached) ? { key: f.cached, start: "open" } : SHARED_SLOT;
  const v = f.viewer;
  if (!v?.hosted) return SHARED_SLOT;
  if (v.kind !== "account") return { key: GUEST_ENGINE_KEY, start: "open" };
  const start: Engine = v.runOn === "key" ? "cloud" : "open";
  if (f.email) return { key: `${ACCOUNT_ENGINE_PREFIX}${accountTag(f.email)}`, start };
  return { key: isAccountKey(f.cached) ? f.cached : null, start };
}

/** The slot to remember for the next page (while hosted runs are on), null to forget it, undefined before the status answers. */
export const slotToCache = (f: SlotFacts, slot: EngineSlot): string | null | undefined => (!f.known ? undefined : f.viewer?.hosted && isHostedKey(slot.key) ? slot.key : null);

/**
 * What a saved key does to the switch the studios start on: Cloud (the person just asked for paid models), except while
 * hosted runs are on, where it stays (open models run free on the install's GPUs; Cloud is one pick away).
 */
export const engineAfterKeySave = (hosted: boolean): Engine | null => (hosted ? null : "cloud");

/** The engine kept in `slot`, or what it starts on. */
export function storedEngine(storage: Pick<Storage, "getItem"> | null | undefined, slot: EngineSlot): Engine {
  if (!slot.key || !storage) return slot.start;
  try {
    const v = storage.getItem(slot.key);
    return v === "open" || v === "cloud" ? v : slot.start;
  } catch {
    return slot.start;
  }
}
