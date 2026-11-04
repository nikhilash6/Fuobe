import "server-only";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { GenerationRequest } from "@/lib/catalog/types";
import { OWN_GPU_TOOL_MESSAGE } from "@/lib/guest-access";
import { RTX_CLASSES, rtxCardOf } from "@/lib/catalog/rtx-video";
import { gpuFits } from "@/lib/gpu/readiness";
import { gpuState } from "./account-gpu";
import { accountGpu, type Account } from "./auth";
import {
  accountFacts,
  BILLING_HEADER,
  BILLING_WAIT,
  billingConfigured,
  cachedPolicy,
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
import { HOSTED_GUEST_WORDS, HOSTED_WORDS, inputCounts, poolAllows, poolAllowsRun, poolOnWorkers, poolReady, poolRunsProvider, poolTakes, poolTakesFiles, POOL_LANE, queueFacts, runFacts, runOnPool, workflowPicks } from "./hosted";
import { withRunStamp } from "./run-stamp";
import { hostedRunsOn } from "./hosted-switch";
import { checkRun, moderationConfigured } from "./moderation";
import type { RunStamp } from "./run-stamp";
import { readRef } from "./storage";
import { readSnapshot } from "./gpu/snapshots";
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

/**
 * The decision for an account's run: its own GPU or key as today, this install's GPUs, or a refusal. On this install's
 * GPUs: the request as it runs there (`req`, `capped` when the policy cut its outputs), its plan, its policy and the steps
 * it is priced for.
 */
export type PlaceDecision =
  | { kind: "own" }
  | { kind: "pool"; planned: Planned; policy: Policy; steps: RunFacts["steps"]; req: GenerationRequest; capped: boolean }
  | { kind: "refuse"; refusal: Refusal };

const OWN: PlaceDecision = { kind: "own" };

/** What an account whose own GPU didn't answer is asked, when its run named no place (never moved and charged unasked). */
export const OWN_GPU_QUIET = "Your GPU isn't answering right now. Run this on this studio's GPUs instead, or try again when your GPU is back.";

/** A run this install's GPUs won't take, refused in the words the price check before Run gives too. */
const notOffered = (error: string): PlaceDecision => ({ kind: "refuse", refusal: { status: 403, body: { error, code: "not-offered" }, headers: { [BILLING_HEADER]: "not-offered" } } });

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
 * A ComfyUI step that needs no model and no graphics memory (a join, a trim, a mux): light work that costs nothing and
 * that every policy allows.
 */
function freeStep(s: PlannedStep): boolean {
  if (s.provider !== "comfyui") return false;
  const endpoint = stepEndpoint(s);
  if (!endpoint) return false;
  // A workflow that picks its graph at run time (`video-concat-{n}`): light when every graph it may pick is.
  const index = loadIndex();
  const needs = (endpoint.includes("{") ? workflowPicks(endpoint) : [endpoint]).map((id) => needsOf(index, id));
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
 * the policy leaves out, a model no worker is allowed, a cloud model, a text step or one made in the browser: steps that
 * can't run there, a model their card can't run), in words; null when every step may run there. A light ComfyUI step (a
 * join) costs nothing and every policy allows it, but it still runs there: something there must take it, or the run's
 * other steps would finish and their join would wait for nothing.
 */
export function stepsProblem(p: Policy, steps: PlannedStep[]): string | null {
  for (const s of steps) {
    if (!poolRunsProvider(s.provider)) return HOSTED_WORDS.notOffered;
    if (s.provider === "comfyui" && poolCardRefuses(s.modelId)) return HOSTED_WORDS.rtxCard;
    if (freeStep(s)) {
      if (s.provider === "comfyui" && !poolTakes(stepEndpoint(s))) return HOSTED_WORDS.notOffered;
      continue;
    }
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
    if (freeStep(s) || !poolRunsProvider(s.provider)) continue;
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

/**
 * Why this install's GPUs won't take a run: a 3D model, a model or kind not offered there, a model their card can't run,
 * LoRAs, or a kind of file.
 */
export type GateReason = "model3d" | "notOffered" | "rtxCard" | "loras" | "inputs";

/** The words for a gate's reason: an account may connect its own GPU in Settings, a guest has nowhere to do that yet. */
export function gateWords(reason: GateReason, guest: boolean): string {
  if (reason === "model3d") return OWN_GPU_TOOL_MESSAGE;
  return (guest ? HOSTED_GUEST_WORDS : HOSTED_WORDS)[reason];
}

/**
 * The one check of whether this install's GPUs take a run, shared by the run itself (decidePlace) and the price check
 * before Run (poolQuote), so the two always agree: its output kind (no 3D there), the policy's model, app and kind
 * lists (for the run's own model and every other model it makes a step with, such as a 2K take's finish), a worker
 * allowed its lane, a card that can run it, LoRAs, the kinds of file it sends, and every later step of a chain (planned
 * only once the cheaper checks pass). `p` null: the billing service didn't answer, so only what needs no policy is
 * checked. Passed, it gives the planned steps for the run's one price.
 */
export function poolGate(
  p: Policy | null,
  planned: Planned,
  req: GenerationRequest,
  planSteps: () => PlannedStep[] | null,
): { ok: true; steps: PlannedStep[] | null } | { ok: false; reason: GateReason } {
  const kind = outputKind(planned.op, planned.model);
  if (kind === "model3d") return { ok: false, reason: "model3d" };
  if (p && (!poolAllowsRun(p, planned, req.presetId) || !kindAllowed(p, kind))) return { ok: false, reason: "notOffered" };
  // Nothing of this install's would ever run it (no worker is allowed its lane): never a run that waits for nothing.
  if (!poolTakes(planned.route.endpoint)) return { ok: false, reason: "notOffered" };
  if (poolCardRefuses(planned.model.id)) return { ok: false, reason: "rtxCard" };
  if (req.loras?.length) return { ok: false, reason: "loras" };
  if (p) {
    const inputs = inputCounts(req);
    const takes = (k: "image" | "video" | "audio") => p.uploads[k] && poolTakesFiles(k);
    if ((inputs.image && !takes("image")) || (inputs.video && !takes("video")) || (inputs.audio && !takes("audio"))) return { ok: false, reason: "inputs" };
  }
  // Every step of a chain, not only its first: each one the policy must allow, and the run is priced for all of them.
  const steps = planSteps();
  const problem = steps && p ? stepsProblem(p, steps) : null;
  if (problem) return { ok: false, reason: problem === HOSTED_WORDS.rtxCard ? "rtxCard" : "notOffered" };
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
 * A request as it runs on this install's GPUs: no more outputs than the studio's cap per run, and the policy's when lower
 * (`capped`: fewer than it asked). The price check and the run plan and price this same request.
 */
export function poolRequest(req: GenerationRequest, p: Pick<Policy, "limits"> | null): { req: GenerationRequest; capped: boolean } {
  const policyCap = p && p.limits.outputsPerRun > 0 ? [Math.floor(p.limits.outputsPerRun)] : [];
  const cap = Math.min(ACCOUNT_LIMITS.outputsPerRun, ...policyCap);
  if ((req.params?.numOutputs ?? 1) <= cap) return { req, capped: false };
  return { req: { ...req, params: { ...req.params, numOutputs: cap } }, capped: true };
}

/**
 * A model that needs an NVIDIA RTX card (src/lib/catalog/rtx-video.ts) on this install's GPUs: refused when the install's
 * last GPU check says its card can't run it (a CPU, an Apple, AMD or Intel device, an older NVIDIA card) or its ComfyUI
 * lacks the RTX Video nodes. A card the name doesn't tell, or no check yet, never refuses (the run says what it finds).
 * On the workers that check is of another machine, so it isn't made: a worker takes a job only when it has the job's
 * node packs and files.
 */
export function poolCardRefuses(modelId: string): boolean {
  if (poolOnWorkers()) return false;
  const need = rtxCardOf(modelId);
  if (!need) return false;
  const inv = readSnapshot({ kind: "install", key: "install", via: "server" })?.inventory;
  if (!inv?.reachable) return false;
  return gpuFits(need, inv) === false || RTX_CLASSES.some((c) => inv.nodes.missing.includes(c));
}

/**
 * Where an account's run goes (hosted.ts has the order). Only with hosted runs on; otherwise always "own" (today).
 *
 * An account with a GPU of its own keeps it as before: its own GPU first (unless the policy puts this install's first),
 * and every run this install's GPUs wouldn't take (the service down, hosted runs closed to it, a model or a kind not
 * offered, LoRAs, inputs, a step no worker takes, 3D) goes to its own GPU, even while that GPU doesn't answer. Only a run
 * this install's GPUs would take, that named no place, whose own GPU doesn't answer, is asked about (never moved there,
 * and charged, unasked).
 */
export async function decidePlace(account: Account, asked: GenerationRequest, wish: PlaceWish): Promise<PlaceDecision> {
  if (!hostedRunsOn() || wish === "own" || !poolReady()) return OWN;
  let planned: Planned;
  try {
    planned = runOnPool(account.id, () => previewGeneration(asked));
  } catch {
    // A paid model, a model switched off, a request with something wrong: today's path says what.
    return OWN;
  }
  if (planned.route.provider !== "comfyui") return OWN;
  // What this install's GPUs can't take goes to the account's own GPU when it has one and didn't ask for this install's.
  const ownFallback = !!accountGpu(account.id) && wish !== "pool";
  // Its own GPU first, unless the policy puts this install's first. The policy as last read is enough to know that (no
  // call to the billing service); when none is kept, it is read while the GPU is checked.
  let p = cachedPolicy(account.id);
  let ownOffline = false;
  if (ownFallback && !prefersPool(p)) {
    const [online, read] = await Promise.all([ownGpuOnline(account.id), p === undefined ? billingPolicy(account.id) : Promise.resolve(p)]);
    p = read;
    if (!prefersPool(p)) {
      if (online) return OWN;
      ownOffline = true;
    }
  }
  if (p === undefined) p = await billingPolicy(account.id);
  if (!p) return ownFallback ? OWN : { kind: "refuse", refusal: billingRefusal("paused", BILLING_WAIT.run) };
  // Closed to this account: its own GPU (or today's "Connect your GPU"); asked for by name, said so.
  if (!p.hosted) return wish === "pool" ? notOffered(HOSTED_WORDS.notHosted) : OWN;
  // Planned, checked and priced for the outputs it would make there (the policy's cap per run).
  const { req, capped } = poolRequest(asked, p);
  if (capped) {
    try {
      planned = runOnPool(account.id, () => previewGeneration(req));
    } catch {
      return OWN;
    }
  }
  // The same check as the price check before Run (poolGate): what this install's GPUs can't take goes to the account's
  // own GPU when it has one and didn't ask for this install's; otherwise it is refused in the same words.
  const gate = poolGate(p, planned, req, () => stepsFor(account, req));
  if (!gate.ok) {
    if (ownFallback) return OWN;
    const error = gateWords(gate.reason, false);
    return gate.reason === "model3d" ? { kind: "refuse", refusal: { status: 403, body: { error, code: "own-gpu-tool" }, headers: {} } } : notOffered(error);
  }
  // Its own GPU didn't answer the check: asked, never moved to this install's GPUs (and charged) without a word.
  if (ownOffline) return { kind: "refuse", refusal: askPlace() };
  return { kind: "pool", planned, policy: p, steps: gate.steps ? pricedSteps(gate.steps) : undefined, req, capped };
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
  // Read as the account (an input's size from its own files only).
  const run = planned
    ? { ...runAsTenant({ kind: "account", id: account.id }, () => runFacts(req, planned, kind)), place: place === "pool" ? ("pool" as const) : planned.route.provider === "comfyui" ? ("own-gpu" as const) : ("own-key" as const) }
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
  // No answer from the service, on this install's GPUs: the same plain words as when the billing service doesn't answer.
  const error = a.code === "paused" && place === "pool" ? BILLING_WAIT.run : a.text;
  return { ok: false, refusal: { status, body: { error, code: a.code }, headers: {} } };
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
    run: { ...runOnPool(account.id, () => runFacts(req, planned, kind)), ...(steps?.length && { steps }) },
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
  return {
    ok: true,
    stamp: {
      ...base,
      hold: a.holdId,
      ...(a.text && { charge: a.text }),
      // Something was set aside (a free run's hold sets aside nothing): only then can a run that ends early say so.
      ...(Number(a.amount) > 0 && { charged: true }),
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
  // Priced for the outputs it would make: the studio's cap per run, and the policy's when lower (as the run is).
  const { req } = poolRequest(asked, p);
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
  // Priced once for every step of a chain that uses this install's GPUs. Its facts are read as the viewer (an input's
  // size from its own files only: another's file reads as none, and says nothing of whether it exists).
  const facts = { ...runOnPool(account?.id ?? null, () => runFacts(req, planned, outputKind(planned.op, planned.model))), ...(gate.steps && { steps: pricedSteps(gate.steps) }) };
  const queue = queueFacts(account?.id ?? null, planned.route.endpoint);
  let q = await billingQuote(account ? accountFacts(account) : null, facts, queue);
  // The policy's limits on this account's runs here, as the run would meet them (pool-limits.ts): said before Run.
  if (q.allowed && account && p) {
    const over = poolLimitRefusal(account.id, p, o.addr ?? null);
    if (over) q = { ...q, allowed: false, code: "limit", text: over.error };
  }
  return { planned, quote: q, line: line(queue, q) };
}
