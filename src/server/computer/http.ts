import "server-only";
import fs from "node:fs";
import { CONNECT_GPU_HEADER, CONNECT_GPU_MESSAGE, GUEST_HEADER, GUEST_RUN_MESSAGE } from "@/lib/guest-access";
import type { WantedFile } from "@/lib/relay";
import { sniffMedia } from "@/lib/sniff";
import { accountById, accountGpu, authEnabled, crossSite, hostAllowed, LoginGuard, publicSignup, requestViewer, validToken } from "../auth";
import { hit } from "../rate";
import { getSetting } from "../settings";
import { RelayError, type Principal } from "./tasks";
import { isWorkerAuth, workerFromAuth, type WorkerRow } from "./workers";

/**
 * What every "computer" route (src/app/api/gpu/computer) checks first: a person in a browser on this site (no API
 * token, no other website, the browser says the request comes from this site's own page), signed in, and running on
 * their own computer: an account whose GPU is "this computer", or the owner when Settings says ComfyUI runs on the
 * owner's computer. Whose tasks the request is about comes only from the session, never from the request.
 */
export function principalOf(request: Request): Principal | Response {
  const no = (status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } });
  const auth = request.headers.get("authorization");
  if (isWorkerAuth(auth)) return workerPrincipal(request, auth!, no);
  if (validToken(auth)) return no(403, "Only Fuobe open in a browser runs jobs on your computer.");
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

/**
 * A worker's call (`Authorization: Bearer fuobe_wkr_…`, from a program: no browser checks). A paired ComfyUI acts as its
 * person's own computer, with the same checks their browser gets: the owner while Settings says ComfyUI runs on the
 * owner's computer, an account while sign-up is open and its GPU is "this computer". Its token says whose it is; the
 * request can't change that.
 */
function workerPrincipal(request: Request, auth: string, no: (status: number, error: string, extra?: Record<string, unknown>) => Response): Principal | Response {
  const w = workerFromAuth(auth, { country: request.headers.get("cf-ipcountry"), network: callNetwork(request) });
  if (!w) return no(401, "This ComfyUI isn't paired with this studio any more. Pair it again from Fuobe Connect.", { code: "worker-token" });
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!authEnabled() && !hostAllowed(host)) return no(403, "Blocked a request for an address this studio isn't reached at.");
  workerOfRequest.set(request, w);
  // One of the owner's shared GPUs (docs/gpu-workers.md): it takes tasks for its pool, never a person's own.
  if (w.kind === "pool") return `pool:${w.pool}`;
  if (!w.principal) return no(401, "This worker's token isn't valid.", { code: "worker-token" });
  if (w.principal === "owner") {
    return getSetting("comfyWhere") === "computer" ? "owner" : no(409, "This studio's ComfyUI runs on its server.", { code: "server-mode" });
  }
  const id = w.principal.startsWith("acct:") ? w.principal.slice(5) : "";
  const account = id ? accountById(id) : undefined;
  if (!account || account.disabled || !publicSignup(host)) return no(401, "This account can't run jobs here now.", { code: "worker-token" });
  const gpu = accountGpu(id);
  if (!gpu) return no(403, CONNECT_GPU_MESSAGE, { code: "connect-gpu" });
  if (gpu.mode !== "computer") return no(409, "Your GPU is connected with a link, so the server runs it.", { code: "link-mode" });
  return w.principal as Principal;
}

/**
 * The network a call came from (an IPv4 address's /24, an IPv6 address's /64), or null when the proxy isn't trusted and
 * every client looks the same.
 */
export function callNetwork(request: Request): string | null {
  const key = LoginGuard.clientKey(request.headers);
  if (key === LoginGuard.DIRECT) return null;
  const v4 = key.split(".");
  return v4.length === 4 ? `${v4.slice(0, 3).join(".")}.0/24` : key;
}

/** The worker that made a request, once principalOf has read it (null: a browser). */
const workerOfRequest = new WeakMap<Request, WorkerRow>();
export const requestWorker = (request: Request): WorkerRow | null => workerOfRequest.get(request) ?? null;

/**
 * Whose limits a call counts against: a principal's (a person's computers share them), or one worker's own (three
 * workers of one pool that beat every 5 seconds are never held up by each other).
 */
export function callerKey(request: Request, principal: Principal): string {
  const w = workerOfRequest.get(request);
  return w ? `${principal}:${w.id}` : principal;
}

/** At most `limit` calls a minute of one kind for a caller (callerKey). */
export function rateOf(caller: string, what: string, limit: number): Response | null {
  const r = hit(`relay-${what}:${caller}`, limit, 60_000);
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
 * A 3D model comes only from the owner's own jobs, or as a binary glTF when `o.glb` (a run on the workers whose 3D
 * finish runs on a worker: the route checks the whole file's parts once it has arrived).
 */
export function outputType(head: Buffer, w: WantedFile, owner: boolean, o: { glb?: boolean } = {}): string {
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
      if ((owner || o.glb) && head.subarray(0, 4).toString("latin1") === "glTF") return "model/gltf-binary";
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
