import { body, handle } from "@/server/shorts-schemas";
import { stopTake, TakeRefSchema } from "@/server/swap-studio";

/** Stop a take (waiting: it doesn't run; running: it is canceled, and the takes waiting on it stop too). */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/takes/stop">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(await stopTake(id, await body(request, TakeRefSchema, "Pick a take")));
  }, request);
}
