import { connection } from "next/server";
import { z } from "zod";
import { body, chatViewer, gone, refused, signUp, tooOften } from "@/server/chat/http";
import { stopLive } from "@/server/chat/live";
import { cancelPending } from "@/server/chat/pending";
import { deleteThread, getPrefs, getThread, renameThread, setArchived } from "@/server/chat/store";

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

const Patch = z.object({ title: z.string().max(200).optional(), archived: z.boolean().optional() });

/** Rename a chat, or archive it (it leaves the list, kept under Archived) and bring it back. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/chat/threads/[id]">) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const limited = tooOften(v.who);
  if (limited) return limited;
  const { id } = await ctx.params;
  const p = Patch.safeParse(await body(request));
  if (!p.success || (p.data.title === undefined && p.data.archived === undefined)) return Response.json({ error: "Give the chat a name." }, { status: 400 });
  try {
    let t = p.data.title !== undefined ? renameThread(v.who, id, p.data.title) : null;
    if (p.data.archived !== undefined) t = setArchived(v.who, id, p.data.archived);
    return Response.json(t);
  } catch (e) {
    return refused(e);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/chat/threads/[id]">) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const { id } = await ctx.params;
  cancelPending(v.who, id);
  stopLive(v.who, id);
  return deleteThread(v.who, id) ? Response.json({ ok: true }) : gone();
}
