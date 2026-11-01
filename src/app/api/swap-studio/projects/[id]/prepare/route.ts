import { z } from "zod";
import { body, handle } from "@/server/shorts-schemas";
import { prepareClip } from "@/server/swap-studio";

const Prepare = z.object({ clipId: z.string().min(1).max(80) });

/** Your GPU: make the clip's 24 fps copy (again). The cloud: its browser copy, when the page can't play the clip. */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/prepare">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(prepareClip(id, (await body(request, Prepare, "Pick a clip")).clipId));
  }, request);
}
