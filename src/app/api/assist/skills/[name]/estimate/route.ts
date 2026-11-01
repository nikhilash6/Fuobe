import { badBody, recipeFailure, RunBody } from "@/server/recipe-routes";
import { estimateRecipe } from "@/server/recipes";
import { priceAs } from "@/server/visitor";

/** Price a run of a skill's recipe, or many (`rows` or `csv`, priced together with a total). Starts nothing. */
async function post(request: Request, ctx: RouteContext<"/api/assist/skills/[name]/estimate">) {
  const parsed = RunBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    const { engine, ...input } = parsed.data;
    return Response.json(estimateRecipe((await ctx.params).name, input, engine));
  } catch (e) {
    return recipeFailure(e);
  }
}

/** A visitor (public sign-up) gets the price of its run on its own GPU, never a demo (src/server/visitor.ts). */
export async function POST(request: Request, ctx: RouteContext<"/api/assist/skills/[name]/estimate">) {
  return priceAs(request, () => post(request, ctx));
}
