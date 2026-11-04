import { connection } from "next/server";
import { accountsWithStats } from "@/server/account-admin";
import { adminAccess, auditRead } from "@/server/admin-tokens";
import { accountsCsv, listAccounts, normalizeEmail } from "@/server/auth";
import { signInNotices } from "@/server/auth-store";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Settings → Accounts (owner only, or an admin token with accounts:read): everyone who signed up, newest first, with
 * their runs and space and the totals. `?q=` keeps the emails that contain it, `?email=` the one with that address;
 * `total` and `totals` still count every account. `?format=csv` downloads the list. `signInNotices`: each auth.json
 * found in the data folder after sign-in data moved into the database and set aside unread (its name and counts only).
 */
export async function GET(request: Request) {
  await connection();
  const access = adminAccess(request, "accounts:read", "You can't open this.");
  if (access instanceof Response) return access;
  const sp = new URL(request.url).searchParams;
  const q = sp.get("q")?.trim().toLowerCase() ?? "";
  if (q.length > 100) return Response.json({ error: "Search with up to 100 characters" }, { status: 400, headers: NO_STORE });
  const emailAsked = sp.get("email");
  const email = emailAsked === null ? null : normalizeEmail(emailAsked);
  if (emailAsked !== null && !email) return Response.json({ error: "Enter a valid email address" }, { status: 400, headers: NO_STORE });
  const all = listAccounts();
  const filtered = !!q || email !== null;
  const items = filtered ? all.filter((a) => (!q || a.email.includes(q)) && (email === null || a.email === email)) : all;
  const filters = filtered ? { ...(q && { q: true }), ...(email && { email: true }) } : null;
  if (sp.get("format") === "csv") {
    auditRead(access.actor, "accounts.csv", filters);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(accountsCsv(items), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fuobe-accounts-${day}.csv"`, ...NO_STORE },
    });
  }
  auditRead(access.actor, "accounts.list", filters);
  const { items: listed, totals } = accountsWithStats(all);
  const notices = signInNotices();
  if (!filtered) return Response.json({ total: all.length, items: listed, totals, signInNotices: notices }, { headers: NO_STORE });
  const keep = new Set(items.map((a) => a.id));
  const matches = listed.filter((a) => keep.has(a.id));
  return Response.json({ total: all.length, matched: matches.length, items: matches, totals, signInNotices: notices }, { headers: NO_STORE });
}
