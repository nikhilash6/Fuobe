import "server-only";
import { CONNECT_GPU_HEADER, CONNECT_NEEDS_HEADER } from "@/lib/guest-access";
import { requestViewer, validToken } from "./auth";
import { ConnectComfyError, type ConnectNeeds } from "./generations";

/**
 * What would run a refused run, when the refusal should open the connect card: nothing connected runs it, ComfyUI or a
 * key could (placeholder results off), and the request is the owner's own browser (never a script's token, which has no
 * page to open a card on, and never a price check). Otherwise null.
 */
export function connectNeeds(e: unknown, request: Request, preview = false): ConnectNeeds | null {
  if (!(e instanceof ConnectComfyError) || preview) return null;
  if (validToken(request.headers.get("authorization"))) return null;
  return requestViewer(request).kind === "owner" ? e.needs : null;
}

/**
 * The 422 that opens the connect card in the owner's browser (src/lib/api.ts watchGuestRefusals), with the way or ways
 * that would run it; the run starts once one is connected. Null when the error is anything else.
 */
export function connectRefusal(e: unknown, request: Request, preview = false): Response | null {
  const needs = connectNeeds(e, request, preview);
  if (!needs) return null;
  return Response.json({ error: (e as Error).message, code: "connect-gpu", needs }, { status: 422, headers: { [CONNECT_GPU_HEADER]: "1", [CONNECT_NEEDS_HEADER]: needs } });
}

/** A route's refused run as `{ error }`: the connect card when connecting something would run it, else `status`. */
export function refusedRun(e: unknown, request: Request, status = 422): Response {
  return connectRefusal(e, request) ?? Response.json({ error: (e as Error).message }, { status });
}
