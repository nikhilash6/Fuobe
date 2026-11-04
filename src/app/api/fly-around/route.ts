import { bodyTooBig, guestRun, toolViewer, toolWishes } from "@/server/account-tool-run";
import { body, handle, once } from "@/server/shorts-schemas";
import { createFlyAround, FlyAroundSchema, previewFlyAround } from "@/server/fly-around";
import { bodyFiles, runToolForAccount, withPoolPrice } from "@/server/tool-runs";
import { priceAs } from "@/server/visitor";
import { worldcastContextNow } from "@/server/worldcast-on";

/**
 * Fly around: a still filmed along an exact camera path (an orbit's numbers, a preset or keys), on either
 * engine. `?preview=1` plans and prices it without running it. Fuobe DoP, Image to 3D, Canvas and Assist call it.
 *
 * The owner's run as always; an account's with only its own pictures, after the checks every tool run gets
 * (src/server/tool-runs.ts); a guest signs up first.
 */
async function post(request: Request) {
  return handle(async () => {
    const viewer = toolViewer(request);
    const wishes = viewer.kind === "owner" ? {} : await toolWishes(request);
    const { requestId, ...input } = await body(request, FlyAroundSchema, "Pick the engine, the still and the path");
    // The WorldCast worker's answer, fresh, before the plan reads it (N7-9).
    await worldcastContextNow();
    const start = () => createFlyAround(input);
    if (new URL(request.url).searchParams.get("preview")) return Response.json(await withPoolPrice(request, previewFlyAround(input), start, wishes.place));
    if (viewer.kind === "account") {
      return runToolForAccount(request, viewer.account, {
        tool: "fly-around",
        files: bodyFiles(input),
        requestId,
        wishes,
        start,
        ok: (value, gpuWarning) => Response.json({ ...value, ...(gpuWarning && { gpuWarning }) }, { status: 201 }),
      });
    }
    // A plan that can't run (FlyAroundError) is a 422 with its reason, as any planner's error is.
    const result = await once("fly-around", requestId, start);
    return Response.json(result, { status: 201 });
  }, request);
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  const viewer = toolViewer(request);
  const preview = !!new URL(request.url).searchParams.get("preview");
  if (viewer.kind === "guest" && !preview) return guestRun();
  if (viewer.kind === "account" && !preview) return bodyTooBig(request) ?? post(request);
  return priceAs(request, () => post(request));
}
