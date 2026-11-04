import { connection } from "next/server";
import { getSkill } from "@/server/skills";
import { skillHistory } from "@/server/skill-insights";
import { listSkillRuns } from "@/server/skill-runs";

/**
 * A skill's runs from the stamp on each run's generations: how many, how many worked, the spend, and the last ten; and
 * its newest runs whose steps wait across studios, with each step's progress.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/assist/skills/[name]/history">) {
  await connection();
  const { name } = await ctx.params;
  if (!getSkill(name)) return Response.json({ error: "No such skill" }, { status: 404 });
  return Response.json({ ...skillHistory(name), waiting: listSkillRuns(name, 5) });
}
