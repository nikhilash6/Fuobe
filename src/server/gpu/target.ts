import "server-only";
import crypto from "node:crypto";
import { accountGpu, requestViewer, validToken } from "../auth";
import { fetchPublic, isPrivateAddress, type RemoteFetchOptions } from "../remote-fetch";
import { comfyRequest } from "../providers/comfyui";
import { getSetting } from "../settings";
import { fetchTransport, type ComfyTransport } from "@/lib/gpu/transport";
import { isInstallHost } from "./hosts";

/**
 * Whose ComfyUI the pre-flight reads (SPEC §3). The owner's session reads the install's own ComfyUI; an
 * account reads only the ComfyUI it connected ("Your GPU"), never the install's (R4); a guest reads nothing.
 * An API token may read the install's, but never starts a fix (R1). A ComfyUI on the person's own computer ("Use the
 * ComfyUI on this computer": an account's, or the owner's when Settings says so) is read by their Fuobe tab, never by
 * the server: its target is "computer", and the tab sends what it found (PUT /api/gpu/inventory).
 */
export type GpuTarget =
  | { kind: "install"; key: "install"; via: "server" }
  | { kind: "account"; key: `acct:${string}`; accountId: string; via: "server"; gpu: { url: string; token?: string } }
  | { kind: "computer"; key: "install" | `acct:${string}`; accountId?: string; via: "browser" }
  | { kind: "none"; reason: "guest" | "no-gpu" | "token" | "refused" };

export type ServerTarget = Extract<GpuTarget, { via: "server" }>;
export type BrowserTarget = Extract<GpuTarget, { via: "browser" }>;
/** A target whose last check can be read (by the server, or sent in by the person's tab). */
export type ReadTarget = ServerTarget | BrowserTarget;

export function gpuTargetFor(request: Request, purpose: "read" | "fix"): GpuTarget {
  const viewer = requestViewer(request);
  if (viewer.kind === "guest") return { kind: "none", reason: "guest" };
  if (viewer.kind === "owner") {
    if (purpose === "fix" && validToken(request.headers.get("authorization"))) return { kind: "none", reason: "token" };
    // ComfyUI on the owner's own computer: only the owner's tab there reads it (an API token reads nothing then).
    if (getSetting("comfyWhere") === "computer") return validToken(request.headers.get("authorization")) ? { kind: "none", reason: "token" } : { kind: "computer", key: "install", via: "browser" };
    return { kind: "install", key: "install", via: "server" };
  }
  const gpu = accountGpu(viewer.account.id);
  if (!gpu) return { kind: "none", reason: "no-gpu" };
  // The ComfyUI on the person's own computer: the server never reads it (the person's tab does).
  if (gpu.mode === "computer") return { kind: "computer", key: `acct:${viewer.account.id}`, accountId: viewer.account.id, via: "browser" };
  // The install's own ComfyUI under any scheme, port or path (its address may have changed since the link was saved).
  if (isInstallHost(gpu.url)) return { kind: "none", reason: "refused" };
  return { kind: "account", key: `acct:${viewer.account.id}`, accountId: viewer.account.id, via: "server", gpu };
}

/** The address a target reads, as hashed: a new address starts with an empty snapshot. */
export function targetUrl(t: ServerTarget): string {
  return (t.kind === "install" ? getSetting("comfyUrl") : t.gpu.url).trim().replace(/\/+$/, "");
}

export function urlHash(t: ReadTarget): string {
  // A computer's ComfyUI has no address the server knows: one per principal, as its tab reads it.
  if (t.via === "browser") return crypto.createHash("sha256").update(`${t.key}|computer|browser`).digest("hex");
  return crypto.createHash("sha256").update(`${targetUrl(t).toLowerCase()}|server`).digest("hex");
}

/** The host a target reads (audit rows keep the host, never a token). */
export function targetHost(t: ServerTarget): string {
  try {
    return new URL(targetUrl(t)).host;
  } catch {
    return "";
  }
}

/**
 * Does the studio's own ComfyUI answer anyone on the internet (review 2b)? An anonymous GET /system_stats from
 * here, through fetchPublic with private addresses always refused: a ComfyUI on this machine or its network
 * never counts, whatever FUOBE_ALLOW_PRIVATE_URLS says.
 */
export async function installExposed(): Promise<boolean> {
  const url = getSetting("comfyUrl").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetchPublic(`${url}/system_stats`, { signal: ctrl.signal, headers: { "ngrok-skip-browser-warning": "1" } }, { blocked: isPrivateAddress, timeoutMs: 5000 });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return false;
    }
    const text = await res.text();
    return text.length < 1_000_000 && /"system"\s*:/.test(text);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface TransportOptions {
  /** Tests: resolve and block addresses without DNS (fetchPublic's own hooks; no env switch, review 22). */
  resolve?: RemoteFetchOptions["resolve"];
  blocked?: RemoteFetchOptions["blocked"];
}

declare global {
  /** Tests only: fetchPublic's resolve / blocked hooks for every pre-flight transport (never set by the app). */
  var __fuobeGpuTestTransport: TransportOptions | undefined;
}

/**
 * The transport for a server-side target. An account's ComfyUI is reached only through fetchPublic, which
 * connects to public addresses only (checked on the address each connection uses), with the account's own
 * token, and ngrok's warning page skipped. The install's goes through the provider's own request (its address
 * and token). Both: a total deadline and a byte cap per request, no redirects followed.
 */
export function transportFor(t: ServerTarget, given: TransportOptions = {}): ComfyTransport {
  const o = { ...globalThis.__fuobeGpuTestTransport, ...given };
  if (t.kind === "install") {
    return fetchTransport("server", "", (path, init) => comfyRequest(path, init), { decodes: true, headers: { "ngrok-skip-browser-warning": "1" } });
  }
  const headers: Record<string, string> = { "ngrok-skip-browser-warning": "1", ...(t.gpu.token && { Authorization: `Bearer ${t.gpu.token}` }) };
  return fetchTransport("server", t.gpu.url, (url, init) => fetchPublic(url, init, { resolve: o.resolve, blocked: o.blocked, timeoutMs: 30_000 }), { headers });
}
