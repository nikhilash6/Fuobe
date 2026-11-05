import { CLOUD_KEY, CLOUD_PROVIDERS, type CloudProvider } from "./your-keys";

/**
 * Connected accounts: what a saved fal.ai key or Replicate token tells about its provider account (the balance, the
 * account's name), for Settings and the account menu. The server reads it with the key (src/server/
 * provider-account-info.ts, GET /api/key-info); the browser only ever gets these fields, never a key, its last
 * characters or the provider's own text. The owner sees the studio's keys, an account its own keys, a guest nothing.
 */

/**
 * What the provider said, as the page shows it:
 *   ok         the account answered (a balance when the key may read it)
 *   empty      the balance is empty: "Top up"
 *   link       no balance the key may read: a link to the provider's billing page
 *   check-key  the provider didn't accept the key
 */
export type AccountState = "ok" | "empty" | "link" | "check-key";

export interface Money {
  amount: number;
  /** An ISO 4217 code, such as "USD". */
  currency: string;
}

export interface ProviderAccount {
  provider: CloudProvider;
  /** When the provider was asked (ms). */
  checkedAt: number;
  state: AccountState;
  /** The provider account's username (fal.ai: the team's name for a team key), its kind and its full name when given. */
  account?: { name: string; kind?: "user" | "organization"; fullName?: string };
  balance?: Money;
  /** Settings only (?detail=1), for a fal.ai key that may read its usage. */
  spentThisMonth?: Money;
  billingUrl: string;
}

/** GET /api/key-info: one entry per saved key. */
export interface KeyInfoAnswer {
  providers: ProviderAccount[];
}

export const KEY_INFO_URL = "/api/key-info";

/** A refresh asks the provider at most once in this time per key (the server keeps to it; the button waits as long). */
export const KEY_INFO_REFRESH_GAP_MS = 10_000;

/** "$24.50" in the reader's own number format (the narrow sign: "$", never "US$"); a code it can't format as "24.50 XYZ". */
export function money(m: Money, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency, currencyDisplay: "narrowSymbol" }).format(m.amount);
  } catch {
    return `${m.amount.toFixed(2)} ${m.currency}`;
  }
}

/** The part of /api/status this reads (StatusInfo in src/lib/api.ts). */
export interface KeyInfoStatus {
  providers: Record<string, { configured: boolean } | undefined>;
  viewer?: { kind: "guest" | "account"; keys?: CloudProvider[]; paidAllowed?: boolean };
}

/**
 * The providers whose saved key "Connected accounts" shows: the studio's (owner, not in Open source only), or the
 * account's own (a studio with paid models on). [] for an account with no key (it gets "Add a key"); null while the
 * status is unknown and for anyone else (a guest, the owner in Open source only), who gets nothing.
 */
export function savedProviders(kind: "owner" | "account" | "guest" | undefined, status: KeyInfoStatus | undefined, engineMode: string): CloudProvider[] | null {
  if (!status || !kind || kind === "guest") return null;
  if (kind === "owner") {
    if (status.viewer || engineMode === "open") return null;
    return CLOUD_PROVIDERS.filter((p) => status.providers[p]?.configured);
  }
  const v = status.viewer;
  if (v?.kind !== "account" || v.paidAllowed === false) return null;
  return CLOUD_PROVIDERS.filter((p) => v.keys?.includes(p));
}

/**
 * The value at the end of a provider's row in the account menu. `amount`: the balance; `link`: the provider's billing
 * page; `fix`: the key, in Settings. Undefined info (the answer failed, or the key isn't in it) reads as the link.
 */
export function menuValue(info: ProviderAccount | undefined): { text: string; kind: "amount" | "empty" | "link" | "fix" } {
  if (info?.state === "check-key") return { text: "Check key", kind: "fix" };
  if (info?.state === "empty") return { text: info.balance ? `${money(info.balance)} · Top up` : "Top up", kind: "empty" };
  if (info?.state === "ok" && info.balance) return { text: money(info.balance), kind: "amount" };
  return { text: "See balance", kind: "link" };
}

/** A row's name for a screen reader: what it says, and where it goes. */
export function menuLabel(p: CloudProvider, info: ProviderAccount | undefined): string {
  const { label } = CLOUD_KEY[p];
  const v = menuValue(info);
  if (v.kind === "fix") return `${label}: check your key in Settings`;
  if (v.kind === "amount") return `${label} balance ${v.text}. Opens ${label} billing in a new tab`;
  if (v.kind === "empty") return `${label} balance empty. Top up on ${label} (opens in a new tab)`;
  return `See your ${label} balance on ${label} (opens in a new tab)`;
}

/** "Updated just now", "Updated 4 min ago", "Updated 2 h ago". */
export function updatedWords(at: number, now: number): string {
  const s = Math.max(0, now - at) / 1000;
  if (s < 60) return "Updated just now";
  if (s < 3600) return `Updated ${Math.floor(s / 60)} min ago`;
  return `Updated ${Math.floor(s / 3600)} h ago`;
}

/** "alice (Alice)", "acme (organization)", "my-team". */
export function accountWords(a: NonNullable<ProviderAccount["account"]>): string {
  if (a.kind === "organization") return `${a.name} (organization)`;
  return a.fullName && a.fullName !== a.name ? `${a.name} (${a.fullName})` : a.name;
}

/** Settings: what a card with no key yet says will show there. */
export const noKeyYetWords = (p: CloudProvider): string =>
  p === "fal"
    ? "When you save a key, this card shows your fal.ai balance or a link to it."
    : "When you save a token, this card shows your Replicate account and a link to your balance.";

/** Settings: a fal.ai key that may not read its balance (fal.ai's default API keys). */
export const FAL_BALANCE_HOW =
  "On fal.ai, make a key with a custom permission list. Add the permission billing:usage:read to the permissions for running models. Then save the new key here.";

/** Settings: the provider didn't accept the saved key when its account was asked. */
export const checkKeyWords = (p: CloudProvider, scope: "owner" | "account"): string =>
  `${CLOUD_KEY[p].label} didn't accept this ${p === "replicate" ? "token" : "key"}. ${scope === "owner" ? "Press Test to check it, or save a new one." : "Press Check again, or replace it."}`;
