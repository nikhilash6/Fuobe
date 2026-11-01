import { z } from "zod";
import { handle, rereadSeries } from "@/server/content-factory";
import { body } from "@/server/faceless";

const Read = z.object({ engine: z.enum(["cloud", "open"]) });

/** Read the reference clip again (on either engine). */
export async function POST(request: Request, ctx: RouteContext<"/api/content-factory/series/[id]/read">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(await rereadSeries(id, (await body(request, Read, "Pick an engine")).engine));
  }, request);
}
