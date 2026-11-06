import { enhancePrompt, writeLyrics } from "@/server/enhance";
import { getModel } from "@/lib/catalog";
import { appliesOwnStyle } from "@/lib/catalog/applied-style";
import type { MediaKind, Operation } from "@/lib/catalog/types";

export async function POST(request: Request) {
  const { prompt, kind, op, target, seconds, max, modelId } = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    kind?: MediaKind;
    op?: Operation;
    /** "lyrics": Audio → Music's "Write the lyrics" (words to sing for the song `prompt` describes). */
    target?: "lyrics";
    seconds?: number;
    max?: number;
    /** The composer's model: one that puts its own look on the clip (an H3 Max look) gets no look of Fuobe's. */
    modelId?: string;
  };
  if (!prompt?.trim()) return Response.json({ error: "Empty prompt" }, { status: 400 });
  try {
    if (target === "lyrics") {
      const lyrics = await writeLyrics(prompt.slice(0, 4000), { seconds: Number(seconds) || undefined, max: Number(max) || undefined });
      if (!lyrics) return Response.json({ error: "Writing lyrics needs the AI helper: pick Claude or a local model in Settings → AI helper", code: "no-llm" }, { status: 503 });
      return Response.json({ lyrics });
    }
    const ownStyle = !!modelId && !!getModel(modelId)?.routes.some(appliesOwnStyle);
    return Response.json({ prompt: await enhancePrompt(prompt, kind ?? "image", op ?? "t2i", { ownStyle }) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
