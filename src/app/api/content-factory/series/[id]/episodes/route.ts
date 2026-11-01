import { z } from "zod";
import { MAX_EPISODES } from "@/lib/catalog/content-factory";
import { addEpisodes, handle } from "@/server/content-factory";
import { body } from "@/server/faceless";

const More = z.object({
  count: z.number().int().min(1).max(MAX_EPISODES, `Up to ${MAX_EPISODES} episodes at a time`),
  next: z.string().max(1000).optional(),
  review: z.boolean().optional(),
});

/** "Next episode": plan and start more episodes after the ones already made. */
export async function POST(request: Request, ctx: RouteContext<"/api/content-factory/series/[id]/episodes">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(await addEpisodes(id, await body(request, More, "Say how many episodes to add")));
  }, request);
}
