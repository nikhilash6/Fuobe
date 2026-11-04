import "server-only";
import type { Account } from "./auth";
import { HookDown, hookCall, hookTarget, type HookTarget } from "./hook-client";

/**
 * The billing hook (docs/billing-hook.md): an install can connect an external billing service at FUOBE_BILLING_URL.
 * Fuobe sends facts about each run that goes to this install's GPUs (hosted runs, hosted.ts); the service answers with
 * what the person sees and whether the run may start. With no service set, no call is made and every run is free and
 * allowed: exactly the studio as it was.
 *
 * The service is called only for runs on this install's GPUs ("pool"), plus an account's policy, its balance, account
 * events and offer clicks. A run on the account's own GPU or its own key never asks it.
 *
 * Calls: GET /v1/policy, POST /v1/quote, POST /v1/reserve, POST /v1/release, POST /v1/settle, POST /v1/refund,
 * GET /v1/balance, POST /v1/account-event, POST /v1/interest. Every call is safe to send twice. Release, settle and
 * refund go through an outbox (billing-outbox.ts), so they reach the service even after a restart or an outage.
 */

export type Place = "own-gpu" | "own-key" | "pool" | "install-key";

export interface AccountFacts {
  id: string;
  email: string | null;
  emailVerified: boolean;
  signIn: "google" | "password";
  createdAt: number;
  adultAt: number | null;
}

export interface RunFacts {
  place: Place;
  model: string;
  op: string | null;
  app: string | null;
  preset: string | null;
  studio: string;
  kind: "image" | "video" | "audio" | "text" | "model3d";
  engine: "open" | "cloud";
  provider: string;
  jobs: number;
  outputsPerJob: number;
  megapixels: number | null;
  seconds: number | null;
  fps: number | null;
  loras: number;
  inputs: { image: number; video: number; audio: number };
  lane: string | null;
  providerUsd: number | null;
  /**
   * Every step of the run that uses this install's GPUs, its own step first, so one quote and one hold cover a whole
   * chain (one press of Run). Steps that need no model (joins, trims) and text steps are left out: they cost nothing.
   * Absent: the run is its own one step.
   */
  steps?: { model: string; op: string | null; kind: RunFacts["kind"]; jobs: number; lane: string | null }[];
}

export interface QueueFacts {
  lane: string;
  ahead: number;
  etaS: number | null;
  workersOnline: number;
  nextOpenAt: number | null;
  mine: { waiting: number; running: number };
}

/** A link the service sends; the app opens `url` as given and never builds one. */
export interface Action {
  label: string;
  url: string;
}

/** An offer the person can ask about; a click sends POST /v1/interest with its key. */
export interface Offer {
  key: string;
  text: string;
  label: string;
}

export type RefuseCode = "top-up" | "limit" | "busy" | "not-offered" | "blocked" | "closed" | "paused";

export interface Quote {
  allowed: boolean;
  amount: number;
  priceVersion: string;
  /** What Run shows, and the line under it. */
  text: string;
  sub?: string;
  code?: RefuseCode;
  etaS?: number | null;
  action?: Action;
  offer?: Offer;
}

export interface Policy {
  /** May this account use this install's GPUs at all. */
  hosted: boolean;
  /** Which models and apps run on this install's GPUs (never applied to an account's own GPU or key). */
  pool: { allow?: string[]; deny?: string[]; apps?: { allow?: string[]; deny?: string[] } };
  /** Which of its own files a run on this install's GPUs may use. */
  uploads: { image: boolean; video: boolean; audio: boolean };
  /**
   * Limits on runs on this install's GPUs, counted on those runs only (never on runs on the account's own GPU or key).
   * 0 or absent: no such limit. `addressRunsPerHour`: runs there from one client address an hour.
   */
  limits: { activeRuns: number; waiting: number; runsPerHour: number; outputsPerRun: number; maxMegapixels: number; maxSeconds: number; keepDays: number; spaceBytes: number; addressRunsPerHour?: number };
  /**
   * Where a run goes when the account could run it on its own GPU and on this install's: "pool" for this install's, "own"
   * (or absent) for its own GPU, as before. A place the request names always wins.
   */
  prefer?: "pool" | "own";
  /** Which kinds of run may use this install's GPUs (absent: all; a kind set to false: not that kind). */
  kinds?: { image?: boolean; video?: boolean; audio?: boolean; text?: boolean; model3d?: boolean };
  links?: Action[];
  notice?: { id: string; text: string; url?: string };
  ttlS: number;
}

export type ReserveAnswer =
  | {
      ok: true;
      holdId: string;
      amount: number;
      /** A head start in line within the run's class (ms). */
      boostMs: number;
      /** The longest the run may wait before a worker first takes it (ms; 0: the install's own limit). */
      maxWaitMs: number;
      pools?: string[];
      /** The run's class in the line: "paid" goes before "free" (absent: "free"). */
      class?: "paid" | "free";
      text: string;
    }
  | { ok: false; code: RefuseCode | "price-changed"; text: string; quote?: Quote; action?: Action; offer?: Offer };

