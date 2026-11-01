import "server-only";
import { nanoid } from "nanoid";
import { db } from "./db";
import { HookDown, hookCall, hookTarget, type HookTarget } from "./hook-client";
import type { RunFacts } from "./billing";

/**
 * The moderation hook (docs/moderation-hook.md): an install can connect an external moderation service at
 * FUOBE_MODERATION_URL. With none set, nothing is checked (the studio as it was) and "Report this result" goes to a
 * list the owner reads (reports_inbox).
 *
 * - POST /v1/check-run: before a run is created (and before any billing hold). `{ allowed: false }` stops it: nothing
 *   is made and nothing is charged. `checkOutputs` says whether its outputs go to check-output before they show; a
 *   missing field means yes. A service may skip output checks for a run by answering `checkOutputs: false`.
 * - POST /v1/check-output: one output's bytes; "show", "hide" or "wait".
 * - POST /v1/report: a person's report of a result or a shared link.
 */

export type ReportCategory = "intimate" | "minor" | "violence" | "impersonation" | "copyright" | "other";
export const REPORT_CATEGORIES: ReportCategory[] = ["intimate", "minor", "violence", "impersonation", "copyright", "other"];

export type CheckRunAnswer = { allowed: true; checkOutputs?: boolean } | { allowed: false; code: "blocked" | "consent" | "paused"; text: string };
export type CheckOutputAnswer = { decision: "show" } | { decision: "hide"; text: string } | { decision: "wait"; retryAfterS: number };

/** What a person sees when the moderation service doesn't answer a run check. */
export const CHECKS_PAUSED = "Checks are paused for a moment. Try again soon.";

export const MODERATION_TIMEOUTS = { checkRun: 10_000, checkOutput: 30_000, report: 5_000 };

const HOOK = "moderation service";

declare global {
  var __fuobeModerationBadUrl: boolean | undefined;
}

function target(): HookTarget | null {
  const raw = process.env.FUOBE_MODERATION_URL ?? "";
  if (!raw.trim()) return null;
  const t = hookTarget(raw);
  if (!t && !globalThis.__fuobeModerationBadUrl) {
    globalThis.__fuobeModerationBadUrl = true;
    console.warn("[fuobe] FUOBE_MODERATION_URL is not an http(s) or unix: address; the moderation hook is off");
  }
  return t;
}

/** Is a moderation service set? */
export const moderationConfigured = (): boolean => target() !== null;

const token = () => process.env.FUOBE_MODERATION_TOKEN || undefined;

/** How many hours an output may wait for its check before the row fails (and, with a hold, is refunded). */
export const moderationMaxWaitMs = (): number => {
  const h = Number(process.env.FUOBE_MODERATION_MAX_WAIT_H);
  return (Number.isFinite(h) && h > 0 ? h : 24) * 3_600_000;
};

export interface RunCheckInput {
  requestId: string;
  account: { id: string } | null;
  run: RunFacts;
  prompt: string;
  negative: string | null;
  inputs: { n: number; kind: "image" | "video" | "audio"; sha256: string; preview: string | null }[];
  consent: boolean | null;
}

/** Check a run before it is created. No service: allowed, outputs not checked. No answer: refused as paused. */
export async function checkRun(input: RunCheckInput): Promise<CheckRunAnswer> {
  const t = target();
  if (!t) return { allowed: true, checkOutputs: false };
  try {
    const a = await hookCall<CheckRunAnswer>({ hook: HOOK, target: t, token: token(), method: "POST", path: "/v1/check-run", body: input, timeoutMs: MODERATION_TIMEOUTS.checkRun });
    if (a.allowed === true) return { allowed: true, checkOutputs: a.checkOutputs !== false };
    if (a.allowed === false) return { allowed: false, code: a.code === "consent" ? "consent" : "blocked", text: typeof a.text === "string" && a.text ? a.text : "This request can't be made here." };
    throw new HookDown(HOOK, "a check-run answer without `allowed`");
  } catch (e) {
    console.warn(`[fuobe] moderation check-run: ${(e as Error).message}`);
    return { allowed: false, code: "paused", text: CHECKS_PAUSED };
  }
}

/** Check one output. No service: show. No answer: wait (asked again later). */
export async function checkOutput(file: { bytes: Buffer; contentType: string; generationId: string; account: string | null; assetId: string; kind: "image" | "video" | "audio"; sha256: string }): Promise<CheckOutputAnswer> {
  const t = target();
  if (!t) return { decision: "show" };
  try {
    const a = await hookCall<CheckOutputAnswer>({
      hook: HOOK,
      target: t,
      token: token(),
      method: "POST",
      path: "/v1/check-output",
      bytes: file.bytes,
      contentType: file.contentType,
      headers: { "X-Fuobe-Generation": file.generationId, "X-Fuobe-Account": file.account ?? "", "X-Fuobe-Asset": file.assetId, "X-Fuobe-Kind": file.kind, "X-Fuobe-Sha256": file.sha256 },
      timeoutMs: MODERATION_TIMEOUTS.checkOutput,
    });
    if (a.decision === "show") return a;
    if (a.decision === "hide") return { decision: "hide", text: typeof a.text === "string" ? a.text : "" };
    return { decision: "wait", retryAfterS: Math.max(10, Math.min(3600, Number((a as { retryAfterS?: number }).retryAfterS) || 60)) };
  } catch (e) {
    console.warn(`[fuobe] moderation check-output: ${(e as Error).message}`);
    return { decision: "wait", retryAfterS: 60 };
  }
}

export interface ReportInput {
  target: { generationId?: string; assetId?: string; shareId?: string };
  category: ReportCategory;
  text: string;
  reporter: { account: string | null; email: string | null };
}

/**
 * A person's report. To the service when one is set (falling back to the inbox when it doesn't answer, so no report is
 * lost); else to the owner's inbox.
 */
export async function report(r: ReportInput): Promise<{ ok: true; hidden: boolean; text: string }> {
  const t = target();
  if (t) {
    try {
      const a = await hookCall<{ ok: true; hidden?: boolean; text?: string }>({ hook: HOOK, target: t, token: token(), method: "POST", path: "/v1/report", body: r, timeoutMs: MODERATION_TIMEOUTS.report });
      return { ok: true, hidden: !!a.hidden, text: typeof a.text === "string" && a.text ? a.text : REPORT_THANKS };
    } catch (e) {
      console.warn(`[fuobe] moderation report: ${(e as Error).message}; kept for the owner`);
    }
  }
  db()
    .prepare("INSERT INTO reports_inbox (id, target_json, category, text, reporter, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(nanoid(12), JSON.stringify(r.target), r.category, r.text.slice(0, 2000), JSON.stringify(r.reporter), Date.now());
  return { ok: true, hidden: false, text: REPORT_THANKS };
}

export const REPORT_THANKS = "Thanks. The studio's owner will look at it.";

/** The owner's list of reports (no moderation service set), newest first. */
export function listReports(limit = 100): { id: string; target: ReportInput["target"]; category: string; text: string | null; reporter: ReportInput["reporter"]; createdAt: number; doneAt: number | null }[] {
  const rows = db().prepare("SELECT * FROM reports_inbox ORDER BY created_at DESC LIMIT ?").all(limit) as { id: string; target_json: string; category: string; text: string | null; reporter: string | null; created_at: number; done_at: number | null }[];
  return rows.map((r) => ({ id: r.id, target: JSON.parse(r.target_json), category: r.category, text: r.text, reporter: r.reporter ? JSON.parse(r.reporter) : { account: null, email: null }, createdAt: r.created_at, doneAt: r.done_at }));
}
