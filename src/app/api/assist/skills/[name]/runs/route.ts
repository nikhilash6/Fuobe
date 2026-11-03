import { connection } from "next/server";
import { RECIPE_LIMITS } from "@/lib/recipe";
import { listSkillRuns } from "@/server/skill-runs";
import { getSkill } from "@/server/skills";

/**
 * A skill's newest runs that span studios (recipe version 2), each step with its status and its studio's page: the
 * progress the skill's dialog shows. `?ids=a,b` asks for those runs of the skill instead (the CLI following a CSV's
 * runs). The owner's: a guest's or an account's read is refused by the proxy.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/assist/skills/[name]/runs">) {
  await connection();
  const { name } = await ctx.params;
  if (!getSkill(name)) return Response.json({ error: "No such skill" }, { status: 404 });
  const asked = new URL(request.url).searchParams.get("ids");
  const ids = asked === null ? undefined : [...new Set(asked.split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids && ids.length > RECIPE_LIMITS.rows) return Response.json({ error: `At most ${RECIPE_LIMITS.rows} runs at once` }, { status: 400 });
  return Response.json({ items: ids ? listSkillRuns(name, ids.length, ids) : listSkillRuns(name) });
}
