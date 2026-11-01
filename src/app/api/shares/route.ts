import { connection } from "next/server";
import { z } from "zod";
import { MAX_EXPIRY_DAYS, SHARE_KINDS } from "@/lib/share";
import { authEnabled } from "@/server/auth";
import { createShare, listShares, MAX_PUBLISH_ITEMS, ShareError } from "@/server/shares";

const Body = z.object({
  kind: z.enum(SHARE_KINDS as [string, ...string[]]),
  targetId: z.string().min(1).max(64).nullable().optional(),
  items: z.array(z.string().min(1).max(64)).max(MAX_PUBLISH_ITEMS).optional(),
  title: z.string().max(300).optional(),
  description: z.string().max(3000).optional(),
  tags: z.union([z.string().max(500), z.array(z.string().max(60)).max(20)]).optional(),
  layout: z.enum(["grid", "feature", "series", "carousel"]).optional(),
  cover: z.object({ generationId: z.string().min(1).max(64), index: z.number().int().min(0).max(500) }).nullable().optional(),
  showPrompts: z.boolean().optional(),
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS).nullable().optional(),
});

/** Every share link (Library → Shared), and whether sign-in is on (the share dialog warns when it isn't). */
export async function GET() {
  await connection();
  return Response.json({ items: listShares(), signIn: authEnabled() });
}

/**
 * A new read-only link to a result, a folder, a Cinema project, or (kind "publish") a page of picked
 * results. The answer carries the token once; only its hash is stored.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.some((i) => i.path[0] === "items") ? `Pick up to ${MAX_PUBLISH_ITEMS} results` : "That isn't something Fuobe can share" }, { status: 400 });
  try {
    const d = parsed.data;
    return Response.json(createShare({ ...d, kind: d.kind as (typeof SHARE_KINDS)[number] }), { status: 201 });
  } catch (e) {
    if (e instanceof ShareError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
