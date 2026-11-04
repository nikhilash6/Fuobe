import "server-only";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { GenerationRequest } from "@/lib/catalog/types";
import { OWN_GPU_TOOL_MESSAGE } from "@/lib/guest-access";
import { gpuState } from "./account-gpu";
import { accountGpu, type Account } from "./auth";
import {
  accountFacts,
  BILLING_HEADER,
  BILLING_PAUSED,
  billingConfigured,
  forgetBalance,
  policy as billingPolicy,
  quote as billingQuote,
  refusalStatus,
  reserve,
  type Policy,
  type Quote,
  type RefuseCode,
  type RunFacts,
} from "./billing";
import { getModel } from "@/lib/catalog";
import { needsOf } from "@/lib/lanes";
import { PLACE_ASK_HEADER } from "@/lib/guest-access";
import { createGenerations, outputKind, plannedSteps, previewGeneration, type PlannedStep } from "./generations";
import { loadIndex } from "./gpu/index-file";
import { poolLane } from "./computer/pool";
import { HOSTED_GUEST_WORDS, HOSTED_WORDS, inputCounts, poolAllows, poolOnWorkers, poolReady, poolTakes, poolTakesFiles, POOL_LANE, queueFacts, runFacts, runOnPool } from "./hosted";
import { withRunStamp } from "./run-stamp";
import { hostedRunsOn } from "./hosted-switch";
import { checkRun, moderationConfigured } from "./moderation";
import type { RunStamp } from "./run-stamp";
import { readRef } from "./storage";
import { ACCOUNT_LIMITS } from "./account-files";
import { poolLimitRefusal } from "./pool-limits";
import { runAsTenant } from "./tenant";

/**
 * The generations route's side of hosted runs (hosted.ts), the billing hook (billing.ts) and the moderation hook
 * (moderation.ts). With nothing set (no FUOBE_HOSTED_RUNS, no service addresses) none of it changes a run.
 */

/** What the client asked for: its own GPU, or this install's (a preference the server checks). */
export type PlaceWish = "own" | "pool" | undefined;

/** The client's preference and the price it showed, read from the body beside the request (never part of it). */
export function readWishes(body: unknown): { wish: PlaceWish; shown: { amount: number; priceVersion: string } | null } {
  const b = (body ?? {}) as { place?: unknown; shown?: unknown };
  const wish = b.place === "own" || b.place === "pool" ? b.place : undefined;
  const s = b.shown as { amount?: unknown; priceVersion?: unknown } | null | undefined;
  const shown =
    s && typeof s === "object" && Number.isFinite(s.amount) && Number(s.amount) >= 0 && typeof s.priceVersion === "string" && s.priceVersion.length <= 200
      ? { amount: Math.floor(Number(s.amount)), priceVersion: s.priceVersion }
      : null;
  return { wish, shown };
}

/** A refusal the route sends as it is. */
export interface Refusal {
  status: number;
  body: Record<string, unknown> & { error: string };
  headers: Record<string, string>;
}

const billingRefusal = (code: RefuseCode | "price-changed", text: string, extra: Record<string, unknown> = {}): Refusal => ({
  status: refusalStatus(code),
  body: { error: text, code, ...extra },
  headers: { [BILLING_HEADER]: code },
});

type Planned = ReturnType<typeof previewGeneration>;

/** The decision for an account's run: its own GPU or key as today, this install's GPUs, or a refusal. */
export type PlaceDecision = { kind: "own" } | { kind: "pool"; planned: Planned; policy: Policy; steps: RunFacts["steps"] } | { kind: "refuse"; refusal: Refusal };

/** What an account whose own GPU didn't answer is asked, when its run named no place (never moved and charged unasked). */
export const OWN_GPU_QUIET = "Your GPU isn't answering right now. Run this on this studio's GPUs instead, or try again when your GPU is back.";

const askPlace = (): Refusal => ({ status: 409, body: { error: OWN_GPU_QUIET, code: "own-gpu-offline" }, headers: { [PLACE_ASK_HEADER]: "1" } });

/** Does the policy put runs on this install's GPUs first, before the account's own GPU? */
const prefersPool = (p: Policy | null | undefined): boolean => !!p?.hosted && p.prefer === "pool";

/** May a run of this kind use this install's GPUs under the policy (`kinds` absent: every kind)? */
export const kindAllowed = (p: Pick<Policy, "kinds">, kind: RunFacts["kind"]): boolean => p.kinds?.[kind] !== false;

