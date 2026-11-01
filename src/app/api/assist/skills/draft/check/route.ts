import { z } from "zod";
import { badBody, recipeFailure } from "@/server/recipe-routes";
import { checkDraft } from "@/server/recipes";

const Body = z.object({
  recipe: z.unknown(),
  /** `plan` prices it (quick); `demo` adds the free dry run on the demo provider. */
  level: z.enum(["plan", "demo"]).default("plan"),
  title: z.string().trim().max(80).optional(),
});

/** Check a drafted skill's recipe before it is saved: free, with or without keys. What passed is kept for its save. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    return Response.json(await checkDraft(parsed.data.recipe, parsed.data.level, parsed.data.title || undefined));
  } catch (e) {
    return recipeFailure(e);
  }
}
