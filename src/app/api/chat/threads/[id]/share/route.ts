import { z } from "zod";
import { body, chatViewer, refused, signUp, tooOften } from "@/server/chat/http";
import { shareThread, unshareThread } from "@/server/chat/store";

const Post = z.object({ messageIds: z.array(z.string().max(60)).max(40).nullish() });

/**
 * Share a chat at a public link: a copy of its last messages (or the ones picked) as they are now. Nothing is public
 * until the person does this, and sharing again makes a new link (the old one stops working).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/chat/threads/[id]/share">) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const limited = tooOften(v.who, "share", 10);
  if (limited) return limited;
  const { id } = await ctx.params;
  const p = Post.safeParse(await body(request));
  if (!p.success) return Response.json({ error: "Pick the messages to share." }, { status: 400 });
  try {
    const s = shareThread(v.who, id, { messageIds: p.data.messageIds });
    return Response.json({ token: s.token, path: `/c/${s.token}`, snapshot: s.snapshot }, { status: 201 });
  } catch (e) {
    return refused(e);
  }
}

/** Stop sharing: the link stops working at once. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/chat/threads/[id]/share">) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const { id } = await ctx.params;
  unshareThread(v.who, id);
  return Response.json({ ok: true });
}
