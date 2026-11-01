import { duplicateCanvas } from "@/server/canvas";

/** "Copy of {name}", with the same nodes and results. */
export async function POST(_req: Request, ctx: RouteContext<"/api/canvases/[id]/duplicate">) {
  const { id } = await ctx.params;
  const c = duplicateCanvas(id);
  return c ? Response.json(c, { status: 201 }) : Response.json({ error: "Not found" }, { status: 404 });
}
