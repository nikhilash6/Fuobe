import { enhancePrompt, writeLyrics } from "@/server/enhance";
import type { MediaKind, Operation } from "@/lib/catalog/types";

export async function POST(request: Request) {
  const { prompt, kind, op, target, seconds, max } = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    kind?: MediaKind;
    op?: Operation;
    /** "lyrics": Audio → Music's "Write the lyrics" (words to sing for the song `prompt` describes). */
    target?: "lyrics";
    seconds?: number;
    max?: number;
  };
  if (!prompt?.trim()) return Response.json({ error: "Empty prompt" }, { status: 400 });
  try {
    if (target === "lyrics") {
      const lyrics = await writeLyrics(prompt.slice(0, 4000), { seconds: Number(seconds) || undefined, max: Number(max) || undefined });
      if (!lyrics) return Response.json({ error: "Writing lyrics needs the AI helper: pick Claude or a local model in Settings → AI helper", code: "no-llm" }, { status: 503 });
      return Response.json({ lyrics });
    }
    return Response.json({ prompt: await enhancePrompt(prompt, kind ?? "image", op ?? "t2i") });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
