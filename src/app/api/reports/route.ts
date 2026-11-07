import { connection } from "next/server";
import { isOwnerRequest, LoginGuard, requestViewer, sessionCookieOf } from "@/server/auth";
import { listReports, report, REPORT_CATEGORIES, type ReportCategory } from "@/server/moderation";
import { hit } from "@/server/rate";
import { limitWords } from "@/lib/limit-words";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * "Report this result": anyone who can see a result or a shared link may report it. It goes to the install's
 * moderation service when one is set (FUOBE_MODERATION_URL, docs/moderation-hook.md), else to a list the owner reads
 * (GET, owner only).
 */
export async function POST(request: Request) {
  const viewer = requestViewer(request);
  const who = viewer.kind === "account" ? `account:${viewer.account.id}` : viewer.kind === "owner" ? "owner" : `guest:${LoginGuard.clientKey(request.headers)}`;
  const rate = hit(`report:${who}`, 20, 60 * 60_000);
  if (!rate.ok) return Response.json({ error: limitWords("reports", rate.retryAfterS) }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(rate.retryAfterS) } });
  const body = (await request.json().catch(() => null)) as { target?: Record<string, unknown>; category?: unknown; text?: unknown; email?: unknown } | null;
  const t = body?.target ?? {};
  const id = (v: unknown) => (typeof v === "string" && /^[\w-]{1,64}$/.test(v) ? v : undefined);
  const target = { ...(id(t.generationId) && { generationId: id(t.generationId) }), ...(id(t.assetId) && { assetId: id(t.assetId) }), ...(id(t.shareId) && { shareId: id(t.shareId) }) };
  if (!Object.keys(target).length) return Response.json({ error: "Say what you are reporting" }, { status: 400, headers: NO_STORE });
  const category = REPORT_CATEGORIES.includes(body?.category as ReportCategory) ? (body!.category as ReportCategory) : null;
  if (!category) return Response.json({ error: "Pick what is wrong with it" }, { status: 400, headers: NO_STORE });
  const text = typeof body?.text === "string" ? body.text.slice(0, 2000) : "";
  const email = viewer.kind === "account" ? viewer.account.email : typeof body?.email === "string" && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(body.email) ? body.email : null;
  const a = await report({ target, category, text, reporter: { account: viewer.kind === "account" ? viewer.account.id : null, email } });
  return Response.json({ ok: true, text: a.text }, { status: 201, headers: NO_STORE });
}

/** The reports kept here (no moderation service set): the owner only. */
export async function GET(request: Request) {
  await connection();
  if (!isOwnerRequest(request, sessionCookieOf(request))) return Response.json({ error: "Only the studio's owner sees reports" }, { status: 403, headers: NO_STORE });
  return Response.json({ items: listReports() }, { headers: NO_STORE });
}
