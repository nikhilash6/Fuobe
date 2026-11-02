import { connection } from "next/server";
import { z } from "zod";
import { badBody, recipeFailure } from "@/server/recipe-routes";
import { applyFix, fixCandidates } from "@/server/skill-insights";

/** The steps that need another model (failing, replaced or switched off) and the models that do the same job, priced. */
export async function GET(_request: Request, ctx: RouteContext<"/api/assist/skills/[name]/fixes">) {
  await connection();
  try {
    return Response.json(fixCandidates((await ctx.params).name));
  } catch (e) {
    return recipeFailure(e);
  }
}

const Body = z.object({ step: z.string().min(1).max(40), modelId: z.string().min(1).max(120) });

/** Swap a step's model for the one picked; the skill is checked (plan and a free dry run) before the swap is kept. */
export async function POST(request: Request, ctx: RouteContext<"/api/assist/skills/[name]/fixes">) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    const { name } = await ctx.params;
    return Response.json(await applyFix(name, parsed.data.step, parsed.data.modelId));
  } catch (e) {
    return recipeFailure(e);
  }
}
