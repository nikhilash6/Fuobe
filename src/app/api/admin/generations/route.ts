import { connection } from "next/server";
import { accountRunOptions, listAccountRuns } from "@/server/account-admin";
import { adminAccess, auditRead } from "@/server/admin-tokens";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Accounts' runs (owner only, or an admin token with runs:read), newest first: `?account=<id>` (else every account's),
 * `status` (finished, running, failed), `kind` (image, video, audio, model3d, text), `before=<createdAt>:<id>` (the
 * `next` of the last page) and `limit` (≤ 100). Never the owner's own runs: those are in the Library.
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "runs:read", "You can't open this.");
  if (access instanceof Response) return access;
  const sp = new URL(request.url).searchParams;
  const o = accountRunOptions(sp);
  if ("error" in o) return Response.json({ error: o.error }, { status: 400, headers: NO_STORE });
  auditRead(access.actor, "runs.list", { ...(o.account && { account: o.account }), ...(sp.get("status") && { status: sp.get("status") }), ...(o.kind && { kind: o.kind }) });
  return Response.json(listAccountRuns(o), { headers: NO_STORE });
}
