import { z } from "zod";
import { createVersion, LayersError, parseDoc } from "@/server/layers";

const Body = z.object({
  doc: z.unknown().optional(),
  label: z.string().max(120).optional(),
  /** The tool job whose result this version holds (marked applied in the same step). */
  jobId: z.string().max(40).optional(),
  /** Restore: copy this older version into a new head. */
  from: z.string().max(40).optional(),
});

/** Save a version (a tool's result, or a restored older version); it becomes the head. */
export async function POST(request: Request, ctx: RouteContext<"/api/layers/[id]/versions">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid version" }, { status: 400 });
  const doc = parsed.data.doc === undefined ? undefined : parseDoc(parsed.data.doc);
  if (doc === null) return Response.json({ error: "Those layers couldn't be saved" }, { status: 400 });
  try {
    return Response.json(createVersion(id, { ...parsed.data, doc }), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof LayersError ? e.status : 422 });
  }
}
