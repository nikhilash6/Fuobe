import { connection } from "next/server";
import { accountRunOptions, listAccountRuns } from "@/server/account-admin";
import { isOwnerRequest, sessionCookieOf } from "@/server/auth";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Accounts' runs (owner only), newest first: `?account=<id>` (else every account's), `status` (finished, running,
 * failed), `kind` (image, video, audio, model3d, text), `before=<createdAt>:<id>` (the `next` of the last page) and
 * `limit` (≤ 100). Never the owner's own runs: those are in the Library.
 */
export async function GET(request: Request) {
  await connection();
  if (!isOwnerRequest(request, sessionCookieOf(request))) return Response.json({ error: "Only the studio's owner sees accounts' runs" }, { status: 403, headers: NO_STORE });
  const o = accountRunOptions(new URL(request.url).searchParams);
  if ("error" in o) return Response.json({ error: o.error }, { status: 400, headers: NO_STORE });
  return Response.json(listAccountRuns(o), { headers: NO_STORE });
}
