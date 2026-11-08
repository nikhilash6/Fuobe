import { connection } from "next/server";
import { z } from "zod";
import { CHAT_LIMITS, isChatKind } from "@/lib/chat/catalog";
import { ownPicture } from "@/server/chat/files";
import { body, chatViewer, refused, signUp, tooOften } from "@/server/chat/http";
import { addMessage, createThread, getPrefs, getThread, listThreads } from "@/server/chat/store";

/** The person's chats, newest first (`?q=` finds by title). */
export async function GET(request: Request) {
  await connection();
  const v = chatViewer(request);
  if (!v) return signUp();
  const sp = new URL(request.url).searchParams;
  const q = sp.get("q") ?? undefined;
  return Response.json({ items: listThreads(v.who, { mature: getPrefs(v.who).mature, q, archived: sp.get("archived") === "1" }) });
}

const Post = z.object({
  kind: z.string().refine(isChatKind),
  characterId: z.string().max(60).nullish(),
  tool: z.string().max(40).nullish(),
  play: z.string().max(40).nullish(),
  /** The first message: the chat is made with it, and the thread page asks for the reply. */
  text: z.string().max(CHAT_LIMITS.messageChars).nullish(),
  image: z.string().max(400).nullish(),
});

/** Start a chat. A character's chat opens with their greeting. */
export async function POST(request: Request) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const limited = tooOften(v.who, "new", 20);
  if (limited) return limited;
  const p = Post.safeParse(await body(request));
  if (!p.success) return Response.json({ error: "That chat couldn't be started." }, { status: 400 });
  const image = p.data.image ? ownPicture(v.who, p.data.image) : null;
  if (p.data.image && !image) return Response.json({ error: "That picture couldn't be read. Add it again." }, { status: 400 });
  try {
    const t = createThread(v.who, { kind: p.data.kind as never, characterId: p.data.characterId, tool: p.data.tool, play: p.data.play, mature: getPrefs(v.who).mature });
    const text = p.data.text?.trim();
    if (text || image) addMessage(v.who, t.id, "user", text ?? "", image);
    return Response.json(getThread(v.who, t.id), { status: 201 });
  } catch (e) {
    return refused(e);
  }
}
