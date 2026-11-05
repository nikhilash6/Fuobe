import "server-only";
import { createHash } from "node:crypto";
import { BILLING_URL } from "@/lib/diagnose";
import type { AccountState, Money, ProviderAccount } from "@/lib/key-info";
import { KEY_INFO_REFRESH_GAP_MS } from "@/lib/key-info";
import { CLOUD_PROVIDERS, type CloudProvider } from "@/lib/your-keys";
import { balanceRefusal, cloudKey, standIn } from "./provider-keys";
import { testFalKey } from "./providers/fal";
import { outsideTenant, runAsTenant } from "./tenant";

/**
 * Connected accounts (src/lib/key-info.ts): what a saved fal.ai key or Replicate token tells about its provider
 * account. Read-only calls that run nothing and cost nothing:
 *   fal.ai     GET api.fal.ai/v1/account/billing?expand=credits: the username and balance, for a key with the
 *              billing:usage:read permission (fal.ai's default API keys get 403: the page links to the billing page),
 *              and, for Settings, GET /v1/models/usage?expand=summary for this month's spend (BILLING or FULL keys).
 *   Replicate  GET api.replicate.com/v1/account: the account (Replicate has no balance API: the billing page).
 *
 * The key is read only through cloudKey, inside the asker's own tenant (an account only ever gets its own key, the
 * owner the studio's), and goes only in a request header. Nothing here returns, logs or keeps it: the cache holds a
 * hash, the answer only ProviderAccount's fields (never the provider's own text), and the log at most the provider and
 * a status. The provider is asked only when someone opens the menu or Settings, or presses Refresh: an answer is kept
 * 60 s (15 s when the provider was busy or out of reach), and a refresh asks again at most once every 10 s per key.
 * This never marks a key refused or its balance empty (account-keys.ts): it only reads.
 */

export type KeyOwner = { kind: "owner" } | { kind: "account"; id: string };

/** Tests make the wait shorter. */
export const KEY_INFO = { timeoutMs: 5_000 };

const OK_TTL = 60_000;
const FAIL_TTL = 15_000;
const MAX_ENTRIES = 1_000;
const FAL_API = "https://api.fal.ai";
const REPLICATE_API = "https://api.replicate.com";

/** The key the asker's info is about: its own key for an account, the studio's for the owner. "" when none is saved. */
function keyOf(who: KeyOwner, p: CloudProvider): string {
  return who.kind === "account" ? runAsTenant({ kind: "account", id: who.id }, () => cloudKey(p)) : outsideTenant(() => cloudKey(p));
}

// ---------------------------------------------------------------------------
// The cache: in this process's memory only, by a hash of the provider and the key.

interface Slot<T> {
  at: number;
  until: number;
  value?: T;
  pending?: Promise<T>;
}

const answers = new Map<string, Slot<ProviderAccount>>();
const spends = new Map<string, Slot<Money | null>>();

const slotId = (p: CloudProvider, key: string) => createHash("sha256").update(`${p}:${key}`).digest("hex").slice(0, 16);

function keep<T>(map: Map<string, Slot<T>>, id: string, slot: Slot<T>): void {
  map.delete(id);
  map.set(id, slot);
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!);
}

/**
 * The kept answer while it is fresh (a refresh: while it is under 10 s old), one request at a time per key, else
 * `load`'s answer, kept for the time it gives.
 */
function cached<T>(map: Map<string, Slot<T>>, id: string, fresh: boolean, load: () => Promise<{ value: T; ttl: number }>): Promise<T> {
  const s = map.get(id);
  const now = Date.now();
  if (s?.pending) return s.pending;
  if (s && "value" in s && (fresh ? now - s.at < KEY_INFO_REFRESH_GAP_MS : now < s.until)) return Promise.resolve(s.value as T);
  const pending = load().then(
    ({ value, ttl }) => {
      const at = Date.now();
      keep(map, id, { at, until: at + ttl, value });
      return value;
    },
    (e) => {
      map.delete(id);
      throw e;
    },
  );
  keep(map, id, { ...(s && "value" in s ? s : { at: 0, until: 0 }), pending });
  return pending;
}

