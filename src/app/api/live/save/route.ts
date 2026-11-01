import { connection } from "next/server";
import { z } from "zod";
import { LIBRARY_MESSAGE } from "@/lib/guest-access";
import { liveWho } from "@/server/live/access";
import { recordLiveEdit } from "@/server/generations";
import { filesRel } from "@/server/storage";

const FileRef = z.string().startsWith("/api/files/").max(500).refine((s) => filesRel(s) !== null);
const Body = z.object({
  master: FileRef,
  original: FileRef.optional(),
  steps: z.array(z.object({ text: z.string().max(2000), seed: z.number().int().min(0) })).max(200),
  from: z.string().max(40).optional(),
});

/** Save a live edit's current picture to the Library (the owner's): its kept master, with the steps that made it. */
export async function POST(request: Request) {
  await connection();
  const who = liveWho(request, { server: false });
  if (who instanceof Response) return who;
  if (who.kind !== "owner") return Response.json({ error: LIBRARY_MESSAGE, code: "library" }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Nothing to save" }, { status: 400 });
  return Response.json(recordLiveEdit(parsed.data), { status: 201 });
}
