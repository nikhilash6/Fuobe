import "server-only";
import { CLOUD_PROVIDERS, type CloudProvider, type KeyInfo } from "@/lib/your-keys";
import { accountKeyRecord, setAccountKey } from "./auth";
import { accountKeyContext, open, seal } from "./secret-box";
import { savedSetting } from "./settings";

/**
 * Your keys (public sign-up): an account's own fal.ai key or Replicate token. Sealed on its record in auth.json
 * (secret-box.ts, bound to the account and the provider), so it goes with the account. Opened on each use and never
 * kept in plain text, so a removed or replaced key stops at once. Only provider-keys.ts hands one to a provider call;
 * nothing here ever returns a key to a browser (accountKeyInfo: the last 4 characters).
 */

/** The account's key for a provider, opened; null when it has none, or this server can't open it (never another key). */
export function accountKey(id: string, p: CloudProvider): string | null {
  const record = accountKeyRecord(id, p);
  return record ? open(record.sealed, accountKeyContext(id, p)) : null;
}

/** What Settings → Your keys shows, per provider: never the key. */
export function accountKeyInfo(id: string): Record<CloudProvider, KeyInfo | null> {
  const info = (p: CloudProvider): KeyInfo | null => {
    const r = accountKeyRecord(id, p);
    return r ? { last4: r.last4, addedAt: r.addedAt, readable: accountKey(id, p) !== null, ...(r.rejectedAt && { rejectedAt: r.rejectedAt }) } : null;
  };
  return { fal: info("fal"), replicate: info("replicate") };
}

/** A key as typed, trimmed; null when it can't be one (empty, spaces inside, too long). The provider has the last word. */
export function cleanKey(raw: unknown): string | null {
  const key = typeof raw === "string" ? raw.trim() : "";
  return /^[\x21-\x7e]{8,300}$/.test(key) ? key : null;
}

/** Seal and save a key the provider accepted (the caller checks it first). */
export function saveAccountKey(id: string, p: CloudProvider, key: string): KeyInfo {
  const stored = { sealed: seal(key, accountKeyContext(id, p)), last4: key.slice(-4), addedAt: Date.now() };
  setAccountKey(id, p, stored);
  return { last4: stored.last4, addedAt: stored.addedAt, readable: true };
}

export function removeAccountKey(id: string, p: CloudProvider): void {
  setAccountKey(id, p, null);
}

/** The provider refused the key in a run: Settings says so. Only when `used` is still the saved key (not one replaced since). */
export function markKeyRejected(id: string, p: CloudProvider, used: string): void {
  const record = accountKeyRecord(id, p);
  if (!record || record.rejectedAt || accountKey(id, p) !== used) return;
  setAccountKey(id, p, { ...record, rejectedAt: Date.now() });
}

/** The studio lets accounts run paid models on their own keys: it isn't open-source only (Settings → Engine mode). */
export const paidAllowed = () => savedSetting("engineMode") !== "open";

/** The providers the account has a key for that this server can open. */
export const accountProviders = (id: string): CloudProvider[] => CLOUD_PROVIDERS.filter((p) => accountKey(id, p) !== null);

/**
 * The engine mode an account's work runs with: "both" (open models on its own GPU, paid ones on its own keys) while it
 * has a key this server can open and the studio isn't open-source only; otherwise "open".
 */
export function accountEngineMode(id: string): "open" | "both" {
  return paidAllowed() && accountProviders(id).length > 0 ? "both" : "open";
}
