import { badBody, DraftSource, recipeFailure } from "@/server/recipe-routes";
import { draftFromGenerations, draftFromThread, nameDraft } from "@/server/recipe-builder";

/**
 * The optional naming pass for a draft (Claude or Ollama, whichever this install allows): names for its inputs, slots in
 * its prompts, a title, a description and a SKILL.md body. A chat's draft also gives it what the person asked for.
 * `naming` is null when there's no LLM or its answer was malformed.
 */
export async function POST(request: Request) {
  const parsed = DraftSource.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    const { draft, words } = "thread" in parsed.data ? draftFromThread(parsed.data.thread) : { ...draftFromGenerations(parsed.data.generations), words: [] };
    return Response.json({ naming: draft ? await nameDraft(draft, words) : null });
  } catch (e) {
    return recipeFailure(e);
  }
}
