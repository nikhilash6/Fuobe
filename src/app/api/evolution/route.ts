import { createEvolution, EvolutionBodySchema } from "@/server/evolution";
import { body, handle, once } from "@/server/shorts-schemas";

/** Evolve a clip (Fuobe Evolution): the direction is written first when none is given; pieces are joined and the sound put back. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, EvolutionBodySchema, "Add a clip and pick how much should change");
    // A repeated requestId (a second click on Evolve) gets the run the first one started.
    const result = await once("evolution", input.requestId, () => createEvolution(input));
    return Response.json(result, { status: 201 });
  }, request);
}
