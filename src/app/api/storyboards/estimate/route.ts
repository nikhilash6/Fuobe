import { estimateStoryboard, StoryboardBodySchema } from "@/server/storyboard";
import { priceAs } from "@/server/visitor";

/** What a board costs before it runs ("Free" on your GPU): every frame, the look's model for frame 1. */
async function post(request: Request) {
  const parsed = StoryboardBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  try {
    return Response.json(estimateStoryboard(parsed.data));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request) {
  return priceAs(request, () => post(request));
}
