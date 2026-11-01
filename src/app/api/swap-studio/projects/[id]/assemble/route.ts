import { z } from "zod";
import { body, handle } from "@/server/shorts-schemas";
import { assemble } from "@/server/swap-studio";

const Assemble = z.object({ clipId: z.string().min(1).max(80) });

/** Assemble a clip: its chosen takes over the original timeline, with the clip's own sound. */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/assemble">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(assemble(id, (await body(request, Assemble, "Pick a clip")).clipId), { status: 201 });
  }, request);
}
