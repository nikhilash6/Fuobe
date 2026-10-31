import "server-only";
import dns from "node:dns/promises";
import net from "node:net";
import { isCloudProvider, type CloudProvider } from "@/lib/your-keys";
import { accountEngineMode, accountProviders, paidAllowed } from "./account-keys";
import { accountGpu, type Account, type AccountGpu } from "./auth";
import type { OwnerGpuView } from "@/lib/connections";
import { runnerFacts, type Principal } from "./computer/tasks";
import { offeredSummary } from "./model-access";
import { PROVIDERS } from "./providers";
import { blockedForAccounts, fetchPublic, isLoopbackGpu } from "./remote-fetch";
import { isInstallHost, REFUSED_ADDRESS } from "./gpu/hosts";

/**
 * "Your GPU" (public sign-up): the ComfyUI an account connects, where its runs go. The server calls
 * it, so it must be reachable from the internet (a Cloudflare Tunnel or ngrok in front of a local
 * ComfyUI). Addresses on this machine or a private network are refused, and so is the install's own
 * ComfyUI. A ComfyUI on the visitor's own computer (localhost) is the browser's to reach, never sent here.
 */

export class GpuError extends Error {}

const allowPrivate = () => process.env.FUOBE_ALLOW_PRIVATE_URLS === "1";

export const LOCAL_GPU_MESSAGE =
  "That address is on your own computer or network, and this server can't reach it. Put a tunnel in front of your ComfyUI (cloudflared tunnel --url http://localhost:8188, or ngrok http 8188) and paste the https address it prints.";

/** An address as stored and compared: origin and path, no trailing slash. */
const normal = (u: URL) => `${u.origin}${u.pathname.replace(/\/+$/, "")}`;

/** Check an account's ComfyUI address: http(s), a public host, not the install's own ComfyUI. Returns it normalised. */
export async function checkGpuAddress(raw: string, o: { resolve?: (host: string) => Promise<string[]> } = {}): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new GpuError("Enter the full address, like https://your-tunnel.trycloudflare.com");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new GpuError("Use an http or https address");
  if (u.username || u.password) throw new GpuError("Put the token in the token field, not in the address");
  if (u.search || u.hash) throw new GpuError("Use the address without ? or #");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal") || !host.includes(".");
  // A stand-in ComfyUI on this machine is allowed in tests and `next dev` only (remote-fetch.ts loopbackGpuPort).
  if (!isLoopbackGpu(u)) {
    if (local && !net.isIP(host) && !allowPrivate()) throw new GpuError(LOCAL_GPU_MESSAGE);
    const resolve = o.resolve ?? (async (h: string) => (await dns.lookup(h, { all: true, verbatim: true })).map((a) => a.address));
    let addrs: string[];
    try {
      addrs = net.isIP(host) ? [host] : await resolve(host);
    } catch {
      throw new GpuError(`Couldn't find ${host}. Check the address (is the tunnel running?)`);
    }
    if (!addrs.length) throw new GpuError(`Couldn't find ${host}. Check the address (is the tunnel running?)`);
    // Private networks, this machine's own addresses (loopback too, even with FUOBE_ALLOW_PRIVATE_URLS), wrapped IPv4.
    if (addrs.some(blockedForAccounts)) throw new GpuError(LOCAL_GPU_MESSAGE);
  }
  const url = normal(u);
  // The install's own ComfyUI on any scheme, port or path (ComfyUI answers every route under /api too), compared by
  // host. One message for every such refusal, so it never confirms a guessed address.
  // (The tests' and `next dev`'s stand-in on this machine is on a port of its own: loopbackGpuPort.)
  if (!isLoopbackGpu(u) && isInstallHost(url)) throw new GpuError(REFUSED_ADDRESS);
  return url;
}

export interface GpuInfo {
  device?: string;
  vramBytes?: number;
  version?: string;
}

