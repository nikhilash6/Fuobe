import { z } from "zod";
import { body, handle, SoundChoiceSchema } from "@/server/shorts-schemas";
import { assemble } from "@/server/swap-studio";

const Assemble = z.object({ clipId: z.string().min(1).max(80), sound: SoundChoiceSchema.optional() });

/** Assemble a clip: its chosen takes over the original timeline, with the clip's own sound. */
export async function POST(request: Request, ctx: RouteContext<"/api/swap-studio/projects/[id]/assemble">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await body(request, Assemble, "Pick a clip");
    return Response.json(assemble(id, b.clipId, b.sound), { status: 201 });
  }, request);
}
