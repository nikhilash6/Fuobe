import { connection } from "next/server";
import { genjutsuExamples } from "@/lib/examples/catalog";
import { isOwnerRequest, sessionCookieOf } from "@/server/auth";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Every Genjutsu mode's examples, the ones still only the owner's included (their mode or a feature they need hasn't
 * passed its GPU test yet). The page itself sends only the examples open to everyone; the owner's Genjutsu asks here
 * for the rest. The owner only.
 */
export async function GET(request: Request) {
  await connection();
  if (!isOwnerRequest(request, sessionCookieOf(request))) return Response.json({ error: "Only the studio's owner sees these" }, { status: 403, headers: NO_STORE });
  return Response.json({ examples: genjutsuExamples() }, { headers: NO_STORE });
}
