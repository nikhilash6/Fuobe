import { connection } from "next/server";
import { z } from "zod";
import { MAX_EXPIRY_DAYS } from "@/lib/share";
import { getShare, revokeShare, ShareError, updateShare } from "@/server/shares";

const Patch = z.object({
  title: z.string().max(300).optional(),
  description: z.string().max(3000).optional(),
  tags: z.union([z.string().max(500), z.array(z.string().max(60)).max(20)]).optional(),
  layout: z.enum(["feature", "series", "carousel"]).optional(),
  showPrompts: z.boolean().optional(),
  /** Days from now, or null: never expires. */
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS).nullable().optional(),
  /** A new token; the old link stops working. The answer carries the new one once. */
  newLink: z.literal(true).optional(),
});

export async function GET(_req: Request, ctx: RouteContext<"/api/shares/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const s = getShare(id);
  return s ? Response.json(s) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Change a link: its words, prompts on or off, a new expiry from now, or a new token. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/shares/[id]">) {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid change" }, { status: 400 });
  try {
    const out = updateShare(id, parsed.data);
    return out ? Response.json(out) : Response.json({ error: "That link doesn't exist anymore" }, { status: 404 });
  } catch (e) {
    if (e instanceof ShareError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

/** Revoke: the link stops working at once. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/shares/[id]">) {
  const { id } = await ctx.params;
  return revokeShare(id) ? new Response(null, { status: 204 }) : Response.json({ error: "That link doesn't exist anymore" }, { status: 404 });
}
