import { connection } from "next/server";
import { isGuest } from "@/lib/guest-access";
import { z } from "zod";
import { createPalette, listPalettes, signatureCaps } from "@/server/palettes";

const Body = z.object({
  name: z.string().trim().min(1).max(60),
  colors: z.array(z.string().max(9)).min(1).max(12),
  background: z.string().max(9).nullable().optional(),
  source: z.enum(["manual", "images"]).default("manual"),
  thumb: z.string().startsWith("/api/files/").max(500).nullable().optional(),
});

/**
 * Your colour signatures and the 50 built-in palettes, plus which models take a palette natively. A guest or an account
 * (GUEST_HEADER) gets the built-in ones only: the signatures are the owner's.
 */
export async function GET(request: Request) {
  await connection();
  const items = listPalettes();
  return Response.json({ items: isGuest(request) ? items.filter((p) => p.source === "builtin") : items, caps: signatureCaps() });
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the palette a name and 1–12 colours" }, { status: 400 });
  try {
    return Response.json(createPalette(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
