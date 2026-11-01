import { connection } from "next/server";
import { listGenerations } from "@/server/generations";
import { emptyTrash, ensureTrashPurge, listOptionsFrom } from "@/server/library";

/** The Trash, most recently deleted first (paging: before=<deletedAt>:<id> of the last row). Same filters as GET /api/generations. */
export async function GET(request: Request) {
  await connection();
  ensureTrashPurge();
  return Response.json({ items: listGenerations({ ...listOptionsFrom(new URL(request.url).searchParams), trashed: true }) });
}

/** Empty the Trash: everything in it is deleted for good. */
export async function DELETE() {
  return Response.json({ count: await emptyTrash() });
}
