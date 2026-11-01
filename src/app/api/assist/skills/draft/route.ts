import { z } from "zod";
import { badBody, recipeFailure } from "@/server/recipe-routes";
import { draftFromGenerations } from "@/server/recipe-builder";

const Body = z.object({ generations: z.array(z.string().min(1).max(40)).min(1).max(200) });

/**
 * A skill drafted from results in the Library (W2): the steps behind them rebuilt from their requests, every input
 * Fixed, with the inputs that could vary and proposed checks; `refusals` say which picks couldn't be used and why.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    return Response.json(draftFromGenerations(parsed.data.generations));
  } catch (e) {
    return recipeFailure(e);
  }
}
