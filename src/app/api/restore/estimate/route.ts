import { estimateRestore, estimateRestoreSteps, RestoreEstimateSchema } from "@/server/restore";
import { body, handle } from "@/server/shorts-schemas";
import { poolPricedCheck } from "@/server/tool-runs";

/** The price, the windows or pieces and the notes for the current settings, before anything runs ("Free" on your GPU). */
async function post(request: Request) {
  return handle(async () => {
    const input = await body(request, RestoreEstimateSchema, "Add the clip to restore and pick an engine");
    return Response.json(estimateRestore(input));
  });
}

/**
 * Priced as the asker's run would go: a visitor's on its own GPU, never a demo; with its place and the price check's
 * answer on this install's GPUs when the run would go there (poolPricedCheck).
 */
export async function POST(request: Request) {
  return poolPricedCheck(request, () => post(request), (raw) => estimateRestoreSteps(RestoreEstimateSchema.parse(raw)));
}
