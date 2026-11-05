import { z } from "zod";
import { asViewer, guestRun, onceForAccount, pressIdOf, runAccountTool, toolViewer } from "@/server/account-tool-run";
import { handle, rereadSeries, rereadSteps, seriesClip } from "@/server/content-factory";
import { body } from "@/server/faceless";
import { planned } from "@/server/faceless-account";

const Read = z.object({ engine: z.enum(["cloud", "open"]) });

/**
 * Read the reference clip again (on either engine). An account's runs on its own GPU or key, on its own clip, after the
 * checks a studio run gets (src/server/account-tool-run.ts); a guest signs up first.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/content-factory/series/[id]/read">) {
  const viewer = toolViewer(request);
  if (viewer.kind === "guest") return guestRun();
  return handle(async () => {
    const { id } = await ctx.params;
    const { engine } = await body(request, Read, "Pick an engine");
    if (viewer.kind === "owner") return Response.json(await rereadSeries(id, engine));
    const clip = asViewer(viewer, () => seriesClip(id));
    // A resend of the same press (the page's id in its header) gets the reading the first one started.
    return onceForAccount(
      viewer.account,
      `content-factory-read:${id}`,
      pressIdOf(request),
      () => runAccountTool(request, viewer.account, { tool: "content-factory", files: [clip], plan: () => planned(() => rereadSteps(id, engine)), start: () => rereadSeries(id, engine) }),
      ({ value, gpuWarning }) => Response.json({ ...value, ...(gpuWarning && { gpuWarning }) }),
    );
  }, request);
}
