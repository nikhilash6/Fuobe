import "server-only";
import fs from "node:fs";
import { CONNECT_GPU_HEADER, CONNECT_GPU_MESSAGE, GUEST_HEADER, GUEST_RUN_MESSAGE } from "@/lib/guest-access";
import type { WantedFile } from "@/lib/relay";
import { sniffMedia } from "@/lib/sniff";
import { accountGpu, authEnabled, crossSite, hostAllowed, requestViewer, validToken } from "../auth";
import { hit } from "../rate";
import { getSetting } from "../settings";
import { RelayError, type Principal } from "./tasks";

/**
 * What every "computer" route (src/app/api/gpu/computer) checks first: a person in a browser on this site (no API
 * token, no other website, the browser says the request comes from this site's own page), signed in, and running on
 * their own computer: an account whose GPU is "this computer", or the owner when Settings says ComfyUI runs on the
 * owner's computer. Whose tasks the request is about comes only from the session, never from the request.
 */
export function principalOf(request: Request): Principal | Response {
  const no = (status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });
  if (validToken(request.headers.get("authorization"))) return no(403, "Only Fuobe open in a browser runs jobs on your computer.");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (crossSite(request, host)) return no(403, "Blocked a request from another website.");
  const site = request.headers.get("sec-fetch-site");
  if (site ? site !== "same-origin" : !request.headers.get("origin")) return no(403, "Only Fuobe's own page can do this.");
  if (!authEnabled() && !hostAllowed(host)) return no(403, "Blocked a request for an address this studio isn't reached at.");
  const viewer = requestViewer(request);
  if (viewer.kind === "guest") return no(401, GUEST_RUN_MESSAGE, {}, { [GUEST_HEADER]: "1" });
  if (viewer.kind === "owner") {
    return getSetting("comfyWhere") === "computer" ? "owner" : no(409, "This studio's ComfyUI runs on its server.", { code: "server-mode" });
  }
  const gpu = accountGpu(viewer.account.id);
  if (!gpu) return no(403, CONNECT_GPU_MESSAGE, { code: "connect-gpu" }, { [CONNECT_GPU_HEADER]: "1" });
  if (gpu.mode !== "computer") return no(409, "Your GPU is connected with a link, so the server runs it.", { code: "link-mode" });
  return `acct:${viewer.account.id}`;
}

/** At most `limit` calls a minute of one kind for a principal. */
export function rateOf(principal: Principal, what: string, limit: number): Response | null {
  const r = hit(`relay-${what}:${principal}`, limit, 60_000);
  return r.ok ? null : Response.json({ error: "Too many at once. Fuobe tries again by itself." }, { status: 429, headers: { "Retry-After": String(r.retryAfterS), "Cache-Control": "no-store" } });
}

/** A RelayError as its answer (anything else is thrown on). */
export function relayAnswer(e: unknown): Response {
  if (e instanceof RelayError) return Response.json({ error: e.message, ...e.extra }, { status: e.status, headers: { "Cache-Control": "no-store" } });
  throw e;
}

const KIND_WORDS: Record<WantedFile["kind"], string> = { image: "a picture", video: "a clip", audio: "sound", text: "text", model3d: "a 3D model", frame: "an EXR frame" };

/** A text result's type, by its name. */
const textType = (name: string, owner: boolean) => (/\.srt$/i.test(name) ? "application/x-subrip" : /\.vtt$/i.test(name) ? "text/vtt" : owner && /\.json$/i.test(name) ? "application/json" : "text/plain");

/**
 * What a result from someone's ComfyUI is, from its first bytes (as an upload's type is: lib/sniff.ts), and whether it
 * is what the server asked for. Never a page or a script: a picture that is really HTML is refused. Throws the words.
 */
export function outputType(head: Buffer, w: WantedFile, owner: boolean): string {
  const s = head.length >= 4 ? sniffMedia(head, undefined, { gif: true }) : null;
  switch (w.kind) {
    case "image":
      if (s?.kind === "image") return s.contentType;
      break;
    case "video":
      // VideoHelperSuite also saves animations as GIF or WebP.
      if (s?.kind === "video" || s?.contentType === "image/gif" || s?.contentType === "image/webp") return s.contentType;
      break;
    case "audio":
      if (s?.kind === "audio") return s.contentType;
      if (s?.contentType === "video/webm") return "audio/webm";
      if (s?.contentType === "video/mp4") return "audio/mp4";
      break;
    case "frame":
      if (head.length >= 4 && head.readUInt32BE(0) === 0x762f3101) return "image/x-exr";
      break;
    case "text":
      if (!head.includes(0)) return textType(w.filename, owner);
      break;
    case "model3d":
      if (owner && head.subarray(0, 4).toString("latin1") === "glTF") return "model/gltf-binary";
      if (owner && /^ply\r?\n/.test(head.subarray(0, 8).toString("latin1"))) return "model/ply";
      break;
  }
  throw new Error(`Couldn't save a result from your ComfyUI: it isn't ${KIND_WORDS[w.kind] ?? "what this run makes"}.`);
}

/** A whole text result is UTF-8 (checked once it has all arrived). */
export function isUtf8File(file: string): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
    return true;
  } catch {
    return false;
  }
}
