import { estimateRemoval, RemovalEstimateSchema } from "@/server/remove-object";
import { body, handle } from "@/server/shorts-schemas";
import { priceAs } from "@/server/visitor";

/** The price, the pieces and the notes for the current settings, before anything runs. */
async function post(request: Request) {
  return handle(async () => {
    const input = await body(request, RemovalEstimateSchema, "Add a clip and pick how to point at what goes");
    return Response.json(await estimateRemoval(input));
  });
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
