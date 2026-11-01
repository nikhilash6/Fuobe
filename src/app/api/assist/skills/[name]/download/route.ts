import { connection } from "next/server";
import { isGuest } from "@/lib/guest-access";
import { getSkill, skillArchive, skillMarkdown } from "@/server/skills";

/**
 * The skill to keep or share: SKILL.md (upload it on another Fuobe, or use it with Claude), or with `?format=zip` the
 * skill with every bundled file, as Upload reads it. A recipe's examples and source stay out unless `&examples=1`.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/assist/skills/[name]/download">) {
  await connection();
  const { name } = await ctx.params;
  // A guest or an account (public sign-up) downloads the built-in skills, not the owner's own.
  if (isGuest(req) && getSkill(name)?.source !== "builtin") return Response.json({ error: "No such skill" }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  if (sp.get("format") === "zip") {
    const data = skillArchive(name, { examples: sp.get("examples") === "1" });
    if (!data) return Response.json({ error: "No such skill" }, { status: 404 });
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${name}.zip"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const md = skillMarkdown(name);
  if (md === null) return Response.json({ error: "No such skill" }, { status: 404 });
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-SKILL.md"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
