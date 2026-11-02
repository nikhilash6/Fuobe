import { ORIGINAL_SOUND_IDS } from "@/lib/av/original-sound";
import { z } from "zod";
import { body, handle } from "@/server/shorts-schemas";
import { assemble } from "@/server/swap-studio";

/** originalSound: what of the clip's sound goes back (src/lib/av/original-sound.ts). */
const Assemble = z.object({ clipId: z.string().min(1).max(80), originalSound: z.enum(ORIGINAL_SOUND_IDS).optional() });

/** Assemble a clip: its chosen takes over the original timeline, with the clip's own sound. */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/assemble">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await body(request, Assemble, "Pick a clip");
    return Response.json(assemble(id, b.clipId, { originalSound: b.originalSound }), { status: 201 });
  }, request);
}
