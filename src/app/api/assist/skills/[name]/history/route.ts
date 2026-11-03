import { connection } from "next/server";
import { recipeFailure } from "@/server/recipe-routes";
import { skillHistory } from "@/server/recipes";

/** A skill's runs (from the skill stamp on the owner's generations): counts, success rate, spend and the last 10. */
export async function GET(_request: Request, ctx: RouteContext<"/api/assist/skills/[name]/history">) {
  await connection();
  try {
    return Response.json(skillHistory((await ctx.params).name));
  } catch (e) {
    return recipeFailure(e);
  }
}
