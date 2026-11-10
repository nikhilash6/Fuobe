import "server-only";
import type { Account } from "./auth";
import { db } from "./db";
import { HookDown, hookCall, hookTarget, type HookTarget } from "./hook-client";
import { hostedRunsOn } from "./hosted-switch";
import { noteServiceCopy } from "@/lib/service-copy";

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
   * chain (one press of Run) and the steps a run makes beside its own model (a 2K take's Open-H3 Regenerate finish).
   * Steps that need no model (joins, trims) and text steps are left out: they cost nothing. Absent: the run is its own
   * one step.
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

/**
 * How the card for a refused run looks, when the service says (docs/billing-hook.md): its heading (`title`), a friendly
 * look (`tone: "info"`), up to two more links (`links`), and a same-site address the page asks while the card is open
 * (`waitFor`): once it answers `{ ready: true }`, the page sends the run once more by itself. Absent: the card as before.
 */
export interface CardLook {
  title?: string;
  tone?: "info";
  links?: Action[];
  waitFor?: { url: string; everyMs: number };
}

/** The most a card waits on `waitFor`, and how often it may ask. */
export const CARD_WAIT = { mostMs: 10 * 60_000, everyMinMs: 2000, everyMaxMs: 60_000, everyMs: 4000 } as const;

const oneLine = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : undefined;
/** A link the page may open: a same-site path, or https. */
const cardUrl = (v: unknown): string | undefined => {
  const u = oneLine(v, 500);
  if (!u) return undefined;
  if (u.startsWith("/") && !u.startsWith("//") && !u.startsWith("/\\")) return u;
  try {
    return new URL(u).protocol === "https:" ? u : undefined;
  } catch {
    return undefined;
  }
};

/** The card's look from a service's answer, checked: anything that isn't right is left out. */
export function cardLook(a: unknown): CardLook {
  const o = (a ?? {}) as Record<string, unknown>;
  const title = oneLine(o.title, 80);
  const links = Array.isArray(o.links)
    ? o.links
        .slice(0, 2)
        .map((l) => ({ label: oneLine((l as Action | null)?.label, 40), url: cardUrl((l as Action | null)?.url) }))
        .filter((l): l is Action => !!l.label && !!l.url)
    : [];
  const w = o.waitFor as { url?: unknown; everyMs?: unknown } | null | undefined;
  const wUrl = cardUrl(w?.url);
  const every = Number(w?.everyMs);
  return {
    ...(title && { title }),
    ...(o.tone === "info" && { tone: "info" as const }),
    ...(links.length && { links }),
    // a same-site address only: the page asks it with the person's own cookie
    ...(wUrl?.startsWith("/") && {
      waitFor: { url: wUrl, everyMs: Number.isFinite(every) ? Math.min(CARD_WAIT.everyMaxMs, Math.max(CARD_WAIT.everyMinMs, Math.round(every))) : CARD_WAIT.everyMs },
    }),
  };
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
  /**
   * Allowed, but the run waits until then (epoch ms) before it enters the line: the day's GPU time is used up, an hourly
   * limit, or free generations that renew then. Absent: it may start at once.
   */
  startAt?: number;
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
   *
   * `giveUpS`: how long a run there may wait before it first starts (s; 0: as long as it takes). Present, it wins over
   * the reserve answer's `maxWaitMs`; absent, that answer (else FUOBE_POOL_WAIT_MIN) says. `offerAfterS`: after how
   * long a wait the line before Run offers an account its own GPU or key for that run, once (absent: POOL_OFFER_AFTER_S).
   *
   * `held`: how many runs may wait behind an account's runs at once (`activeRuns`) before its next press is turned down
   * (0: no cap). Present (0 or more), a press past a limit is taken and waits to enter the line (pool-holds.ts), and so
   * is a press while the billing service doesn't answer; absent, those presses are refused as before.
   */
  limits: {
    activeRuns: number;
    waiting: number;
    runsPerHour: number;
    outputsPerRun: number;
    maxMegapixels: number;
    maxSeconds: number;
    keepDays: number;
    spaceBytes: number;
    addressRunsPerHour?: number;
    giveUpS?: number;
    offerAfterS?: number;
    held?: number;
  };
  /**
   * Where a run goes when the account could run it on its own GPU and on this install's: "pool" for this install's, "own"
   * (or absent) for its own GPU, as before. A place the request names always wins.
   */
  prefer?: "pool" | "own";
  /** Which kinds of run may use this install's GPUs (absent: all; a kind set to false: not that kind). */
  kinds?: { image?: boolean; video?: boolean; audio?: boolean; text?: boolean; model3d?: boolean };
  /**
   * The words a preset card shows when its run would go to this install's GPUs, such as "Try free" (absent: the cards
   * show none). Fuobe has no price words of its own: with a service, only the service says a run there is free.
   */
  cardText?: string;
  /**
   * The name visitors read for this install's GPUs ("Runs on {name}", at most 40 characters; src/server/place-name.ts).
   * Absent: the install's own name for them (Settings → Workers, FUOBE_PLACE_NAME), else "Our GPUs".
   */
  placeName?: string;
  links?: Action[];
  notice?: { id: string; text: string; url?: string };
  /**
   * Display copy: sentences by key, with placeholders the app fills in (src/lib/service-copy.ts COPY_KEYS). Absent, or a
   * key left out: the app's own plain sentence. The latest answer's copy applies to every visitor's words.
   */
  copy?: Record<string, string>;
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
      /** The hold is made, and the run waits until then (epoch ms) before it enters the line (absent: at once). */
      startAt?: number;
    }
  | ({ ok: false; code: RefuseCode | "price-changed"; text: string; quote?: Quote; action?: Action; offer?: Offer } & CardLook);

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
  var __fuobeBillingPolicies: Map<string, PolicyEntry> | undefined;
  var __fuobeBillingBalances: Map<string, { at: number; balance: Balance }> | undefined;
  var __fuobeBillingAnsweredAt: number | undefined;
  var __fuobeBillingQuotes: Map<string, { at: number; quote: Quote }> | undefined;
}

