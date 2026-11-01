import { estimateEvolution, EvolutionEstimateSchema } from "@/server/evolution";
import { body, handle } from "@/server/shorts-schemas";
import { priceAs } from "@/server/visitor";

/** The price, the pieces and the notes for the current settings, before anything runs ("Free" on your GPU). */
async function post(request: Request) {
  return handle(async () => {
    const input = await body(request, EvolutionEstimateSchema, "Add a clip and pick how much should change");
    return Response.json(estimateEvolution(input));
  });
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
