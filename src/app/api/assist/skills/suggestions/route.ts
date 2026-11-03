import { connection } from "next/server";
import { z } from "zod";
import { isGuest } from "@/lib/guest-access";
import { badBody, recipeFailure } from "@/server/recipe-routes";
import { dismissSuggestion, skillSuggestions } from "@/server/recipes";

/**
 * Chains the owner made often lately that no saved skill has yet (the Library's "Save it as a skill?" card). The sweep
 * runs at most once a day, when the Library asks. A guest or an account (public sign-up) gets none: the runs are the owner's.
 */
export async function GET(request: Request) {
  await connection();
  if (isGuest(request)) return Response.json({ items: [] });
  try {
    return Response.json({ items: skillSuggestions() });
  } catch (e) {
    return recipeFailure(e);
  }
}

const Body = z.object({ shape: z.string().regex(/^[0-9a-f]{16}$/), action: z.enum(["dismiss", "later"]) });

/** "Don't suggest this" (dismiss) or "Not now" (later: a week). */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badBody(parsed.error.issues);
  try {
    dismissSuggestion(parsed.data.shape, parsed.data.action === "dismiss" ? "never" : "later");
    return Response.json({ ok: true });
  } catch (e) {
    return recipeFailure(e);
  }
}
