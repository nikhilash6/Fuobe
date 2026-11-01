import { estimateShorts } from "@/server/shorts";
import { ShortsEstimateSchema, body, handle } from "@/server/shorts-schemas";
import { priceAs } from "@/server/visitor";

/** What a session would cost (or that it runs as a demo), how many segments it makes, and notes. */
async function post(request: Request) {
  return handle(async () => {
    const input = await body(request, ShortsEstimateSchema, "Pick a preset and the part of the clip to restyle");
    return Response.json(await estimateShorts(input));
  });
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
