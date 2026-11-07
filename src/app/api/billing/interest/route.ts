import { requestAccount } from "@/server/auth";
import { interest } from "@/server/billing";
import { hit } from "@/server/rate";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * An account's click on an offer the billing service sent ("Tell me when"): passed on to the service
 * (docs/billing-hook.md, POST /v1/interest). With no billing service set there are no offers: 404.
 */
export async function POST(request: Request) {
  const account = requestAccount(request);
  if (!account) return Response.json({ error: "Sign in first" }, { status: 401, headers: NO_STORE });
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" && /^[\w.:-]{1,80}$/.test(body.key) ? body.key : null;
  if (!key) return Response.json({ error: "Which offer?" }, { status: 400, headers: NO_STORE });
  const rate = hit(`interest:${account.id}`, 30, 60 * 60_000);
  if (!rate.ok) return Response.json({ error: "Thanks — we have your interest. You can tell us more in a little while." }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(rate.retryAfterS) } });
  const a = await interest(account.id, key);
  if (!a) return Response.json({ error: "Not available right now" }, { status: 404, headers: NO_STORE });
  return Response.json({ ok: true, text: a.text }, { headers: NO_STORE });
}
