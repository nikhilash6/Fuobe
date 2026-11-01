import { requestViewer } from "@/server/auth";
import { recordExists } from "@/server/records";
import { body, handle, once } from "@/server/shorts-schemas";
import { createTurnaround, previewTurnaround, TurnaroundBodySchema, turnaroundRun } from "@/server/turnaround";
import { priceAs } from "@/server/visitor";

/**
 * Turnaround video (build plan N7-6): a 360° turnaround of a cast sheet or a character, on either engine. `?preview=1` plans
 * and prices it (the route, the pictures drawn first, the film's frames, the GPU it needs) without running it.
 */
async function post(request: Request) {
  return handle(async () => {
    const { requestId, ...input } = await body(request, TurnaroundBodySchema, "Pick the engine and the character's pictures");
    // Characters are the owner's library: a visitor (public sign-up) is never told whether one exists.
    if (input.elementId && (requestViewer(request).kind !== "owner" || !recordExists({ kind: "element", ids: [input.elementId] }))) {
      return Response.json({ error: "Character not found" }, { status: 404 });
    }
    const run = turnaroundRun(input);
    if (new URL(request.url).searchParams.get("preview")) return Response.json(previewTurnaround(run));
    const result = await once("turnaround", requestId, () => createTurnaround(run));
    return Response.json(result, { status: 201 });
  });
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
