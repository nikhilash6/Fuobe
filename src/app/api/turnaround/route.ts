import { bodyTooBig, guestRun, toolViewer, toolWishes } from "@/server/account-tool-run";
import { requestViewer } from "@/server/auth";
import { recordExists } from "@/server/records";
import { body, handle, once } from "@/server/shorts-schemas";
import { bodyFiles, runToolForAccount, withPoolPrice } from "@/server/tool-runs";
import { createTurnaround, previewTurnaround, TurnaroundBodySchema, turnaroundRun } from "@/server/turnaround";
import { priceAs } from "@/server/visitor";
import { worldcastContextNow } from "@/server/worldcast-on";

/**
 * Turnaround video (build plan N7-6): a 360° turnaround of a cast sheet or a character, on either engine. `?preview=1` plans
 * and prices it (the route, the pictures drawn first, the film's frames, the GPU it needs) without running it.
 *
 * The owner's run as always; an account's with only its own pictures (characters are the owner's library), after the
 * checks every tool run gets (src/server/tool-runs.ts); a guest signs up first.
 */
async function post(request: Request) {
  return handle(async () => {
    const wishes = requestViewer(request).kind === "owner" ? {} : await toolWishes(request);
    const { requestId, ...input } = await body(request, TurnaroundBodySchema, "Pick the engine and the character's pictures");
    // Characters are the owner's library: a visitor (public sign-up) is never told whether one exists.
    if (input.elementId && (requestViewer(request).kind !== "owner" || !recordExists({ kind: "element", ids: [input.elementId] }))) {
      return Response.json({ error: "Character not found" }, { status: 404 });
    }
    await worldcastContextNow();
    const run = turnaroundRun(input);
    const start = () => createTurnaround(run);
    if (new URL(request.url).searchParams.get("preview")) return Response.json(await withPoolPrice(request, previewTurnaround(run), start, wishes.place));
    const viewer = toolViewer(request);
    if (viewer.kind === "account") {
      return runToolForAccount(request, viewer.account, {
        tool: "turnaround",
        files: bodyFiles(input),
        requestId,
        wishes,
        start,
        ok: (value, gpuWarning) => Response.json({ ...value, ...(gpuWarning && { gpuWarning }) }, { status: 201 }),
      });
    }
    const result = await once("turnaround", requestId, start);
    return Response.json(result, { status: 201 });
  });
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  const viewer = toolViewer(request);
  const preview = !!new URL(request.url).searchParams.get("preview");
  if (viewer.kind === "guest" && !preview) return guestRun();
  if (viewer.kind === "account" && !preview) return bodyTooBig(request) ?? post(request);
  return priceAs(request, () => post(request));
}
