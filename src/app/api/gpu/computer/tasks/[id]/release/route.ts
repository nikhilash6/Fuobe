import { principalOf, relayAnswer } from "@/server/computer/http";
import { leased, release } from "@/server/computer/tasks";

/**
 * The tab lets go of a job as it closes (sent with keepalive): one it hadn't sent to ComfyUI yet waits for the next tab
 * or computer at once; one ComfyUI has stays with this computer, which picks it up again when Fuobe opens there.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/gpu/computer/tasks/[id]/release">) {
  const principal = principalOf(request);
  if (principal instanceof Response) return principal;
  const body = (await request.json().catch(() => null)) as { lease?: unknown } | null;
  const { id } = await ctx.params;
  try {
    release(leased(principal, id, body?.lease));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return relayAnswer(e);
  }
}
