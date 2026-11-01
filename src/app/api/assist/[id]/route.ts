import { connection } from "next/server";
import { z } from "zod";
import { AssistBusyError, deleteThread, getThread, updateThread } from "@/server/assist/agent";
import { ModeChoice } from "@/server/assist/schemas";

const Patch = z.object({
  autoApprove: z.boolean().optional(),
  title: z.string().trim().min(1).max(80).optional(),
  projectId: z.string().max(40).nullable().optional(),
  mode: ModeChoice.optional(),
});

export async function GET(_req: Request, ctx: RouteContext<"/api/assist/[id]">) {
  await connection();
  const view = getThread((await ctx.params).id);
  return view ? Response.json(view) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Ask-first, rename, move into or out of a project, or switch the mode (Free / Smart / Manual). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/assist/[id]">) {
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid change" }, { status: 400 });
  try {
    const t = await updateThread((await ctx.params).id, parsed.data);
    return t ? Response.json(t) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof AssistBusyError ? 409 : 400 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/assist/[id]">) {
  deleteThread((await ctx.params).id);
  return new Response(null, { status: 204 });
}
