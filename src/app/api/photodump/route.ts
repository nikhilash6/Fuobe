import { connection } from "next/server";
import { z } from "zod";
import { createPhotodump, listUserPacks, previewPhotodump } from "@/server/photodump";
import { refusedRun } from "@/server/connect-refusal";

const Body = z
  .object({
    packId: z.string().min(1).max(80),
    engine: z.enum(["cloud", "open"]),
    elementId: z.string().max(40).optional(),
    selfie: z.string().startsWith("/api/files/").max(500).optional(),
    aspectRatio: z.string().max(10).optional(),
    modelId: z.string().max(80).optional(),
  })
  .refine((b) => !!b.elementId || !!b.selfie, { message: "Pick a character or add a selfie" });

/** Your own packs (the built-in ones ship with the page). */
export async function GET() {
  await connection();
  return Response.json({ packs: listUserPacks() });
}

/**
 * Generate a photodump: one photo per pack shot, as one batch. `?preview=1` prices it instead
 * (model, photo count, cost, demo, notes, or the error that would stop it).
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Pick a pack" }, { status: 400 });
  if (new URL(request.url).searchParams.get("preview")) return Response.json(previewPhotodump(parsed.data));
  try {
    return Response.json(createPhotodump(parsed.data), { status: 201 });
  } catch (e) {
    return refusedRun(e, request);
  }
}
