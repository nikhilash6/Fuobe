import { z } from "zod";
import { badBody, recipeFailure } from "@/server/recipe-routes";
import { draftFromGenerations, nameDraft } from "@/server/recipe-builder";

const Body = z.object({ generations: z.array(z.string().min(1).max(40)).min(1).max(200) });

/**
 * The optional naming pass for a draft (Claude or Ollama, whichever this install allows): names for its inputs, slots in
 * its prompts, a title, a description and a SKILL.md body. `naming` is null when there's no LLM or its answer was malformed.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    const { draft } = draftFromGenerations(parsed.data.generations);
    return Response.json({ naming: draft ? await nameDraft(draft) : null });
  } catch (e) {
    return recipeFailure(e);
  }
}
