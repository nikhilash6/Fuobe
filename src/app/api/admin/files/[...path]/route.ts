import { connection } from "next/server";
import { fileAccount, HELD_FILE } from "@/server/account-library";
import { adminAccess, auditFileView } from "@/server/admin-tokens";
import { fileResponse } from "@/server/file-response";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * An account's stored file, for an admin token with outputs:view (or the owner): the path as in an output's url after
 * /api/files/. Only accounts' files and held ones (waiting for their check, or hidden: what moderation has to see);
 * the owner's own files and unknown paths are a 404. Every view by a token is logged. Byte ranges work.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/files/[...path]">) {
  await connection();
  const access = adminAccess(request, "outputs:view", "You can't open this.");
  if (access instanceof Response) return access;
  const { path: parts } = await ctx.params;
  // Next has decoded each segment once already: decoding again would turn %252e into "." (stored names never need it).
  const rel = parts.join("/");
  const owner = fileAccount(rel);
  if (!owner) return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  auditFileView(access.actor, rel, owner === HELD_FILE ? "held" : owner);
  return fileResponse(request, rel, { cache: "no-store" });
}
