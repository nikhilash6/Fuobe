import { asViewer, guestRun, onceForAccount, pressIdOf, runAccountTool, toolViewer } from "@/server/account-tool-run";
import { applyChange, body, ChangeSchema, changeGraph, episodeView, graphFiles, graphToolSteps, handle, previewChange } from "@/server/faceless";
import { planned } from "@/server/faceless-account";

/**
 * The timeline editor: `{ blocks, part, instruction | narration }` returns what the change re-runs and its
 * price; with `apply: true` it re-runs those steps (that block's picture or clips, the joins after it,
 * the mix and the subtitles, or the narration). An account's change runs on its own GPU or key, after the checks a
 * studio run gets (src/server/account-tool-run.ts).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/faceless/episodes/[id]/change">) {
  const viewer = toolViewer(request);
  if (viewer.kind === "guest") return guestRun();
  return handle(async () => {
    const { id } = await ctx.params;
    const c = await body(request, ChangeSchema, "Pick a scene and describe the change");
    if (!c.apply) return Response.json(asViewer(viewer, () => previewChange(id, c)));
    if (viewer.kind === "owner") {
      applyChange(id, c);
      return Response.json(episodeView(id), { status: 201 });
    }
    const graph = asViewer(viewer, () => changeGraph(id, c));
    // A resend of the same press (the page's id in its header) gets the change the first one started.
    return onceForAccount(
      viewer.account,
      `faceless-change:${id}`,
      pressIdOf(request),
      () => runAccountTool(request, viewer.account, { tool: "faceless", files: graphFiles(graph), plan: () => planned(() => graphToolSteps(changeGraph(id, c))), start: () => applyChange(id, c) }),
      ({ gpuWarning }) => Response.json({ ...asViewer(viewer, () => episodeView(id)), ...(gpuWarning && { gpuWarning }) }, { status: 201 }),
    );
  }, request);
}
