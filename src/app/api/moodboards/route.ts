import { connection } from "next/server";
import { isGuest } from "@/lib/guest-access";
import { z } from "zod";
import { createMoodboard, curatedMoodboards, listMoodboards } from "@/server/moodboards";

const Body = z.object({
  name: z.string().max(200),
  images: z.array(z.string().startsWith("/api/files/")).max(200),
  collages: z.array(z.string().startsWith("/api/files/")).max(2).optional(),
  engine: z.enum(["cloud", "open"]).default("cloud"),
});

/** Your moodboards (each one's status follows its cover job) and Soul 2.0's curated looks. */
export async function GET(request: Request) {
  await connection();
  // A guest (public sign-up) sees the curated looks, not the owner's boards.
  return Response.json({ items: isGuest(request) ? [] : listMoodboards(), curated: curatedMoodboards() });
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Upload at least 5 photos to continue." }, { status: 400 });
  try {
    return Response.json(createMoodboard(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
