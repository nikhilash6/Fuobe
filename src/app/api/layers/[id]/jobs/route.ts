import { connectRefusal } from "@/server/connect-refusal";
import { JobInputSchema, LayersError, startJob } from "@/server/layers";

/**
 * Start a tool (decompose, separate a layer, edit text, remove background, a regional edit, upscale,
 * relight, angles, expand, generate a layer): its generations run on the chosen engine; the editor
 * applies the result when it lands. 422 with the reason when it can't start.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/layers/[id]/jobs">) {
  const { id } = await ctx.params;
  const parsed = JobInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Could not start the tool: the request was incomplete" }, { status: 400 });
  try {
    return Response.json(startJob(id, parsed.data), { status: 201 });
  } catch (e) {
    return connectRefusal(e, request) ?? Response.json({ error: (e as Error).message }, { status: e instanceof LayersError ? e.status : 422 });
  }
}
