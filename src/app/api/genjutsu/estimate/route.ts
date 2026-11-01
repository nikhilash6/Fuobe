import { estimateGenjutsu, GenjutsuEstimateSchema } from "@/server/genjutsu";
import { body, handle } from "@/server/shorts-schemas";
import { priceAs } from "@/server/visitor";

/** The price, the model, the pieces and the notes for the current settings, before anything runs. */
async function post(request: Request) {
  return handle(async () => {
    const input = await body(request, GenjutsuEstimateSchema, "Add a clip and pick a mode");
    return Response.json(await estimateGenjutsu(input));
  });
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