/** Is a billing service set? */
export const billingConfigured = (): boolean => target() !== null;

function call<T>(method: "GET" | "POST", path: string, body: unknown, timeoutMs: number): Promise<T> {
  const t = target();
  if (!t) return Promise.reject(new HookDown(HOOK, "not configured"));
  return hookCall<T>({ hook: HOOK, target: t, token: process.env.FUOBE_BILLING_TOKEN || undefined, method, path, body, timeoutMs }).then((v) => {
    globalThis.__fuobeBillingAnsweredAt = Date.now();
    return v;
  });
}

/**
 * When the billing service last answered a call from this process (epoch ms; 0: not yet). Runs held while it didn't
 * answer (pool-holds.ts) are tried again at once after it does.
 */
export const serviceAnsweredAt = (): number => globalThis.__fuobeBillingAnsweredAt ?? 0;

/** Log a transport problem on the server only. */
function logDown(what: string, e: unknown): void {
  console.warn(`[fuobe] billing ${what}: ${(e as Error).message}`);
}

/** An account as the billing service sees it. */
export function accountFacts(a: Pick<Account, "id" | "email" | "createdAt"> & { signIn?: "google" | "password"; emailVerifiedAt?: number; adultAt?: number }): AccountFacts {
  return { id: a.id, email: a.email || null, emailVerified: !!a.emailVerifiedAt, signIn: a.signIn ?? "password", createdAt: a.createdAt, adultAt: a.adultAt ?? null };
}

/**
 * With no billing service: an account may use this install's GPUs (when hosted runs are on) within today's limits. Those
 * runs are free (hosted runs with no service need FUOBE_HOSTED_FREE=1), so preset cards say so.
 */
export const OPEN_POLICY: Policy = {
  hosted: true,
  pool: {},
  uploads: { image: true, video: false, audio: false },
  limits: { activeRuns: 4, waiting: 4, runsPerHour: 60, outputsPerRun: 4, maxMegapixels: 0, maxSeconds: 0, keepDays: 0, spaceBytes: 0 },
  cardText: "Try free",
  ttlS: 60,
};

/**
 * After a policy call that got no answer, how long the last answer (or none) stands before the service is asked again
 * (ms). A guest's status is read on every page, so a guest's policy waits longer.
 */
export const POLICY_RETRY_MS = { account: 5_000, guest: 60_000 };

/**
 * How long the last policy the service gave stands while it doesn't answer (a restart, a short outage): runs go on
 * under it, and only after this long without an answer are runs on this install's GPUs held until it answers again.
 */
export const POLICY_KEEP_MS = 10 * 60_000;

/**
 * A policy as kept: when it was read, how long it stands, when the service last answered (`goodAt`), and the place its
 * last answer put first (`prefer`), kept for as long as the service doesn't answer (lastPrefer).
 */
