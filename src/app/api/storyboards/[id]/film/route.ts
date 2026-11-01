import { z } from "zod";
import { createStoryboardFilm } from "@/server/storyboard";
import { refusedRun } from "@/server/connect-refusal";

const Body = z.object({ modelId: z.string().max(100).optional() });

/** Animate a storyboard's frames into clips and join them into one film. */
export async function POST(request: Request, ctx: RouteContext<"/api/storyboards/[id]/film">) {
  const parsed = Body.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    return Response.json(createStoryboardFilm((await ctx.params).id, parsed.data), { status: 201 });
  } catch (e) {
    return refusedRun(e, request);
  }
}