export interface Balance {
  amount: number;
  chip: string;
  text: string;
  sub?: string;
  refillAt?: number | null;
  detail: { label: string; text: string }[];
  action?: Action;
  offer?: Offer;
}

export interface SettleReport {
  holdId: string;
  generationId: string;
  rows: number;
  status: "succeeded";
  final: { outputs: number; megapixels: number | null; seconds: number | null };
  providerUsd: number | null;
  gpuMs: number | null;
  device: string | null;
  reachedProvider: boolean;
}

export interface RefundReport {
  holdId: string;
  generationId: string;
  rows: number;
  status: "failed" | "canceled" | "hidden" | "unchecked";
  reason: string;
  reachedProvider: boolean;
  gpuMs: number | null;
  device: string | null;
}

/**
 * What a person sees when the billing service doesn't answer: never its address, its error or a word about the service.
 * `quote`: the price slot before Run (the price check asks again by itself, and Run comes back on with its answer);
 * `run`: a run pressed then, which didn't start.
 */
export const BILLING_WAIT = { quote: "Ready in a moment", run: "Try again in a moment." } as const;

/** Timeouts per call (ms). */
export const BILLING_TIMEOUTS = { policy: 1000, quote: 1000, reserve: 2000, balance: 1000, report: 5000, event: 5000 };

const HOOK = "billing service";

/** The service's address, or null when none is set (or it can't be read: then it is logged once and treated as none). */
function target(): HookTarget | null {
  const raw = process.env.FUOBE_BILLING_URL ?? "";
  if (!raw.trim()) return null;
  const t = hookTarget(raw);
  if (!t && !globalThis.__fuobeBillingBadUrl) {
    globalThis.__fuobeBillingBadUrl = true;
    console.warn("[fuobe] FUOBE_BILLING_URL is not an http(s) or unix: address; the billing hook is off");
  }
  return t;
}

declare global {
  var __fuobeBillingBadUrl: boolean | undefined;
  var __fuobeBillingPolicies: Map<string, { at: number; ttlMs: number; policy: Policy | null }> | undefined;
  var __fuobeBillingBalances: Map<string, { at: number; balance: Balance }> | undefined;
}

/** Is a billing service set? */
export const billingConfigured = (): boolean => target() !== null;

function call<T>(method: "GET" | "POST", path: string, body: unknown, timeoutMs: number): Promise<T> {
  const t = target();
  if (!t) return Promise.reject(new HookDown(HOOK, "not configured"));
  return hookCall<T>({ hook: HOOK, target: t, token: process.env.FUOBE_BILLING_TOKEN || undefined, method, path, body, timeoutMs });
}

/** Log a transport problem on the server only. */
function logDown(what: string, e: unknown): void {
  console.warn(`[fuobe] billing ${what}: ${(e as Error).message}`);
}

/** An account as the billing service sees it. */
export function accountFacts(a: Pick<Account, "id" | "email" | "createdAt"> & { signIn?: "google" | "password"; emailVerifiedAt?: number; adultAt?: number }): AccountFacts {
  return { id: a.id, email: a.email || null, emailVerified: !!a.emailVerifiedAt, signIn: a.signIn ?? "password", createdAt: a.createdAt, adultAt: a.adultAt ?? null };
}

/** With no billing service: an account may use this install's GPUs (when hosted runs are on) within today's limits. */
export const OPEN_POLICY: Policy = {
  hosted: true,
  pool: {},
  uploads: { image: true, video: false, audio: false },
  limits: { activeRuns: 4, waiting: 4, runsPerHour: 60, outputsPerRun: 4, maxMegapixels: 0, maxSeconds: 0, keepDays: 0, spaceBytes: 0 },
  ttlS: 60,
};

/**
 * After a policy call that got no answer, how long the last answer (or none) stands before the service is asked again
 * (ms). A guest's status is read on every page, so a guest's policy waits longer.
 */
export const POLICY_RETRY_MS = { account: 5_000, guest: 60_000 };

/**
 * The account's policy (cached for its `ttlS`), or a guest's (`accountId` null: GET /v1/policy with no account). No
 * service: OPEN_POLICY. The service down: the last answer, else null (the caller treats runs on this install's GPUs as
 * paused). That stands for POLICY_RETRY_MS, so a service that doesn't answer isn't waited for on every call.
 */
export async function policy(accountId: string | null): Promise<Policy | null> {
  if (!billingConfigured()) return OPEN_POLICY;
  const cache = (globalThis.__fuobeBillingPolicies ??= new Map());
  const key = accountId ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttlMs) return hit.policy;
  const keep = (entry: { at: number; ttlMs: number; policy: Policy | null }) => {
    cache.set(key, entry);
    if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  };
  try {
    const p = await call<Policy>("GET", accountId ? `/v1/policy?account=${encodeURIComponent(accountId)}` : "/v1/policy", undefined, BILLING_TIMEOUTS.policy);
    const ttlMs = Math.max(0, Math.min(3600, Number(p.ttlS) || 0)) * 1000;
    keep({ at: Date.now(), ttlMs, policy: p });
    return p;
  } catch (e) {
    logDown("policy", e);
    const last = hit?.policy ?? null;
    keep({ at: Date.now(), ttlMs: accountId ? POLICY_RETRY_MS.account : POLICY_RETRY_MS.guest, policy: last });
    return last;
  }
}

