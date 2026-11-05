import { ownGpuTool, toolViewer } from "@/server/account-tool-run";
import { enhanceSegment, ShortsError } from "@/server/shorts";
import { NonceSchema, handle, once, optionalBody } from "@/server/shorts-schemas";

/**
 * Enhance (H3 regenerate): a 1080p take of this segment, redrawn on your GPU (a repeated requestId gets the first answer).
 * The owner's only: it isn't offered on an account's own GPU yet.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/shorts/sessions/[id]/segments/[index]/enhance">) {
  if (toolViewer(request).kind !== "owner") return ownGpuTool();
  return handle(async () => {
    const { id, index } = await ctx.params;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0) throw new ShortsError("No such segment", 404);
    const { requestId } = await optionalBody(request, NonceSchema);
    return Response.json(await once(`shorts-enhance:${id}:${i}`, requestId, () => enhanceSegment(id, i)), { status: 201 });
  }, request);
}
