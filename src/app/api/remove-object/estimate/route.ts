import { estimateRemoval, planRemovalRun, RemovalEstimateSchema, removalSteps } from "@/server/remove-object";
import { poolPricedCheck } from "@/server/tool-runs";
import { body, handle } from "@/server/shorts-schemas";

/** The price, the pieces and the notes for the current settings, before anything runs. */
async function post(request: Request) {
  return handle(async () => {
    const input = await body(request, RemovalEstimateSchema, "Add a clip and pick how to point at what goes");
    return Response.json(await estimateRemoval(input));
  });
}

/**
 * Priced as the asker's run would go: an account's on its own GPU or key, a guest's on the open engine, never a demo;
 * with its place, price and line on this install's GPUs when the run would go there (poolPricedCheck).
 */
export async function POST(request: Request) {
  return poolPricedCheck(request, () => post(request), async (raw) => removalSteps(await planRemovalRun(RemovalEstimateSchema.parse(raw))));
}
