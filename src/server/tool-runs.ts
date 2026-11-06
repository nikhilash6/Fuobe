import "server-only";
import { onceForAccount, priceAsRun, runAccountTool, toolPriceCheck, toolViewer, toolWishes, type ToolStep } from "./account-tool-run";
import type { Account } from "./auth";
import { db } from "./db";
import { captureRun } from "./generations";
import type { GenerationRequest } from "@/lib/catalog/types";
import { runOnPool } from "./hosted";
import { withoutStamp } from "./run-stamp";

/**
 * The apps and tools whose run is made in one go by a create function (createInfluencer, createPhotodump,
 * createTurnaround, createFlyAround…: generations and pipelines, nothing else) open to accounts through the same checks
 * as every tool run (account-tool-run.ts runAccountTool): their steps are what that create function would make, made in
 * a transaction that is rolled back (nothing kept, nothing sent), then made for real once every check passed. With
 * hosted runs on, the run may go to this install's GPUs as one run (placeOf).
 */

const ROLLED_BACK = Symbol("rolled back");

const depCount = (v: string | null): number => (!v ? 0 : v.startsWith("[") ? (JSON.parse(v) as unknown[]).length : 1);

/**
 * A run's steps as `start` would make them: every row it makes (a chain's later steps too), with the earlier steps each
 * waits for, made and thrown away inside one transaction. Call it in the run's own scope (asAccount, runOnPool). A start
 * that awaits before it makes its rows can't be planned this way.
 */
export function dryRunSteps(start: () => unknown): ToolStep[] {
  const d = db();
  let steps: ToolStep[] = [];
  try {
    d.transaction(() => {
      const made = captureRun(start);
      made.settle();
      if (made.value && typeof (made.value as { then?: unknown }).then === "function") throw new Error("A run that waits before it starts can't be planned here.");
      const q = d.prepare("SELECT request_json, depends_on FROM generations WHERE id = ?");
      steps = made.ids.flatMap((id) => {
        const r = q.get(id) as { request_json: string; depends_on: string | null } | undefined;
        return r ? [{ request: withoutStamp(JSON.parse(r.request_json) as GenerationRequest), deps: depCount(r.depends_on) }] : [];
      });
      throw ROLLED_BACK;
    })();
  } catch (e) {
    if (e !== ROLLED_BACK) throw e;
  }
  return steps;
}

export interface ToolRoute<T> {
  /** The tool, for the run limit's key and the logs. */
  tool: string;
  /** Every file the body names: only the account's own, or Fuobe's example files. */
  files: (string | null | undefined)[];
  /** A client nonce: a repeat of it gets the first run. */
  requestId?: string;
  /** Makes the run (createInfluencer…), inside the account's scope. */
  start: () => T;
  /** The route's answer for the started run. */
  ok: (value: T, gpuWarning?: string) => Response;
  skipGpuCheck?: boolean;
  /** The place and price the body carries (account-tool-run.ts toolWishes, read before the route reads the body). */
  wishes?: Awaited<ReturnType<typeof toolWishes>>;
  /** Runs only on this install's GPUs: anywhere else it is refused as before (account-tool-run.ts AccountToolRun). */
  poolOnly?: boolean;
  /** The start as it runs on this install's GPUs, with no more outputs at once than `cap` (AccountToolRun.forPool). */
  poolStart?: (cap: number) => () => T;
}

/** An account's run of such a tool: its steps planned from `start`, checked, placed and started (runAccountTool). */
export async function runToolForAccount<T>(request: Request, account: Account, o: ToolRoute<T>): Promise<Response> {
  return onceForAccount(
    account,
    o.tool,
    o.requestId,
    () =>
      runAccountTool(request, account, {
        tool: o.tool,
        files: o.files,
        plan: () => dryRunSteps(o.start),
        start: o.start,
        skipGpuCheck: o.skipGpuCheck,
        ...o.wishes,
        ...(o.poolOnly && { poolOnly: true }),
        ...(o.poolStart && {
          forPool: (cap: number) => {
            const start = o.poolStart!(cap);
            return { plan: () => dryRunSteps(start), start };
          },
        }),
      }),
    ({ value, gpuWarning }) => o.ok(value, gpuWarning),
  );
}

/**
 * A tool's price check (`?preview=1` or its estimate route) as one answer: the tool's own, priced as the asker's run
 * would go (priceAsRun), with `{ place: "pool", quote, line }` added when the run would go to this install's GPUs (an
 * account with no GPU of its own, or one whose runs go there first; a guest). Then the tool's own answer is made as a
 * run there too (runOnPool), so an account with no GPU of its own is priced instead of asked to connect one. The
 * owner's as always.
 *
 * `plan` gets the request's body (read from a copy, before `preview` reads it) and gives the run's steps; a body or a
 * plan that doesn't check out adds nothing here (the tool's own answer says why).
 */
export async function poolPricedCheck(
  request: Request,
  preview: () => Response | Promise<Response>,
  plan: (body: unknown) => ToolStep[] | Promise<ToolStep[]>,
): Promise<Response> {
  const viewer = toolViewer(request);
  if (viewer.kind === "owner") return preview();
  let body: Promise<unknown> | null = null;
  const read = () => (body ??= request.clone().json().catch(() => null));
  const pool = await toolPriceCheck(request, async () => plan(await read()));
  if (!pool) return priceAsRun(request, preview);
  const res = await runOnPool(viewer.kind === "account" ? viewer.account.id : null, preview);
  const answer: unknown = res.ok ? await res.clone().json().catch(() => null) : null;
  if (!answer || typeof answer !== "object" || Array.isArray(answer) || "error" in answer) return res;
  return Response.json({ ...answer, ...pool }, { status: res.status, headers: { "Cache-Control": "no-store" } });
}
