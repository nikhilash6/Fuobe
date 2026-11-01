import { z } from "zod";
import { retryMoodboard } from "@/server/moodboards";

const Body = z.object({ engine: z.enum(["cloud", "open"]).optional() });

/** Run a board's cover job again (after a failure, or on the other engine). */
export async function POST(request: Request, ctx: RouteContext<"/api/moodboards/[id]/retry">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  try {
    return Response.json(retryMoodboard(id, parsed.success ? parsed.data.engine : undefined));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: /not found/i.test((e as Error).message) ? 404 : 409 });
  }
}
