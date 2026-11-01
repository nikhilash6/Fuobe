import { body, handle } from "@/server/shorts-schemas";
import { QueueSchema, queueTakes } from "@/server/swap-studio";

/** Queue segment / Queue from here / Queue all segments: a take for each, continuations waiting for what they continue from. */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/queue">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(queueTakes(id, await body(request, QueueSchema, "Pick a segment to queue")), { status: 201 });
  }, request);
}
