import { connection } from "next/server";
import { z } from "zod";
import { createFolder, LibraryError, listFolders } from "@/server/library";

/** `parentId`: a folder's id, or null (or left out) for the library root; "" is refused, not stored as a parent nothing has. */
const Body = z.object({ name: z.string().trim().min(1).max(60), color: z.string().max(20).optional(), parentId: z.string().min(1).max(40).nullable().optional() });

/** Every folder, flat: each has its parentId (null at the library root) and pinnedAt. */
export async function GET() {
  await connection();
  return Response.json({ items: listFolders() });
}

/** A new folder; `parentId` makes it a subfolder. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.some((i) => i.path[0] === "parentId") ? "Pick a folder to put it in, or null for the top of the Library" : "Give the folder a name" }, { status: 400 });
  try {
    return Response.json(createFolder(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof LibraryError ? e.status : 409 });
  }
}