const stepEndpoint = (s: PlannedStep): string | undefined => {
  const m = getModel(s.modelId);
  return (m?.routes.find((r) => r.op === s.op && r.provider === s.provider) ?? m?.routes.find((r) => r.provider === s.provider))?.endpoint;
};

/**
 * A step that needs no model and no graphics memory (a join, a trim, a mux): light work that costs nothing and that every
 * policy allows. Text steps and steps made in the browser cost nothing either.
 */
function freeStep(s: PlannedStep): boolean {
  if (s.provider === "llm" || s.provider === "local" || s.provider === "mock") return true;
  if (s.provider !== "comfyui") return false;
  const endpoint = stepEndpoint(s);
  if (!endpoint) return false;
  // A workflow that picks its graph at run time (`video-concat-{n}`): light when every graph it may pick is.
  const index = loadIndex();
  const [head, tail = ""] = endpoint.split("{n}");
  const picks = endpoint.includes("{n}")
    ? Object.keys(index.workflows).filter((id) => id.length > head.length + tail.length && id.startsWith(head) && id.endsWith(tail) && /^\d+$/.test(id.slice(head.length, id.length - tail.length)))
    : [endpoint];
  const needs = picks.map((id) => needsOf(index, id));
  return needs.length > 0 && needs.every((x) => !!x && x.files.length === 0 && x.minVramBytes === 0);
}

/**
 * Every row an account's run would make on this install's GPUs (a chain's later steps too), planned as the real run plans
 * them and thrown away. Null when the request can't be made (the real run says why).
 */
export function poolSteps(accountId: string, req: GenerationRequest): PlannedStep[] | null {
  try {
    return runOnPool(accountId, () => withRunStamp({ place: "pool" }, () => plannedSteps(() => createGenerations(req))));
  } catch {
    return null;
  }
}

/**
 * The first step of a run that this install's GPUs may not take under the policy (its model or app not offered, a kind
 * the policy leaves out, a model no worker is allowed, a cloud model), in words; null when every step may run there.
 */
export function stepsProblem(p: Policy, steps: PlannedStep[]): string | null {
  for (const s of steps) {
    if (freeStep(s)) continue;
    if (s.provider !== "comfyui" || s.kind === "model3d") return HOSTED_WORDS.notOffered;
    if (!poolAllows(p, s.modelId, s.presetId) || !kindAllowed(p, s.kind as RunFacts["kind"])) return HOSTED_WORDS.notOffered;
    if (!poolTakes(stepEndpoint(s))) return HOSTED_WORDS.notOffered;
  }
  return null;
}

/** The steps of a run that use this install's GPUs, for its one price: each model and operation once, with its rows. */
export function pricedSteps(steps: PlannedStep[]): NonNullable<RunFacts["steps"]> {
  const out = new Map<string, NonNullable<RunFacts["steps"]>[number]>();
  for (const s of steps) {
    if (freeStep(s)) continue;
    const key = `${s.modelId} ${s.op}`;
    const had = out.get(key);
    if (had) {
      had.jobs++;
      continue;
    }
    const endpoint = stepEndpoint(s);
    out.set(key, { model: s.modelId, op: s.op || null, kind: s.kind as RunFacts["kind"], jobs: 1, lane: poolOnWorkers() && endpoint && !endpoint.includes("{") ? poolLane(endpoint) : POOL_LANE });
  }
  return [...out.values()];
}

/** Why this install's GPUs won't take a run: a 3D model, a model or kind not offered there, LoRAs, or a kind of file. */
export type GateReason = "model3d" | "notOffered" | "loras" | "inputs";

/** The words for a gate's reason: an account may connect its own GPU in Settings, a guest has nowhere to do that yet. */
export function gateWords(reason: GateReason, guest: boolean): string {
  if (reason === "model3d") return OWN_GPU_TOOL_MESSAGE;
  return (guest ? HOSTED_GUEST_WORDS : HOSTED_WORDS)[reason];
}

/**
 * The one check of whether this install's GPUs take a run, shared by the run itself (decidePlace) and the price check
 * before Run (poolQuote), so the two always agree: its output kind (no 3D there), the policy's model, app and kind
 * lists, a worker allowed its lane, LoRAs, the kinds of file it sends, and every later step of a chain (planned only
 * once the cheaper checks pass). `p` null: the billing service didn't answer, so only what needs no policy is checked.
 * Passed, it gives the planned steps for the run's one price.
 */
