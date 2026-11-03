import { badBody, DraftSource, recipeFailure } from "@/server/recipe-routes";
import { draftFromCanvas } from "@/server/canvas-skills";
import { draftFromGenerations, draftFromThread } from "@/server/recipe-builder";

/**
 * A skill drafted from results in the Library (W2), from an Assist chat (W3) or from a canvas page (W5): the steps
 * behind them rebuilt from their requests (a canvas's from its nodes), every input Fixed, with the inputs that could vary
 * and proposed checks; `refusals` say which picks (the chat's steps, the board's nodes) couldn't be used and why.
 */
export async function POST(request: Request) {
  const parsed = DraftSource.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    if ("canvas" in parsed.data) return Response.json(draftFromCanvas(parsed.data.canvas, parsed.data.page));
    if ("thread" in parsed.data) {
      const { draft, refusals } = draftFromThread(parsed.data.thread);
      return Response.json({ draft, refusals });
    }
    return Response.json(draftFromGenerations(parsed.data.generations));
  } catch (e) {
    return recipeFailure(e);
  }
}
