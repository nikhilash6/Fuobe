import { priceAsRun, toolPriceCheck } from "@/server/account-tool-run";
import { estimateShorts, planSessionRun, shortsSteps } from "@/server/shorts";
import { ShortsEstimateSchema, body, handle } from "@/server/shorts-schemas";

/**
 * What a session would cost (or that it runs as a demo), how many segments it makes, and notes. A visitor (public
 * sign-up) gets the price of its run as it would go: an account's on its own GPU or its own key (with its own presets),
 * a guest's on the open engine; never a demo (src/server/account-tool-run.ts priceAsRun). A run that would go to this
 * install's GPUs adds `{ place: "pool", quote, line }` (toolPriceCheck), as every tool's price check does.
 */
export async function POST(request: Request) {
  return priceAsRun(request, () =>
    handle(async () => {
      const input = await body(request, ShortsEstimateSchema, "Pick a preset and the part of the clip to restyle");
      const estimate = await estimateShorts(input);
      const pool = await toolPriceCheck(request, async () => shortsSteps((await planSessionRun(input)).plan.steps));
      return Response.json(pool ? { ...estimate, ...pool } : estimate);
    }),
  );
}
