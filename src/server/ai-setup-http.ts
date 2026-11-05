import "server-only";
import { hit, peek } from "./rate";
import { visitorKey } from "./ai-setup";
import { LoginGuard } from "./auth";

/** Every answer of the setup routes: never cached or indexed, and no address leaks in a Referer. */
export const SETUP_HEADERS = {
  "Cache-Control": "no-store, private",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

/** The status as JSON: ?format=json, or an Accept that names application/json. Any other parameter is ignored. */
export function wantsJson(request: Request): boolean {
  const format = new URL(request.url).searchParams.get("format");
  if (format === "json") return true;
  if (format === "text") return false;
  return (request.headers.get("accept") ?? "").includes("application/json");
}

/** An answer as JSON or plain text (the text form is the JSON's `text`, or its error). */
export function answer(request: Request, status: number, body: Record<string, unknown>, text: string, headers: Record<string, string> = {}): Response {
  const h = { ...SETUP_HEADERS, ...headers };
  return wantsJson(request) ? Response.json(body, { status, headers: h }) : new Response(text, { status, headers: { ...h, "Content-Type": "text/plain; charset=utf-8" } });
}

/** "Try again in 2 min." */
export const inMinutes = (s: number) => (s <= 60 ? `${Math.max(1, s)} s` : `${Math.ceil(s / 60)} min`);

/** A 429 with Retry-After, as JSON. */
export const tooMany = (error: string, retryAfterS: number) =>
  Response.json({ error, retryAfterS }, { status: 429, headers: { ...SETUP_HEADERS, "Retry-After": String(retryAfterS) } });

/**
 * A visitor's budget for Fuobe's own fixed files (the steps, the guard, the start file): its own only, when the studio
 * can tell visitors apart. No budget shared by everyone: these are the same few lines for every visitor, and a shared
 * one would let a few visitors use it up and keep every other person's AI from its steps.
 */
export function ownBudget(name: string, headers: Headers, perVisitor: number, windowMs: number): { ok: boolean; retryAfterS: number } {
  const key = visitorKey(headers);
  return key ? hit(`${name}:${key}`, perVisitor, windowMs) : { ok: true, retryAfterS: 0 };
}

/**
 * Who reads codes that aren't active, for that visitor's own budget: the visitor behind a trusted proxy
 * (FUOBE_TRUST_PROXY), else the last X-Forwarded-For hop when a proxy in front of the studio set one, else null (every
 * visitor looks the same). The hop isn't checked without a trusted proxy, and that is safe here: a made-up one only
 * moves its own reads to another budget, the shared budget still holds, and an active code never uses either budget.
 * Never use it to lock anyone out of anything they own.
 */
export function guessKey(headers: Headers): string | null {
  const trusted = visitorKey(headers);
  if (trusted) return trusted;
  const hop = LoginGuard.clientKey(headers, true);
  return hop === LoginGuard.DIRECT ? null : `hop:${hop}`;
}

/**
 * The budget for codes that aren't active: one per visitor (guessKey), and always one shared by everyone, much larger
 * (so one busy visitor can't use it up for the rest, and a studio that can't tell visitors apart never gives everyone
 * one visitor's budget). A visitor past its own budget doesn't count against the shared one, and a key is only kept
 * while the shared budget has room (made-up keys can't fill the limiter's memory).
 */
export function guessBudget(name: string, headers: Headers, perVisitor: number, everyone: number, windowMs: number): { ok: boolean; retryAfterS: number } {
  const key = guessKey(headers);
  const shared = peek(`${name}:all`, everyone, windowMs);
  const own = key ? peek(`${name}:${key}`, perVisitor, windowMs) : { ok: true, retryAfterS: 0 };
  if (!shared.ok || !own.ok) return { ok: false, retryAfterS: Math.max(shared.retryAfterS, own.retryAfterS) };
  hit(`${name}:all`, everyone, windowMs);
  if (key) hit(`${name}:${key}`, perVisitor, windowMs);
  return { ok: true, retryAfterS: 0 };
}
