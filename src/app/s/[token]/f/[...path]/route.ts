import { shareRoute } from "@/lib/share";
import { fileResponse } from "@/server/file-response";
import { findShare } from "@/server/share-access";
import { shareServesFile } from "@/server/shares";

const NOINDEX = { "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };

/**
 * A file a share's page shows, without a session (the proxy lets exactly this path shape through).
 * Served only while the link is live and only when that page shows the file: a token never opens
 * another share's files or anything else in the files folder. Files go out without the generation
 * data saved inside them (ComfyUI's prompt and workflow, EXIF, XMP, tags): see media-clean.ts.
 */
export async function GET(request: Request, ctx: RouteContext<"/s/[token]/f/[...path]">) {
  const { token, path: parts } = await ctx.params;
  const rel = shareRoute(`/s/${token}/f/${parts.join("/")}`)?.file;
  const row = rel ? findShare(token) : null;
  if (!rel || !row || !shareServesFile(row, rel)) return new Response("Not found", { status: 404, headers: NOINDEX });
  // Revoking stops new requests at once; a browser may keep what it already has for a few minutes.
  return fileResponse(request, rel, { cache: "private, max-age=300", headers: NOINDEX, clean: true });
}
