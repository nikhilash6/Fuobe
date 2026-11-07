import { body, chatViewer, refused, signUp, tooOften } from "@/server/chat/http";
import { ownPicture } from "@/server/chat/files";
import { deleteCharacter, getPrefs, updateCharacter } from "@/server/chat/store";
import { CharacterBody } from "@/server/chat/schemas";

/** Change one of the person's characters. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/chat/characters/[id]">) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const limited = tooOften(v.who, "characters", 30);
  if (limited) return limited;
  const { id } = await ctx.params;
  const p = CharacterBody.safeParse(await body(request));
  if (!p.success) return Response.json({ error: "That character couldn't be read." }, { status: 400 });
  if (p.data.mature && !getPrefs(v.who).mature) return Response.json({ error: "Turn on Mango Chilli mode to make a mature character.", code: "mature-off" }, { status: 403 });
  let portrait: string | null | undefined = undefined;
  if (p.data.portrait !== undefined) {
    portrait = p.data.portrait ? ownPicture(v.who, p.data.portrait) : null;
    if (p.data.portrait && !portrait) return Response.json({ error: "That portrait couldn't be read. Pick it again." }, { status: 400 });
  }
  try {
    return Response.json(updateCharacter(v.who, id, { ...p.data, ...(portrait !== undefined && { portrait }) }));
  } catch (e) {
    return refused(e);
  }
}

/** Delete one of the person's characters. Its chats stay. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/chat/characters/[id]">) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const { id } = await ctx.params;
  return deleteCharacter(v.who, id) ? Response.json({ ok: true }) : Response.json({ error: "That character isn't one of yours." }, { status: 404 });
}
