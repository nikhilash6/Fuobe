import { connection } from "next/server";
import { NO_FACETS } from "@/lib/guest-access";
import { requestViewer } from "@/server/auth";
import { libraryFacets } from "@/server/library";

/**
 * Counts for the Library's filter menus: models used, kinds, favorites, failed, pinned, review statuses, helper steps, Trash. `steps=1` counts the steps in.
 * An account (public sign-up) counts its own runs only; a guest none (the proxy answers it first).
 */
export async function GET(request: Request) {
  await connection();
  const viewer = requestViewer(request);
  if (viewer.kind === "guest") return Response.json(NO_FACETS);
  return Response.json(libraryFacets({ steps: new URL(request.url).searchParams.get("steps") === "1", account: viewer.kind === "account" ? viewer.account.id : undefined }));
}
