import { createGenjutsu, GenjutsuBodySchema } from "@/server/genjutsu";
import { body, handle, once } from "@/server/shorts-schemas";

/** Run a Genjutsu: the pieces or windows are made, joined, and the clip's sound put back. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, GenjutsuBodySchema, "Add a clip, pick a mode and add your references");
    // A repeated requestId (a second click on Generate) gets the run the first one started.
    const { final, items } = await once("genjutsu", input.requestId, () => createGenjutsu(input));
    return Response.json({ final, items }, { status: 201 });
  }, request);
}
