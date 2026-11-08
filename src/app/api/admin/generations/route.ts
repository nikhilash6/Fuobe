import { connection } from "next/server";
import { accountRunOptions, listAdminRuns } from "@/server/account-admin";
import { actorHas, adminAccess, auditContentRead, auditRead } from "@/server/admin-tokens";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Runs (owner only, or an admin token with runs:read), newest first: `?account=<id>`, else `whose` (`people`: every
 * account's and guest's, the default; `ours`: the owner's own; `everyone`), `source` (the owner's runs: `hands-on` or
 * `batch`), `where` (`pool`, `provider`, `own`), `status` (`finished` or `done`, `failed`, `canceled`, `waiting`,
 * `started`, `running`: waiting and started), `kind` (image, video, audio, model3d, text), `model` (letters of the model
 * id), `from` and `to` (yyyy-mm-dd, UTC, both included), `q` (words of the prompt, or a run id), `before=<createdAt>:<id>`
 * (the `next` of the last page) and `limit` (≤ 100). Each run says `whose` it is (`account`, `guest`, `owner`); the
 * owner's own have `account: null` and their `source`.
 *
 * A token with runs:read alone gets each run's facts (when, which model, how it ended); its prompt, inputs and results
 * need outputs:view, and the accounts' emails need accounts:read. Every read of runs' content, the owner's too, is in
 * the admin log, once per account every 10 minutes, with the account (or "owner") as its target.
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "runs:read", "You can't open this.");
  if (access instanceof Response) return access;
  const sp = new URL(request.url).searchParams;
  const o = accountRunOptions(sp);
  if ("error" in o) return Response.json({ error: o.error }, { status: 400, headers: NO_STORE });
  const show = { content: actorHas(access.actor, "outputs:view"), emails: actorHas(access.actor, "accounts:read") };
  const page = listAdminRuns(o, show);
  const filters = {
    ...(o.account && { account: o.account }),
    ...(o.whose !== "people" && { whose: o.whose }),
    ...(o.source && { source: o.source }),
    ...(o.where && { where: o.where }),
    ...(sp.get("status") && { status: sp.get("status") }),
    ...(o.kind && { kind: o.kind }),
    ...(o.modelLike && { model: o.modelLike }),
    ...(o.q && { q: true }),
    ...(sp.get("from") && { from: sp.get("from") }),
    ...(sp.get("to") && { to: sp.get("to") }),
  };
  auditRead(access.actor, "runs.list", filters);
  if (show.content) auditContentRead(access.actor, "runs.content", page.items.map((r) => r.account?.id ?? "owner"), filters);
  return Response.json(page, { headers: NO_STORE });
}
