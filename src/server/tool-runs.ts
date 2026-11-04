import "server-only";
import { onceForAccount, runAccountTool, toolPriceCheck, toolViewer, toolWishes, type ToolStep } from "./account-tool-run";
import type { Account } from "./auth";
import { db } from "./db";
import { captureRun } from "./generations";
import type { GenerationRequest } from "@/lib/catalog/types";
import type { PlaceWish } from "./hosted-run";
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
      }),
    ({ value, gpuWarning }) => o.ok(value, gpuWarning),
  );
}

/**
 * A tool's price check (`?preview=1`) with its place on this install's GPUs added when the run would go there:
 * `{ place: "pool", quote, line }` beside the tool's own answer (an account's or a guest's; the owner's as always).
 */
export async function withPoolPrice(request: Request, answer: object, start: () => unknown, wish?: PlaceWish): Promise<object> {
  if (toolViewer(request).kind === "owner" || "error" in answer) return answer;
  const pool = await toolPriceCheck(request, () => dryRunSteps(start), wish);
  return pool ? { ...answer, ...pool } : answer;
}

/** Every stored file a body names (`/api/files/…`), wherever it sits: the files an account's run must own. */
export function bodyFiles(value: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 8) return;
    if (typeof v === "string") {
      if (v.startsWith("/api/files/")) out.add(v);
    } else if (Array.isArray(v)) for (const x of v) walk(x, depth + 1);
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(value, 0);
  return [...out];
}
