import { connection } from "next/server";
import { ACTIVE_RUNS_CODE, CONNECT_GPU_HEADER, CONNECT_NEEDS_HEADER, GUEST_RUN_MESSAGE, OWN_GPU_TOOL_MESSAGE } from "@/lib/guest-access";
import { missingFilesMessage } from "@/lib/missing-files";
import { ADD_KEY_HEADER } from "@/lib/your-keys";
import { requestViewer, validToken } from "@/server/auth";
import { accountEngineMode } from "@/server/account-keys";
import { computerScope, ISOLATED_ON_COMPUTER, workerFor } from "@/server/providers/comfyui";
import { getSetting } from "@/server/settings";
import { RUNS_ON_COMPUTER_NOTE } from "@/lib/relay";
import { OPERATION_LABELS } from "@/lib/catalog/types";
import { ANY_ANGLE } from "@/lib/catalog/any-angle";
import { directRunFeatures } from "@/lib/catalog/genjutsu";
import { genjutsuLive } from "@/server/genjutsu-live";
import { soundLive } from "@/server/sound-live";
import { wantsVoiceFirst } from "@/lib/av/voice-first";
import { relightRunTitle } from "@/lib/relight/engine";
import { ACCOUNT_LIMITS, ACCOUNT_MESSAGES, accountTotalBytes, accountUsage, diskHasRoom, filesFullMessage } from "@/server/account-files";
import { accountInputProblem } from "@/server/account-inputs";
import { findView, requestViewKey } from "@/server/any-angle";
import { accountLoraFix, accountRun, AccountRunError, asAccount, asVisitor, captureRun, createGenerations, getGeneration, listGenerations, outputKind, previewGeneration, stepsOf, type AccountRunRefusal } from "@/server/generations";
import { accountActiveRuns, AdmitRefused, admitRun, clientAddress, poolLimitRefusal } from "@/server/pool-limits";
import { ensureTrashPurge, listOptionsFrom } from "@/server/library";
import { hit, unhit } from "@/server/rate";
import { GenerationRequestSchema } from "@/server/request-schema";
import { gateGeneration, GPU_SETUP_HEADER } from "@/server/gpu/gate";
import { gpuTargetFor } from "@/server/gpu/target";
import { connectNeeds } from "@/server/connect-refusal";
import { BILLING_HEADER, BILLING_WAIT } from "@/server/billing";
import { queueRelease } from "@/server/billing-outbox";
import { runOnPool } from "@/server/hosted";
import { decidePlace, moderateRun, poolQuote, readWishes, reservePool, stepsProblem, type PlaceDecision, type Refusal } from "@/server/hosted-run";
import { withRunStamp, type RunStamp } from "@/server/run-stamp";
import { hostedRunsOn } from "@/server/hosted-switch";
import { notePress, notePressRefused, pressSeen, readPressId, type PressRefusal, type PressSeen } from "@/server/run-requests";

/**
 * List generations, newest first. Filters: kind / kinds, features (`x*` = prefix), models, statuses,
 * favorites=1, folder=<id>, q, since / until (createdAt ms), trash=1 (the Trash, newest deletion first),
 * paging with before=<createdAt>:<id> of the last row (<deletedAt>:<id> in the Trash; a bare
 * timestamp still works) and limit (≤ 200).
 */
export async function GET(request: Request) {
  await connection();
  ensureTrashPurge();
  // An account (public sign-up) lists only its own runs; the owner only theirs; anyone else nothing.
  const viewer = requestViewer(request);
  if (viewer.kind === "guest") return Response.json({ items: [] });
  return Response.json({ items: listGenerations({ ...listOptionsFrom(new URL(request.url).searchParams), account: viewer.kind === "account" ? viewer.account.id : undefined }) });
}

/** What the sign-in proxy passes on of a request body (next.config.ts proxyClientMaxBodySize). */
const PROXY_BODY_BYTES = 4 * 1024 * 1024;
const BODY_TOO_BIG = "That request is over 4 MB. Upload pictures and clips first (POST /api/uploads), then send their /api/files/ paths.";

