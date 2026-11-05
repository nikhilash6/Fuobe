import "server-only";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import { ANY_ANGLE } from "@/lib/catalog/any-angle";
import type { GenerationRequest } from "@/lib/catalog/types";
import { CONNECT_GPU_HEADER, OWN_SETUP_HEADER } from "@/lib/guest-access";
import { MODEL3D_SETUP, ownSetupDetail, ownSetupLabel, type OwnSetup } from "@/lib/own-setup";
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
  holdsOn,
  lastPrefer,
  lastQuote,
  policy as billingPolicy,
  policyGiveUpMs,
  policyOfferAfterS,
  quote as billingQuote,
  quoteDown,
  refusalStatus,
  reserve,
  RESERVE_INLINE,
  UNKNOWN_QUOTE,
  type Policy,
  type Quote,
  type QueueFacts,
  type RefuseCode,
  type ReserveAnswer,
  type ReserveInput,
  type RunFacts,
} from "./billing";
import { getModel } from "@/lib/catalog";
import { PLACE_ASK_HEADER, RUN_PLACE_HEADER, RUN_SHOWN_HEADER } from "@/lib/guest-access";
import { db } from "./db";
import { AccountRunError, createGenerations, outputKind, plannedSteps, previewChained, previewGeneration, stepsOf, type PlannedStep } from "./generations";
import { loadIndex } from "./gpu/index-file";
import { attemptLimitMs, MAX_ATTEMPTS, poolLane } from "./computer/pool";
import { poolFinishes3d } from "./computer/finish";
import { holdTiming } from "./queue-settings";
import { hostedDetails, hostedGuestWords, hostedWords, inputCounts, isOutputsWords, outputsWords, poolAllows, poolAllowsRun, poolAway, poolFitsSize, poolMostWords, poolOnWorkers, poolReady, poolRunsProvider, poolTakes, poolTicketsReady, poolUploads, POOL_LANE, queueFacts, runFacts, runOnPool, workflowPicks, type JobSize } from "./hosted";
import { withRunStamp } from "./run-stamp";
import { hostedRunsOn } from "./hosted-switch";
import { checkRun, moderationConfigured } from "./moderation";
import { queueRequestRelease } from "./billing-outbox";
import { reserveRequestId, type Press } from "./run-requests";
import type { RunStamp } from "./run-stamp";
import { readRef } from "./storage";
import { ACCOUNT_LIMITS } from "./account-files";
import { poolLimitPlan, type LimitPlan } from "./pool-limits";
import { startReason, type HoldReason } from "./pool-holds";
import { runAsTenant } from "./tenant";
import { needsGpu, ownSetupHere, poolCardRefuses, requestOwnSetup } from "./pool-own-setup";
import { ADD_KEY_HEADER } from "@/lib/your-keys";
import type { Place } from "@/lib/place-name";
import { placeFor, placeOfAccount } from "./place-name";
import { rememberedPlace } from "./run-on";

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
export const ownGpuQuiet = (place: Place): string => `Your GPU isn't answering right now. Run this on ${place.text} instead, or wait for your GPU.`;

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
    headers: setup.need === "key" ? { [ADD_KEY_HEADER]: setup.provider } : { [CONNECT_GPU_HEADER]: "1", [OWN_SETUP_HEADER]: encodeURIComponent(JSON.stringify(setup)) },
  },
});

/**
 * A gate's refusal as the run's answer: its label (gateText), with the own setup that runs it, so the page opens that
 * setup ("Connect your GPU", "Add your key") instead of saying no. A run past the outputs a run here makes says so in
 * words (the person picks fewer).
 */
function gateRefusal(gate: GateRefusal, place: Place): { kind: "refuse"; refusal: Refusal } {
  if (gate.reason === "outputs") return notOffered(gateText(gate, false, place));
  const r = ownSetupRefusal(gate.setup ?? needsGpu());
  if (gate.reason === "ownSetup") return r;
  r.refusal.body.error = gateText(gate, false, place);
  return r;
}

/**
 * A late guard's answer (stepsProblem, madeRunProblem: a step of the run as made that this install's GPUs don't take,
 * after the gate took its plan): its label, which opens Connect your GPU as the gate's does. A run past the outputs a run
 * here makes stays words (the person picks fewer).
 */
export function lateRefusal(problem: string): Refusal {
  if (isOutputsWords(problem)) return notOffered(problem).refusal;
  const r = ownSetupRefusal(needsGpu()).refusal;
  return { ...r, body: { ...r.body, error: problem } };
}

/** The question for a run whose own GPU didn't answer, with the place name its "Run on …" button says. */
const askPlace = (place: Place): Refusal => ({ status: 409, body: { error: ownGpuQuiet(place), code: "own-gpu-offline", placeName: place.label }, headers: { [PLACE_ASK_HEADER]: "1" } });

/** Does the policy put runs on this install's GPUs first, before the account's own GPU? */
const prefersPool = (p: Policy | null | undefined): boolean => !!p?.hosted && p.prefer === "pool";

