import { applyChange, body, ChangeSchema, episodeView, handle, previewChange } from "@/server/faceless";

/**
 * The timeline editor: `{ blocks, part, instruction | narration }` returns what the change re-runs and its
 * price; with `apply: true` it re-runs those steps (that block's picture or clips, the joins after it,
 * the mix and the subtitles, or the narration).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/faceless/episodes/[id]/change">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const c = await body(request, ChangeSchema, "Pick a scene and describe the change");
    if (!c.apply) return Response.json(previewChange(id, c));
    applyChange(id, c);
    return Response.json(episodeView(id), { status: 201 });
  }, request);
}
