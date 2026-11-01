import { AnchorSchema, makeAnchor } from "@/server/swap-studio";
import { body, handle } from "@/server/shorts-schemas";

/** A scene anchor for a shot (or a reference for a segment): your character put into its first frame. */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/anchors">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(makeAnchor(id, await body(request, AnchorSchema, "Pick a shot")), { status: 201 });
  }, request);
}