/** Tests only: forget every kept answer. */
export function clearKeyInfo(): void {
  answers.clear();
  spends.clear();
}

// ---------------------------------------------------------------------------
// The provider calls: GET only, the key in the Authorization header.

type Got = { status: number; text: string } | { status: "timeout" | "unreachable" };

async function read(url: string, authorization: string): Promise<Got> {
  try {
    const res = await fetch(url, { headers: { Authorization: authorization, Accept: "application/json" }, signal: AbortSignal.timeout(KEY_INFO.timeoutMs), redirect: "error" });
    return { status: res.status, text: await res.text().catch(() => "") };
  } catch (e) {
    return { status: (e as Error)?.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

const falApi = () => standIn("fal") ?? FAL_API;
const replicateApi = () => standIn("replicate") ?? REPLICATE_API;

/** Only the provider and the status: never a key, a URL or the provider's text. */
function note(p: CloudProvider, status: number | string): void {
  console.warn(`[fuobe] key-info ${p}: ${status}`);
}

/** A status that says nothing about the key: the provider busy, down, or out of reach. Kept a short time. */
const passing = (g: Got) => typeof g.status !== "number" || g.status === 429 || g.status >= 500;

function json(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A short line of the provider's own data (a username), or undefined. */
function line(v: unknown, max = 80): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\p{Cc}/gu, "").trim();
  return s ? s.slice(0, max) : undefined;
}

function moneyOf(amount: unknown, currency: unknown): Money | undefined {
  const n = typeof amount === "string" ? Number(amount) : amount;
  const c = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  return typeof n === "number" && Number.isFinite(n) && /^[A-Z]{3}$/.test(c) ? { amount: Math.round(n * 100) / 100, currency: c } : undefined;
}

const answer = (p: CloudProvider, state: AccountState, more: Partial<ProviderAccount> = {}): ProviderAccount => ({
  provider: p,
  checkedAt: Date.now(),
  state,
  ...more,
  billingUrl: BILLING_URL[p],
});

async function falAccount(k: string): Promise<{ value: ProviderAccount; ttl: number }> {
  const got = await read(`${falApi()}/v1/account/billing?expand=credits`, `Key ${k}`);
  if (passing(got)) {
    note("fal", got.status);
    return { value: answer("fal", "link"), ttl: FAIL_TTL };
  }
  const { status, text } = got as { status: number; text: string };
  if (status === 200) {
    const body = json(text);
    const credits = (body.credits && typeof body.credits === "object" ? body.credits : {}) as Record<string, unknown>;
    const balance = moneyOf(credits.current_balance, credits.currency);
    const name = line(body.username);
    return {
      value: answer("fal", balance ? (balance.amount > 0 ? "ok" : "empty") : "link", { ...(name && { account: { name } }), ...(balance && { balance }) }),
      ttl: OK_TTL,
    };
  }
  if (balanceRefusal(status, text)) return { value: answer("fal", "empty"), ttl: OK_TTL };
  if (status === 401) {
    // Said only when the free key check agrees (the status of a request that doesn't exist): a key fal.ai takes for
    // runs is never called refused because the Platform API answered otherwise.
    // It waits no longer than the billing call did: no answer in time is the billing link.
    let stop: ReturnType<typeof setTimeout> | undefined;
    const check = await Promise.race([testFalKey(k), new Promise<null>((done) => (stop = setTimeout(() => done(null), KEY_INFO.timeoutMs)))]).finally(() => clearTimeout(stop));
    if (!check) return { value: answer("fal", "link"), ttl: FAIL_TTL };
    if (!check.ok && check.reason === "rejected") return { value: answer("fal", "check-key"), ttl: OK_TTL };
    if (!check.ok && check.reason === "balance") return { value: answer("fal", "empty"), ttl: OK_TTL };
  }
  // 403: a key without billing:usage:read (fal.ai's default API keys).
  return { value: answer("fal", "link"), ttl: OK_TTL };
}

/** The first day of this month (UTC), as fal.ai's usage API takes it. */
const monthStart = (now = new Date()) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

/** This month's spend on a fal.ai key that may read its usage (BILLING or FULL keys); null when it may not, or can't be summed. */
async function falSpend(k: string): Promise<{ value: Money | null; ttl: number }> {
  let total = 0;
  let currency: string | undefined;
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ expand: "summary", start: monthStart(), bound_to_timeframe: "false", limit: "50", ...(cursor && { cursor }) });
    const got = await read(`${falApi()}/v1/models/usage?${q}`, `Key ${k}`);
    if (passing(got)) {
      note("fal", got.status);
      return { value: null, ttl: FAIL_TTL };
    }
    const { status, text } = got as { status: number; text: string };
    if (status !== 200) return { value: null, ttl: OK_TTL };
    const body = json(text);
    for (const r of Array.isArray(body.summary) ? body.summary : []) {
      const row = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const m = moneyOf(row.cost_total ?? row.cost, row.currency);
      if (!m || (currency && m.currency !== currency)) return { value: null, ttl: OK_TTL };
      currency = m.currency;
      total += m.amount;
    }
    cursor = body.has_more === true ? line(body.next_cursor, 200) : undefined;
    if (!cursor) return { value: { amount: Math.round(total * 100) / 100, currency: currency ?? "USD" }, ttl: OK_TTL };
  }
  // More pages than it reads: no figure rather than a part of one.
  return { value: null, ttl: OK_TTL };
}

