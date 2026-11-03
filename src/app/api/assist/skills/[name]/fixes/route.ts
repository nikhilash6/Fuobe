import { connection } from "next/server";
import { z } from "zod";
import { badBody, recipeFailure } from "@/server/recipe-routes";
import { applyFix, stepFixes } from "@/server/recipes";

/** The steps that need a fix (failing, replaced or switched off), each with the models that could take its place, priced. */
export async function GET(_request: Request, ctx: RouteContext<"/api/assist/skills/[name]/fixes">) {
  await connection();
  try {
    return Response.json({ items: stepFixes((await ctx.params).name) });
  } catch (e) {
    return recipeFailure(e);
  }
}

const Body = z.object({ step: z.string().min(1).max(40), modelId: z.string().min(1).max(120) });

/** Use the picked model in that step: saved only once its plan and the free dry run pass. */
export async function POST(request: Request, ctx: RouteContext<"/api/assist/skills/[name]/fixes">) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    return Response.json(await applyFix((await ctx.params).name, parsed.data.step, parsed.data.modelId));
  } catch (e) {
    return recipeFailure(e);
  }
}
