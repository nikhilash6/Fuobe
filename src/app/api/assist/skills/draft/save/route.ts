import { z } from "zod";
import { SkillBody } from "@/server/assist/schemas";
import { badBody, recipeFailure } from "@/server/recipe-routes";
import { saveDraft } from "@/server/recipes";

const Body = SkillBody.extend({ recipe: z.unknown() });

/** Save a drafted skill: its SKILL.md and recipe.json, once its plan passes on an engine (checked again here, free). */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    return Response.json(await saveDraft(parsed.data), { status: 201 });
  } catch (e) {
    return recipeFailure(e);
  }
}
