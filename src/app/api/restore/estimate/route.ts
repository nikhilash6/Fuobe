import { estimateRestore, RestoreEstimateSchema } from "@/server/restore";
import { body, handle } from "@/server/shorts-schemas";
import { priceAs } from "@/server/visitor";

/** The price, the windows or pieces and the notes for the current settings, before anything runs ("Free" on your GPU). */
async function post(request: Request) {
  return handle(async () => {
    const input = await body(request, RestoreEstimateSchema, "Add the clip to restore and pick an engine");
    return Response.json(estimateRestore(input));
  });
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
