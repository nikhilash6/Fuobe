import { connection } from "next/server";
import { CONNECT_GPU_HEADER, GUEST_RUN_MESSAGE, OWN_GPU_TOOL_MESSAGE } from "@/lib/guest-access";
import { missingFilesMessage } from "@/lib/missing-files";
import { ADD_KEY_HEADER } from "@/lib/your-keys";
import { requestViewer, validToken } from "@/server/auth";
import { accountEngineMode } from "@/server/account-keys";
import { computerScope, ISOLATED_ON_COMPUTER, workerFor } from "@/server/providers/comfyui";
import { getSetting } from "@/server/settings";
import { RUNS_ON_COMPUTER_NOTE } from "@/lib/relay";
import { OPERATION_LABELS } from "@/lib/catalog/types";
import { ACCOUNT_LIMITS, ACCOUNT_MESSAGES, accountTotalBytes, accountUsage, diskHasRoom, filesFullMessage } from "@/server/account-files";
import { accountInputProblem } from "@/server/account-inputs";
import { db } from "@/server/db";
import { accountLoraFix, accountRun, AccountRunError, asAccount, asVisitor, ConnectComfyError, createGenerations, listGenerations, outputKind, previewGeneration, type AccountRunRefusal } from "@/server/generations";
import { ensureTrashPurge, listOptionsFrom } from "@/server/library";
import { hit, unhit } from "@/server/rate";
import { GenerationRequestSchema } from "@/server/request-schema";
import { gateGeneration, GPU_SETUP_HEADER } from "@/server/gpu/gate";
import { gpuTargetFor } from "@/server/gpu/target";

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

/** An account's runs going now (queued or running), counted as runs: a run's jobs and chain steps share a batch. */
function activeRuns(accountId: string): number {
  const r = db()
    .prepare(
      "SELECT COUNT(DISTINCT COALESCE(batch_id, id)) AS n FROM generations WHERE status IN ('queued', 'running') AND json_extract(request_json, '$.account') = ?",
    )
    .get(accountId) as { n: number };
  return r.n;
}

/** What the sign-in proxy passes on of a request body (next.config.ts proxyClientMaxBodySize). */
const PROXY_BODY_BYTES = 4 * 1024 * 1024;
const BODY_TOO_BIG = "That request is over 4 MB. Upload pictures and clips first (POST /api/uploads), then send their /api/files/ paths.";

const refuse = (status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });

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
  const asked = parsed.data as Parameters<typeof createGenerations>[0];
  // Public sign-up: an account runs on its own ComfyUI or its own fal.ai or Replicate key, never the install's providers.
  // Without a key of its own it stays on the open engine; with one, the engine it asked for.
  let req = account ? { ...asked, account: account.id, engine: accountEngineMode(account.id) === "open" ? ("open" as const) : asked.engine } : { ...asked, account: undefined };
  const onOwn = <T,>(fn: () => T): T => (account ? asAccount(account.id, fn) : fn());
  // A visitor's price check: priced as it would run, as that visitor (an account: its own GPU and keys; a guest: the open
  // engine, no demo).
  const priced = <T,>(fn: () => T): T => (viewer.kind === "owner" ? fn() : account ? asAccount(account.id, fn) : asVisitor(null, fn));
  /** An account's run that can't go where it was planned: Connect your GPU, Add your key (the client opens either). */
  const refused = (r: AccountRunRefusal) => {
    if (account) unhit(`run:${account.id}`);
    const headers: Record<string, string> = r.code === "connect-gpu" ? { [CONNECT_GPU_HEADER]: "1" } : r.code === "add-key" && r.provider ? { [ADD_KEY_HEADER]: r.provider } : {};
    return refuse(403, r.error, { code: r.code, ...(r.provider && { provider: r.provider }) }, headers);
  };
  const notes: string[] = [];
  if (account && !preview) {
    // Room on the server, room in the account's files, and a fair share of runs.
    if (!diskHasRoom()) return refuse(503, ACCOUNT_MESSAGES.diskLow);
    if (accountUsage(account.id).total >= accountTotalBytes(account.id)) return refuse(413, filesFullMessage(account.id));
    if (activeRuns(account.id) >= ACCOUNT_LIMITS.activeRuns) return refuse(429, ACCOUNT_MESSAGES.activeRuns, {}, { "Retry-After": "30" });
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
  try {
    if (preview) {
      const { model, ...p } = priced(() => previewGeneration(req));
      return Response.json({ ...p, modelId: model.id, modelName: model.name, engine: model.engine, kind: outputKind(p.op, model), opLabel: OPERATION_LABELS[p.op] ?? p.op });
    }
    // GPU pre-flight: a ComfyUI run that is sure to fail for something missing stops here with the plan that fixes it
    // (src/server/gpu/gate.ts; never when the check is unknown, for graphics memory, or with gpuCheck "skip").
    let gpuWarning: string | undefined;
    if (viewer.kind !== "guest") {
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
        if (account && outputKind(planned.op, planned.model) === "model3d") {
          unhit(`run:${account.id}`);
          return Response.json({ error: OWN_GPU_TOOL_MESSAGE, code: "own-gpu-tool" }, { status: 403 });
        }
        const skip = (body as { gpuCheck?: unknown } | null)?.gpuCheck === "skip";
        const gate = await gateGeneration(gpuTargetFor(request, "read"), { request: req, route: planned.route, op: planned.op, modelId: planned.model.id, skip, actor: account?.id ?? "owner" });
        if (!gate.ok) {
          if (account) unhit(`run:${account.id}`);
          return Response.json({ error: gate.message, code: "gpu-setup", ref: gate.ref, plan: gate.plan }, { status: 409, headers: { [GPU_SETUP_HEADER]: "1" } });
        }
        gpuWarning = gate.warning;
      }
    }
    if (account) {
      // The LoRAs this run adds (and its start frame's step, for an effect that makes one) must be on the account's
      // ComfyUI: say which to download before anything is queued.
      const fix = await onOwn(() => accountLoraFix(req));
      if (fix) {
        unhit(`run:${account.id}`);
        return refuse(409, missingFilesMessage(fix), { code: "comfy_missing_model", fix });
      }
    }
    // Counted again just before the run is stored, with nothing awaited in between: requests that arrived together all
    // passed the first count while the checks above waited.
    if (account && activeRuns(account.id) >= ACCOUNT_LIMITS.activeRuns) {
      unhit(`run:${account.id}`);
      return refuse(429, ACCOUNT_MESSAGES.activeRuns, {}, { "Retry-After": "30" });
    }
    const items = onOwn(() => createGenerations(req));
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
    // Nothing connected runs this, and ComfyUI could: the owner's own browser (never a script's token) opens "Connect
    // your GPU" for it, and the run starts once it is connected.
    const connect = e instanceof ConnectComfyError && viewer.kind === "owner" && !preview && !token;
    return Response.json(
      { error: (e as Error).message, ...(refusal && { code: refusal.code, ...(refusal.provider && { provider: refusal.provider }) }), ...(connect && { code: "connect-gpu" }) },
      { status: 422, ...(connect && { headers: { [CONNECT_GPU_HEADER]: "1" } }) },
    );
  }
}
