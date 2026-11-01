import { retryItem } from "@/server/cinema";
import { handle } from "@/server/cinema-schemas";

/** Run a failed take again (same request, same folder). */
export async function POST(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/items/[generationId]/retry">) {
  return handle(async () => {
    const { id, generationId } = await ctx.params;
    return Response.json({ items: retryItem(id, generationId) }, { status: 201 });
  }, request);
}
