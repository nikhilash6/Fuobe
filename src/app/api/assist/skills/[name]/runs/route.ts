import { connection } from "next/server";
import { listSkillRuns } from "@/server/skill-runs";
import { getSkill } from "@/server/skills";

/**
 * A skill's newest runs that span studios (recipe version 2), each step with its status and its studio's page: the
 * progress the skill's dialog shows. The owner's: a guest's or an account's read is refused by the proxy.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/assist/skills/[name]/runs">) {
  await connection();
  const { name } = await ctx.params;
  if (!getSkill(name)) return Response.json({ error: "No such skill" }, { status: 404 });
  return Response.json({ items: listSkillRuns(name) });
}
