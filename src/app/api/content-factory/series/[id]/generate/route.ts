import { z } from "zod";
import { generateSeries, handle, SeriesInputSchema } from "@/server/content-factory";
import { body } from "@/server/faceless";

const Generate = SeriesInputSchema.extend({ review: z.boolean().optional() });

/** "Generate here": plan the episodes, make the series' channel and start every episode. */
export async function POST(request: Request, ctx: RouteContext<"/api/content-factory/series/[id]/generate">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(await generateSeries(id, await body(request, Generate, "Say what the video is about and pick the settings")));
  }, request);
}