interface PolicyEntry {
  at: number;
  ttlMs: number;
  policy: Policy | null;
  goodAt?: number;
  prefer?: Policy["prefer"];
}

/**
 * The account's policy (cached for its `ttlS`), or a guest's (`accountId` null: GET /v1/policy with no account). No
 * service: OPEN_POLICY. The service down: the last answer it gave, for up to POLICY_KEEP_MS after it gave it, else null
 * (the caller holds runs on this install's GPUs until it answers). That stands for POLICY_RETRY_MS, so a service that
 * doesn't answer isn't waited for on every call.
 */
export async function policy(accountId: string | null): Promise<Policy | null> {
  if (!billingConfigured()) return OPEN_POLICY;
  const cache = (globalThis.__fuobeBillingPolicies ??= new Map());
  const key = accountId ?? "";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttlMs) return hit.policy;
  const keep = (entry: PolicyEntry) => {
    cache.set(key, entry);
    if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  };
  try {
    const p = await call<Policy>("GET", accountId ? `/v1/policy?account=${encodeURIComponent(accountId)}` : "/v1/policy", undefined, BILLING_TIMEOUTS.policy);
    const ttlMs = Math.max(0, Math.min(3600, Number(p.ttlS) || 0)) * 1000;
    keep({ at: Date.now(), ttlMs, policy: p, goodAt: Date.now(), ...(p.prefer && { prefer: p.prefer }) });
    savePolicy(key, p);
    noteServiceCopy(p.copy);
    return p;
  } catch (e) {
    logDown("policy", e);
    const now = Date.now();
    const goodAt = hit?.goodAt;
    const last = goodAt !== undefined && now - goodAt < POLICY_KEEP_MS ? (hit?.policy ?? null) : null;
    // Never past the time the last answer may stand.
    const retryMs = accountId ? POLICY_RETRY_MS.account : POLICY_RETRY_MS.guest;
    keep({ at: now, ttlMs: last && goodAt !== undefined ? Math.min(retryMs, goodAt + POLICY_KEEP_MS - now) : retryMs, policy: last, ...(goodAt !== undefined && { goodAt }), ...(hit?.prefer && { prefer: hit.prefer }) });
    return last;
  }
}

/**
 * The place the service's last answer put first, however long ago it answered (kept while it doesn't): the account's,
 * else a guest's. A run that would have gone to this install's GPUs keeps waiting for them while the service is quiet,
 * never moved to the account's own GPU for that. Undefined: it never answered here, or put none first. No service:
 * OPEN_POLICY's (none).
 */
export function lastPrefer(accountId: string | null): Policy["prefer"] {
  if (!billingConfigured()) return OPEN_POLICY.prefer;
  const cache = globalThis.__fuobeBillingPolicies;
  const own = cache?.get(accountId ?? "");
  // (Its own last answer, when the service ever answered for it here; else the one kept across restarts; else a guest's.)
  if (own?.goodAt !== undefined) return own.prefer;
  const kept = savedPolicy(accountId ?? "");
  return kept ? kept.prefer : cache?.get("")?.prefer;
}

/** Keep the service's answer across restarts (hosted runs on only): the key's own, and an account's as the last any got. */
function savePolicy(key: string, p: Policy): void {
  if (!hostedRunsOn()) return;
  try {
    const put = db().prepare("INSERT INTO billing_policies (key, policy_json, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET policy_json = excluded.policy_json, at = excluded.at");
    const json = JSON.stringify(p);
    const now = Date.now();
    put.run(key, json, now);
    if (key) put.run("*", json, now);
  } catch (e) {
    console.warn(`[fuobe] Couldn't keep the billing policy: ${(e as Error).message}`);
  }
}

/** The answer kept for this key across restarts, or null. */
function savedPolicy(key: string): Policy | null {
  if (!hostedRunsOn()) return null;
  try {
    const r = db().prepare("SELECT policy_json FROM billing_policies WHERE key = ?").get(key) as { policy_json: string } | undefined;
    return r ? (JSON.parse(r.policy_json) as Policy) : null;
  } catch {
    return null;
  }
}

/**
 * While the billing service doesn't answer and nothing recent is kept in memory (a restart, an outage past
 * POLICY_KEEP_MS, an account it never answered for here): its last answer kept across restarts, the account's own, else
 * the last any account got (a guest's for a guest). Only one under which runs wait instead of being refused (holdsOn):
 * a run pressed now is taken and waits for the service in line, and is reserved and checked when it answers. Null
 * otherwise (the press is refused as before). No service: OPEN_POLICY.
 */
