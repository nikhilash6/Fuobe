import { z } from "zod";
import { badBody, recipeFailure } from "@/server/recipe-routes";
import { verifyRecipe } from "@/server/recipes";

const Body = z.object({
  level: z.enum(["plan", "demo", "real"]).default("demo"),
  engine: z.enum(["cloud", "open"]).optional(),
  /** A real test spends money or GPU time: the page asks first, with its price. */
  confirm: z.boolean().optional(),
});

/** Check a skill's recipe (plan, a free dry run, or a real test) and record what passed in its `verified`. */
export async function POST(request: Request, ctx: RouteContext<"/api/assist/skills/[name]/verify">) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    const { level, engine, confirm } = parsed.data;
    return Response.json(await verifyRecipe((await ctx.params).name, level, engine, { confirm }));
  } catch (e) {
    return recipeFailure(e);
  }
}
