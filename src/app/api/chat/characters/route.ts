import { connection } from "next/server";
import { z } from "zod";
import { copyPicture, ownPicture } from "@/server/chat/files";
import { body, chatViewer, refused, signUp, tooOften } from "@/server/chat/http";
import { CharacterBody } from "@/server/chat/schemas";
import { createCharacter, findChatShare, getCharacter, getPrefs, listCharacters } from "@/server/chat/store";

/** The characters this person can chat with: their own first, then the built-in ones. Mature ones only in Mango Chilli mode. */
export async function GET(request: Request) {
  await connection();
  const v = chatViewer(request);
  if (!v) return signUp();
  return Response.json({ items: listCharacters(v.who, getPrefs(v.who).mature) });
}

const Post = CharacterBody.extend({
  /** Make a copy of the character in a shared chat ("Chat with them"). */
  fromShare: z.string().max(64).optional(),
});

/** Make a character (or copy one from a shared chat). */
export async function POST(request: Request) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const limited = tooOften(v.who, "characters", 20);
  if (limited) return limited;
  const p = Post.safeParse(await body(request));
  if (!p.success) return Response.json({ error: "That character couldn't be read." }, { status: 400 });
  const mature = getPrefs(v.who).mature;
  try {
    if (p.data.fromShare) {
      const s = findChatShare(p.data.fromShare);
      const c = s?.snapshot.character;
      if (!s || !c) return Response.json({ error: "That shared chat has no character to copy." }, { status: 404 });
      if (s.snapshot.mature && !mature) return Response.json({ error: "Turn on Mango Chilli mode to chat with this character.", code: "mature-off" }, { status: 403 });
      // A built-in character needs no copy: chat with it as it is.
      if (c.builtIn) return Response.json(getCharacter(v.who, c.id), { status: 200 });
      // The person who shared it keeps their own wording private: the copy takes the name, look and the shared lines'
      // voice, and the new owner can change it.
      const source = getCharacter(s.owner, c.id);
      if (!source) return Response.json({ error: "That character was deleted by the person who shared it." }, { status: 404 });
      const portrait = s.portrait ? await copyPicture(v.who, s.portrait) : null;
      return Response.json(
        createCharacter(v.who, { name: source.name, tagline: source.tagline, persona: source.persona, scenario: source.scenario, greeting: source.greeting, mature: source.mature, accent: source.accent, portrait }),
        { status: 201 },
      );
    }
    if (p.data.mature && !mature) return Response.json({ error: "Turn on Mango Chilli mode to make a mature character.", code: "mature-off" }, { status: 403 });
    const portrait = p.data.portrait ? ownPicture(v.who, p.data.portrait) : null;
    if (p.data.portrait && !portrait) return Response.json({ error: "That portrait couldn't be read. Pick it again." }, { status: 400 });
    return Response.json(createCharacter(v.who, { ...p.data, portrait }), { status: 201 });
  } catch (e) {
    return refused(e);
  }
}
