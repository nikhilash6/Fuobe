import { connection } from "next/server";
import { z } from "zod";
import { deleteMoodboard, getMoodboard, renameMoodboard } from "@/server/moodboards";

const Patch = z.object({ name: z.string().max(200) });

export async function GET(_req: Request, ctx: RouteContext<"/api/moodboards/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const m = getMoodboard(id);
  return m ? Response.json(m) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/moodboards/[id]">) {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please enter a moodboard name" }, { status: 400 });
  try {
    return Response.json(renameMoodboard(id, parsed.data.name));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: /not found/i.test((e as Error).message) ? 404 : 400 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/moodboards/[id]">) {
  const { id } = await ctx.params;
  return deleteMoodboard(id) ? new Response(null, { status: 204 }) : Response.json({ error: "Not found" }, { status: 404 });
}