export function keptPolicy(accountId: string | null): Policy | null {
  if (!billingConfigured()) return OPEN_POLICY;
  const p = accountId ? (savedPolicy(accountId) ?? savedPolicy("*")) : savedPolicy("");
  return p && holdsOn(p) ? p : null;
}

/** After how long a wait the line before Run offers an account its own GPU or key for that run, when the policy says none (s). */
export const POOL_OFFER_AFTER_S = 1200;

/**
 * How long a run on this install's GPUs may wait before it first starts, as the policy says (ms; 0: as long as it takes).
 * Undefined when the policy says nothing: the reserve answer's `maxWaitMs`, else FUOBE_POOL_WAIT_MIN, decide as before.
 */
export function policyGiveUpMs(p: Pick<Policy, "limits"> | null | undefined): number | undefined {
  const s = p?.limits?.giveUpS;
  return typeof s === "number" && Number.isFinite(s) && s >= 0 ? Math.round(s * 1000) : undefined;
}

/**
 * Does the policy say runs past a limit wait to enter the line instead of being refused (`limits.held` present: the
 * service of a release that knows it)? Then a press while the billing service doesn't answer waits too (pool-holds.ts).
 */
export function holdsOn(p: Pick<Policy, "limits"> | null | undefined): boolean {
  const n = p?.limits?.held;
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** How many runs may wait behind an account's runs at once before a press is turned down: `limits.held` (0: no cap). */
export function heldCap(p: Pick<Policy, "limits"> | null | undefined): number {
  return holdsOn(p) ? Math.floor(p!.limits.held!) : 0;
}

/**
 * After how long a wait the line before Run offers an account its own GPU or key, as the policy says (s). 0 turns the
 * offer off for waits (Infinity): it shows only at the daily cap and while runs there are paused.
 */
export function policyOfferAfterS(p: Pick<Policy, "limits"> | null | undefined): number {
  const s = p?.limits?.offerAfterS;
  if (s === 0) return Infinity;
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : POOL_OFFER_AFTER_S;
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

/** The quotes the service gave when it didn't answer (quoteDown). */
const downQuotes = new WeakSet<Quote>();

/** Is this quote the one quote() gives when the billing service didn't answer (not an answer of its own)? */
export const quoteDown = (q: Quote): boolean => downQuotes.has(q);

/** The key a quote is kept under: the viewer and the run's facts (the same draft asks with the same facts). */
const quoteKey = (account: AccountFacts | null, run: RunFacts) => `${account?.id ?? ""}\n${JSON.stringify(run)}`;

/** The quote for a run on this install's GPUs. No service: free. The service down: a refusal with `paused`. */
export async function quote(account: AccountFacts | null, run: RunFacts, queue: QueueFacts | null): Promise<Quote> {
  if (!billingConfigured()) return FREE_QUOTE;
  try {
    const q = await call<Quote>("POST", "/v1/quote", { account, run, queue }, BILLING_TIMEOUTS.quote);
    const kept = (globalThis.__fuobeBillingQuotes ??= new Map());
    if (q.allowed) {
      kept.set(quoteKey(account, run), { at: Date.now(), quote: q });
      if (kept.size > 5000) kept.delete(kept.keys().next().value!);
    }
    return q;
  } catch (e) {
    logDown("quote", e);
    const down: Quote = { allowed: false, amount: 0, priceVersion: "", text: BILLING_WAIT.quote, code: "paused" };
    downQuotes.add(down);
    return down;
  }
}

/**
 * The last price the service gave for this run (allowed), for up to POLICY_KEEP_MS after it gave it: what Run shows
 * while it doesn't answer, when runs then wait for it (holdsOn). Null: none known.
 */
export function lastQuote(account: AccountFacts | null, run: RunFacts, now = Date.now()): Quote | null {
  const hit = globalThis.__fuobeBillingQuotes?.get(quoteKey(account, run));
  if (!hit || now - hit.at >= POLICY_KEEP_MS) return null;
  const { startAt: _startAt, etaS: _etaS, ...q } = hit.quote;
  void _startAt;
  void _etaS;
  return q;
}

/** What Run shows while the service doesn't answer and no price is known: nothing, and Run stays on (the run waits). */
export const UNKNOWN_QUOTE: Quote = { allowed: true, amount: 0, priceVersion: "", text: "" };

/**
 * How a reserve the service doesn't answer is tried again (ms): after `firstMs`, then twice as long each time up to
 * `mostMs`, for up to `forMs` in all, the last try's own time included. A press of Run waits through a short outage or
 * a restart of the service, and the run starts with its place once it answers. The whole wait stays well under the
 * time a front proxy gives a request (often 60 s), so the page always gets an answer.
 */
export const RESERVE_RETRY = { forMs: 40_000, firstMs: 500, mostMs: 8_000 };

/**
 * When runs wait for the billing service (holdsOn), how long a press of Run tries its reserve before the run is made and
 * waits for the service instead (ms): the page gets its answer at once, and the run reserves when the service is back.
 */
export const RESERVE_INLINE = { ms: 5_000 };

/**
 * Is a failed reserve worth trying again: no connection, no answer in time, the service's own trouble (5xx) or too many
 * calls at once (429)? Any other answer (a wrong token, a request it refuses) is the same on every try.
 */
const retryable = (e: unknown): boolean => {
  const status = e instanceof HookDown ? e.why.status : undefined;
  return status === undefined || status >= 500 || status === 429;
};

/** Might a failed try have made a hold at the service (it was sent, and no answer said it wasn't)? */
const mayHaveHeld = (e: unknown): boolean => !(e instanceof HookDown) || !(e.why.refused || (e.why.status !== undefined && e.why.status < 500));

/** What a reserve sends (docs/billing-hook.md). */
export interface ReserveInput {
  requestId: string;
  account: AccountFacts;
  run: RunFacts;
  queue: QueueFacts | null;
  shown: { amount: number; priceVersion: string };
  /**
   * How long the run's hold must stay open once a worker first takes the run, so its report always comes before the
   * hold's deadline: `runMs`, every attempt of every job at its lane's run ceiling, and `pausedMs`, the time a started
   * run may spend back in line. The service adds the run's wait limit (`maxWaitMs`) before the first start. `heldMs`:
   * how long the run is expected to wait before it enters the line at all (behind the account's other runs, or until a
   * `startAt`; pool-holds.ts).
   */
  timing?: { runMs: number; pausedMs: number; heldMs?: number };
}

/**
 * Set the run's price aside before it is created. No service: null (no hold; the run is free). The service down: tried
 * again with the same request id (RESERVE_RETRY: the service makes one hold for it however often it hears it), then a
 * `paused` refusal in plain words. An answer that would be the same on every try (a 4xx) is that refusal at once.
 * `unsure` on a refusal: a try may have made a hold the app never heard of (the caller releases it by the request id).
 * `down` on a refusal: the service gave no answer at all (not a `paused` of its own). `forMs`: how long to keep trying
 * (RESERVE_RETRY.forMs; 0: one try). Never throws.
 */
export async function reserve(input: ReserveInput, o: { forMs?: number } = {}): Promise<(ReserveAnswer & { unsure?: boolean; down?: true }) | null> {
  if (!billingConfigured()) return null;
  const start = Date.now();
  const forMs = o.forMs ?? RESERVE_RETRY.forMs;
  let unsure = false;
  for (let attempt = 0; ; attempt++) {
    try {
      const a = await call<ReserveAnswer>("POST", "/v1/reserve", input, BILLING_TIMEOUTS.reserve);
      if (a.ok && (typeof a.holdId !== "string" || !a.holdId)) throw new HookDown(HOOK, "a reserve answer without a hold id");
      return a;
    } catch (e) {
      logDown(`reserve (try ${attempt + 1})`, e);
      if (mayHaveHeld(e)) unsure = true;
      if (!retryable(e)) break;
    }
    const wait = Math.min(RESERVE_RETRY.mostMs, RESERVE_RETRY.firstMs * 2 ** Math.min(attempt, 16));
    // The next try must end (its answer or its timeout) inside the whole wait.
    if (Date.now() - start + wait + BILLING_TIMEOUTS.reserve > forMs) break;
    await new Promise((r) => setTimeout(r, wait));
  }
  return { ok: false, code: "paused", text: BILLING_WAIT.run, down: true, ...(unsure && { unsure: true }) };
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
  globalThis.__fuobeBillingQuotes?.clear();
  globalThis.__fuobeBillingBadUrl = undefined;
  globalThis.__fuobeServiceCopy = undefined;
}
