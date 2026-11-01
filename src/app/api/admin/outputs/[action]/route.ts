import { adminAccess, audit, type Scope } from "@/server/admin-tokens";
import { hideOutputs, removeOutputs, unhideOutputs, type Targets } from "@/server/takedown";

const NO_STORE = { "Cache-Control": "no-store" };

const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : undefined);

/** Who may do each action: hiding is outputs:hide's (or outputs:moderate's); showing again and removing are outputs:moderate's. */
const SCOPE: Record<string, Scope[]> = { hide: ["outputs:hide", "outputs:moderate"], unhide: ["outputs:moderate"], remove: ["outputs:moderate"] };

/**
 * Take results down (owner only, or an admin token with the action's scope): `hide` (served to no account and by no
 * link; kept), `unhide`, `remove` (deleted; with `evidence: true`, moved to a locked folder instead). Body:
 * `{ assetIds?, generationIds?, evidence? }`.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/outputs/[action]">) {
  const { action } = await ctx.params;
  const access = adminAccess(request, Object.hasOwn(SCOPE, action) ? SCOPE[action] : ["outputs:moderate"],"Only the studio's owner can take results down");
  if (access instanceof Response) return access;
  const body = (await request.json().catch(() => null)) as { assetIds?: unknown; generationIds?: unknown; evidence?: unknown } | null;
  const t: Targets = { assetIds: list(body?.assetIds), generationIds: list(body?.generationIds) };
  if (!t.assetIds?.length && !t.generationIds?.length) return Response.json({ error: "Name the results: assetIds or generationIds" }, { status: 400, headers: NO_STORE });
  // The log keeps the counts and the first ids named (ids only: never a file's content or a prompt).
  const asked = { assets: t.assetIds?.length ?? 0, runs: t.generationIds?.length ?? 0, ids: [...(t.assetIds ?? []), ...(t.generationIds ?? [])].slice(0, 20).map((s) => s.slice(0, 64)) };
  if (action === "hide") {
    const hidden = hideOutputs(t);
    audit(access.actor, "outputs.hide", null, { ...asked, changed: hidden }, 200);
    return Response.json({ hidden }, { headers: NO_STORE });
  }
  if (action === "unhide") {
    const shown = unhideOutputs(t);
    audit(access.actor, "outputs.unhide", null, { ...asked, changed: shown }, 200);
    return Response.json({ shown }, { headers: NO_STORE });
  }
  if (action === "remove") {
    const evidence = body?.evidence === true;
    const removed = removeOutputs(t, evidence);
    audit(access.actor, "outputs.remove", null, { ...asked, changed: removed, evidence }, 200);
    return Response.json({ removed }, { headers: NO_STORE });
  }
  return Response.json({ error: "Unknown action" }, { status: 404, headers: NO_STORE });
}