/** Ask the account's ComfyUI for /system_stats, the check the studio makes of its own. */
export async function testGpu(gpu: { url: string; token?: string }, o: { resolve?: (host: string) => Promise<string[]>; timeoutMs?: number; maxBytes?: number } = {}): Promise<GpuInfo> {
  let res: Response;
  try {
    res = await fetchPublic(`${gpu.url}/system_stats`, { headers: gpu.token ? { Authorization: `Bearer ${gpu.token}` } : {} }, { timeoutMs: o.timeoutMs ?? 10_000, deadlineMs: (o.timeoutMs ?? 10_000) + 5_000, maxBytes: o.maxBytes ?? 1 * 2 ** 20, resolve: o.resolve });
  } catch (e) {
    throw new GpuError(`Couldn't reach your ComfyUI at ${gpu.url}: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) throw new GpuError(`Your ComfyUI refused the request (HTTP ${res.status}): check the token`);
  if (!res.ok) throw new GpuError(`Your ComfyUI answered HTTP ${res.status}. Is the tunnel pointing at ComfyUI?`);
  const s = (await res.json().catch(() => null)) as { system?: { comfyui_version?: string }; devices?: { name?: string; vram_total?: number }[] } | null;
  if (!s?.system) throw new GpuError("That address answers, but not as ComfyUI");
  const dev = s.devices?.[0];
  return { device: dev?.name, vramBytes: typeof dev?.vram_total === "number" ? dev.vram_total : undefined, version: s.system.comfyui_version };
}

declare global {
  /** Each account's GPU as last asked (Your GPU: online or not, and what it is), for the status strip. */
  var __fuobeAccountGpus: Map<string, { url: string; at: number; online: boolean; info: GpuInfo }> | undefined;
  /** The checks on their way, one per account: status requests that arrive meanwhile wait for it. */
  var __fuobeAccountGpuChecks: Map<string, Promise<{ online: boolean } & GpuInfo>> | undefined;
}

/** What a status check reads of /system_stats at most: a ComfyUI's answer is a few KB. */
const STATUS_MAX_BYTES = 64 * 1024;

/**
 * Is the account's ComfyUI answering, and what is it? Asked at most every 30 s per account, and one check at a time:
 * status requests that arrive while one is on its way share its answer.
 */
export async function gpuState(id: string, gpu: AccountGpu): Promise<{ online: boolean; comfy?: "down" | "no-setting" } & GpuInfo> {
  // On the person's own computer: what its Fuobe tab last said (online while it beats and its ComfyUI answers; `comfy`:
  // the tab is open, but ComfyUI is closed or runs without Fuobe's setting).
  if (gpu.mode === "computer") {
    const f = runnerFacts(`acct:${id}`);
    return { online: !!f?.online, ...(f?.comfy && { comfy: f.comfy }), ...(f?.device && { device: f.device }), ...(f?.vramBytes && { vramBytes: f.vramBytes }), ...(f?.version && { version: f.version }) };
  }
  const cache = (globalThis.__fuobeAccountGpus ??= new Map());
  const hit = cache.get(id);
  if (hit && hit.url === gpu.url && Date.now() - hit.at < 30_000) return { online: hit.online, ...hit.info };
  const checks = (globalThis.__fuobeAccountGpuChecks ??= new Map());
  const key = `${id} ${gpu.url}`;
  const going = checks.get(key);
  if (going) return going;
  const check = (async () => {
    let online = false;
    let info: GpuInfo = hit?.url === gpu.url ? hit.info : {};
    try {
      info = await testGpu(gpu, { timeoutMs: 5000, maxBytes: STATUS_MAX_BYTES });
      online = true;
    } catch {}
    cache.set(id, { url: gpu.url, at: Date.now(), online, info });
    if (cache.size > 5000) cache.delete(cache.keys().next().value!);
    return { online, ...info };
  })().finally(() => checks.delete(key));
  checks.set(key, check);
  return check;
}

/**
 * The device type ("cuda", "cpu", "mps"…) of an account's ComfyUI as its last status check read it (the start of
 * /system_stats devices[0].name: "cuda:0 NVIDIA …"), without asking it again; undefined when no check of its saved
 * address has read one. A price check reads this and never calls the GPU (Split soundtrack's pick and time).
 */
export function lastGpuDevice(id: string): string | undefined {
  const gpu = accountGpu(id);
  // On the person's own computer: what its Fuobe tab last said.
  if (gpu?.mode === "computer") return /^[a-z]+/i.exec(runnerFacts(`acct:${id}`)?.device ?? "")?.[0].toLowerCase();
  const hit = globalThis.__fuobeAccountGpus?.get(id);
  if (!gpu || hit?.url !== gpu.url) return undefined;
  return /^[a-z]+/i.exec(hit.info.device ?? "")?.[0].toLowerCase();
}

/**
 * What someone's computer's Fuobe tab last said (an account's "this computer", or the owner's when ComfyUI runs on the
 * owner's computer): its GPU, memory, ComfyUI version and port, the guard and the cross-site setting, and whether it
 * is open now. Never an address, a token or anything of the server's.
 */
export function computerView(principal: Principal): OwnerGpuView {
  const f = runnerFacts(principal);
  return {
    mode: "computer" as const,
    online: !!f?.online,
    ...(f?.comfy && { comfy: f.comfy }),
    ...(f?.guard !== undefined && { guard: f.guard }),
    ...(f?.device && { device: f.device }),
    ...(f?.vramBytes && { vramBytes: f.vramBytes }),
    ...(f?.version && { version: f.version }),
    ...(f?.port && { port: f.port }),
    ...(f?.cors && { cors: f.cors }),
  };
}

/** What a visitor's status strip shows (GET /api/status): its own GPU, never the install's providers, servers or Demo mode. */
export interface VisitorView {
  kind: "guest" | "account";
  /** `mode` "computer": the ComfyUI on the person's own computer, which their Fuobe tab runs. */
  gpu: { connected: boolean; mode?: "link" | "computer"; online?: boolean; comfy?: "down" | "no-setting"; device?: string; vramBytes?: number };
  /** The providers it has its own key for that this server can open ("Your keys"): never a key. */
  keys: CloudProvider[];
  /** The studio lets accounts run paid models on their own keys (it isn't open-source only). */
  paidAllowed: boolean;
}

/**
 * GET /api/status for a guest or an account: ComfyUI is its own GPU (taken as there until it has one,
 * so the studios offer Generate and the run asks it to connect one), fal.ai and Replicate are its own
 * keys, the engine mode they allow (account-keys.ts), no Demo mode, and nothing of the install's own
 * servers, keys or addresses.
 */
export async function visitorStatus(account: Account | null) {
  const gpu = account ? accountGpu(account.id) : null;
  const live = account && gpu ? await gpuState(account.id, gpu) : null;
  const keys = account ? accountProviders(account.id) : [];
  const viewer: VisitorView = {
    kind: account ? "account" : "guest",
    gpu: gpu
      ? { connected: true, mode: gpu.mode === "computer" ? "computer" : "link", online: !!live?.online, ...(live?.comfy && { comfy: live.comfy }), ...(live?.device && { device: live.device }), ...(live?.vramBytes && { vramBytes: live.vramBytes }) }
      : { connected: false },
    keys,
    paidAllowed: paidAllowed(),
  };
  const configured = (id: string) => (id === "comfyui" ? (gpu ? !!live?.online : true) : isCloudProvider(id) && keys.includes(id));
  const access = keys.length ? offeredSummary() : undefined;
  return {
    providers: Object.fromEntries(Object.values(PROVIDERS).map((p) => [p.id, { label: p.id === "comfyui" ? "Your GPU" : p.label, configured: configured(p.id) }])),
    demoMode: "off",
    engineMode: account ? accountEngineMode(account.id) : "open",
    cloudProvider: "auto",
    onboarded: true,
    // Settings → Models & licences: the paid models the owner switched off stay out of its pickers too.
    ...(access && { access }),
    viewer,
  };
}
