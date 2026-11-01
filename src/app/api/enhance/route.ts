import { enhancePrompt } from "@/server/enhance";
import type { MediaKind, Operation } from "@/lib/catalog/types";

export async function POST(request: Request) {
  const { prompt, kind, op } = (await request.json().catch(() => ({}))) as { prompt?: string; kind?: MediaKind; op?: Operation };
  if (!prompt?.trim()) return Response.json({ error: "Empty prompt" }, { status: 400 });
  try {
    return Response.json({ prompt: await enhancePrompt(prompt, kind ?? "image", op ?? "t2i") });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
