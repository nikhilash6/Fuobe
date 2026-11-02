import { createRemovalReroll, RerollSchema } from "@/server/remove-object";
import { body, handle, once } from "@/server/shorts-schemas";

/** "Redo from here": an H3 person removal drawn again from one window, the windows before it kept exactly. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, RerollSchema, "Pick the window to redo");
    const made = await once("remove-object-reroll", input.requestId, () => createRemovalReroll(input));
    return Response.json(made, { status: 201 });
  }, request);
}
