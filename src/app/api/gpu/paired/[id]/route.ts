import { pairingPrincipal } from "@/server/computer/pairing-http";
import { unpair } from "@/server/computer/workers";

/** Disconnect one of this person's paired ComfyUIs: its token stops at its next call. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/gpu/paired/[id]">) {
  const principal = pairingPrincipal(request);
  if (principal instanceof Response) return principal;
  const { id } = await ctx.params;
  if (!unpair(principal, id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