export function poolGate(
  p: Policy | null,
  planned: Planned,
  req: GenerationRequest,
  planSteps: () => PlannedStep[] | null,
): { ok: true; steps: PlannedStep[] | null } | { ok: false; reason: GateReason } {
  const kind = outputKind(planned.op, planned.model);
  if (kind === "model3d") return { ok: false, reason: "model3d" };
  if (p && (!poolAllows(p, planned.model.id, req.presetId) || !kindAllowed(p, kind))) return { ok: false, reason: "notOffered" };
  // Nothing of this install's would ever run it (no worker is allowed its lane): never a run that waits for nothing.
  if (!poolTakes(planned.route.endpoint)) return { ok: false, reason: "notOffered" };
  if (req.loras?.length) return { ok: false, reason: "loras" };
  if (p) {
    const inputs = inputCounts(req);
    const takes = (k: "image" | "video" | "audio") => p.uploads[k] && poolTakesFiles(k);
    if ((inputs.image && !takes("image")) || (inputs.video && !takes("video")) || (inputs.audio && !takes("audio"))) return { ok: false, reason: "inputs" };
  }
  // Every step of a chain, not only its first: each one the policy must allow, and the run is priced for all of them.
  const steps = planSteps();
  if (steps && p && stepsProblem(p, steps)) return { ok: false, reason: "notOffered" };
  return { ok: true, steps };
}

/**
 * The account a guest's price check plans a chain's later steps under: no real account has it (account ids hold no
 * colon), and nothing planned under it is kept (plannedSteps throws every row away).
 */
const GUEST_PLAN = "guest:plan";

/** Every row a run would make on this install's GPUs, for an account or (planned as nobody's) for a guest's price check. */
const stepsFor = (account: Account | null, req: GenerationRequest) => poolSteps(account?.id ?? GUEST_PLAN, req);

/** Is the account's own GPU there to run now? */
async function ownGpuOnline(accountId: string): Promise<boolean> {
  const gpu = accountGpu(accountId);
  if (!gpu) return false;
  try {
    return (await gpuState(accountId, gpu)).online;
  } catch {
    return false;
  }
}

/**
 * Where an account's run goes (hosted.ts has the order). Only with hosted runs on; otherwise always "own" (today).
 */
export async function decidePlace(account: Account, req: GenerationRequest, wish: PlaceWish): Promise<PlaceDecision> {
  if (!hostedRunsOn() || wish === "own" || !poolReady()) return { kind: "own" };
  let planned: Planned;
  try {
    planned = runOnPool(account.id, () => previewGeneration(req));
  } catch {
    // A paid model, a model switched off, a request with something wrong: today's path says what.
    return { kind: "own" };
  }
  if (planned.route.provider !== "comfyui") return { kind: "own" };
  const hasGpu = !!accountGpu(account.id);
  const p = await billingPolicy(account.id);
  // Its own GPU first, unless the policy puts this install's first (a place the request names always wins).
  if (hasGpu && wish !== "pool" && !prefersPool(p)) {
    if (await ownGpuOnline(account.id)) return { kind: "own" };
    // Its GPU didn't answer the check: asked, never moved to this install's GPUs (and charged) without a word.
    if (!wish) return { kind: "refuse", refusal: askPlace() };
  }
  if (!p) return { kind: "refuse", refusal: billingRefusal("paused", BILLING_PAUSED) };
  if (!p.hosted) return { kind: "own" };
  // From here on the run would be this install's: what it can't take there goes to the account's own GPU when it has one.
  const gate = poolGate(p, planned, req, () => stepsFor(account, req));
  if (!gate.ok) {
    if (hasGpu && wish !== "pool") return { kind: "own" };
    const error = gateWords(gate.reason, false);
    return gate.reason === "model3d"
      ? { kind: "refuse", refusal: { status: 403, body: { error, code: "own-gpu-tool" }, headers: {} } }
      : { kind: "refuse", refusal: { status: 403, body: { error, code: "not-offered" }, headers: { [BILLING_HEADER]: "not-offered" } } };
  }
  return { kind: "pool", planned, policy: p, steps: gate.steps ? pricedSteps(gate.steps) : undefined };
}

