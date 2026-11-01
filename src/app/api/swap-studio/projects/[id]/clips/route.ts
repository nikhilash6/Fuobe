import { body, handle } from "@/server/shorts-schemas";
import { addClip, ClipSchema } from "@/server/swap-studio";

/** Add an uploaded clip (MP4, MOV, MKV, WebM or AVI, at most 149.66 s); on your GPU its 24 fps copy starts now. */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/clips">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(await addClip(id, await body(request, ClipSchema, "Upload a clip first")), { status: 201 });
  }, request);
}
