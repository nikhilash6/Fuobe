import "server-only";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { GenerationRequest } from "@/lib/catalog/types";
import { CONNECT_GPU_HEADER, OWN_GPU_TOOL_MESSAGE } from "@/lib/guest-access";
import { ownSetupLabel, ownSetupOnly, type OwnSetup } from "@/lib/own-setup";
import { gpuState } from "./account-gpu";
import { accountGpu, type Account } from "./auth";
import {
  accountFacts,
  BILLING_HEADER,
  BILLING_WAIT,
  billingConfigured,
  cachedPolicy,
  forgetBalance,
  FREE_QUOTE,
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
import { PLACE_ASK_HEADER, RUN_PLACE_HEADER, RUN_SHOWN_HEADER } from "@/lib/guest-access";
import { db } from "./db";
import { AccountRunError, createGenerations, outputKind, plannedSteps, previewChained, previewGeneration, stepsOf, type PlannedStep } from "./generations";
import { loadIndex } from "./gpu/index-file";
import { poolLane } from "./computer/pool";
import { HOSTED_GUEST_WORDS, HOSTED_WORDS, inputCounts, outputsWords, poolAllows, poolAllowsRun, poolOnWorkers, poolReady, poolRunsProvider, poolTakes, poolUploads, POOL_LANE, queueFacts, runFacts, runOnPool, workflowPicks } from "./hosted";
import { withRunStamp } from "./run-stamp";
import { hostedRunsOn } from "./hosted-switch";
import { checkRun, moderationConfigured } from "./moderation";
import type { RunStamp } from "./run-stamp";
import { readRef } from "./storage";
import { ACCOUNT_LIMITS } from "./account-files";
import { poolLimitRefusal } from "./pool-limits";
import { runAsTenant } from "./tenant";
import { needsGpu, poolCardRefuses, requestOwnSetup } from "./pool-own-setup";
import { ADD_KEY_HEADER } from "@/lib/your-keys";

export { poolCardRefuses };

/**
 * The generations route's side of hosted runs (hosted.ts), the billing hook (billing.ts) and the moderation hook
 * (moderation.ts). With nothing set (no FUOBE_HOSTED_RUNS, no service addresses) none of it changes a run.
 */

/** What the client asked for: its own GPU, or this install's (a preference the server checks). */
export type PlaceWish = "own" | "pool" | undefined;

/** The client's preference and the price it showed, read from the body beside the request (never part of it). */
export function readWishes(body: unknown, headers?: Headers): { wish: PlaceWish; shown: { amount: number; priceVersion: string } | null } {
  const b = (body ?? {}) as { place?: unknown; shown?: unknown };
  const wish = placeWish(b.place) ?? placeWish(headers?.get(RUN_PLACE_HEADER));
  return { wish, shown: shownPrice(b.shown) ?? shownPrice(headerJson(headers?.get(RUN_SHOWN_HEADER))) };
}

const placeWish = (v: unknown): PlaceWish => (v === "own" || v === "pool" ? v : undefined);

function shownPrice(v: unknown): { amount: number; priceVersion: string } | null {
  const s = v as { amount?: unknown; priceVersion?: unknown } | null | undefined;
  return s && typeof s === "object" && Number.isFinite(s.amount) && Number(s.amount) >= 0 && typeof s.priceVersion === "string" && s.priceVersion.length <= 200
    ? { amount: Math.floor(Number(s.amount)), priceVersion: s.priceVersion }
    : null;
}

/** A header's URI-encoded JSON (RUN_SHOWN_HEADER), or null when it isn't one. */
function headerJson(v: string | null | undefined): unknown {
  if (!v || v.length > 600) return null;
  try {
    return JSON.parse(decodeURIComponent(v));
  } catch {
    return null;
  }
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
 * Planning a run on this install's GPUs was refused for a mode or option that runs on a visitor's own setup only (MiniMax
 * H3 at 2K, Kandinsky 6.0 Pro: their check refuses them there before poolGate is asked): that setup, so the run and its
 * price check say its label as poolGate would. Null for any other refusal (a cloud model without the visitor's key
 * keeps today's answer: it never runs here).
 */
function refusedForOwnSetup(e: unknown, req: GenerationRequest): OwnSetup | null {
  if (!(e instanceof AccountRunError) || req.engine === "cloud") return null;
  const own = requestOwnSetup({ ...req, engine: "open" });
  return own?.need === "gpu" ? own : null;
}

/**
 * The decision for an account's run: its own GPU or key as today, this install's GPUs, or a refusal. On this install's
 * GPUs: the request as it runs there (`req`, `capped` when the policy cut its outputs), its plan, its policy, the steps
 * it is priced for, and whether it is light work only (`light`: every step a join, a trim or the like, which is free and
 * never counted against the policy's limits).
 */
export type PlaceDecision =
  | { kind: "own" }
  | { kind: "pool"; planned: Planned; policy: Policy; steps: RunFacts["steps"]; req: GenerationRequest; capped: boolean; light: boolean }
  | { kind: "refuse"; refusal: Refusal };

const OWN = { kind: "own" } as const;

/** What an account whose own GPU didn't answer is asked, when its run named no place (never moved and charged unasked). */
export const OWN_GPU_QUIET = "Your GPU isn't answering right now. Run this on this studio's GPUs instead, or try again when your GPU is back.";

/** A run this install's GPUs won't take, refused in the words the price check before Run gives too. */
const notOffered = (error: string): { kind: "refuse"; refusal: Refusal } => ({ kind: "refuse", refusal: { status: 403, body: { error, code: "not-offered" }, headers: { [BILLING_HEADER]: "not-offered" } } });

/**
 * A run that runs on the visitor's own setup only (own-setup.ts): refused in its label's words, with the setup itself so
 * the client opens it (Connect your GPU, or Add your key) instead of saying no.
 */
const ownSetupRefusal = (setup: OwnSetup): { kind: "refuse"; refusal: Refusal } => ({
  kind: "refuse",
  refusal: {
    status: 403,
    body: { error: ownSetupLabel(setup), code: setup.need === "key" ? "add-key" : "connect-gpu", ownSetup: setup, ...(setup.need === "key" && { provider: setup.provider }) },
    headers: setup.need === "key" ? { [ADD_KEY_HEADER]: setup.provider } : { [CONNECT_GPU_HEADER]: "1" },
  },
});

/** A gate's refusal as the run's answer: its words, with the own setup that would run it. */
function gateRefusal(gate: GateRefusal): { kind: "refuse"; refusal: Refusal } {
  if (gate.reason === "ownSetup") return ownSetupRefusal(gate.setup ?? needsGpu());
  const error = gateText(gate, false);
  if (gate.reason === "model3d") return { kind: "refuse", refusal: { status: 403, body: { error, code: "own-gpu-tool" }, headers: {} } };
  const r = notOffered(error);
  if (gate.setup) r.refusal.body.ownSetup = gate.setup;
  return r;
}

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
 * A text step (the install's AI helper writing a script, lyrics or a translation) inside a run on this install's GPUs:
 * it runs on the helper, costs nothing and is never counted against the policy's limits.
 */
export const helperStep = (provider: string): boolean => provider === "llm";

/**
 * A ComfyUI step of CPU work (the requirements index marks it `cpu`: no model file, no first-run download, no graphics
 * memory and no card its nodes need, such as a filter, a trim, a join, adding sound or a Ken Burns move): light work that
 * costs nothing, that every policy allows, and that is never counted. A step whose nodes run on the card (RTX Video) is
 * GPU work, model file or not. A chain's text step (helperStep) is free too.
 */
function freeStep(s: PlannedStep): boolean {
  if (helperStep(s.provider)) return true;
  if (s.provider !== "comfyui") return false;
  const endpoint = stepEndpoint(s);
  if (!endpoint) return false;
  // A workflow that picks its graph at run time (`video-concat-{n}`): light when every graph it may pick is.
  const index = loadIndex();
  const ids = endpoint.includes("{") ? workflowPicks(endpoint) : [endpoint];
  return ids.length > 0 && ids.every((id) => index.workflows[id]?.cpu === true);
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
    const own = s.provider === "comfyui" ? ownSetupOnly(s.modelId, "open") : null;
    if (own) return ownSetupLabel(own);
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

/** How many outputs each row asks for (its request's numOutputs: a run split into one job per output keeps it on each). */
function rowOutputs(ids: string[]): number[] {
  const q = db().prepare("SELECT request_json FROM generations WHERE id = ?");
  return ids.map((id) => {
    const r = q.get(id) as { request_json: string } | undefined;
    try {
      const n = r ? Number((JSON.parse(r.request_json) as GenerationRequest).params?.numOutputs ?? 1) : 1;
      return Number.isFinite(n) ? n : 1;
    } catch {
      return 1;
    }
  });
}

/**
 * The rows a tool's run made on this install's GPUs, checked against what it was priced and held for, before anything
 * of it is sent: every step one the policy allows there (stepsProblem); a run held as light work (free, never counted)
 * that made light work only; no row asking for more outputs at once than a run there makes (poolOutputsCap); and no more
 * jobs of any model and operation than were priced. Null when they match; otherwise its refusal's words. A tool whose
 * start makes more than its plan said is stopped here, never run on a hold for less.
 */
export function madeRunProblem(run: { policy: Policy; steps: RunFacts["steps"]; light: boolean }, ids: string[]): string | null {
  const made = stepsOf(ids);
  const problem = stepsProblem(run.policy, made);
  if (problem) return problem;
  if (run.light) return lightRun(made) ? null : HOSTED_WORDS.notOffered;
  const cap = poolOutputsCap(run.policy);
  if (rowOutputs(ids).some((n) => n > cap)) return outputsWords(cap, false);
  const held = new Map((run.steps ?? []).map((s) => [`${s.model} ${s.op ?? ""}`, s.jobs]));
  for (const s of pricedSteps(made)) if (s.jobs > (held.get(`${s.model} ${s.op ?? ""}`) ?? 0)) return HOSTED_WORDS.notOffered;
  return null;
}

/**
 * Is a run light work only: every step it makes a ComfyUI step that needs no model and no graphics memory (a filter, a
 * trim, a join, adding sound, a Ken Burns move)? Such a run is free and never counts against the policy's limits on runs
 * at once, in line or an hour. Unknown steps (null: the plan couldn't be made) count as GPU work.
 */
export const lightRun = (steps: PlannedStep[] | null | undefined): boolean => !!steps?.length && steps.every(freeStep);

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
 * LoRAs, a kind of file, more outputs at once than a run there makes (`outputs`: a tool's run, which can't be cut down
 * the way the studios' own runs are), or one that runs on the visitor's own setup only (`ownSetup`: a static item of
 * own-setup.ts, or a workflow none of this install's GPUs can run right now: none holds its files, serves its lane, or
 * has the memory).
 */
export type GateReason = "model3d" | "notOffered" | "rtxCard" | "loras" | "inputs" | "outputs" | "ownSetup";

/**
 * A gate's refusal: its reason, and the visitor's own setup that would run it (`setup`: always with "ownSetup"; with the
 * others, a GPU of its own, which runs what this install's GPUs don't take). `cap`: with "outputs", the most a run there
 * makes at once.
 */
export type GateRefusal = { ok: false; reason: GateReason; setup?: OwnSetup; cap?: number };

/** The words for a gate's reason: an account may connect its own GPU in Settings, a guest has nowhere to do that yet. */
export function gateWords(reason: Exclude<GateReason, "ownSetup" | "outputs">, guest: boolean): string {
  if (reason === "model3d") return OWN_GPU_TOOL_MESSAGE;
  return (guest ? HOSTED_GUEST_WORDS : HOSTED_WORDS)[reason];
}

/** A gate's refusal in words: the own setup's label (the same for a guest and an account), or the reason's words. */
export const gateText = (gate: GateRefusal, guest: boolean): string =>
  gate.reason === "ownSetup" ? ownSetupLabel(gate.setup ?? needsGpu()) : gate.reason === "outputs" ? outputsWords(gate.cap ?? 1, guest) : gateWords(gate.reason, guest);

/**
 * The one check of whether this install's GPUs take a run, shared by the run itself (decidePlace) and the price check
 * before Run (poolQuote), so the two always agree: its output kind (no 3D there), the policy's model, app and kind
 * lists (for the run's own model and every other model it makes a step with, such as a 2K take's finish), a worker
 * allowed its lane, a card that can run it, LoRAs, the kinds of file it sends, and every later step of a chain (planned
 * only once the cheaper checks pass). `p` null: the billing service didn't answer, so only what needs no policy is
 * checked. Passed, it gives the planned steps for the run's one price.
 *
 * First of all, every step's own setup (own-setup.ts): a model, mode or option that runs on a visitor's own GPU or key
 * only is refused as "ownSetup" with that setup, on the run's own step and on every later step of a chain alike.
 */
export function poolGate(
  p: Policy | null,
  planned: Planned,
  req: GenerationRequest,
  planSteps: () => PlannedStep[] | null,
): { ok: true; steps: PlannedStep[] | null } | GateRefusal {
  const own = requestOwnSetup({ ...req, modelId: planned.model.id, engine: "open" });
  if (own) return { ok: false, reason: "ownSetup", setup: own };
  const gpu = needsGpu(planned.route.endpoint);
  const kind = outputKind(planned.op, planned.model);
  if (kind === "model3d") return { ok: false, reason: "model3d" };
  if (p && (!poolAllowsRun(p, planned, req.presetId) || !kindAllowed(p, kind))) return { ok: false, reason: "notOffered", setup: gpu };
  // Nothing of this install's runs it right now (no worker holds its files, is allowed its lane, or has the memory it
  // needs): a run that would wait for nothing, so it runs on the visitor's own GPU instead.
  if (!poolTakes(planned.route.endpoint)) return { ok: false, reason: "ownSetup", setup: gpu };
  if (poolCardRefuses(planned.model.id)) return { ok: false, reason: "rtxCard", setup: gpu };
  if (req.loras?.length) return { ok: false, reason: "loras", setup: gpu };
  if (p) {
    const inputs = inputCounts(req);
    const takes = poolUploads(p);
    if ((inputs.image && !takes.image) || (inputs.video && !takes.video) || (inputs.audio && !takes.audio)) return { ok: false, reason: "inputs", setup: gpu };
  }
  // Every step of a chain, not only its first: each one the policy must allow, and the run is priced for all of them.
  const steps = planSteps();
  for (const s of steps ?? []) {
    const later = s.provider === "comfyui" ? ownSetupOnly(s.modelId, "open") : null;
    if (later) return { ok: false, reason: "ownSetup", setup: later };
  }
  const problem = steps && p ? stepsProblem(p, steps) : null;
  if (problem) return { ok: false, reason: problem === HOSTED_WORDS.rtxCard ? "rtxCard" : "notOffered", setup: gpu };
  return { ok: true, steps };
}

/**
 * The account a guest's price check plans a chain's later steps under: no real account has it (account ids hold no
 * colon), and nothing planned under it is kept (plannedSteps throws every row away).
 */
export const GUEST_PLAN = "guest:plan";

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

/** The most outputs one request makes on this install's GPUs: the studio's cap per run, and the policy's when lower. */
export function poolOutputsCap(p: Pick<Policy, "limits"> | null): number {
  const policyCap = p && p.limits.outputsPerRun > 0 ? [Math.floor(p.limits.outputsPerRun)] : [];
  return Math.min(ACCOUNT_LIMITS.outputsPerRun, ...policyCap);
}

/**
 * A request as it runs on this install's GPUs: no more outputs than poolOutputsCap (`capped`: fewer than it asked). The
 * price check and the run plan and price this same request.
 */
export function poolRequest(req: GenerationRequest, p: Pick<Policy, "limits"> | null): { req: GenerationRequest; capped: boolean } {
  const cap = poolOutputsCap(p);
  if ((req.params?.numOutputs ?? 1) <= cap) return { req, capped: false };
  return { req: { ...req, params: { ...req.params, numOutputs: cap } }, capped: true };
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
  } catch (e) {
    // A mode that runs on the visitor's own setup only: its own GPU when it has one, else refused in its label's words.
    const own = refusedForOwnSetup(e, asked);
    if (own && !accountGpu(account.id)) return gateRefusal({ ok: false, reason: "ownSetup", setup: own });
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
    return gateRefusal(gate);
  }
  // Its own GPU didn't answer the check: asked, never moved to this install's GPUs (and charged) without a word.
  if (ownOffline) return { kind: "refuse", refusal: askPlace() };
  return { kind: "pool", planned, policy: p, steps: gate.steps ? pricedSteps(gate.steps) : undefined, req, capped, light: lightRun(gate.steps) };
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
/**
 * A price check refused for what this install's GPUs don't take: its words, and (`ownSetup`) the visitor's own setup
 * that runs it, so Run opens that setup (Connect your GPU, Add your key, or a guest's sign-up) instead of staying off.
 */
const notOfferedQuote = (text: string, setup?: OwnSetup): Quote & { ownSetup?: OwnSetup } => ({ allowed: false, amount: 0, priceVersion: "", text, code: "not-offered", ...(setup && { ownSetup: setup }) });

/** A gate's refusal as the price check's quote (gateText: the label's words for an own setup). */
const gateQuote = (gate: GateRefusal, guest: boolean) => notOfferedQuote(gateText(gate, guest), gate.reason === "model3d" ? undefined : gate.setup);

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
): Promise<{ planned: Planned | null; quote: Quote; line: PoolLine } | null> {
  if (!hostedRunsOn() || wish === "own" || !poolReady()) return null;
  // A guest is priced under the billing service's policy for guests (none set: as an account would be, once signed up).
  const p = await billingPolicy(account?.id ?? null);
  // Priced for the outputs it would make: the studio's cap per run, and the policy's when lower (as the run is).
  const { req } = poolRequest(asked, p);
  let planned: Planned;
  try {
    planned = runOnPool(account?.id ?? null, () => previewGeneration(req));
  } catch (e) {
    // A mode that runs on the visitor's own setup only, for a viewer with no GPU of its own: Run says its label and opens
    // that setup (no plan to show: it never runs here).
    const own = refusedForOwnSetup(e, req);
    if (own && !(account && accountGpu(account.id)) && !(p && !p.hosted)) return { planned: null, quote: gateQuote({ ok: false, reason: "ownSetup", setup: own }, !account), line: { place: 1, etaSeconds: null } };
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
    return { planned, quote: gateQuote(gate, !account), line: line(queueFacts(account?.id ?? null, planned.route.endpoint)) };
  }
  // Light work only (joins, trims): free, and never counted against the policy's limits, so the service isn't asked.
  if (lightRun(gate.steps)) {
    const queue = queueFacts(account?.id ?? null, planned.route.endpoint);
    return { planned, quote: FREE_QUOTE, line: line(queue) };
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

/**
 * Tool runs (account-tool-run.ts: Genjutsu, Storyboard, Character Swap Studio, the apps and the other tools that plan a
 * run as a pipeline of generations): the same decision as a studio run's, made once for the whole run. Every step goes
 * through poolGate as a studio run would (a chain's later steps too); the run is priced once from every step, held once,
 * and counted once against the policy's limits. A text step (a script, lyrics, a translation) runs on the install's AI
 * helper for free; a join, a trim or adding sound is free CPU work. A run with no ComfyUI step at all stays where it
 * runs today.
 */

/** One step of a tool's run, as the tool planned it: its request, and how many earlier steps it waits for. */
export interface ToolRunStep {
  request: GenerationRequest;
  deps?: number;
}

/** A tool run on this install's GPUs: its policy, the step it is priced and held as, its steps priced once, and whether it is light work only. */
export interface ToolPoolRun {
  policy: Policy;
  main: { req: GenerationRequest; planned: Planned };
  steps: RunFacts["steps"];
  light: boolean;
}

export type ToolPlaceDecision = { kind: "own" } | ({ kind: "pool" } & ToolPoolRun) | { kind: "refuse"; refusal: Refusal };

/** A planned step as a row it would make (for a step that waits, whose own chain can't be planned before its inputs exist). */
const asPlannedStep = (req: GenerationRequest, p: Planned, waits: boolean): PlannedStep => ({
  id: "",
  modelId: p.model.id,
  op: p.op,
  provider: p.route.provider,
  kind: outputKind(p.op, p.model),
  presetId: req.presetId ?? null,
  waits,
});

/**
 * Every step of a tool's run through poolGate, as `viewer` (an account's id, or null for a guest's price check):
 * "unplanned" when a step can't be planned on this install's GPUs (a cloud model, a request with something wrong: the
 * run goes where it goes today, which says what), or the first step's refusal; passed, the step the run is priced as
 * (its first ComfyUI step) and every row the run would make.
 *
 * A tool makes its own requests when it starts, so each step is planned and priced as it asks: one that asks for more
 * outputs at once than a run there makes (poolOutputsCap) is refused ("outputs"), never priced as a smaller copy the run
 * wouldn't use.
 */
export function toolGate(
  p: Policy | null,
  viewer: string | null,
  steps: ToolRunStep[],
): "unplanned" | GateRefusal | { ok: true; main: ToolPoolRun["main"]; rows: PlannedStep[] } {
  let main: ToolPoolRun["main"] | null = null;
  const rows: PlannedStep[] = [];
  const cap = poolOutputsCap(p);
  for (const step of steps) {
    const deps = step.deps ?? 0;
    const req = step.request;
    let planned: Planned;
    try {
      planned = runOnPool(viewer, () => previewChained(req, deps));
    } catch {
      return "unplanned";
    }
    if (helperStep(planned.route.provider)) {
      rows.push(asPlannedStep(req, planned, deps > 0));
      continue;
    }
    if (planned.route.provider !== "comfyui") return "unplanned";
    const gate = poolGate(p, planned, req, () => (deps ? [asPlannedStep(req, planned, true)] : poolSteps(viewer ?? GUEST_PLAN, req)));
    // A tool adds its LoRAs itself (a person adds none to it): said as a step that runs on an own GPU, not as extra LoRAs.
    if (!gate.ok) return gate.reason === "loras" ? { ok: false, reason: "notOffered", setup: gate.setup } : gate;
    if ((req.params?.numOutputs ?? 1) > cap) return { ok: false, reason: "outputs", cap };
    rows.push(...(gate.steps ?? [asPlannedStep(req, planned, deps > 0)]));
    main ??= { req, planned };
  }
  return main ? { ok: true, main, rows } : "unplanned";
}

/**
 * Where an account's tool run goes: decidePlace's order for a whole run. With hosted runs off, or asked for its own GPU,
 * always "own" (today). An account with a GPU of its own keeps it first (unless the policy puts this install's first),
 * and a run this install's GPUs won't take goes there; with none, it runs here or is refused in the price check's words.
 */
export async function decideToolPlace(account: Account, steps: ToolRunStep[], wish: PlaceWish): Promise<ToolPlaceDecision> {
  if (!hostedRunsOn() || wish === "own" || !poolReady() || !steps.length) return OWN;
  const ownFallback = !!accountGpu(account.id) && wish !== "pool";
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
  if (!p.hosted) return wish === "pool" ? notOffered(HOSTED_WORDS.notHosted) : OWN;
  const gate = toolGate(p, account.id, steps);
  if (gate === "unplanned") return OWN;
  if (!gate.ok) {
    if (ownFallback) return OWN;
    return gateRefusal(gate);
  }
  if (ownOffline) return { kind: "refuse", refusal: askPlace() };
  return { kind: "pool", policy: p, main: gate.main, steps: pricedSteps(gate.rows), light: lightRun(gate.rows) };
}

/**
 * A tool's price check on this install's GPUs (hosted runs on): the billing service's quote for the whole run, priced
 * once from every step, and where it would stand in line; refused before Run for what the run would be refused for (the
 * same toolGate, and the policy's limits). Null when the run wouldn't go there (its own GPU, its own key, today's answer).
 */
export async function toolPoolQuote(
  account: Account | null,
  steps: ToolRunStep[],
  wish: PlaceWish,
  o: { addr?: () => string | null } = {},
): Promise<{ quote: Quote; line: PoolLine } | null> {
  if (!hostedRunsOn() || wish === "own" || !poolReady() || !steps.length) return null;
  const p = await billingPolicy(account?.id ?? null);
  const hasGpu = !!account && !!accountGpu(account.id);
  if (account && hasGpu && wish !== "pool" && !prefersPool(p) && (await ownGpuOnline(account.id))) return null;
  if (p && !p.hosted) return null;
  const gate = toolGate(p, account?.id ?? null, steps);
  if (gate === "unplanned") return null;
  const lineOf = (endpoint: string | undefined, q?: Quote): PoolLine => {
    const facts = queueFacts(account?.id ?? null, endpoint);
    return { place: Math.max(0, facts.ahead) + 1, etaSeconds: q?.etaS ?? facts.etaS ?? null };
  };
  if (!gate.ok) {
    if (hasGpu && wish !== "pool") return null;
    return { quote: gateQuote(gate, !account), line: lineOf(undefined) };
  }
  const endpoint = gate.main.planned.route.endpoint;
  if (lightRun(gate.rows)) return { quote: FREE_QUOTE, line: lineOf(endpoint) };
  const { req, planned } = gate.main;
  const facts = { ...runOnPool(account?.id ?? null, () => runFacts(req, planned, outputKind(planned.op, planned.model))), steps: pricedSteps(gate.rows) };
  let q = await billingQuote(account ? accountFacts(account) : null, facts, queueFacts(account?.id ?? null, endpoint));
  if (q.allowed && account && p) {
    const over = poolLimitRefusal(account.id, p, o.addr ?? null);
    if (over) q = { ...q, allowed: false, code: "limit", text: over.error };
  }
  return { quote: q, line: lineOf(endpoint, q) };
}

/**
 * Could a viewer's tool run go to this install's GPUs, before its plan is made: hosted runs ready, not asked for its own
 * GPU, and no GPU of its own that goes first (or this install's asked for, or put first by the policy as last read). A
 * tool whose plan can't be made as the viewer's own run (no GPU or key of its own to plan it on) is planned here then.
 */
export function poolMayTake(account: Account | null, wish: PlaceWish): boolean {
  if (!hostedRunsOn() || wish === "own" || !poolReady()) return false;
  return !account || !accountGpu(account.id) || wish === "pool" || prefersPool(cachedPolicy(account.id));
}
