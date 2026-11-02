import { body, handle, once } from "@/server/shorts-schemas";
import { createFlyAround, FlyAroundSchema, previewFlyAround } from "@/server/fly-around";
import { priceAs } from "@/server/visitor";

/**
 * Fly around (build plan N7-7): a still filmed along an exact camera path (an orbit's numbers, a preset or keys), on either
 * engine. `?preview=1` plans and prices it without running it. Fuobe DoP, Image to 3D, Canvas and Assist call it.
 */
async function post(request: Request) {
  return handle(async () => {
    const { requestId, ...input } = await body(request, FlyAroundSchema, "Pick the engine, the still and the path");
    if (new URL(request.url).searchParams.get("preview")) return Response.json(previewFlyAround(input));
    // A plan that can't run (FlyAroundError) is a 422 with its reason, as any planner's error is.
    const result = await once("fly-around", requestId, () => createFlyAround(input));
    return Response.json(result, { status: 201 });
  }, request);
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
