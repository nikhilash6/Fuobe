import { badBody, DraftSource, recipeFailure } from "@/server/recipe-routes";
import { draftFromGenerations, draftFromThread } from "@/server/recipe-builder";

/**
 * A skill drafted from results in the Library (W2) or from an Assist chat (W3): the steps behind them rebuilt from
 * their requests, every input Fixed, with the inputs that could vary and proposed checks; `refusals` say which picks
 * (or which of the chat's steps) couldn't be used and why.
 */
export async function POST(request: Request) {
  const parsed = DraftSource.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    if ("thread" in parsed.data) {
      const { draft, refusals } = draftFromThread(parsed.data.thread);
      return Response.json({ draft, refusals });
    }
    return Response.json(draftFromGenerations(parsed.data.generations));
  } catch (e) {
    return recipeFailure(e);
  }
}
