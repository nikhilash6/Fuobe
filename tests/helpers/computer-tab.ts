/**
 * A Fuobe tab in tests: the real runner (src/lib/computer-runner.ts) with the routes of src/app/api/gpu/computer called
 * as handlers (the session cookie, this site's own origin), and a ComfyUI on this computer reached as a browser on the
 * site reaches it: the site's Origin and Sec-Fetch-Site go with every request, and an answer without the CORS header for
 * the site is a network error, as in a browser.
 */
import { ComputerRunner, type RunnerDeps } from "@/lib/computer-runner";

export const SITE = "http://localhost:3000";
const realFetch = globalThis.fetch;

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

export interface ComputerRoutes {
  beat: { POST: Handler };
  claim: { POST: Handler };
  inputs: { GET: Handler };
  report: { POST: Handler };
  outputs: { PUT: Handler; GET: Handler };
  release: { POST: Handler };
}

export async function loadRoutes(): Promise<ComputerRoutes> {
  return {
    beat: (await import("@/app/api/gpu/computer/beat/route")) as never,
    claim: (await import("@/app/api/gpu/computer/claim/route")) as never,
    inputs: (await import("@/app/api/gpu/computer/tasks/[id]/inputs/[n]/route")) as never,
    report: (await import("@/app/api/gpu/computer/tasks/[id]/report/route")) as never,
    outputs: (await import("@/app/api/gpu/computer/tasks/[id]/outputs/[n]/route")) as never,
    release: (await import("@/app/api/gpu/computer/tasks/[id]/release/route")) as never,
  };
}

/** Requests from Fuobe's own page with this cookie (and any headers given), sent to the route handlers. */
export function apiAs(routes: ComputerRoutes, cookie: string | null, extra: Record<string, string> = {}): RunnerDeps["api"] & { calls: string[] } {
  const calls: string[] = [];
  const api = async (p: string, init: RequestInit = {}) => {
    const url = new URL(p, SITE);
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    headers.set("host", "localhost:3000");
    if (!headers.has("sec-fetch-site")) headers.set("sec-fetch-site", "same-origin");
    if (!headers.has("origin")) headers.set("origin", SITE);
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    let body = init.body as BodyInit | null | undefined;
    if (body instanceof Blob) body = Buffer.from(await body.arrayBuffer());
    if (body instanceof Uint8Array || typeof body === "string") headers.set("content-length", String(typeof body === "string" ? Buffer.byteLength(body) : body.byteLength));
    const req = new Request(url, { method: init.method ?? "GET", headers, body: body ?? undefined, duplex: "half" } as RequestInit);
    const method = req.method;
    calls.push(`${method} ${url.pathname}`);
    const params = (o: Record<string, string>) => ({ params: Promise.resolve(o) });
    let m: RegExpExecArray | null;
    if (url.pathname === "/api/gpu/computer/beat") return routes.beat.POST(req, params({}));
    if (url.pathname === "/api/gpu/computer/claim") return routes.claim.POST(req, params({}));
    if ((m = /^\/api\/gpu\/computer\/tasks\/([^/]+)\/inputs\/([^/]+)$/.exec(url.pathname))) return routes.inputs.GET(req, params({ id: m[1], n: m[2] }));
    if ((m = /^\/api\/gpu\/computer\/tasks\/([^/]+)\/report$/.exec(url.pathname))) return routes.report.POST(req, params({ id: m[1] }));
    if ((m = /^\/api\/gpu\/computer\/tasks\/([^/]+)\/outputs\/([^/]+)$/.exec(url.pathname))) return (method === "PUT" ? routes.outputs.PUT : routes.outputs.GET)(req, params({ id: m[1], n: m[2] }));
    if ((m = /^\/api\/gpu\/computer\/tasks\/([^/]+)\/release$/.exec(url.pathname))) return routes.release.POST(req, params({ id: m[1] }));
    return new Response("no such route", { status: 404 });
  };
  return Object.assign(api, { calls });
}

/** fetch() to the ComfyUI on this computer, as a browser on SITE sends it and reads the answer. */
export function browserLocal(site = SITE): RunnerDeps["local"] & { urls: string[] } {
  const urls: string[] = [];
  const local = async (url: string, init: RequestInit = {}) => {
    urls.push(url);
    const headers = new Headers(init.headers);
    headers.set("origin", site);
    headers.set("sec-fetch-site", "cross-site");
    const { mode, ...rest } = init;
    const res = await realFetch(url, { ...rest, headers });
    if (mode === "no-cors") return new Response(null, { status: 200 });
    const allow = res.headers.get("access-control-allow-origin");
    if (allow !== site && allow !== "*") {
      await res.body?.cancel().catch(() => {});
      throw new TypeError("Failed to fetch");
    }
    return res;
  };
  return Object.assign(local, { urls });
}

export const sha256 = async (data: ArrayBuffer) => Buffer.from(await crypto.subtle.digest("SHA-256", data)).toString("hex");

/** A tab on this computer for `cookie`, its ComfyUI on `port` (`local`: how it reaches it, when not as a browser does). */
export function tab(routes: ComputerRoutes, cookie: string, port: number, o: { device?: string; clientId?: string; local?: RunnerDeps["local"]; access?: "ask" | "blocked" } = {}) {
  const api = apiAs(routes, cookie);
  const local = o.local ?? browserLocal();
  const runner = new ComputerRunner(
    { api, local, socket: (url) => new WebSocket(url) as never, sha256, origin: SITE, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))) },
    { device: o.device ?? "device-test-1", port, clientId: o.clientId ?? "client-test-1", ...(o.access && { access: o.access }) },
  );
  return { runner, api, local };
}
