import { connection } from "next/server";
import { z } from "zod";
import { deleteProject, LayersError, parseDoc, projectView, updateProject } from "@/server/layers";

const Patch = z.object({
  name: z.string().max(200).optional(),
  /** Autosave: the document as the editor shows it, written into the head version. */
  doc: z.unknown().optional(),
  /** The head version the editor started from (a mismatch means another tab saved a version). */
  versionId: z.string().max(40).optional(),
  /** The card's cover: a small JPEG/WebP data URL of the composite. */
  cover: z.string().max(300_000).optional(),
});

/** The project, its versions, the head document and its tools' jobs (with their results). */
export async function GET(_req: Request, ctx: RouteContext<"/api/layers/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const view = projectView(id);
  return view ? Response.json(view) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/layers/[id]">) {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid change" }, { status: 400 });
  const doc = parsed.data.doc === undefined ? undefined : parseDoc(parsed.data.doc);
  if (doc === null) return Response.json({ error: "Those layers couldn't be saved" }, { status: 400 });
  try {
    const p = updateProject(id, { name: parsed.data.name, doc, versionId: parsed.data.versionId, cover: parsed.data.cover });
    return p ? Response.json(p) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof LayersError ? e.status : 422 });
  }
}

/** Delete the project and all of its versions; its images stay in the library. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/layers/[id]">) {
  const { id } = await ctx.params;
  return deleteProject(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
