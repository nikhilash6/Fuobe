import { connection } from "next/server";
import { z } from "zod";
import { deleteSession, getSession, regenerateCost, renameSession } from "@/server/shorts";
import { body, handle } from "@/server/shorts-schemas";

/** The session with its generations (segments, takes, stitches) and what one more take costs. */
export async function GET(_req: Request, ctx: RouteContext<"/api/shorts/sessions/[id]">) {
  await connection();
  return handle(async () => {
    const { id } = await ctx.params;
    const s = getSession(id);
    return Response.json({ ...s, regenerateUsd: regenerateCost(s) });
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/shorts/sessions/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { title } = await body(request, z.object({ title: z.string().trim().min(1).max(120) }), "Give the short a name");
    return Response.json(renameSession(id, title));
  }, request);
}

/** Delete the session; its videos move to the Trash unless ?keep=1. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/shorts/sessions/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const keep = new URL(request.url).searchParams.get("keep") === "1";
    return Response.json({ trashed: deleteSession(id, { keep }) });
  }, request);
}
