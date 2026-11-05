import { estimateMixed, mixedSteps, planMixedRun } from "@/server/mixed-media";
import { poolPricedCheck } from "@/server/tool-runs";
import { MixedEstimateSchema, body, handle } from "@/server/shorts-schemas";

/** Frames, cost of the render and of a preview frame, and notes for the current settings. */
async function post(request: Request) {
  return handle(async () => {
    const input = await body(request, MixedEstimateSchema, "Pick a preset and the part of the clip to use");
    return Response.json(await estimateMixed(input));
  });
}

/**
 * Priced as the asker's run would go: an account's on its own GPU or key, a guest's on the open engine, never a demo;
 * with its place, price and line on this install's GPUs when the run would go there (poolPricedCheck).
 */
export async function POST(request: Request) {
  return poolPricedCheck(request, () => post(request), async (raw) => mixedSteps(await planMixedRun(MixedEstimateSchema.parse(raw))));
}