/**
 * The policy as last read, with no call to the service: undefined when none is kept (or it is too old). No service:
 * OPEN_POLICY.
 */
export function cachedPolicy(accountId: string | null): Policy | null | undefined {
  if (!billingConfigured()) return OPEN_POLICY;
  const hit = globalThis.__fuobeBillingPolicies?.get(accountId ?? "");
  return hit && Date.now() - hit.at < hit.ttlMs ? hit.policy : undefined;
}

/** A free run's quote (no service set): Run keeps its own words. */
export const FREE_QUOTE: Quote = { allowed: true, amount: 0, priceVersion: "", text: "" };

/** The quote for a run on this install's GPUs. No service: free. The service down: a refusal with `paused`. */
export async function quote(account: AccountFacts | null, run: RunFacts, queue: QueueFacts | null): Promise<Quote> {
  if (!billingConfigured()) return FREE_QUOTE;
  try {
    return await call<Quote>("POST", "/v1/quote", { account, run, queue }, BILLING_TIMEOUTS.quote);
  } catch (e) {
    logDown("quote", e);
    return { allowed: false, amount: 0, priceVersion: "", text: BILLING_WAIT.quote, code: "paused" };
  }
}

/**
 * Set the run's price aside before it is created. No service: null (no hold; the run is free). The service down (one
 * retry with the same request id): a `paused` refusal. Never throws.
 */
export async function reserve(input: { requestId: string; account: AccountFacts; run: RunFacts; queue: QueueFacts | null; shown: { amount: number; priceVersion: string } }): Promise<ReserveAnswer | null> {
  if (!billingConfigured()) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const a = await call<ReserveAnswer>("POST", "/v1/reserve", input, BILLING_TIMEOUTS.reserve);
      if (a.ok && (typeof a.holdId !== "string" || !a.holdId)) throw new HookDown(HOOK, "a reserve answer without a hold id");
      return a;
    } catch (e) {
      logDown(`reserve (try ${attempt + 1})`, e);
    }
  }
  return { ok: false, code: "paused", text: BILLING_WAIT.run };
}

/** The HTTP status and header for a billing refusal (the generations route; docs/billing-hook.md). */
export function refusalStatus(code: RefuseCode | "price-changed"): number {
  switch (code) {
    case "price-changed":
      return 409;
    case "top-up":
      return 402;
    case "limit":
      return 429;
    case "busy":
    case "paused":
      return 503;
    default:
      return 403;
  }
}

export const BILLING_HEADER = "x-fuobe-billing";

/** The account's balance (cached 10 s). No service, or no answer: null (nothing to show). */
export async function balance(accountId: string): Promise<Balance | null> {
  if (!billingConfigured()) return null;
  const cache = (globalThis.__fuobeBillingBalances ??= new Map());
  const hit = cache.get(accountId);
  if (hit && Date.now() - hit.at < 10_000) return hit.balance;
  try {
    const b = await call<Balance>("GET", `/v1/balance?account=${encodeURIComponent(accountId)}`, undefined, BILLING_TIMEOUTS.balance);
    cache.set(accountId, { at: Date.now(), balance: b });
    if (cache.size > 5000) cache.delete(cache.keys().next().value!);
    return b;
  } catch (e) {
    logDown("balance", e);
    return hit?.balance ?? null;
  }
}

/** Forget an account's cached balance (after a run is reserved or reported, the chip reads it again). */
export function forgetBalance(accountId: string): void {
  globalThis.__fuobeBillingBalances?.delete(accountId);
}

/** Tell the service about an account: made, verified, signed in, deleted. Best effort; never fails the caller. */
export function accountEvent(event: "created" | "verified" | "signed-in" | "deleted", account: AccountFacts): void {
  if (!billingConfigured()) return;
  call("POST", "/v1/account-event", { event, account }, BILLING_TIMEOUTS.event).catch((e) => logDown(`account-event ${event}`, e));
}

/** An account asked about an offer. No service: null. */
export async function interest(accountId: string, key: string): Promise<{ ok: true; text: string } | null> {
  if (!billingConfigured()) return null;
  try {
    return await call<{ ok: true; text: string }>("POST", "/v1/interest", { account: accountId, key }, BILLING_TIMEOUTS.event);
  } catch (e) {
    logDown("interest", e);
    return null;
  }
}

/** Send one outbox report (billing-outbox.ts). Throws HookDown when the service doesn't take it. */
export async function sendReport(kind: "settle" | "refund" | "release", payload: unknown): Promise<void> {
  const a = await call<{ ok?: boolean }>("POST", `/v1/${kind}`, payload, BILLING_TIMEOUTS.report);
  if (a?.ok !== true) throw new HookDown(HOOK, `${kind} wasn't taken`);
}

/** Forget the cached policies and balances (tests; a changed service). */
export function resetBillingCache(): void {
  globalThis.__fuobeBillingPolicies?.clear();
  globalThis.__fuobeBillingBalances?.clear();
  globalThis.__fuobeBillingBadUrl = undefined;
}