/** The input files of a request, for the moderation service: their kind and sha256 (pictures' previews: not sent yet). */
async function inputFacts(accountId: string, req: GenerationRequest): Promise<{ n: number; kind: "image" | "video" | "audio"; sha256: string; preview: null }[]> {
  const i = req.inputs ?? {};
  const refs: [string | undefined, "image" | "video" | "audio"][] = [
    ...(i.images ?? []).map((r) => [r, "image"] as [string, "image"]),
    [i.endImage, "image"],
    [i.mask, "image"],
    [i.sketch, "image"],
    [i.video, "video"],
    ...(i.videos ?? []).map((r) => [r, "video"] as [string, "video"]),
    [i.audio, "audio"],
    [i.audio2, "audio"],
    [i.voiceAudio, "audio"],
    [i.voiceAudio2, "audio"],
    ...(i.audios ?? []).map((r) => [r, "audio"] as [string, "audio"]),
  ];
  const out: { n: number; kind: "image" | "video" | "audio"; sha256: string; preview: null }[] = [];
  for (const [ref, kind] of refs) {
    if (!ref) continue;
    try {
      const f = await runAsTenant({ kind: "account", id: accountId }, () => readRef(ref));
      out.push({ n: out.length, kind, sha256: crypto.createHash("sha256").update(f.data).digest("hex"), preview: null });
    } catch {
      // A file it can't read: the run says so when it is created.
    }
  }
  return out;
}

/**
 * The moderation service's check of an account's run (no service: allowed, nothing to stamp). A refusal costs nothing:
 * it comes before any hold.
 */
export async function moderateRun(
  account: Account,
  req: GenerationRequest,
  planned: Planned | null,
  place: "pool" | "own",
  /** A result made in the browser (no plan): what it is and where the account works. */
  browser?: { kind: RunFacts["kind"]; place: RunFacts["place"] },
): Promise<{ ok: true; checkOutputs: boolean } | { ok: false; refusal: Refusal }> {
  if (!moderationConfigured()) return { ok: true, checkOutputs: false };
  const kind = planned ? outputKind(planned.op, planned.model) : (browser?.kind ?? "image");
  const run = planned
    ? { ...runFacts(req, planned, kind), place: place === "pool" ? ("pool" as const) : planned.route.provider === "comfyui" ? ("own-gpu" as const) : ("own-key" as const) }
    : null;
  const a = await checkRun({
    requestId: nanoid(16),
    account: { id: account.id },
    run: run ?? { ...runFacts(req, { model: { id: req.modelId, kind, engine: "open" }, op: req.op ?? "", jobs: 1, outputs: 1, providerId: browser ? "local" : "", costUsd: null, loras: { applied: [] } }, kind), place: browser?.place ?? "own-gpu" },
    prompt: req.prompt ?? "",
    negative: req.negativePrompt ?? null,
    inputs: await inputFacts(account.id, req),
    consent: null,
  });
  if (a.allowed) return { ok: true, checkOutputs: a.checkOutputs !== false };
  const status = a.code === "paused" ? 503 : 403;
  return { ok: false, refusal: { status, body: { error: a.text, code: a.code }, headers: {} } };
}

/**
 * Set the run's price aside (no billing service: nothing to set aside; the run is free). Returns the stamp the run's
 * rows carry, or the refusal (402, 409 with the new price, 429, 503, 403; docs/billing-hook.md).
 */
export async function reservePool(
  account: Account,
  req: GenerationRequest,
  planned: Planned,
  shown: { amount: number; priceVersion: string } | null,
  checkOutputs: boolean,
  steps?: RunFacts["steps"],
): Promise<{ ok: true; stamp: RunStamp } | { ok: false; refusal: Refusal }> {
  const base: RunStamp = { place: "pool", ...(checkOutputs && { checkOutputs: true }) };
  if (!billingConfigured()) return { ok: true, stamp: base };
  const kind = outputKind(planned.op, planned.model);
  const a = await reserve({
    requestId: nanoid(16),
    account: accountFacts(account),
    run: { ...runFacts(req, planned, kind), ...(steps?.length && { steps }) },
    queue: queueFacts(account.id, planned.route.endpoint),
    shown: shown ?? { amount: 0, priceVersion: "" },
  });
  if (!a) return { ok: true, stamp: base };
  if (!a.ok) {
    return { ok: false, refusal: billingRefusal(a.code, a.text, { ...(a.quote && { quote: a.quote }), ...(a.action && { action: a.action }), ...(a.offer && { offer: a.offer }) }) };
  }
  forgetBalance(account.id);
  // Its class and head start in the line come from the answer too (a paid run goes before every free one).
  const boost = Number(a.boostMs);
  // What the hold set aside: a run that can't finish says it wasn't charged only when something could have been.
  const amount = Number(a.amount);
  return {
    ok: true,
    stamp: {
      ...base,
      hold: a.holdId,
      ...(Number.isFinite(amount) && amount > 0 && { heldAmount: amount }),
      ...(a.text && { charge: a.text }),
      ...(a.maxWaitMs > 0 && { waitMs: a.maxWaitMs }),
      ...(a.class === "paid" && { class: "paid" as const }),
      ...(Number.isFinite(boost) && boost > 0 && { boostMs: Math.min(boost, 24 * 60 * 60_000) }),
    },
  };
}

