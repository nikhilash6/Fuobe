import { z } from "zod";
import { makePrimary, ShortsError } from "@/server/shorts";
import { body, handle } from "@/server/shorts-schemas";

/** Make a take the one the stitch uses. */
export async function POST(request: Request, ctx: RouteContext<"/api/shorts/sessions/[id]/segments/[index]/primary">) {
  return handle(async () => {
    const { id, index } = await ctx.params;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0) throw new ShortsError("No such segment", 404);
    const { generationId } = await body(request, z.object({ generationId: z.string().min(1).max(40) }), "Pick a take");
    return Response.json(makePrimary(id, i, generationId));
  }, request);
}
