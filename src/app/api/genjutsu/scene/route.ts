import { requestViewer } from "@/server/auth";
import { describeScene, SceneSchema } from "@/server/genjutsu";
import { body, handle } from "@/server/shorts-schemas";

/** From picture's "What happens": starts the describer on the part; the page waits for its text (a generation). */
export async function POST(request: Request) {
  return handle(async () => {
    const input = await body(request, SceneSchema, "Make and pick the first frame first");
    return Response.json(describeScene(input, { owner: requestViewer(request).kind === "owner" }), { status: 201 });
  }, request);
}
