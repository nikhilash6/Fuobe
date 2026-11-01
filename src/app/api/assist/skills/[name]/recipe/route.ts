import { connection } from "next/server";
import { isGuest } from "@/lib/guest-access";
import { recipeFailure } from "@/server/recipe-routes";
import { recipeView, saveRecipe } from "@/server/recipes";
import { getSkill } from "@/server/skills";

/** A skill's recipe with where it runs and what was checked (engines, ready, needs a re-check). */
export async function GET(request: Request, ctx: RouteContext<"/api/assist/skills/[name]/recipe">) {
  await connection();
  const { name } = await ctx.params;
  // A guest or an account (public sign-up) sees the built-in skills' recipes, not the owner's own.
  if (isGuest(request) && getSkill(name)?.source !== "builtin") return Response.json({ error: "No such skill" }, { status: 404 });
  try {
    return Response.json(recipeView(name));
  } catch (e) {
    return recipeFailure(e);
  }
}

/** Save a user skill's recipe.json (it starts unchecked); every problem is named. */
export async function PUT(request: Request, ctx: RouteContext<"/api/assist/skills/[name]/recipe">) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Send the recipe as JSON" }, { status: 400 });
  try {
    const { name } = await ctx.params;
    saveRecipe(name, body);
    return Response.json(recipeView(name));
  } catch (e) {
    return recipeFailure(e);
  }
}
