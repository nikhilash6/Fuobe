import { connection } from "next/server";
import { z } from "zod";
import { body, chatViewer, gone, refused, signUp, tooOften } from "@/server/chat/http";
import { deleteThread, getPrefs, getThread, renameThread } from "@/server/chat/store";

/** One of the person's chats with its messages (another's reads as gone). */
export async function GET(request: Request, ctx: RouteContext<"/api/chat/threads/[id]">) {
  await connection();
  const v = chatViewer(request);
  if (!v) return signUp();
  const { id } = await ctx.params;
  const t = getThread(v.who, id);
  if (!t) return gone();
  if (t.mature && !getPrefs(v.who).mature) return Response.json({ error: "This chat is in Mango Chilli mode. Turn it on to open it.", code: "mature-off" }, { status: 403 });
  return Response.json(t);
}

const Patch = z.object({ title: z.string().max(200) });

export async function PATCH(request: Request, ctx: RouteContext<"/api/chat/threads/[id]">) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const limited = tooOften(v.who);
  if (limited) return limited;
  const { id } = await ctx.params;
  const p = Patch.safeParse(await body(request));
  if (!p.success) return Response.json({ error: "Give the chat a name." }, { status: 400 });
  try {
    return Response.json(renameThread(v.who, id, p.data.title));
  } catch (e) {
    return refused(e);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/chat/threads/[id]">) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const { id } = await ctx.params;
  return deleteThread(v.who, id) ? Response.json({ ok: true }) : gone();
}
