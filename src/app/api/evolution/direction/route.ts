import { DirectionSchema, writeDirection } from "@/server/evolution";
import { body, handle } from "@/server/shorts-schemas";

/** Write the creative direction from the references and your words: Claude, Ollama, or Fuobe's offline writer. Never generates. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, DirectionSchema, "Pick how much should change, then add references or a few words");
    return Response.json(await writeDirection(input));
  }, request);
}
