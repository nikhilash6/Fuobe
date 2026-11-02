import { z } from "zod";
import { body, handle } from "@/server/shorts-schemas";
import { transcribe } from "@/server/swap-studio";

/** cleanVoiceFirst: the speech apart from the music and effects before it's read (src/lib/av/voice-first.ts). */
const Transcribe = z.object({ clipId: z.string().min(1).max(80), cleanVoiceFirst: z.boolean().optional() });

/** The clip's words, with who speaks when (Scribe v2 on the cloud, Qwen3-ASR on your GPU). */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/transcribe">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await body(request, Transcribe, "Pick a clip");
    return Response.json(transcribe(id, b.clipId, { cleanVoiceFirst: b.cleanVoiceFirst }));
  }, request);
}
