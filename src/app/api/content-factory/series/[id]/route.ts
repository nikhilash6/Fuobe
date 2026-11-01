import { connection } from "next/server";
import { z } from "zod";
import { BriefSchema, deleteSeries, handle, seriesView, updateSeries } from "@/server/content-factory";
import { body } from "@/server/faceless";

const Patch = z.object({ brief: BriefSchema.optional(), name: z.string().max(60).optional() });

/** The series: its reference, how far reading it has got, the brief, the plan and the episodes. */
export async function GET(_req: Request, ctx: RouteContext<"/api/content-factory/series/[id]">) {
  await connection();
  return handle(async () => Response.json(seriesView((await ctx.params).id)));
}

/** Edit the brief by hand, or rename the series. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/content-factory/series/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(updateSeries(id, await body(request, Patch, "That brief isn't valid")));
  }, request);
}

/**
 * Deletes the series and its channel, stopping what its episodes still render (finished videos stay in the Library).
 * `?draft=1` deletes only a draft that was never made (the composer moving on from a clip it was reading).
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/content-factory/series/[id]">) {
  return handle(async () => {
    await deleteSeries((await ctx.params).id, { draftOnly: new URL(request.url).searchParams.get("draft") === "1" });
    return new Response(null, { status: 204 });
  }, request);
}