async function replicateAccount(t: string): Promise<{ value: ProviderAccount; ttl: number }> {
  const got = await read(`${replicateApi()}/v1/account`, `Bearer ${t}`);
  if (passing(got)) {
    note("replicate", got.status);
    return { value: answer("replicate", "link"), ttl: FAIL_TTL };
  }
  const { status, text } = got as { status: number; text: string };
  if (status === 200) {
    const body = json(text);
    const name = line(body.username);
    const fullName = line(body.name);
    const kind = body.type === "organization" || body.type === "user" ? body.type : undefined;
    // Replicate has no balance API: the billing page has it.
    return { value: answer("replicate", "link", name ? { account: { name, ...(kind && { kind }), ...(fullName && { fullName }) } } : {}), ttl: OK_TTL };
  }
  if (balanceRefusal(status, text)) return { value: answer("replicate", "empty"), ttl: OK_TTL };
  if (status === 401) return { value: answer("replicate", "check-key"), ttl: OK_TTL };
  return { value: answer("replicate", "link"), ttl: OK_TTL };
}

// ---------------------------------------------------------------------------

/**
 * What the asker's saved key for `p` tells about its provider account, or null when no key is saved. `fresh`: ask the
 * provider again (Refresh), at most once every 10 s per key. `detail`: Settings' view, with this month's spend where the
 * key may read it.
 */
export async function accountInfo(who: KeyOwner, p: CloudProvider, opts: { fresh?: boolean; detail?: boolean } = {}): Promise<ProviderAccount | null> {
  const key = keyOf(who, p);
  if (!key) return null;
  const id = slotId(p, key);
  const info = await cached(answers, id, !!opts.fresh, () => (p === "fal" ? falAccount(key) : replicateAccount(key)));
  if (!opts.detail || p !== "fal" || !info.balance) return info;
  const spent = await cached(spends, id, !!opts.fresh, () => falSpend(key));
  return spent ? { ...info, spentThisMonth: spent } : info;
}

/** Every saved key's info, in the providers' order (fal.ai first), asked of the providers side by side. */
export async function accountsInfo(who: KeyOwner, opts: { fresh?: boolean; detail?: boolean } = {}): Promise<ProviderAccount[]> {
  const all = await Promise.all(CLOUD_PROVIDERS.map((p) => accountInfo(who, p, opts)));
  return all.filter((x): x is ProviderAccount => x !== null);
}
