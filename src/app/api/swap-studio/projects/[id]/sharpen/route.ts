import { body, handle } from "@/server/shorts-schemas";
import { SharpenSchema, sharpenClip } from "@/server/swap-studio";

/** Sharpen: every chosen take of a clip made sharper at 1080p, 2K or 4K, each a version beside its take to compare. */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/sharpen">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(await sharpenClip(id, await body(request, SharpenSchema, "Pick a clip and a size")), { status: 201 });
  }, request);
}
