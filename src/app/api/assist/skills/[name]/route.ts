import { connection } from "next/server";
import { z } from "zod";
import { isGuest } from "@/lib/guest-access";
import { deleteSkill, getSkill, setSkillEnabled, SkillError, updateSkill } from "@/server/skills";

const Patch = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(1).max(1024).optional(),
  whenToUse: z.string().trim().max(1024).optional(),
  body: z.string().min(1).max(60_000).optional(),
  icon: z.string().max(40).optional(),
});

const fail = (e: unknown) => Response.json({ error: (e as Error).message }, { status: e instanceof SkillError ? e.status : 500 });

export async function GET(request: Request, ctx: RouteContext<"/api/assist/skills/[name]">) {
  await connection();
  const s = getSkill((await ctx.params).name);
  // A guest or an account (public sign-up) sees the built-in skills, not the owner's own.
  if (!s || (isGuest(request) && s.source !== "builtin")) return Response.json({ error: "No such skill" }, { status: 404 });
  return Response.json(s);
}

/** Switch a skill on or off, or edit one of your own. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/assist/skills/[name]">) {
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid change" }, { status: 400 });
  const { name } = await ctx.params;
  try {
    const { enabled, ...edit } = parsed.data;
    let s = Object.keys(edit).length ? updateSkill(name, edit) : getSkill(name);
    if (!s) return Response.json({ error: "No such skill" }, { status: 404 });
    if (enabled !== undefined) s = setSkillEnabled(s.name, enabled);
    return Response.json(s);
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/assist/skills/[name]">) {
  try {
    deleteSkill((await ctx.params).name);
    return new Response(null, { status: 204 });
  } catch (e) {
    return fail(e);
  }
}
