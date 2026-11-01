import { createMixed } from "@/server/mixed-media";
import { MixedBodySchema, body, handle, once } from "@/server/shorts-schemas";

/** Render a Mixed Media video (open: per frame; cloud: cut → frames or restyle → original sound). `items` leaves out the per-frame edits (`frames` counts them). */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, MixedBodySchema, "Pick a preset, upload a clip and choose up to 10 seconds");
    // A repeated requestId (a second click on Generate video) gets the render the first one started.
    const { final, items, frames } = await once("mixed-render", input.requestId, () => createMixed(input));
    return Response.json({ final, items, frames }, { status: 201 });
  }, request);
}
