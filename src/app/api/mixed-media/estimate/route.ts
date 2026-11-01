import { estimateMixed } from "@/server/mixed-media";
import { MixedEstimateSchema, body, handle } from "@/server/shorts-schemas";
import { priceAs } from "@/server/visitor";

/** Frames, cost of the render and of a preview frame, and notes for the current settings. */
async function post(request: Request) {
  return handle(async () => {
    const input = await body(request, MixedEstimateSchema, "Pick a preset and the part of the clip to use");
    return Response.json(await estimateMixed(input));
  });
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
