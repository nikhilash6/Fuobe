import { body, handle } from "@/server/shorts-schemas";
import { stopJob, StopSchema } from "@/server/swap-studio";

/** Stop a mask, anchor, transcript, 24 fps copy or assembly that is still being made. */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/stop">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(await stopJob(id, await body(request, StopSchema, "Pick a job to stop")));
  }, request);
}