/** Where a new run would stand in line on this install's GPUs right now (1: next), and the wait, about (null: unknown). */
export interface PoolLine {
  place: number;
  etaSeconds: number | null;
}

/** A price check's answer for a run this install's GPUs won't take, in the words the run itself would get. */
const notOfferedQuote = (text: string): Quote => ({ allowed: false, amount: 0, priceVersion: "", text, code: "not-offered" });

/**
 * A price check on this install's GPUs (hosted runs on): the plan there, the billing service's quote (no service: free,
 * and Run keeps its own words) and where the run would stand in line. Null when the run wouldn't go there (its own GPU,
 * its own key, today's answer).
 *
 * The quote is refused before Run for what the run itself would be refused for (the same poolGate as decidePlace, and
 * the route's limits), so Run is off and says why instead of failing once pressed: a model, a kind, LoRAs, files or a
 * chain's later step this install's GPUs don't take (for a viewer with no GPU of its own to send them to instead), and
 * the policy's limits on runs at once, runs in line and runs an hour. A guest's refusal names nothing it can't do yet.
 * `addr`: the client's address as the hourly count keeps it (pool-limits.ts clientAddress), asked for only when the
 * policy counts runs per address.
 */
export async function poolQuote(
  account: Account | null,
  asked: GenerationRequest,
  wish: PlaceWish,
  o: { addr?: () => string | null } = {},
): Promise<{ planned: Planned; quote: Quote; line: PoolLine } | null> {
  if (!hostedRunsOn() || wish === "own" || !poolReady()) return null;
  // A guest is priced under the billing service's policy for guests (none set: as an account would be, once signed up).
  const p = await billingPolicy(account?.id ?? null);
  // Priced for the outputs it would make: the studio's cap per run, and the billing service's when lower.
  const cap = Math.min(ACCOUNT_LIMITS.outputsPerRun, ...(billingConfigured() && p && p.limits.outputsPerRun > 0 ? [p.limits.outputsPerRun] : []));
  const req = (asked.params?.numOutputs ?? 1) > cap ? { ...asked, params: { ...asked.params, numOutputs: cap } } : asked;
  let planned: Planned;
  try {
    planned = runOnPool(account?.id ?? null, () => previewGeneration(req));
  } catch {
    return null;
  }
  if (planned.route.provider !== "comfyui") return null;
  const hasGpu = !!account && !!accountGpu(account.id);
  if (account && hasGpu && wish !== "pool" && !prefersPool(p) && (await ownGpuOnline(account.id))) return null;
  if (p && !p.hosted) return null;
  const line = (facts: { ahead: number; etaS: number | null }, q?: Quote): PoolLine => ({ place: Math.max(0, facts.ahead) + 1, etaSeconds: q?.etaS ?? facts.etaS ?? null });
  // What this install's GPUs won't take goes to the viewer's own GPU when it has one (as the run would); otherwise the
  // price check says so, and Run stays off.
  const gate = poolGate(p, planned, req, () => stepsFor(account, req));
  if (!gate.ok) {
    if (hasGpu && wish !== "pool") return null;
    return { planned, quote: notOfferedQuote(gateWords(gate.reason, !account)), line: line(queueFacts(account?.id ?? null, planned.route.endpoint)) };
  }
  // Priced once for every step of a chain that uses this install's GPUs.
  const facts = { ...runFacts(req, planned, outputKind(planned.op, planned.model)), ...(gate.steps && { steps: pricedSteps(gate.steps) }) };
  const queue = queueFacts(account?.id ?? null, planned.route.endpoint);
  let q = await billingQuote(account ? accountFacts(account) : null, facts, queue);
  // The policy's limits on this account's runs here, as the run would meet them (pool-limits.ts): said before Run.
  if (q.allowed && account && p) {
    const over = poolLimitRefusal(account.id, p, o.addr ?? null);
    if (over) q = { ...q, allowed: false, code: "limit", text: over.error };
  }
  return { planned, quote: q, line: line(queue, q) };
}
