import { finishTake } from "@/server/cinema";
import { handle } from "@/server/cinema-schemas";

/** Finish in 2K: a MiniMax H3 take made again at 2K (fal), or redrawn at 2K on your GPU (Open-H3 Regenerate), same folder. */
export async function POST(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/items/[generationId]/finish">) {
  return handle(async () => {
    const { id, generationId } = await ctx.params;
    return Response.json({ items: finishTake(id, generationId) }, { status: 201 });
  }, request);
}
