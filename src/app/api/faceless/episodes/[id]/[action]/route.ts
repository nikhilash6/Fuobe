import { episodeView, handle, regenerateEpisode, renderEpisode, retryEpisode, rewriteEpisode, undoChange, upscaleEpisode } from "@/server/faceless";

const ACTIONS = {
  /** Render the reviewed script. */
  render: renderEpisode,
  /** Redo the failed steps and what waited on them. */
  retry: retryEpisode,
  /** Write the script again. */
  rewrite: rewriteEpisode,
  /** Go back to the version before the last change. */
  undo: undoChange,
  /** Upscale the finished film to 1080p (cloud). */
  upscale: upscaleEpisode,
  /** Redraw every scene at 1080p with Open-H3 Regenerate, then join and mix again (open engine). */
  regenerate: regenerateEpisode,
} as const;

export async function POST(request: Request, ctx: RouteContext<"/api/faceless/episodes/[id]/[action]">) {
  return handle(async () => {
    const { id, action } = await ctx.params;
    const run = ACTIONS[action as keyof typeof ACTIONS];
    if (!run) return Response.json({ error: "Not found" }, { status: 404 });
    run(id);
    return Response.json(episodeView(id));
  }, request);
}
