import { stitchSession } from "@/server/shorts";
import { StitchSchema, handle, once, optionalBody } from "@/server/shorts-schemas";

/** Stitch again: join the chosen takes and put the original sound back (a repeated requestId gets the first answer). */
export async function POST(request: Request, ctx: RouteContext<"/api/shorts/sessions/[id]/stitch">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { requestId, sound } = await optionalBody(request, StitchSchema);
    return Response.json(await once(`shorts-stitch:${id}`, requestId, () => stitchSession(id, sound)), { status: 201 });
  }, request);
}
