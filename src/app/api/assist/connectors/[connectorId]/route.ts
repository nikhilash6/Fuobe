import { ConnectorError, deleteConnector, updateConnector } from "@/server/assist/connectors";
import { ConnectorBody } from "@/server/assist/schemas";

/** Rename, change the URL, replace the token ("" removes it; leave it out to keep it), switch on or off. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/assist/connectors/[connectorId]">) {
  const parsed = ConnectorBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid change" }, { status: 400 });
  try {
    const c = updateConnector((await ctx.params).connectorId, parsed.data);
    return c ? Response.json(c) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof ConnectorError ? e.status : 500 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/assist/connectors/[connectorId]">) {
  return deleteConnector((await ctx.params).connectorId) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
