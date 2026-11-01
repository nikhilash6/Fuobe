import "server-only";
import { z } from "zod";
import { RecipeError } from "./recipes";
import { SkillError } from "./skills";

/** What the recipe routes take: one set of values, rows, or a CSV, and the engine to run on. */
export const RunBody = z.object({
  values: z.record(z.string(), z.unknown()).optional(),
  rows: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
  csv: z.string().max(500_000).optional(),
  engine: z.enum(["cloud", "open"]).optional(),
});

/** A refusal as JSON: the reason, every problem of a recipe, and the status a SkillError carries. */
export function recipeFailure(e: unknown): Response {
  const status = e instanceof SkillError ? e.status : 500;
  return Response.json({ error: (e as Error).message, ...(e instanceof RecipeError && { problems: e.problems }) }, { status });
}

export const badBody = (issues: z.core.$ZodIssue[]) => Response.json({ error: issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, { status: 400 });