/**
 * Where the account's own pick sends a run that names no place (run-on.ts, hosted runs only): "own" its GPU, at once and
 * never asked about; "pool" this install's GPUs first, as if the policy put them first for this account (what they
 * can't take still runs on its own GPU); undefined with no pick, or for a run that names its place (a one-off: Retry,
 * "Run on …", the first picture of a GPU's setup), which the pick never changes.
 */
const pickedPlace = (account: Account | null, wish: PlaceWish): PlaceWish => (account && !wish ? rememberedPlace(account.id) : undefined);

/**
 * This install's GPUs go first for this run: the policy says so, or the account picked them. With no policy to read (the
 * billing service doesn't answer), the place its last answer put first: a run that would go to this install's GPUs keeps
 * waiting for them, never moved to the account's own GPU because the service went quiet.
 */
const poolFirst = (p: Policy | null | undefined, picked: PlaceWish, accountId?: string | null): boolean =>
  prefersPool(p) || picked === "pool" || (p === null && accountId !== undefined && lastPrefer(accountId) === "pool");

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
  const words = hostedWords(placeFor(p));
  for (const s of steps) {
    const own = s.provider === "comfyui" ? ownSetupHere(s.modelId, "open") : null;
    if (own) return ownSetupLabel(own);
    if (!poolRunsProvider(s.provider)) return words.notOffered;
    if (s.provider === "comfyui" && poolCardRefuses(s.modelId)) return words.rtxCard;
    if (freeStep(s)) {
      if (s.provider === "comfyui" && !poolTakes(stepEndpoint(s))) return words.notOffered;
      continue;
    }
    if (s.provider !== "comfyui") return words.notOffered;
    if (s.kind === "model3d" && !madeHere3d(s)) return ownSetupLabel(MODEL3D_SETUP);
    if (!poolAllows(p, s.modelId, s.presetId) || !kindAllowed(p, s.kind as RunFacts["kind"])) return words.notOffered;
    if (!poolTakes(stepEndpoint(s))) return words.notOffered;
  }
  return null;
}

/**
 * Is this 3D step made on this install's GPUs: a model a worker's CPU slot finishes (poolFinishes3d), or Any Angle's 3D
 * view (a splat and its turntable, nothing to finish: generations.ts lets it there too).
 */
const madeHere3d = (s: { provider: string; op: string; modelId: string }): boolean => s.modelId === ANY_ANGLE.buildModel || poolFinishes3d(s);

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
  const place = placeFor(run.policy);
  const words = hostedWords(place);
  if (run.light) return lightRun(made) ? null : words.notOffered;
  const cap = poolOutputsCap(run.policy);
  if (rowOutputs(ids).some((n) => n > cap)) return outputsWords(cap, false, place);
  const held = new Map((run.steps ?? []).map((s) => [`${s.model} ${s.op ?? ""}`, s.jobs]));
  for (const s of pricedSteps(made)) if (s.jobs > (held.get(`${s.model} ${s.op ?? ""}`) ?? 0)) return words.notOffered;
  return null;
}

/**
 * Are the workers that could run some GPU step of a run all away now (paused, silent, outside their hours): its own
 * model's, or a later step's of a chain? Then the run would wait for nothing at that step, so it isn't made. Light steps
 * (a join, a trim) are left out, as they cost nothing.
 */
export function runAway(planned: Pick<Planned, "route">, steps: PlannedStep[] | null | undefined): boolean {
  if (poolAway(planned.route.endpoint)) return true;
  return (steps ?? []).some((s) => s.provider === "comfyui" && !freeStep(s) && poolAway(stepEndpoint(s)));
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
 * Why this install's GPUs won't take a run: a 3D model no worker finishes (computer/finish.ts poolFinishes3d), a model
 * or kind not offered there, a model their card can't run, LoRAs, a kind of file, more outputs at once than a run there
 * makes (`outputs`: a tool's run, which can't be cut down the way the studios' own runs are), one that runs on the
 * visitor's own setup only (`ownSetup`: a static item of own-setup.ts, or a workflow none of this install's GPUs can
 * run right now: none holds its files, serves its lane, or has the memory). Each is a label the visitor reads before
 * Run, with the setup that runs it. A run these GPUs take but can't start right now (every one that could is away, or
 * being updated) is no reason: it waits in line (runWaits).
 */
export type GateReason = "model3d" | "notOffered" | "rtxCard" | "loras" | "inputs" | "size" | "outputs" | "ownSetup";

/**
 * A gate's refusal: its reason, and the visitor's own setup that would run it (`setup`: always with "ownSetup" and
 * "model3d"; with the others, a GPU of its own, which runs what this install's GPUs don't take). `cap`: with "outputs",
 * the most a run there makes at once. `most`: with "size", the largest those GPUs make, in words ("8 megapixels").
 */
export type GateRefusal = { ok: false; reason: GateReason; setup?: OwnSetup; cap?: number; most?: string };

