import { z } from "zod";
import { body, handle } from "@/server/shorts-schemas";
import { transcribe } from "@/server/swap-studio";

const Transcribe = z.object({ clipId: z.string().min(1).max(80), voiceFirst: z.boolean().optional() });

/** The clip's words, with who speaks when (Scribe v2 on the cloud, Qwen3-ASR on your GPU), from the speech alone with voiceFirst. */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/transcribe">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await body(request, Transcribe, "Pick a clip");
    return Response.json(transcribe(id, b.clipId, b.voiceFirst));
  }, request);
}
