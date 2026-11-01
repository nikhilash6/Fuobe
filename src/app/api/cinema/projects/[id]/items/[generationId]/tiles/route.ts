import { setTiles } from "@/server/cinema";
import { TilesPut, body, handle } from "@/server/cinema-schemas";

/** The tiles the browser cut from a grid contact sheet (each already saved as an upload). */
export async function PUT(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/items/[generationId]/tiles">) {
  return handle(async () => {
    const { id, generationId } = await ctx.params;
    const b = await body(request, TilesPut, "Those tiles aren't valid");
    return Response.json(setTiles(id, generationId, b.tiles));
  });
}
