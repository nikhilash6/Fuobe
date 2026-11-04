import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import { AccountError, accountGpu, authEnabled, createSession, publicSignup, SESSION_COOKIE, sessionCookieOf, sessionViewer, setAccountPassword, validToken, verifyAccount } from "@/server/auth";
import { runnerFacts } from "@/server/computer/tasks";
import { getSetting } from "@/server/settings";
import { soundLive } from "@/server/sound-live";
import { removeAccount } from "@/server/account-sweep";
import { hit } from "@/server/rate";

/** Who is looking: the owner, an account, or a guest; and whether sign-up is open. Open to everyone. */
export async function GET(request: Request) {
  await connection();
  const open = publicSignup(request.headers.get("host"));
  const session = sessionViewer(sessionCookieOf(request));
  const owner = !authEnabled() || session?.kind === "owner" || validToken(request.headers.get("authorization"));
  const account = !owner && open && session?.kind === "account" ? session.account : null;
  // Runs go to the ComfyUI on this person's own computer: their Fuobe tab runs them (never for an API token: a script isn't a tab).
  const computer = account ? accountGpu(account.id)?.mode === "computer" : owner && !validToken(request.headers.get("authorization")) && getSetting("comfyWhere") === "computer";
  // Where that computer's tab last found ComfyUI (another browser of theirs starts looking there).
  const comfyPort = computer ? runnerFacts(account ? `acct:${account.id}` : "owner")?.port : undefined;
  // The sound features that have passed a real run (src/server/sound-live.ts): their switches start on and show to everyone.
  const live = Object.entries(soundLive()).flatMap(([k, v]) => (v ? [k] : []));
  return Response.json(
    {
      signedIn: owner || !!account,
      owner,
      publicSignup: open,
      ...(account && { account: { email: account.email } }),
      ...(computer && { computer: true, ...(comfyPort && { comfyPort }) }),
      ...(live.length && { soundLive: live }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Five password checks a minute per account, deleting it and changing its password together: each is a slow check on
 * purpose, and either one tells whether a guess was right.
 */
const passwordCheck = (id: string) => hit(`password-check:${id}`, 5, 60_000);

/**
 * A request from no account: signed out (no session, or one that ended when the password was changed in another browser)
 * is a 401, so the page can show Log in; the owner, whose password isn't an account's, a 403.
 */
function notAnAccount(request: Request, signedOut: string, owner: string): Response {
  const isOwner = !authEnabled() || validToken(request.headers.get("authorization"));
  return Response.json({ error: isOwner ? owner : signedOut }, { status: isOwner ? 403 : 401 });
}

/** An account deletes itself (its password again, to be sure). Signs it out. */
export async function DELETE(request: Request) {
  const jar = await cookies();
  const session = sessionViewer(sessionCookieOf(request));
  const ownerRefusal = "This deletes an account, not the studio";
  if (!session) return notAnAccount(request, "You're signed out. Log in again to delete your account.", ownerRefusal);
  if (session.kind !== "account") return Response.json({ error: ownerRefusal }, { status: 403 });
  const parsed = z.object({ password: z.string().min(1).max(500) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Wrong password" }, { status: 403 });
  const rate = passwordCheck(session.account.id);
  if (!rate.ok) return Response.json({ error: "Too many tries. Wait a minute, then try again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterS) } });
  if (!(await verifyAccount(session.account.email, parsed.data.password))) return Response.json({ error: "Wrong password" }, { status: 403 });
  // Switched off at once, its running jobs stopped (on its own keys), then its runs, files and record go.
  await removeAccount(session.account.id);
  jar.delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
}

const NewPassword = z.object({
  current: z.string().max(500),
  next: z.string().min(8, "Use at least 8 characters").max(500, "Use at most 500 characters"),
});

/**
 * An account changes its password (the current one first, to be sure). Its other sign-ins end; this browser gets a new
 * session cookie.
 */
export async function PATCH(request: Request) {
  const jar = await cookies();
  const session = sessionViewer(sessionCookieOf(request));
  const ownerRefusal = "This changes an account's password, not the studio's";
  if (!session) return notAnAccount(request, "You're signed out. Log in again to change your password.", ownerRefusal);
  if (session.kind !== "account") return Response.json({ error: ownerRefusal }, { status: 403 });
  const parsed = NewPassword.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const next = parsed.error.issues.find((i) => i.path[0] === "next");
    return Response.json({ error: next?.message ?? "Enter your current password and a new one" }, { status: 400 });
  }
  // Not a change: it would sign the other browsers out for nothing. (Two of the request's own words: no password check.)
  if (parsed.data.next === parsed.data.current) return Response.json({ error: "Choose a new password, not the one you use now" }, { status: 400 });
  const rate = passwordCheck(session.account.id);
  if (!rate.ok) return Response.json({ error: "Too many tries. Wait a minute, then try again." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterS) } });
  try {
    await setAccountPassword(session.account.id, parsed.data.current, parsed.data.next);
  } catch (e) {
    if (e instanceof AccountError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const s = createSession(session.account.id);
  jar.set(SESSION_COOKIE, s.value, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: s.maxAge });
  return Response.json({ ok: true });
}
