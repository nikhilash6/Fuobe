import { connection } from "next/server";
import { GUEST_LIBRARY_MESSAGE } from "@/lib/guest-access";
import type { KeyInfoAnswer } from "@/lib/key-info";
import { paidAllowed } from "@/server/account-keys";
import { requestViewer } from "@/server/auth";
import { accountsInfo, type KeyOwner } from "@/server/provider-account-info";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Connected accounts (src/lib/key-info.ts): what each saved fal.ai key or Replicate token tells about its provider
 * account, for the account menu and Settings. Who is asking comes from the session, never from the request's words: the
 * owner gets the studio's keys, an account its own keys only, and anyone else 401 before any key is read.
 * `?refresh=1` asks the providers again (at most once every 10 s per key); `?detail=1` adds this month's spend where a
 * key may read it (Settings). Never a key or the provider's own text.
 */
export async function GET(request: Request) {
  await connection();
  const viewer = requestViewer(request);
  if (viewer.kind === "guest") return Response.json({ error: GUEST_LIBRARY_MESSAGE }, { status: 401, headers: NO_STORE });
  const who: KeyOwner = viewer.kind === "owner" ? { kind: "owner" } : { kind: "account", id: viewer.account.id };
  // A studio with paid models off doesn't use an account's keys: nothing to show, nothing asked.
  if (who.kind === "account" && !paidAllowed()) return Response.json({ providers: [] } satisfies KeyInfoAnswer, { headers: NO_STORE });
  const q = new URL(request.url).searchParams;
  const providers = await accountsInfo(who, { fresh: q.get("refresh") === "1", detail: q.get("detail") === "1" });
  return Response.json({ providers } satisfies KeyInfoAnswer, { headers: NO_STORE });
}
