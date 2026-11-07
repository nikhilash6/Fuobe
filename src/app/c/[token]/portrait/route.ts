import { connection } from "next/server";
import { readSharedPicture } from "@/server/chat/files";
import { findChatShare } from "@/server/chat/store";

/** A shared chat's character portrait: the one file a chat share shows, for anyone with the link. */
export async function GET(_request: Request, ctx: RouteContext<"/c/[token]/portrait">) {
  await connection();
  const { token } = await ctx.params;
  const s = findChatShare(token);
  const pic = s?.portrait ? await readSharedPicture(s.portrait) : null;
  if (!pic) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(pic.data), {
    headers: {
      "Content-Type": pic.contentType,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}
