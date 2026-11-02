import { z } from "zod";
import { PLAN_WORDS_MAX } from "@/lib/layout-plan";
import { planLayoutFromWords, planSide } from "@/server/layout-plan";

const Body = z.object({
  words: z.string().trim().min(1).max(PLAN_WORDS_MAX),
  width: z.number().optional(),
  height: z.number().optional(),
});

/**
 * POST /api/layout/plan {words, width, height}: a starting layout for the Layout editor's canvas, planned from a
 * sentence (src/server/layout-plan.ts). It plans with the install's AI helper, so it is the owner's: a guest or an
 * account gets the proxy's own-gpu-tool answer (src/proxy.ts).
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Describe the picture to plan, in a sentence" }, { status: 400 });
  const { words, width, height } = parsed.data;
  return Response.json(await planLayoutFromWords(words, planSide(width), planSide(height)));
}