/** The own GPU a 3D model no worker here finishes runs on: the memory its workflow needs, else MODEL3D_SETUP's. */
const model3dSetup = (endpoint?: string): OwnSetup => {
  const gpu = needsGpu(endpoint);
  return gpu.need === "gpu" && gpu.vramGb ? gpu : MODEL3D_SETUP;
};

/** A gate's label for a reason (the same for a guest and an account: Run opens the sign-up for a guest). */
export function gateWords(reason: Exclude<GateReason, "ownSetup" | "outputs">, guest: boolean, place: Place): string {
  if (reason === "model3d") return ownSetupLabel(model3dSetup());
  return (guest ? hostedGuestWords() : hostedWords(place))[reason];
}

/** A gate's refusal in words: the own setup's label (the same for a guest and an account), or the reason's label. */
export const gateText = (gate: GateRefusal, guest: boolean, place: Place): string =>
  gate.reason === "ownSetup" || gate.reason === "model3d"
    ? ownSetupLabel(gate.setup ?? (gate.reason === "model3d" ? model3dSetup() : needsGpu()))
    : gate.reason === "outputs"
      ? outputsWords(gate.cap ?? 1, guest, place)
      : gateWords(gate.reason, guest, place);

/** A label's one sentence (the price slot's tooltip): what to do, or what the own setup is. None for "outputs". */
export function gateDetail(gate: GateRefusal, place: Place): string | undefined {
  if (gate.reason === "ownSetup" || gate.reason === "model3d") return ownSetupDetail(gate.setup ?? model3dSetup());
  if (gate.reason === "outputs") return undefined;
  return hostedDetails(place, gate.most)[gate.reason];
}

/**
 * The one check of whether this install's GPUs take a run, shared by the run itself (decidePlace) and the price check
 * before Run (poolQuote), so the two always agree: its output kind (3D only where a worker finishes it), the policy's
 * model, app and kind lists (for the run's own model and every other model it makes a step with, such as a 2K take's
 * finish), a worker allowed its lane, a card that can run it, LoRAs, the kinds of file it sends, and every later step
 * of a chain (planned only once the cheaper checks pass). `p` null: the billing service didn't answer, so only what needs
 * no policy is checked. Passed, it gives the planned steps for the run's one price.
 *
 * First of all, every step's own setup (own-setup.ts): a model, mode or option that runs on a visitor's own GPU or key
 * only is refused as "ownSetup" with that setup, on the run's own step and on every later step of a chain alike.
 */
export function poolGate(
  p: Policy | null,
  planned: Planned,
  req: GenerationRequest,
  planSteps: () => PlannedStep[] | null,
  sizeOf?: () => JobSize | null,
): { ok: true; steps: PlannedStep[] | null } | GateRefusal {
  const own = requestOwnSetup({ ...req, modelId: planned.model.id, engine: "open" });
  if (own) return { ok: false, reason: "ownSetup", setup: own };
  const gpu = needsGpu(planned.route.endpoint);
  const kind = outputKind(planned.op, planned.model);
  // A 3D model only where a worker finishes it (its GLB checked, made for the web and given a turntable there): then the
  // policy's kinds say, as for any other kind. Elsewhere it runs on the visitor's own GPU (a label, with that setup).
  if (kind === "model3d" && !madeHere3d({ provider: planned.route.provider, op: planned.op, modelId: planned.model.id })) return { ok: false, reason: "model3d", setup: model3dSetup(planned.route.endpoint) };
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
  // A size bigger than every GPU here that runs it makes (their PCs' ceilings): said before Run as a label, never a run
  // that fails once pressed (the run's own check stays the last guard: comfyui.ts POOL_TOO_BIG).
  const size = sizeOf ? safeSize(sizeOf) : null;
  if (size && !poolFitsSize(planned.route.endpoint, size)) {
    const most = poolMostWords(planned.route.endpoint, size);
    return { ok: false, reason: "size", setup: gpu, ...(most && { most }) };
  }
  // Every step of a chain, not only its first: each one the policy must allow, and the run is priced for all of them.
  const steps = planSteps();
  for (const s of steps ?? []) {
    const later = s.provider === "comfyui" ? ownSetupHere(s.modelId, "open") : null;
    if (later) return { ok: false, reason: "ownSetup", setup: later };
  }
  const problem = steps && p ? stepsProblem(p, steps) : null;
  if (problem) return { ok: false, reason: problem === hostedWords(placeFor(p)).rtxCard ? "rtxCard" : "notOffered", setup: gpu };
  return { ok: true, steps };
}

/** A size worked out, or null when it can't be (an input that can't be read): the run's own check says then. */
function safeSize(sizeOf: () => JobSize | null): JobSize | null {
  try {
    return sizeOf();
  } catch {
    return null;
  }
}

/**
 * The size of each job a run makes on this install's GPUs, about, as a PC's ceiling reads it (its pictures' or frames'
 * megapixels, a clip's seconds, its results at once), read as `viewer` (its own files only).
 */
