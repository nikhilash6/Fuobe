import { connection } from "next/server";
import { pairingPrincipal, runOnComputer } from "@/server/computer/pairing-http";
import { approvePairing, denyPairing, normaliseCode, pairingByCode } from "@/server/computer/workers";
import { hit } from "@/server/rate";

/** Codes a person may look up or answer in 10 minutes (a code is 8 characters from 31: guessing one is hopeless). */
const LOOKUPS = 30;

const GONE = "That code isn't waiting any more. Press Connect to Fuobe in ComfyUI again for a new one.";

function limited(principal: string): Response | null {
  const r = hit(`pair-code:${principal}`, LOOKUPS, 10 * 60_000);
  return r.ok ? null : Response.json({ error: "Too many codes. Try again in a few minutes." }, { status: 429, headers: { "Retry-After": String(r.retryAfterS) } });
}

/** The computer behind a code, for the person to check before they approve it: its name and GPU. */
export async function GET(request: Request) {
  await connection();
  const principal = pairingPrincipal(request);
  if (principal instanceof Response) return principal;
  const no = limited(principal);
  if (no) return no;
  const code = new URL(request.url).searchParams.get("code");
  const p = code ? pairingByCode(code) : null;
  if (!p) return Response.json({ error: GONE }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json({ code: normaliseCode(code), ...p }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * The person approves a code (`{ code }`), or says it isn't theirs (`{ code, deny: true }`). Approved: that ComfyUI runs
 * this person's jobs, and only theirs, from its next poll on.
 */
export async function POST(request: Request) {
  const principal = pairingPrincipal(request);
  if (principal instanceof Response) return principal;
  const no = limited(principal);
  if (no) return no;
  const body = (await request.json().catch(() => null)) as { code?: unknown; deny?: unknown } | null;
  if (body?.deny === true) {
    denyPairing(String(body.code ?? ""));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const a = approvePairing(String(body?.code ?? ""), principal);
  if (!a) return Response.json({ error: GONE }, { status: 404, headers: { "Cache-Control": "no-store" } });
  runOnComputer(principal);
  return Response.json({ ok: true, worker: { id: a.workerId, name: a.name } }, { headers: { "Cache-Control": "no-store" } });
}
