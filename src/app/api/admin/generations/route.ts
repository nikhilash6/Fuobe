import { connection } from "next/server";
import { accountRunOptions, listAccountRuns } from "@/server/account-admin";
import { actorHas, adminAccess, auditContentRead, auditRead } from "@/server/admin-tokens";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Accounts' runs (owner only, or an admin token with runs:read), newest first: `?account=<id>` (else every account's),
 * `status` (finished, running, failed), `kind` (image, video, audio, model3d, text), `before=<createdAt>:<id>` (the
 * `next` of the last page) and `limit` (≤ 100). Never the owner's own runs: those are in the Library.
 *
 * A token with runs:read alone gets each run's facts (when, which model, how it ended); its prompt, inputs and results
 * need outputs:view, and the accounts' emails need accounts:read. Every read of runs' content, the owner's too, is in
 * the admin log, once per account every 10 minutes, with the account as its target.
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "runs:read", "You can't open this.");
  if (access instanceof Response) return access;
  const sp = new URL(request.url).searchParams;
  const o = accountRunOptions(sp);
  if ("error" in o) return Response.json({ error: o.error }, { status: 400, headers: NO_STORE });
  const show = { content: actorHas(access.actor, "outputs:view"), emails: actorHas(access.actor, "accounts:read") };
  const page = listAccountRuns(o, show);
  const filters = { ...(o.account && { account: o.account }), ...(sp.get("status") && { status: sp.get("status") }), ...(o.kind && { kind: o.kind }) };
  auditRead(access.actor, "runs.list", filters);
  if (show.content) auditContentRead(access.actor, "runs.content", page.items.map((r) => r.account.id), filters);
  return Response.json(page, { headers: NO_STORE });
}