export function jobSize(viewer: string | null, req: GenerationRequest, planned: Planned): JobSize {
  const f = runOnPool(viewer, () => runFacts(req, planned, outputKind(planned.op, planned.model)));
  return { megapixels: f.megapixels ?? 0, seconds: Number(f.seconds) || 0, outputs: f.outputsPerJob };
}

/**
 * Does a run these GPUs take wait for one of them to be free: every GPU that could run some GPU step of it is away now
 * (paused, silent, outside its hours: runAway), or built from the catalog before this studio's update (it takes the run
 * once updated)? It is taken all the same, and waits in line in its place ("starts when a GPU is free"). Light work only
 * (joins, trims) never waits for a GPU.
 */
export function runWaits(planned: Pick<Planned, "route">, steps: PlannedStep[] | null | undefined): boolean {
  if (lightRun(steps)) return false;
  if (runAway(planned, steps)) return true;
  const endpoints = [planned.route.endpoint, ...(steps ?? []).filter((s) => s.provider === "comfyui" && !freeStep(s)).map(stepEndpoint)];
  return !endpoints.every((e) => poolTicketsReady(e));
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
 * and every run this install's GPUs wouldn't take (hosted runs closed to it, a model or a kind not offered, LoRAs,
 * inputs, a step no worker takes, 3D) goes to its own GPU, even while that GPU doesn't answer. Only a run this install's
 * GPUs would take, that named no place, whose own GPU doesn't answer, is asked about (never moved there, and charged,
 * unasked). A run that goes to this install's GPUs is never moved to its own GPU because they are busy, away or being
 * updated, or because the billing service went quiet: it waits in line for them.
 *
 * One order (the place a run names, then what only one place can run, then the account's own pick, then the policy):
 * a run that names no place follows the account's pick (run-on.ts): its own GPU, at once and never asked about; or this
 * install's GPUs first, whatever the policy prefers. What these GPUs can't take still runs on its own GPU.
 */
export async function decidePlace(account: Account, asked: GenerationRequest, wish: PlaceWish): Promise<PlaceDecision> {
  if (!hostedRunsOn() || wish === "own" || !poolReady()) return OWN;
  // The account's own pick, for a run that names no place: its GPU at once, or this install's GPUs first.
  const picked = pickedPlace(account, wish);
  if (picked === "own") return OWN;
  let planned: Planned;
  try {
    planned = runOnPool(account.id, () => previewGeneration(asked));
  } catch (e) {
    // A mode that runs on the visitor's own setup only: its own GPU when it has one, else refused in its label's words.
    const own = refusedForOwnSetup(e, asked);
    if (own && !accountGpu(account.id)) return gateRefusal({ ok: false, reason: "ownSetup", setup: own }, placeOfAccount(account.id));
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
  if (ownFallback && !poolFirst(p, picked, account.id)) {
    const [online, read] = await Promise.all([ownGpuOnline(account.id), p === undefined ? billingPolicy(account.id) : Promise.resolve(p)]);
    p = read;
    if (!poolFirst(p, picked, account.id)) {
      if (online) return OWN;
      ownOffline = true;
    }
  }
  if (p === undefined) p = await billingPolicy(account.id);
  // The billing service doesn't answer: a run whose own GPU goes first goes there as before; one that goes to this
  // install's GPUs (the service's last answer put them first, or the account picked them) is never moved to its own GPU
  // for that: it waits for the service.
  if (!p) return ownFallback && !poolFirst(p, picked, account.id) ? OWN : { kind: "refuse", refusal: billingRefusal("paused", BILLING_WAIT.run) };
  // Closed to this account: its own GPU (or today's "Connect your GPU"); asked for by name, said so.
  if (!p.hosted) return wish === "pool" ? notOffered(hostedWords(placeFor(p)).notHosted) : OWN;
  // Planned, checked and priced for the outputs it would make there (the policy's cap per run).
  const { req, capped } = poolRequest(asked, p);
  if (capped) {
    try {
      planned = runOnPool(account.id, () => previewGeneration(req));
    } catch {
      return OWN;
    }
  }
  // The same check as the price check before Run (poolGate): what this install's GPUs can't take (a label the person
  // reads before Run) goes to the account's own GPU when it has one and didn't ask for this install's; otherwise it is
  // refused in the same words. A run they take is taken even while every GPU that could run it is away or being updated:
  // it waits in line in its place until one is free, never moved to the account's own GPU for that.
  const gate = poolGate(p, planned, req, () => stepsFor(account, req), () => jobSize(account.id, req, planned));
  if (!gate.ok) {
    if (ownFallback) return OWN;
    return gateRefusal(gate, placeFor(p));
  }
  // Its own GPU didn't answer the check: asked, never moved to this install's GPUs (and charged) without a word.
  if (ownOffline) return { kind: "refuse", refusal: askPlace(placeFor(p)) };
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
 * The wait limit the policy gives a run on this install's GPUs (`limits.giveUpS`; 0: as long as it takes), as a stamp's
 * field, when it gives one: for a run that sets nothing aside (light work), as reservePool stamps it for the others.
 */
export function policyWait(p: Pick<Policy, "limits"> | null | undefined): Pick<RunStamp, "waitMs"> {
  const ms = policyGiveUpMs(p);
  return ms === undefined ? {} : { waitMs: ms };
}

/**
 * Why a run that reservePool let in waits to enter the line (pool-holds.ts): the billing service didn't answer, or said
 * runs here are paused (`service`: it reserves under `requestId` once it answers); or it answered with a time the run may
 * start (`today`, `hour`: its hold is made; `credits`: it reserves then).
 */
export type ReserveWait =
  | { reason: "service"; requestId: string; paused?: true }
  | { reason: "today" | "hour"; startAt: number }
  | { reason: "credits"; startAt: number; requestId: string };

/** What a reserve made later sends of the run (pool-release.ts): its facts, the price shown, its timing. */
export interface ReserveFacts {
  run: RunFacts;
  shown: { amount: number; priceVersion: string };
  timing: NonNullable<ReserveInput["timing"]>;
  workflowId: string | null;
}

/**
 * Set the run's price aside (no billing service: nothing to set aside; the run is free). Returns the stamp the run's
 * rows carry, or the refusal (402, 409 with the new price, 429, 503, 403; docs/billing-hook.md). `press`: the press of
 * Run it belongs to and its try (run-requests.ts), so every send of that try reserves under one request id, and a new try
 * under one of its own; none (a script): an id of this request's own. A reserve given up after a try that may have made a
 * hold releases it by its request id, unless a send of the same try owns that hold (`press.gaveUp`).
 *
 * How long the run may wait before it first starts: the policy's `limits.giveUpS` when it says (0: as long as it takes),
 * which wins over the reserve answer's `maxWaitMs`; else that answer's; else the install's own (FUOBE_POOL_WAIT_MIN).
 *
 * When runs wait instead of being refused (billing.ts holdsOn), the reserve is tried for RESERVE_INLINE at most; a
 * service that doesn't answer, says runs are paused, or answers with a later start lets the run in all the same, and
 * `wait` says why it waits (the caller holds it; no hold is given back by request id: the release reserves under the
 * same one). `heldMs`: how long the run is expected to wait before it enters the line (sent with the reserve's timing).
 */
export async function reservePool(
  account: Account,
  req: GenerationRequest,
  planned: Planned,
  shown: { amount: number; priceVersion: string } | null,
  checkOutputs: boolean,
  steps?: RunFacts["steps"],
  press: Press | null = null,
  policy: Pick<Policy, "limits"> | null = null,
  o: { heldMs?: number } = {},
): Promise<{ ok: true; stamp: RunStamp; wait?: ReserveWait; facts?: ReserveFacts } | { ok: false; refusal: Refusal }> {
  const giveUp = policyGiveUpMs(policy);
  const base: RunStamp = { place: "pool", ...(checkOutputs && { checkOutputs: true }), ...(giveUp !== undefined && { waitMs: giveUp }) };
  if (!billingConfigured()) return { ok: true, stamp: base };
  const kind = outputKind(planned.op, planned.model);
  const run: RunFacts = { ...runOnPool(account.id, () => runFacts(req, planned, kind)), ...(steps?.length && { steps }) };
  const requestId = press ? reserveRequestId(account.id, press.key, press.tries) : nanoid(16);
  const waits = holdsOn(policy);
  // How long its hold must stay open once a worker first takes it: every attempt at its lanes' run ceilings, and the
  // time it may spend back in line (the queue's settings); and, for a run that waits to enter the line, about how long.
  const timing = {
    ...holdTiming(run.steps?.length ? run.steps : [{ lane: run.lane, jobs: run.jobs }], MAX_ATTEMPTS, attemptLimitMs),
    ...(o.heldMs && o.heldMs > 0 && { heldMs: Math.round(o.heldMs) }),
  };
  const facts: ReserveFacts = { run, shown: shown ?? { amount: 0, priceVersion: "" }, timing, workflowId: planned.route.endpoint ?? null };
  const queue = queueFacts(account.id, planned.route.endpoint);
  const a = await reserve({ requestId, account: accountFacts(account), run, queue, shown: facts.shown, timing }, waits ? { forMs: RESERVE_INLINE.ms } : {});
  if (!a) return { ok: true, stamp: base };
  if (!a.ok && waits) {
    // No answer, or runs here paused: the run is made and waits; it reserves under this same request id once the service
    // answers (so a hold an unanswered try made is the one it gets).
    if (a.code === "paused") return { ok: true, stamp: base, wait: { reason: "service", requestId, ...(!a.down && { paused: true as const }) }, facts };
    // No free generations left until they renew: it waits, and reserves then.
    const at = await renewalAt(a, account, run, queue);
    if (at !== null) return { ok: true, stamp: base, wait: { reason: "credits", startAt: at, requestId }, facts };
  }
  if (!a.ok) {
    if (a.unsure) {
      // A try may have made a hold the app never heard of: it goes back by its request id, and the press's next send is a
      // new try under a request id of its own. A send of the same try that got there first (it made the run, or was
      // refused and gave its hold back) owns that hold, so nothing is released by its request id. One statement decides,
      // after any run it made.
      db().transaction(() => {
        if (!press || press.gaveUp()) queueRequestRelease(requestId);
      })();
    }
    return { ok: false, refusal: billingRefusal(a.code, a.text, { ...(a.quote && { quote: a.quote }), ...(a.action && { action: a.action }), ...(a.offer && { offer: a.offer }) }) };
  }
  forgetBalance(account.id);
  // A later start (the day's GPU time used up, an hourly limit): the hold is made, and the run waits until then.
  const startAt = Number(a.startAt);
  const later = waits && Number.isFinite(startAt) && startAt > Date.now();
  return { ok: true, stamp: { ...base, ...heldStamp(a, giveUp) }, ...(later && { wait: { reason: startReason(startAt), startAt }, facts }) };
}

/**
 * When free generations that renew would pay for a run its reserve turned down for credit (`top-up`, with credits on):
 * the service's quote for the run says so, allowed with a later `startAt` (the refusal's own quote when it carries one).
 * Null for any other refusal, or when nothing renews in time (the refusal stands).
 */
export async function renewalAt(a: { code: string; quote?: Quote }, account: Account, run: RunFacts, queue: QueueFacts | null, now = Date.now()): Promise<number | null> {
  if (a.code !== "top-up") return null;
  const q = a.quote ?? (await billingQuote(accountFacts(account), run, queue));
  const at = Number(q.startAt);
  return q.allowed && Number.isFinite(at) && at > now ? at : null;
}

/**
 * The stamp fields a reserve's answer gives a run: its hold, the words for its charge, whether anything was set aside,
 * its wait limit (the policy's `giveUp` wins), and its class and head start in the line (a paid run goes before every
 * free one).
 */
export function heldStamp(a: Extract<ReserveAnswer, { ok: true }>, giveUp: number | undefined): RunStamp {
  const boost = Number(a.boostMs);
  return {
    hold: a.holdId,
    ...(a.text && { charge: a.text }),
    // Something was set aside (a free run's hold sets aside nothing): only then can a run that ends early say so.
    ...(Number(a.amount) > 0 && { charged: true }),
    ...(giveUp === undefined && a.maxWaitMs > 0 && { waitMs: a.maxWaitMs }),
    ...(a.class === "paid" && { class: "paid" as const }),
    ...(Number.isFinite(boost) && boost > 0 && { boostMs: Math.min(boost, 24 * 60 * 60_000) }),
  };
}

/**
 * Where a new run would stand in line on this install's GPUs right now (1: next), and the wait, about (null: unknown).
 * The run is taken whatever the line: Run stays on.
 *
 * - `unknown`: no GPU that could run it can take it now (away, or being updated): it starts when one is free.
 *   `returnAt` (epoch ms): when the first of them is due back, when one says.
 * - `light`: light work only (joins, trims): ready in seconds, with no GPU.
 * - `long`: the wait passes the policy's `offerAfterS` (or is unknown): an account with its own GPU or key that runs it
 *   may be offered it for this run, once.
 * - `held`: a run pressed now is taken and waits to enter the line (pool-holds.ts): "mine" after the account's runs going,
 *   "today" or "hour" until `startAt`; "service" while runs here are paused (`paused`, with the service's words in
 *   `note`).
 */
export interface PoolLine {
  place: number;
  etaSeconds: number | null;
  unknown?: true;
  returnAt?: number;
  light?: true;
  long?: true;
  held?: HoldReason;
  startAt?: number;
  paused?: true;
  note?: string;
}

/**
 * The line a price check says, with why a run pressed now would wait to enter it: the service's later start (the day's
 * GPU time, an hourly limit: the offer of the account's own GPU or key shows at the daily cap), else the policy's
 * limits (behind the account's runs going, or an hourly limit).
 */
function withHeld(line: PoolLine, plan: LimitPlan | null, q: Quote, now = Date.now()): PoolLine {
  const at = Number(q.startAt);
  if (q.allowed && Number.isFinite(at) && at > now) {
    const reason = startReason(at);
    return { ...line, held: reason, startAt: at, ...(reason === "today" && { long: true as const }) };
  }
  if (plan && "hold" in plan) return { ...line, held: plan.hold, ...(plan.startAt !== undefined && { startAt: plan.startAt }) };
  return line;
}

/**
 * The quote a price check shows when the billing service doesn't answer or says runs here are paused, while runs wait for
 * it (holdsOn): the last price it gave for this run (else none), allowed, so Run stays on and a press is taken. `paused`:
 * the service's own words for the pause, shown as the line before Run.
 */
function quoteWhileQuiet(q: Quote, p: Policy | null, account: Account | null, facts: RunFacts): { q: Quote; paused?: string } {
  if (q.allowed || q.code !== "paused" || !holdsOn(p)) return { q };
  const known = lastQuote(account ? accountFacts(account) : null, facts) ?? UNKNOWN_QUOTE;
  return quoteDown(q) ? { q: known } : { q: known, paused: q.text };
}

/** A price check's quote and line, with what the policy's limits say of a run pressed now (refused only past the cap). */
function limitedCheck(q0: Quote, line: (q: Quote) => PoolLine, p: Policy | null, account: Account | null, facts: RunFacts, addr: (() => string | null) | null): { quote: Quote; line: PoolLine } {
  const quiet = quoteWhileQuiet(q0, p, account, facts);
  let q = quiet.q;
  let plan: LimitPlan | null = null;
  if (q.allowed && account && p) {
    plan = poolLimitPlan(account.id, p, addr);
    if ("refuse" in plan) q = { ...q, allowed: false, code: "limit", text: plan.refuse.error };
  }
  const shown = withHeld(line(q), plan, q);
  return { quote: q, line: quiet.paused !== undefined && q.allowed ? { ...shown, held: "service", paused: true, note: quiet.paused, long: true } : shown };
}

/** The line a price check says, from the queue's facts (and the service's own estimate, `q.etaS`, when it gave one). */
function poolLine(facts: Pick<QueueFacts, "ahead" | "etaS" | "nextOpenAt">, o: { light: boolean; waits: boolean; p: Policy | null; q?: Quote }, now = Date.now()): PoolLine {
  const place = Math.max(0, facts.ahead) + 1;
  if (o.light) return { place, etaSeconds: null, light: true };
  const afterMs = policyOfferAfterS(o.p) * 1000;
  if (o.waits) {
    const back = facts.nextOpenAt && facts.nextOpenAt > now ? facts.nextOpenAt : undefined;
    return { place, etaSeconds: null, unknown: true, ...(back && { returnAt: back }), ...((!back || back - now > afterMs) && { long: true }) };
  }
  const eta = o.q?.etaS ?? facts.etaS ?? null;
  return { place, etaSeconds: eta, ...(eta !== null && eta * 1000 > afterMs && { long: true }) };
}

/**
 * A price check refused for what this install's GPUs don't take: its words, and (`ownSetup`) the visitor's own setup
 * that runs it, so Run opens that setup (Connect your GPU, Add your key, or a guest's sign-up) instead of staying off.
 */
const notOfferedQuote = (text: string, setup?: OwnSetup, sub?: string): Quote & { ownSetup?: OwnSetup } => ({
  allowed: false,
  amount: 0,
  priceVersion: "",
  text,
  code: "not-offered",
  ...(sub && { sub }),
  ...(setup && { ownSetup: setup }),
});

/**
 * A gate's refusal as the price check's quote: its label (gateText), the sentence under it (`sub`: the tooltip), and the
 * own setup Run opens. A run past the outputs a run here makes has no setup: the person picks fewer.
 */
const gateQuote = (gate: GateRefusal, guest: boolean, place: Place): Quote & { ownSetup?: OwnSetup } =>
  notOfferedQuote(gateText(gate, guest, place), gate.reason === "outputs" ? undefined : (gate.setup ?? needsGpu()), gateDetail(gate, place));

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
  // The account's own pick, as its run would follow it: its GPU (no price here), or this install's GPUs first.
  const picked = pickedPlace(account, wish);
  if (picked === "own") return null;
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
    if (own && !(account && accountGpu(account.id)) && !(p && !p.hosted)) return { planned: null, quote: gateQuote({ ok: false, reason: "ownSetup", setup: own }, !account, placeFor(p)), line: { place: 1, etaSeconds: null } };
    return null;
  }
  if (planned.route.provider !== "comfyui") return null;
  const hasGpu = !!account && !!accountGpu(account.id);
  if (account && hasGpu && wish !== "pool" && !poolFirst(p, picked, account.id) && (await ownGpuOnline(account.id))) return null;
  if (p && !p.hosted) return null;
  // What this install's GPUs won't take goes to the viewer's own GPU when it has one (as the run would); otherwise the
  // price check says its label, and Run opens the setup that runs it.
  const gate = poolGate(p, planned, req, () => stepsFor(account, req), () => jobSize(account?.id ?? null, req, planned));
  if (!gate.ok) {
    if (hasGpu && wish !== "pool") return null;
    return { planned, quote: gateQuote(gate, !account, placeFor(p)), line: poolLine(queueFacts(account?.id ?? null, planned.route.endpoint), { light: false, waits: false, p }) };
  }
  // Taken whatever the line: while every GPU here that could run it is away (or being updated), the line says it starts
  // when one is free, and Run stays on.
  const queue = queueFacts(account?.id ?? null, planned.route.endpoint);
  const shape = { light: lightRun(gate.steps), waits: runWaits(planned, gate.steps), p };
  // Light work only (joins, trims): free, and never counted against the policy's limits, so the service isn't asked.
  if (shape.light) return { planned, quote: FREE_QUOTE, line: poolLine(queue, shape) };
  // Priced once for every step of a chain that uses this install's GPUs. Its facts are read as the viewer (an input's
  // size from its own files only: another's file reads as none, and says nothing of whether it exists).
  const facts = { ...runOnPool(account?.id ?? null, () => runFacts(req, planned, outputKind(planned.op, planned.model))), ...(gate.steps && { steps: pricedSteps(gate.steps) }) };
  const q = await billingQuote(account ? accountFacts(account) : null, facts, queue);
  // The policy's limits on this account's runs here, as the run would meet them (pool-limits.ts): said before Run.
  const checked = limitedCheck(q, (quote) => poolLine(queue, { ...shape, q: quote }), p, account, facts, o.addr ?? null);
  return { planned, ...checked };
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
    const gate = poolGate(p, planned, req, () => (deps ? [asPlannedStep(req, planned, true)] : poolSteps(viewer ?? GUEST_PLAN, req)), deps ? undefined : () => jobSize(viewer, req, planned));
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
  const picked = pickedPlace(account, wish);
  if (picked === "own") return OWN;
  const ownFallback = !!accountGpu(account.id) && wish !== "pool";
  let p = cachedPolicy(account.id);
  let ownOffline = false;
  if (ownFallback && !poolFirst(p, picked, account.id)) {
    const [online, read] = await Promise.all([ownGpuOnline(account.id), p === undefined ? billingPolicy(account.id) : Promise.resolve(p)]);
    p = read;
    if (!poolFirst(p, picked, account.id)) {
      if (online) return OWN;
      ownOffline = true;
    }
  }
  if (p === undefined) p = await billingPolicy(account.id);
  // As decidePlace: a run that goes to this install's GPUs waits for a quiet service, never moved to its own GPU for it.
  if (!p) return ownFallback && !poolFirst(p, picked, account.id) ? OWN : { kind: "refuse", refusal: billingRefusal("paused", BILLING_WAIT.run) };
  if (!p.hosted) return wish === "pool" ? notOffered(hostedWords(placeFor(p)).notHosted) : OWN;
  // What these GPUs can't take (a label) goes to its own GPU; what they take is taken, even while every GPU that could
  // run it is away or being updated: it waits in line until one is free.
  const gate = toolGate(p, account.id, steps);
  if (gate === "unplanned") return OWN;
  if (!gate.ok) {
    if (ownFallback) return OWN;
    return gateRefusal(gate, placeFor(p));
  }
  if (ownOffline) return { kind: "refuse", refusal: askPlace(placeFor(p)) };
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
  const picked = pickedPlace(account, wish);
  if (picked === "own") return null;
  const p = await billingPolicy(account?.id ?? null);
  const hasGpu = !!account && !!accountGpu(account.id);
  if (account && hasGpu && wish !== "pool" && !poolFirst(p, picked, account.id) && (await ownGpuOnline(account.id))) return null;
  if (p && !p.hosted) return null;
  const gate = toolGate(p, account?.id ?? null, steps);
  if (gate === "unplanned") return null;
  if (!gate.ok) {
    if (hasGpu && wish !== "pool") return null;
    return { quote: gateQuote(gate, !account, placeFor(p)), line: poolLine(queueFacts(account?.id ?? null, undefined), { light: false, waits: false, p }) };
  }
  const { req, planned } = gate.main;
  const queue = queueFacts(account?.id ?? null, planned.route.endpoint);
  const shape = { light: lightRun(gate.rows), waits: runWaits(planned, gate.rows), p };
  if (shape.light) return { quote: FREE_QUOTE, line: poolLine(queue, shape) };
  const facts = { ...runOnPool(account?.id ?? null, () => runFacts(req, planned, outputKind(planned.op, planned.model))), steps: pricedSteps(gate.rows) };
  const q = await billingQuote(account ? accountFacts(account) : null, facts, queue);
  return limitedCheck(q, (quote) => poolLine(queue, { ...shape, q: quote }), p, account, facts, o.addr ?? null);
}

/**
 * Could a viewer's tool run go to this install's GPUs, before its plan is made: hosted runs ready, not asked for its own
 * GPU, and no GPU of its own that goes first (or this install's asked for, or put first by the policy as last read). A
 * tool whose plan can't be made as the viewer's own run (no GPU or key of its own to plan it on) is planned here then.
 */
export function poolMayTake(account: Account | null, wish: PlaceWish): boolean {
  if (!hostedRunsOn() || wish === "own" || !poolReady()) return false;
  const picked = pickedPlace(account, wish);
  if (picked === "own") return false;
  return !account || !accountGpu(account.id) || wish === "pool" || poolFirst(cachedPolicy(account.id), picked, account.id);
}
