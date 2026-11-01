import { isOwnerRequest, sessionCookieOf } from "@/server/auth";
import { hideOutputs, removeOutputs, unhideOutputs, type Targets } from "@/server/takedown";

const NO_STORE = { "Cache-Control": "no-store" };

const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : undefined);

/**
 * Take results down (owner only): `hide` (served to no account and by no link; kept), `unhide`, `remove` (deleted;
 * with `evidence: true`, moved to a locked folder instead). Body: `{ assetIds?, generationIds?, evidence? }`.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/outputs/[action]">) {
  if (!isOwnerRequest(request, sessionCookieOf(request))) return Response.json({ error: "Only the studio's owner can take results down" }, { status: 403, headers: NO_STORE });
  const { action } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { assetIds?: unknown; generationIds?: unknown; evidence?: unknown } | null;
  const t: Targets = { assetIds: list(body?.assetIds), generationIds: list(body?.generationIds) };
  if (!t.assetIds?.length && !t.generationIds?.length) return Response.json({ error: "Name the results: assetIds or generationIds" }, { status: 400, headers: NO_STORE });
  if (action === "hide") return Response.json({ hidden: hideOutputs(t) }, { headers: NO_STORE });
  if (action === "unhide") return Response.json({ shown: unhideOutputs(t) }, { headers: NO_STORE });
  if (action === "remove") return Response.json({ removed: removeOutputs(t, body?.evidence === true) }, { headers: NO_STORE });
  return Response.json({ error: "Unknown action" }, { status: 404, headers: NO_STORE });
}
