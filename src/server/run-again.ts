import "server-only";
import { getModel } from "@/lib/catalog";
import { lengthRange } from "@/lib/catalog/clip-lengths";
import type { Generation, GenerationRequest } from "@/lib/catalog/types";
import { ACCOUNT_LIMITS, accountTotalBytes, accountUsage, diskHasRoom, filesFullMessage } from "./account-files";
import { accountInputProblem } from "./account-inputs";
import { accountById } from "./auth";
import { db } from "./db";
import { accountRun, AccountRunError, asAccount, captureRun, createGenerations, getGeneration, previewGeneration, stepsOf } from "./generations";
import { poolReady, poolRunsProvider, runOnPool } from "./hosted";
import { GenerationRequestSchema } from "./request-schema";
import { stampOf, withoutStamp, withRunStamp, type RunStamp } from "./run-stamp";

/**
 * Run an account's run again for them (the admin API's POST /api/admin/generations/{id}/again): the same feature,
 * model, operation, words and files, with the changes asked for, in the same account and on the same place it ran
 * (this install's GPUs, or the account's own GPU or key). It is made as that account's own Run would make it, and it
 * meets the same checks of the request (the request schema, the model's lengths, the account's files), but it is free:
 * nothing is set aside for it and it counts against none of the limits on runs. `notice` is said on the new run's
 * result, as a run's notice is.
 */

/** What may change: settings (merged over the run's own) and the words. */
export interface RunChanges {
  params?: Record<string, unknown>;
  prompt?: string;
}

export const NOTICE_MAX = 300;

export class RunAgainError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The body as sent, checked for its shape: `{ changes?: { params?, prompt? }, notice? }`. */
export function readAgainBody(body: unknown): { changes: RunChanges; notice?: string } {
  if (body === null || body === undefined) return { changes: {} };
  if (!isRecord(body)) throw new RunAgainError(400, "Send { changes?: { params?, prompt? }, notice? }");
  const extraKeys = Object.keys(body).filter((k) => k !== "changes" && k !== "notice");
  if (extraKeys.length) throw new RunAgainError(400, `Unknown field: ${extraKeys[0]}`);
  const changes: RunChanges = {};
  if (body.changes !== undefined) {
    if (!isRecord(body.changes)) throw new RunAgainError(400, "changes is { params?, prompt? }");
    const extra = Object.keys(body.changes).filter((k) => k !== "params" && k !== "prompt");
    if (extra.length) throw new RunAgainError(400, `Unknown change: ${extra[0]}`);
    if (body.changes.params !== undefined) {
      if (!isRecord(body.changes.params)) throw new RunAgainError(400, "changes.params is an object of settings");
      changes.params = body.changes.params;
    }
    if (body.changes.prompt !== undefined) {
      if (typeof body.changes.prompt !== "string" || !body.changes.prompt.trim()) throw new RunAgainError(400, "changes.prompt is the new words");
      changes.prompt = body.changes.prompt;
    }
  }
  let notice: string | undefined;
  if (body.notice !== undefined && body.notice !== null) {
    if (typeof body.notice !== "string") throw new RunAgainError(400, "notice is a sentence");
    const n = body.notice.replace(/\s+/g, " ").trim();
    if (n.length > NOTICE_MAX) throw new RunAgainError(400, `notice is at most ${NOTICE_MAX} characters`);
    if (n) notice = n;
  }
  return { changes, notice };
}

/** A length the model doesn't make, in words, or null. */
export function durationProblem(modelId: string, duration: unknown): string | null {
  if (duration === undefined) return null;
  const model = getModel(modelId);
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return "duration is a number of seconds";
  if (!model) return null;
  const range = lengthRange(model);
  if (range) {
    return Number.isInteger(duration) && duration >= range[0] && duration <= range[1] ? null : `${model.name} makes clips of ${range[0]} to ${range[1]} seconds, in whole seconds`;
  }
  const list = model.options.durations;
  if (list && list.length && !list.includes(duration)) return `${model.name} makes clips of ${list.join(", ")} seconds`;
  return null;
}

