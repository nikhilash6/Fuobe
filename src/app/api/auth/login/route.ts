import { cookies } from "next/headers";
import { z } from "zod";
import { authEnabled, createSession, LoginGuard, normalizeEmail, publicSignup, recordLogin, SESSION_COOKIE, verifyAccount, verifyPassword } from "@/server/auth";
import { enter, hit } from "@/server/rate";

/** The install password alone (the owner), or an account's email and password (public sign-up). */
const Body = z.object({ password: z.string().min(1).max(500), email: z.string().max(254).optional() });

declare global {
  var __fuobeLoginGuard: LoginGuard | undefined;
  var __fuobeAccountLoginGuard: LoginGuard | undefined;
  var __fuobeEmailLoginGuard: LoginGuard | undefined;
  var __fuobePairLoginGuard: LoginGuard | undefined;
}

const PAIR_SEPARATOR = "|";

/**
 * Separate budgets, so one kind of guessing never locks the other out, and nobody can lock a chosen account out:
 * - the install password (the owner's sign-in): a visitor is locked for a minute after 5 misses, and past 20 misses a
 *   minute from everyone, every try waits a few seconds;
 * - account log-ins, per visitor: locked for a minute after 5 misses;
 * - one email from one visitor: locked for 15 minutes after 5 misses;
 * - one email from many visitors: after 10 misses in 15 minutes the email is locked for 15 minutes, but only for the
 *   visitors that got it wrong twice or more. Anyone else still gets in with the right password (2 tries each), so the
 *   person whose account it is can't be locked out on purpose.
 * Every miss is counted before the password is checked, so requests sent all at once can't run more checks than this.
 */
const ownerGuard = () => (globalThis.__fuobeLoginGuard ??= new LoginGuard());
const accountGuard = () =>
  (globalThis.__fuobeAccountLoginGuard ??= new LoginGuard({ perClient: 5, global: Infinity, windowMs: 60_000, lockMs: 60_000, throttleMs: 4_000, maxClients: 5000 }));
const emailGuard = () =>
  (globalThis.__fuobeEmailLoginGuard ??= new LoginGuard({ perClient: 10, global: Infinity, windowMs: 15 * 60_000, lockMs: 15 * 60_000, throttleMs: 4_000, maxClients: 20_000 }));
/** One email from one visitor. Without a trusted proxy every visitor is the shared key: that pair slows down, never locks. */
const pairGuard = () =>
  (globalThis.__fuobePairLoginGuard ??= new LoginGuard(
    { perClient: 5, global: Infinity, windowMs: 15 * 60_000, lockMs: 15 * 60_000, throttleMs: 4_000, maxClients: 20_000 },
    (key) => key.endsWith(`${PAIR_SEPARATOR}${LoginGuard.DIRECT}`),
  ));

/** Every account log-in is counted, a right one too (each one is a slow password check): per visitor, and per email from it. */
const PER_CLIENT_A_MINUTE = 30;
const PER_EMAIL_A_MINUTE = 10;
/** Tries a visitor still gets at an email many visitors got wrong. */
const TRIES_AT_A_LOCKED_EMAIL = 2;
/** Owner password checks at once (a Settings password's check is slow, and shares the server's worker threads). */
const OWNER_CHECKS_AT_ONCE = 2;

function tooMany(waitMs: number, key: string) {
  const secs = Math.max(1, Math.ceil(waitMs / 1000));
  // Without a trusted proxy every visitor shares one limit (the hint is for whoever runs the server).
  const hint = key === LoginGuard.DIRECT ? " Behind a reverse proxy? Set FUOBE_TRUST_PROXY=1 so each visitor gets their own limit." : "";
  return Response.json(
    { error: `Too many sign-in attempts. Try again in ${secs} second${secs === 1 ? "" : "s"}.${hint}` },
    { status: 429, headers: { "Retry-After": String(secs) } },
  );
}

export async function POST(request: Request) {
  if (!authEnabled()) return Response.json({ ok: true });
  const key = LoginGuard.clientKey(request.headers);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  const email = parsed.success ? parsed.data.email?.trim() : undefined;
  let accountId: string | undefined;
  if (email) {
    // Only an address that could be an account's is counted per email: made-up text adds nothing to remember.
    const emailKey = normalizeEmail(email);
    const pair = emailKey ? `${emailKey}${PAIR_SEPARATOR}${key}` : undefined;
    // The visitor's own budget first: a request it refuses adds no key at all.
    let wait = accountGuard().blockedFor(key);
    if (pair && emailKey) {
      wait = Math.max(wait, pairGuard().blockedFor(pair));
      if (key !== LoginGuard.DIRECT && pairGuard().misses(pair) >= TRIES_AT_A_LOCKED_EMAIL) wait = Math.max(wait, emailGuard().blockedFor(`email:${emailKey}`));
    }
    if (wait > 0) return tooMany(wait, key);
    // The shared key (no trusted proxy) is every visitor at once: only the per-email budget applies to it.
    const perClient = key === LoginGuard.DIRECT ? { ok: true, retryAfterS: 0 } : hit(`login:${key}`, PER_CLIENT_A_MINUTE, 60_000);
    if (!perClient.ok) return tooMany(perClient.retryAfterS * 1000, key);
    if (pair) {
      const perEmail = hit(`login:${pair}`, PER_EMAIL_A_MINUTE, 60_000);
      if (!perEmail.ok) return tooMany(perEmail.retryAfterS * 1000, key);
    }
    // A miss until the password proves right: requests sent together are each counted before any check ends.
    accountGuard().fail(key);
    if (pair && emailKey) {
      pairGuard().fail(pair);
      emailGuard().fail(`email:${emailKey}`);
    }
    const account = emailKey && parsed.success && publicSignup(request.headers.get("host")) ? await verifyAccount(emailKey, parsed.data.password) : null;
    if (!account) return Response.json({ error: "Wrong email or password" }, { status: 401 });
    accountGuard().succeed(key);
    if (pair && emailKey) {
      pairGuard().succeed(pair);
      emailGuard().succeed(`email:${emailKey}`);
    }
    if (account.disabled) return Response.json({ error: "This account is switched off. Ask the studio's owner." }, { status: 403 });
    accountId = account.id;
    recordLogin(account.id);
  } else {
    const wait = ownerGuard().blockedFor(key);
    if (wait > 0) return tooMany(wait, key);
    const checking = enter("owner-login", OWNER_CHECKS_AT_ONCE);
    if (!checking) return tooMany(1000, key);
    // A miss until the password proves right (a Settings password's check takes a while: guesses sent together all count).
    ownerGuard().fail(key);
    let ok: boolean;
    try {
      ok = parsed.success && (await verifyPassword(parsed.data.password));
    } finally {
      checking();
    }
    if (!ok) return Response.json({ error: "Wrong password" }, { status: 401 });
    ownerGuard().succeed(key);
  }
  const s = createSession(accountId);
  (await cookies()).set(SESSION_COOKIE, s.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: s.maxAge,
  });
  return Response.json({ ok: true });
}
