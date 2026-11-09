import { adminAccess, audit } from "@/server/admin-tokens";
import { readAgainBody, runAgainFor, RunAgainError } from "@/server/run-again";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Run an account's run again for them (owner only, or an admin token with queue:control): `{ changes?: { params?,
 * prompt? }, notice? }`. The new run is the account's own, made as its Run would make it (the same feature, model,
 * operation and files, with the changes), on the place the run went (this install's GPUs, or its own GPU or key), and
 * free. `notice` is said on its result. The changes meet the checks a run's request meets: 400 with the reason. 404 for
 * no such run or the owner's own; 409 for a step of a longer run, an account switched off, or a place that can't take
 * it now. Each call is in the admin log with the run and the new run's ids.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/generations/[id]/again">) {
  const access = adminAccess(request, "queue:control", "Only the studio's owner runs a person's run again");
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  if (!/^[\w-]{1,80}$/.test(id)) {
    audit(access.actor, "run.again", null, null, 404);
    return Response.json({ error: "No such run" }, { status: 404, headers: NO_STORE });
  }
  const text = await request.text().catch(() => "");
  let body: unknown = null;
  try {
    body = text.trim() ? JSON.parse(text) : null;
  } catch {
    audit(access.actor, "run.again", id, null, 400);
    return Response.json({ error: "Send JSON: { changes?: { params?, prompt? }, notice? }" }, { status: 400, headers: NO_STORE });
  }
  try {
    const { changes, notice } = readAgainBody(body);
    const made = await runAgainFor(id, changes, notice);
    const ids = made.items.map((g) => g.id);
    const changed = [...Object.keys(changes.params ?? {}).map((k) => `params.${k}`), ...(changes.prompt !== undefined ? ["prompt"] : [])];
    audit(access.actor, "run.again", id, { account: made.account, ids, place: made.place, changed, ...(changes.params && { params: loggable(changes.params) }), notice: !!notice }, 201);
    return Response.json(
      { original: id, account: made.account, place: made.place, ids, items: made.items.map((g) => ({ id: g.id, status: g.status, modelId: g.modelId, op: g.op, params: g.request.params ?? {}, notice: g.request.notice ?? null })) },
      { status: 201, headers: NO_STORE },
    );
  } catch (e) {
    const status = e instanceof RunAgainError ? e.status : 500;
    const error = e instanceof RunAgainError ? e.message : "Couldn't make the run";
    audit(access.actor, "run.again", id, { error: error.slice(0, 200) }, status);
    return Response.json({ error }, { status, headers: NO_STORE });
  }
}

/** The changed settings for the log: numbers, switches and short words only (never a prompt or a file). */
function loggable(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 40 && !v.includes("/"))) out[k] = v;
  }
  return out;
}
