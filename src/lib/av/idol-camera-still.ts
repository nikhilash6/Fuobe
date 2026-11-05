import type { Generation, OutputFile } from "@/lib/catalog/types";

/**
 * Idol 3D's clean graph (image-to-splat-idol-clean) saves, beside the splat and its orbit, a still of the input view
 * (role "preview") rendered from the camera Idol predicts. That camera can miss a product seen side on: the red stiletto
 * in profile comes out as a few coloured squares on black, while the same run's orbit is clean from every side. Nothing
 * here can tell a good one from a collapsed one, so the still is never a result's cover, poster, tile or shown piece:
 * the orbit (its still, else its first frame) and the photo stand in. Every place that lists a result's outputs or picks
 * its picture asks here: the card (model3d.ts), the Library and feed Viewer and tiles (output-actions.ts modelPreview),
 * share and Publish pages (output-actions.ts sharedOutputs), Assist's chat and project tiles.
 */

/** Whether a splat came from the clean graph: its saved file says it was pruned (the core graph's says it wasn't). */
export const isIdolClean = (meta: Record<string, unknown> | undefined) => meta?.pruned === true;

/** The URLs of a result's camera stills: its role "preview" pictures when it holds a clean Idol splat, else none. */
export function idolCameraStills(g: Pick<Generation, "outputs">): Set<string> {
  if (!g.outputs.some((o) => o.kind === "model3d" && isIdolClean(o.meta))) return new Set();
  return new Set(g.outputs.filter((o) => o.kind === "image" && o.meta?.role === "preview").map((o) => o.url));
}

/** Whether an output is a clean Idol splat's camera still (see above): never a cover, poster, tile or shown piece. */
export function isIdolCameraStill(g: Pick<Generation, "outputs">, o: Pick<OutputFile, "kind" | "url">): boolean {
  return o.kind === "image" && idolCameraStills(g).has(o.url);
}

/** A result's outputs (their indexes, in order) without a camera still: the pieces a chat, a project or a page shows. */
export function showableOutputs(g: Pick<Generation, "outputs">): number[] {
  const still = idolCameraStills(g);
  return g.outputs.flatMap((o, i) => (o.kind === "image" && still.has(o.url) ? [] : [i]));
}
