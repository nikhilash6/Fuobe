import { connection } from "next/server";
import { z } from "zod";
import { BlockSchema, body, deleteEpisode, episodeView, handle, SettingsSchema, updateEpisode } from "@/server/faceless";

const Patch = z.object({
  title: z.string().max(120).optional(),
  favorite: z.boolean().optional(),
  blocks: z.array(BlockSchema).min(1, "Keep at least one scene").max(80, "Up to 80 scenes").optional(),
  settings: SettingsSchema.partial().optional(),
});

/** The episode with every step's generation, its progress, spend and estimate. */
export async function GET(_req: Request, ctx: RouteContext<"/api/faceless/episodes/[id]">) {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(episodeView(id));
  });
}

/** Rename, like, or (before rendering) edit the script and settings. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/faceless/episodes/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = await body(request, Patch, "Those changes aren't valid");
    updateEpisode(id, patch);
    return Response.json(episodeView(id));
  }, request);
}

/** Deletes the episode and stops what it still renders (its finished videos stay in the Library). */
export async function DELETE(request: Request, ctx: RouteContext<"/api/faceless/episodes/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    await deleteEpisode(id);
    return new Response(null, { status: 204 });
  }, request);
}
