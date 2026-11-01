import { createStoryboard, StoryboardBodySchema } from "@/server/storyboard";
import { refusedRun } from "@/server/connect-refusal";

/** Popcorn-style storyboard: consecutive frames, each made from the previous one. */
export async function POST(request: Request) {
  const parsed = StoryboardBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  try {
    return Response.json(await createStoryboard(parsed.data), { status: 201 });
  } catch (e) {
    return refusedRun(e, request);
  }
}
