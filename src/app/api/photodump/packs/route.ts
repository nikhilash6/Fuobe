import { connection } from "next/server";
import { z } from "zod";
import { createUserPack, listUserPacks } from "@/server/photodump";

const Body = z.object({ name: z.string().max(200), refs: z.array(z.string().startsWith("/api/files/")).max(40) });

export async function GET() {
  await connection();
  return Response.json({ packs: listUserPacks() });
}

/** Create a pack from up to 15 reference photos: each becomes one photo of the dump. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Upload your reference set up to 15 photos" }, { status: 400 });
  try {
    return Response.json(createUserPack(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
