import { z } from "zod";
import { checkOpenRouterKey } from "@/server/chat/backend";
import { body, chatViewer, signUp, tooOften } from "@/server/chat/http";
import { removeChatKey, saveChatKey } from "@/server/chat/store";

const Put = z.object({
  key: z
    .string()
    .trim()
    .regex(/^sk-or-[\w-]{20,200}$/),
  model: z
    .string()
    .trim()
    .regex(/^[\w.:/-]{3,120}$/)
    .nullish(),
});

/**
 * Save the person's own OpenRouter key for chat, checked with OpenRouter first (a free call). It is sealed on the
 * server and never sent back; only its last four characters show.
 */
export async function PUT(request: Request) {
  const v = chatViewer(request);
  if (!v) return signUp();
  // A check reaches OpenRouter: a few a minute.
  const limited = tooOften(v.who, "key", 6);
  if (limited) return limited;
  const p = Put.safeParse(await body(request));
  if (!p.success) return Response.json({ error: "That doesn't look like an OpenRouter key. It starts with sk-or-." }, { status: 400 });
  const check = await checkOpenRouterKey(p.data.key);
  if (check === "refused") return Response.json({ error: "OpenRouter didn't accept that key. Copy it again from openrouter.ai/settings/keys." }, { status: 422 });
  if (check === "unreachable") return Response.json({ error: "Couldn't reach OpenRouter to check the key. Try again in a moment." }, { status: 503 });
  const prefs = saveChatKey(v.who, p.data.key, p.data.model ?? null);
  return Response.json({ key: prefs.key, engine: prefs.engine });
}

export async function DELETE(request: Request) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const prefs = removeChatKey(v.who);
  return Response.json({ key: prefs.key, engine: prefs.engine });
}