const refuse = (status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** The answer to an account's run that can't go where it was planned: Connect your GPU, Add your key (the client opens either). */
const accountRunAnswer = (r: AccountRunRefusal): PressRefusal => ({
  status: 403,
  body: { error: r.error, code: r.code, ...(r.provider && { provider: r.provider }) },
  headers: r.code === "connect-gpu" ? { [CONNECT_GPU_HEADER]: "1" } : r.code === "add-key" && r.provider ? { [ADD_KEY_HEADER]: r.provider } : {},
});

/** The answer to a run the limits refuse as it is made (admitRun), or one with a step this install's GPUs don't take. */
const limitAnswer = (r: AdmitRefused["refusal"]): PressRefusal => ({
  status: r.status,
  body: { error: r.error, code: r.code },
  headers: r.code === "not-offered" ? { [BILLING_HEADER]: "not-offered" } : { "Retry-After": String(r.retryAfterS ?? 30) },
});

/** The answer to a run whose rows couldn't be made (as the route's own catch says it, for an account's run). */
const thrownAnswer = (e: Error): PressRefusal => (e instanceof AccountRunError ? accountRunAnswer(e.refusal) : { status: 422, body: { error: e.message }, headers: {} });

/** Start a generation; `?preview=1` only says what it would run as (model, operation, jobs, outputs, cost). */
export async function POST(request: Request) {
  const viewer = requestViewer(request);
  // An API token (a script, the CLI, MCP): never a page that can open a dialog or keep a tab open.
  const token = validToken(request.headers.get("authorization"));
  const account = viewer.kind === "account" ? viewer.account : null;
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  // Without a viewer only a price check: a run is the owner's or an account's, never "nobody, so the owner".
  if (viewer.kind === "guest" && !preview) return refuse(401, GUEST_RUN_MESSAGE);
  // An account's run request is words and file paths (files are uploaded first): small.
  const limitBody = !!account && !preview;
  if (limitBody && Number(request.headers.get("content-length") ?? 0) > ACCOUNT_LIMITS.runBodyBytes) return refuse(413, ACCOUNT_MESSAGES.bodyTooBig);
  const text = await request.text().catch(() => "");
  if (limitBody && Buffer.byteLength(text) > ACCOUNT_LIMITS.runBodyBytes) return refuse(413, ACCOUNT_MESSAGES.bodyTooBig);
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // The sign-in proxy passes on the first 4 MB of a body (next.config.ts): a bigger one arrives cut short.
    if (Number(request.headers.get("content-length") ?? 0) > PROXY_BODY_BYTES) return refuse(413, BODY_TOO_BIG);
  }
  const parsed = GenerationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  // A retired model id (an older script, a saved CLI or MCP call) runs on the model that replaced it, and the notes say
  // so: previewGeneration and createGenerations move it (generations.ts currentRequest, replaced.ts).
  const sent = parsed.data as Parameters<typeof createGenerations>[0];
  // Generate lighting is named by its look or its lights (src/lib/relight/engine.ts), not by its long prompt.
  const relightTitle = relightRunTitle(sent);
  const asked = relightTitle ? { ...sent, title: relightTitle } : sent;
  // Public sign-up: an account runs on its own ComfyUI or its own fal.ai or Replicate key, never the install's providers.
  // Without a key of its own it stays on the open engine; with one, the engine it asked for.
  // Genjutsu's new makers open one by one (src/server/genjutsu-live.ts): sent here directly, a maker that hasn't opened
  // runs for the owner only, as on the Genjutsu page.
  if (viewer.kind !== "owner") {
    // "Clean the voice first" opens to visitors once it has passed a real run (src/server/sound-live.ts).
    if (wantsVoiceFirst(asked) && !soundLive()["clean-voice-first"]) return refuse(403, OWN_GPU_TOOL_MESSAGE, { code: "own-gpu-tool" });
    const extra = asked.params?.extra?.openjutsu;
    const needs = directRunFeatures(asked.modelId, extra && typeof extra === "object" ? (extra as Record<string, unknown>) : {});
    if (needs) {
      const live = genjutsuLive();
      if (needs.some((f) => !live[f])) return refuse(403, OWN_GPU_TOOL_MESSAGE, { code: "own-gpu-tool" });
    }
  }
  let req = account ? { ...asked, account: account.id, engine: accountEngineMode(account.id) === "open" ? ("open" as const) : asked.engine } : { ...asked, account: undefined };
  const onOwn = <T,>(fn: () => T): T => (account ? asAccount(account.id, fn) : fn());
  // A visitor's price check: priced as it would run, as that visitor (an account: its own GPU and keys; a guest: the open
  // engine, no demo).
  const priced = <T,>(fn: () => T): T => (viewer.kind === "owner" ? fn() : account ? asAccount(account.id, fn) : asVisitor(null, fn));
  /** An account's run that can't go where it was planned: Connect your GPU, Add your key (the client opens either). */
  const refused = (r: AccountRunRefusal) => {
    if (account) unhit(`run:${account.id}`);
    const a = accountRunAnswer(r);
    return refuse(a.status, a.body.error, a.body, a.headers);
  };
  // Beside the request (never in it): the place the client prefers, and the price it showed (hosted runs, billing hook).
  const { wish, shown } = readWishes(body);
  const refusedBy = (r: Refusal) => {
    if (account) unhit(`run:${account.id}`);
    return refuse(r.status, r.body.error, r.body, r.headers);
  };
  // With hosted runs on, an account's press of Run is made once however often the page sends it (run-requests.ts): a
  // resend gets the run the first one made, and one that was refused because the billing service didn't answer is
  // refused again (a new press starts afresh).
  const pressId = account && !preview && hostedRunsOn() ? readPressId(body) : null;
  const paused = () => refuse(503, BILLING_WAIT.run, { code: "paused" }, { [BILLING_HEADER]: "paused" });
  const madeAlready = (ids: string[]) => Response.json({ items: ids.map((id) => getGeneration(id)).filter((g) => !!g) }, { status: 201 });
  // The answer a press got before, for a resend of it: the same refusal, or the run it made.
  const answerAgain = (seen: Exclude<PressSeen, null>) =>
    seen === "gave-up" ? paused() : "refused" in seen ? refuse(seen.refused.status, seen.refused.body.error, seen.refused.body, seen.refused.headers) : madeAlready(seen.ids);
  if (account && pressId) {
    const seen = pressSeen(account.id, pressId);
    if (seen) return answerAgain(seen);
  }
  const notes: string[] = [];
  if (account && !preview) {
    // Room on the server, room in the account's files, and a fair share of runs.
    if (!diskHasRoom()) return refuse(503, ACCOUNT_MESSAGES.diskLow);
    if (accountUsage(account.id).total >= accountTotalBytes(account.id)) return refuse(413, filesFullMessage(account.id));
    if (accountActiveRuns(account.id) >= ACCOUNT_LIMITS.activeRuns) return refuse(429, ACCOUNT_MESSAGES.activeRuns, { code: ACTIVE_RUNS_CODE }, { "Retry-After": "30" });
    const rate = hit(`run:${account.id}`, ACCOUNT_LIMITS.runsPerHour, 60 * 60_000);
    if (!rate.ok) return refuse(429, ACCOUNT_MESSAGES.runRate, {}, { "Retry-After": String(rate.retryAfterS) });
    if ((req.params?.numOutputs ?? 1) > ACCOUNT_LIMITS.outputsPerRun) {
      req = { ...req, params: { ...req.params, numOutputs: ACCOUNT_LIMITS.outputsPerRun } };
      notes.push(ACCOUNT_MESSAGES.outputsCapped);
    }
    // Only files it uploaded here, or its own results (no links, no data: URIs, nobody else's).
    const problem = accountInputProblem(req, account.id);
    if (problem) {
      unhit(`run:${account.id}`);
      return refuse(problem.status, problem.error, { code: problem.code });
    }
  }
  // Any Angle builds a photo's 3D view once for the owner or an account (src/server/any-angle.ts): a second build of the
  // same photo, under any file name, gets the first one (running or done) and costs nothing.
  if (!preview && req.modelId === ANY_ANGLE.buildModel) {
    const key = await onOwn(() => requestViewKey(req));
    if (key) {
      const built = findView(key, account?.id);
      const g = built ? getGeneration(built) : null;
      if (g) {
        if (account) unhit(`run:${account.id}`);
        return Response.json({ items: [g] }, { status: 201 });
      }
      // The build takes nothing but the photo (fixed seeds, src/lib/catalog/any-angle.ts): other params are dropped, so
      // the view a key finds is always the one this request would build.
      req = { ...req, params: { extra: { viewKey: key } } };
    }
  }
  try {
    if (preview) {
      // Hosted runs: a visitor's run that would go to this install's GPUs is priced there, with the billing service's
      // quote (its words for Run) and where it would stand in line. Off, or a run on its own GPU or key: priced as before.
      // (The client's address is read only for a policy that counts runs per address.)
      const pool = viewer.kind !== "owner" ? await poolQuote(account, req, wish, { addr: () => clientAddress(request) }) : null;
      if (pool) {
        const { model, ...p } = pool.planned;
        return Response.json({ ...p, modelId: model.id, modelName: model.name, engine: model.engine, kind: outputKind(p.op, model), opLabel: OPERATION_LABELS[p.op] ?? p.op, place: "pool", quote: pool.quote, line: pool.line });
      }
      const { model, ...p } = priced(() => previewGeneration(req));
      return Response.json({ ...p, modelId: model.id, modelName: model.name, engine: model.engine, kind: outputKind(p.op, model), opLabel: OPERATION_LABELS[p.op] ?? p.op });
    }
    // Hosted runs (FUOBE_HOSTED_RUNS=1): an account's run may go to this install's GPUs. Off: always its own (today).
    let decision: PlaceDecision = { kind: "own" };
    if (account) {
      decision = await decidePlace(account, req, wish);
      if (decision.kind === "refuse") return refusedBy(decision.refusal);
    }
    const onPool = decision.kind === "pool" ? decision : null;
    // The client's address, kept only as a salted hash for the policy's hourly count per address (null: no trusted proxy).
    const addr = account && onPool ? clientAddress(request) : null;
    if (account && onPool) {
      // The policy's limits for runs on this install's GPUs, counted on runs there only (never on runs on the account's own
      // GPU or key, nor on a run of light work only, which is free): said now, before anything is checked or set aside, and
      // counted again as the run is made (admitRun).
      const over = onPool.light ? null : poolLimitRefusal(account.id, onPool.policy, addr);
      if (over) {
        unhit(`run:${account.id}`);
        return refuse(over.status, over.error, { code: over.code }, { "Retry-After": String(over.retryAfterS) });
      }
      // The request as it runs there (no more outputs than the policy's cap per run): planned and priced as it is.
      if (onPool.capped) {
        req = { ...req, params: onPool.req.params };
        notes.push(ACCOUNT_MESSAGES.outputsCapped);
      }
    }
    // GPU pre-flight: a ComfyUI run that is sure to fail for something missing stops here with the plan that fixes it
    // (src/server/gpu/gate.ts; never when the check is unknown, for graphics memory, or with gpuCheck "skip").
    let gpuWarning: string | undefined;
    // (A run on this install's GPUs: its plan was checked by decidePlace; the pre-flight is about the account's own GPU.)
    if (viewer.kind !== "guest" && !onPool) {
      let planned: ReturnType<typeof previewGeneration> | null = null;
      try {
        planned = onOwn(() => previewGeneration(req));
      } catch (e) {
        // A paid model the account has no key for (or a studio that is open-source only).
        if (e instanceof AccountRunError) return refused(e.refusal);
        // Otherwise createGenerations says what's wrong with the request.
      }
      if (account && planned) {
        // Where the run goes decides what the account needs: its GPU for ComfyUI, its own key for fal.ai or Replicate.
        const own = accountRun(account.id, planned.route.provider, "submit");
        if ("error" in own) return refused(own);
      }
      if (planned) {
        // A workflow for the isolated worker (LatentSync 1.6, ThinkSound) on someone's computer: its tab reaches no second
        // ComfyUI yet. Said now, before anything is staged or queued.
        if (planned.route.provider === "comfyui" && workerFor(planned.route.endpoint) === "isolated" && onOwn(() => computerScope())) {
          if (account) unhit(`run:${account.id}`);
          return refuse(422, ISOLATED_ON_COMPUTER, { code: "isolated-on-computer" });
        }
        // A 3D model from someone else's ComfyUI is finished on this server (decimate, web GLB, turntable): accounts
        // don't get Image to 3D until that finish runs under an account's own limits.
        // (Any Angle's 3D view is a splat and its turntable: nothing to finish, so an account builds it on its own GPU.)
        if (account && outputKind(planned.op, planned.model) === "model3d" && planned.model.id !== ANY_ANGLE.buildModel) {
          unhit(`run:${account.id}`);
          return Response.json({ error: OWN_GPU_TOOL_MESSAGE, code: "own-gpu-tool" }, { status: 403 });
        }
        const skip = (body as { gpuCheck?: unknown } | null)?.gpuCheck === "skip";
        const gate = await gateGeneration(gpuTargetFor(request, "read"), { request: req, route: planned.route, op: planned.op, modelId: planned.model.id, gpu: planned.gpu, h3: planned.h3, skip, actor: account?.id ?? "owner" });
        if (!gate.ok) {
          if (account) unhit(`run:${account.id}`);
          return Response.json({ error: gate.message, code: "gpu-setup", ref: gate.ref, plan: gate.plan }, { status: 409, headers: { [GPU_SETUP_HEADER]: "1" } });
        }
        gpuWarning = gate.warning;
      }
    }
    if (account && !onPool) {
      // The LoRAs this run adds (and its start frame's step, for an effect that makes one) must be on the account's
      // ComfyUI: say which to download before anything is queued.
      const fix = await onOwn(() => accountLoraFix(req));
      if (fix) {
        unhit(`run:${account.id}`);
        return refuse(409, missingFilesMessage(fix), { code: "comfy_missing_model", fix });
      }
    }
    // The moderation service's check (none set: nothing checked), before anything is set aside: a refusal costs nothing.
    // Then, on this install's GPUs, the billing service sets the run's price aside (none set: the run is free).
    let stamp: RunStamp | null = null;
    if (account) {
      const mod = await moderateRun(account, req, onPool?.planned ?? null, onPool ? "pool" : "own");
      if (!mod.ok) return refusedBy(mod.refusal);
      if (onPool?.light) {
        // Light work only (joins, trims): free, so nothing is set aside, and it counts against none of the policy's limits.
        stamp = { place: "pool", light: true, ...(mod.checkOutputs && { checkOutputs: true }) };
      } else if (onPool) {
        const held = await reservePool(account, req, onPool.planned, shown, mod.checkOutputs, onPool.steps, pressId);
        if (!held.ok) return refusedBy(held.refusal);
        stamp = held.stamp;
      } else if (mod.checkOutputs) stamp = { checkOutputs: true };
    }
    const make = () => createGenerations(req);
    const inScope = <T,>(fn: () => T): T => (account && onPool ? runOnPool(account.id, () => withRunStamp(stamp ?? { place: "pool" }, fn)) : stamp ? onOwn(() => withRunStamp(stamp, fn)) : onOwn(fn));
    let items: ReturnType<typeof createGenerations>;
    try {
      if (account) {
        // Counted again as the run is made, in one transaction (admitRun): requests that arrived together all passed the
        // first counts while the checks above waited, and a second server may be making runs too. The run's rows are made
        // and checked step by step (every step of a chain on this install's GPUs is one the policy allows); nothing is
        // sent until they are kept.
        const pool = onPool;
        const admitted = inScope(() => {
          const r = admitRun(
            {
              accountId: account.id,
              pool: pool && !pool.light ? { policy: pool.policy, addr } : null,
              // A resend of this press that got here first made the run (or gave up, or was refused): nothing is made twice.
              ...(pressId && { prior: () => pressSeen(account.id, pressId) }),
              // Refused after its hold was made: the hold goes back, so a resend gets this same answer, never a run
              // against that hold. Noted in the same transaction, before any resend can look.
              ...(pressId && stamp?.hold && { refused: (why: AdmitRefused["refusal"] | Error) => notePressRefused(account.id, pressId, stamp?.hold ?? null, why instanceof Error ? thrownAnswer(why) : limitAnswer(why)) }),
            },
            () => {
              const run = captureRun(make);
              const problem = pool && stepsProblem(pool.policy, stepsOf(run.ids));
              if (problem) throw new AdmitRefused({ status: 403, error: problem, code: "not-offered" });
              if (pressId) notePress(account.id, pressId, run.value.map((g) => g.id), stamp?.hold ?? null);
              return run;
            },
          );
          if (r.ok) r.value.start();
          return r;
        });
        if (!admitted.ok && "prior" in admitted) {
          unhit(`run:${account.id}`);
          const prior = admitted.prior;
          // The service gives one press one hold; a different one (a service that made a second) goes back, and so does
          // the hold of a press that made no run.
          if (stamp?.hold && (prior === "gave-up" || "refused" in prior || stamp.hold !== prior.hold)) queueRelease(stamp.hold);
          return answerAgain(prior);
        }
        if (!admitted.ok) {
          unhit(`run:${account.id}`);
          if (stamp?.hold) queueRelease(stamp.hold);
          const a = limitAnswer(admitted.refusal);
          return refuse(a.status, a.body.error, a.body, a.headers);
        }
        items = admitted.value.value;
      } else items = make();
    } catch (e) {
      // Nothing was made: what was set aside goes back.
      if (stamp?.hold) queueRelease(stamp.hold);
      throw e;
    }
    // A script's open-source run while ComfyUI is on the owner's computer: it waits for the owner's Fuobe tab there.
    if (viewer.kind === "owner" && token && getSetting("comfyWhere") === "computer" && items.some((g) => g.provider === "comfyui")) notes.push(RUNS_ON_COMPUTER_NOTE);
    // What the run leaves out or changes (a model that replaced a retired one, a LoRA that runs only on a GPU, a length the API rounds).
    const all = [...new Set([...notes, ...items.flatMap((g) => g.notes ?? [])])];
    return Response.json({ items, ...(all.length && { notes: all }), ...(gpuWarning && { gpuWarning }) }, { status: 201 });
  } catch (e) {
    const refusal = e instanceof AccountRunError ? e.refusal : undefined;
    // A price check of a paid model the account has no key for says so, without opening "Add your key".
    if (refusal && !preview) return refused(refusal);
    if (account && !preview) unhit(`run:${account.id}`);
    // Nothing connected runs this, and ComfyUI or a key could (placeholder results off): the owner's own browser
    // (never a script's token) opens the connect card for it, with the ways that would run it, and the run starts once
    // one is connected (src/server/connect-refusal.ts).
    const connect = connectNeeds(e, request, preview);
    return Response.json(
      {
        error: (e as Error).message,
        ...(refusal && { code: refusal.code, ...(refusal.provider && { provider: refusal.provider }) }),
        ...(connect && { code: "connect-gpu", needs: connect }),
      },
      { status: 422, ...(connect && { headers: { [CONNECT_GPU_HEADER]: "1", [CONNECT_NEEDS_HEADER]: connect } }) },
    );
  }
}
