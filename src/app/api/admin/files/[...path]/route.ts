import { connection } from "next/server";
import { fileRecord } from "@/server/account-library";
import { adminAccess, auditFileView } from "@/server/admin-tokens";
import { fileResponse } from "@/server/file-response";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * A stored file, for an admin token with outputs:view (or the owner): the path as in an output's url after /api/files/.
 * Accounts' files, held ones too (waiting for their check, or hidden: what moderation has to see), and the owner's own
 * (the admin list's Ours: its runs' inputs and results). Unknown paths are a 404. Every view by a token is logged, with
 * the account (or "owner"). Byte ranges work.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/admin/files/[...path]">) {
  await connection();
  const access = adminAccess(request, "outputs:view", "You can't open this.");
  if (access instanceof Response) return access;
  const { path: parts } = await ctx.params;
  // Next has decoded each segment once already: decoding again would turn %252e into "." (stored names never need it).
  const rel = parts.join("/");
  const file = fileRecord(rel);
  if (!file) return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  auditFileView(access.actor, rel, file.account ?? "owner", file.held);
  return fileResponse(request, rel, { cache: "no-store" });
}