/** The request the new run sends: the run's own as a client would send it again, with the changes. */
export function againRequest(stored: GenerationRequest, changes: RunChanges): GenerationRequest {
  const base = withoutStamp(stored) as GenerationRequest & Record<string, unknown>;
  const params = changes.params
    ? {
        ...base.params,
        ...changes.params,
        ...(isRecord(changes.params.extra) && { extra: { ...base.params?.extra, ...changes.params.extra } }),
      }
    : base.params;
  const body = { ...base, ...(params && { params }), ...(changes.prompt !== undefined && { prompt: changes.prompt }) };
  const parsed = GenerationRequestSchema.safeParse(body);
  if (!parsed.success) throw new RunAgainError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const req = parsed.data as GenerationRequest;
  // A setting the request doesn't take is said, never dropped without a word.
  for (const k of Object.keys(changes.params ?? {})) {
    if (!(k in (req.params ?? {}))) throw new RunAgainError(400, `Unknown setting: ${k}`);
  }
  const problem = durationProblem(req.modelId, req.params?.duration);
  if (changes.params && "duration" in changes.params && problem) throw new RunAgainError(400, problem);
  return req;
}

export interface RunAgainResult {
  account: string;
  place: "pool" | "own";
  items: Generation[];
}

/** Make the run again for its account. Throws RunAgainError with the status to answer. */
export async function runAgainFor(id: string, changes: RunChanges, notice: string | undefined): Promise<RunAgainResult> {
  const row = db().prepare("SELECT request_json, depends_on FROM generations WHERE id = ?").get(id) as { request_json: string; depends_on: string | null } | undefined;
  if (!row || !getGeneration(id)) throw new RunAgainError(404, "No such run");
  const stored = JSON.parse(row.request_json) as GenerationRequest;
  const accountId = stored.account;
  if (!accountId) throw new RunAgainError(404, "That run is yours, not an account's. Run it again in the studio.");
  if (row.depends_on) throw new RunAgainError(409, "That run is a step of a longer run: run the whole run again instead.");
  const account = accountById(accountId);
  if (!account) throw new RunAgainError(404, "That run's account is gone");
  if (account.disabled) throw new RunAgainError(409, "That account is switched off");
  if (!diskHasRoom()) throw new RunAgainError(503, "The server is low on space: free some first");
  if (accountUsage(accountId).total >= accountTotalBytes(accountId)) throw new RunAgainError(413, filesFullMessage(accountId));

  let req = againRequest(stored, changes);
  if ((req.params?.numOutputs ?? 1) > ACCOUNT_LIMITS.outputsPerRun) req = { ...req, params: { ...req.params, numOutputs: ACCOUNT_LIMITS.outputsPerRun } };
  const files = accountInputProblem(req, accountId);
  if (files) throw new RunAgainError(400, files.error);
  req = { ...req, account: accountId, ...(notice && { notice }) };

  // What the first run kept of its place in line (its class, its moderation check), with no hold or charge: free, and
  // no limit on how long it waits to start.
  const was = stampOf(stored);
  const kept: RunStamp = { standalone: true, ...(was.checkOutputs && { checkOutputs: true }), ...(was.class && { class: was.class }) };
  const make = () => createGenerations(req);

  try {
    if (was.place === "pool") {
      if (!poolReady()) throw new RunAgainError(409, "This install's GPUs aren't taking runs right now");
      const planned = runOnPool(accountId, () => previewGeneration(req));
      if (planned.route.provider !== "comfyui") throw new RunAgainError(409, "With these changes the run can't go to this install's GPUs");
      const stamp: RunStamp = { ...kept, place: "pool", ...(was.light && { light: true }), waitMs: 0 };
      const items = runOnPool(accountId, () =>
        withRunStamp(stamp, () => {
          // Made in one transaction and sent once kept: a step the GPUs here can't run keeps nothing.
          const run = db().transaction(() => {
            const r = captureRun(make);
            if (stepsOf(r.ids).some((s) => !poolRunsProvider(s.provider))) throw new RunAgainError(409, "With these changes the run can't go to this install's GPUs");
            return r;
          })();
          run.start();
          return run.value;
        }),
      );
      return { account: accountId, place: "pool", items };
    }
    const planned = asAccount(accountId, () => previewGeneration(req));
    const own = accountRun(accountId, planned.route.provider, "submit");
    if ("error" in own) throw new RunAgainError(409, own.error);
    const items = own.run(() => withRunStamp(kept, make));
    return { account: accountId, place: "own", items };
  } catch (e) {
    if (e instanceof RunAgainError) throw e;
    if (e instanceof AccountRunError) throw new RunAgainError(409, e.refusal.error);
    throw new RunAgainError(400, (e as Error).message);
  }
}
