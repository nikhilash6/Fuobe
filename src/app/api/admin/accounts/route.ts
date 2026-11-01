import { connection } from "next/server";
import { accountsWithStats } from "@/server/account-admin";
import { accountsCsv, isOwnerRequest, listAccounts, sessionCookieOf } from "@/server/auth";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Settings → Accounts (owner only): everyone who signed up, newest first, with their runs and space and the totals.
 * `?format=csv` downloads the list.
 */
export async function GET(request: Request) {
  await connection();
  if (!isOwnerRequest(request, sessionCookieOf(request))) return Response.json({ error: "Only the studio's owner sees accounts" }, { status: 403, headers: NO_STORE });
  const items = listAccounts();
  if (new URL(request.url).searchParams.get("format") === "csv") {
    const day = new Date().toISOString().slice(0, 10);
    return new Response(accountsCsv(items), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fuobe-accounts-${day}.csv"`, ...NO_STORE },
    });
  }
  const { items: listed, totals } = accountsWithStats(items);
  return Response.json({ total: items.length, items: listed, totals }, { headers: NO_STORE });
}
