import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { startFakeComfy, readyFor, type FakeComfy } from "./helpers/fake-comfy";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 30_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-gpu-api-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
delete process.env.FUOBE_GPU_PREFLIGHT;

const auth = await import("@/server/auth");
const { proxy } = await import("@/proxy");
const { loadIndex } = await import("@/server/gpu/index-file");
const { gpuTargetFor } = await import("@/server/gpu/target");
const { gateGeneration } = await import("@/server/gpu/gate");
const { db } = await import("@/server/db");
const { setSetting } = await import("@/server/settings");
const requirements = await import("@/app/api/gpu/requirements/route");
const readiness = await import("@/app/api/gpu/readiness/route");
const badges = await import("@/app/api/gpu/badges/route");
const check = await import("@/app/api/gpu/check/route");
const plan = await import("@/app/api/gpu/plan/route");
const inventory = await import("@/app/api/gpu/inventory/route");
const generations = await import("@/app/api/generations/route");

const idx = loadIndex();
const Z = "z-image-turbo-t2i";
/** The Image studio's default on your GPU (Ideogram 4: 24 GB, ComfyUI 0.42.0). */
const I4 = "ideogram4-t2i";
const fakes: FakeComfy[] = [];
afterAll(async () => {
  globalThis.__fuobeGpuTestTransport = undefined;
  await Promise.all(fakes.map((f) => f.close()));
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

/** Account GPUs live at "<name>.gpu.test:<port>"; the tests resolve those names to the fake server (no env switch). */
beforeAll(() => {
  auth.setPassword("install password");
  globalThis.__fuobeGpuTestTransport = { resolve: async (h) => (h.endsWith(".gpu.test") ? ["127.0.0.1"] : ["203.0.113.9"]), blocked: () => false };
});

async function fake(s: Parameters<typeof startFakeComfy>[0]) {
  const f = await startFakeComfy(s);
  fakes.push(f);
  return f;
}

let n = 0;
/** A new account whose GPU is this fake ComfyUI. Returns its session cookie value. */
function account(f: FakeComfy | null): { cookie: string; id: string } {
  const a = auth.createAccount(`gpu${++n}@example.com`, "long enough");
  if (f) auth.setAccountGpu(a.id, { url: `http://a${n}.gpu.test:${f.port}` });
  return { cookie: auth.createSession(a.id).value, id: a.id };
}

function req(url: string, o: { method?: string; cookie?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", "sec-fetch-site": "same-origin", ...o.headers };
  if (o.cookie) headers.cookie = `${auth.SESSION_COOKIE}=${o.cookie}`;
  return new NextRequest(`http://localhost:3000${url}`, { method: o.method ?? "GET", headers, ...(o.body !== undefined && { body: JSON.stringify(o.body) }) });
}

async function runCheck(cookie?: string, headers?: Record<string, string>) {
  const res = await check.POST(req("/api/gpu/check", { method: "POST", cookie, headers }));
  const text = res.status === 200 ? await res.text() : "";
  return { res, events: text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; step?: string; state?: string; report?: unknown; connected?: boolean }) };
}

describe("guests", () => {
  it("read the index, get { connected: false } for the board and chips, and a 401 for a check", async () => {
    const r = proxy(req("/api/gpu/requirements"));
    expect(r.headers.get("x-middleware-next")).toBe("1");
    const res = await requirements.GET(req("/api/gpu/requirements"));
    expect(res.headers.get("etag")).toBe(`"${idx.hash}"`);
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
    expect((await requirements.GET(req("/api/gpu/requirements", { headers: { "if-none-match": `"${idx.hash}"` } }))).status).toBe(304);
    for (const p of ["/api/gpu/readiness", "/api/gpu/badges"]) expect(await proxy(req(p)).json()).toMatchObject({ connected: false });
    expect(proxy(req("/api/gpu/check", { method: "POST" })).status).toBe(401);
    expect(proxy(req("/api/gpu/plan?ref=preset:app-face-swap")).status).toBe(401);
  });
});

describe("an account", () => {
  it("passes the proxy for its own reads and its check", () => {
    const { cookie } = account(null);
    for (const p of ["/api/gpu/readiness", "/api/gpu/badges", "/api/gpu/plan?ref=preset:app-face-swap"]) expect(proxy(req(p, { cookie })).headers.get("x-middleware-next"), p).toBe("1");
    expect(proxy(req("/api/gpu/check", { method: "POST", cookie })).headers.get("x-middleware-next")).toBe("1");
  });

  it("without a GPU gets { connected: false, reason: no-gpu }", async () => {
    const { cookie } = account(null);
    expect(await (await readiness.GET(req("/api/gpu/readiness", { cookie }))).json()).toMatchObject({ connected: false, reason: "no-gpu" });
    expect(await (await badges.GET(req("/api/gpu/badges", { cookie }))).json()).toMatchObject({ connected: false });
  });

  it("checks its own GPU only, streams the lines, then the board, reads only, and writes an audit row", async () => {
    const big = { version: "0.42.1", devices: [{ name: "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync", type: "cuda", vramGb: 24 }] };
    const f = await fake(readyFor(idx, [Z, I4], { manager: { api: "v4", installed: {} }, argv: ["main.py", "--enable-manager"], ...big }));
    const { cookie, id } = account(f);
    const { res, events } = await runCheck(cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("cache-control")).toContain("no-transform");
    const lines = events.filter((e) => e.type === "line");
    expect(lines.some((l) => l.step === "found" && l.state === "done")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "report", connected: true });
    expect(f.requests.length).toBeGreaterThan(5);
    expect(f.requests.filter((r) => r.method !== "GET")).toEqual([]);
    const view = await (await readiness.GET(req("/api/gpu/readiness", { cookie }))).json();
    const image = view.report.studios.find((s: { href: string }) => s.href === "/image");
    expect(image.tool.state).toBe("ready");
    const map = await (await badges.GET(req("/api/gpu/badges", { cookie }))).json();
    expect(map.connected).toBe(true);
    expect(map.models["oss-z-image-turbo#t2i"][0]).toBe("r");
    const rows = db().prepare("SELECT * FROM gpu_audit WHERE target_key = ?").all(`acct:${id}`) as { action: string; host: string; result: string }[];
    expect(rows[0]).toMatchObject({ action: "check", result: "ok" });
    expect(rows[0].host).toMatch(/gpu\.test/);
    // Again within 10 s: 429.
    expect((await runCheck(cookie)).res.status).toBe(429);
  });

  it("is refused a check from an API token, another site or a request that isn't from the page", async () => {
    const f = await fake(readyFor(idx, [Z]));
    const { cookie } = account(f);
    const { token } = auth.createToken("t");
    expect((await check.POST(req("/api/gpu/check", { method: "POST", headers: { authorization: `Bearer ${token}` } }))).status).toBe(403);
    expect((await check.POST(req("/api/gpu/check", { method: "POST", cookie, headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect((await check.POST(req("/api/gpu/check", { method: "POST", cookie, headers: { "sec-fetch-site": "none" } }))).status).toBe(403);
    expect((await inventory.PUT(req("/api/gpu/inventory", { method: "PUT", cookie, body: {} }))).status).toBe(409);
    expect(f.requests).toEqual([]);
  });

  it("never reaches the studio's own ComfyUI, by any scheme, port or path", async () => {
    setSetting("comfyUrl", "https://owner-comfy.example:8443");
    try {
      for (const url of ["https://owner-comfy.example/api", "http://OWNER-comfy.example.:9000"]) {
        const a = auth.createAccount(`own${++n}@example.com`, "long enough");
        auth.setAccountGpu(a.id, { url });
        const r = req("/api/gpu/check", { method: "POST", cookie: auth.createSession(a.id).value });
        expect(gpuTargetFor(r, "read")).toEqual({ kind: "none", reason: "refused" });
        const res = await check.POST(r);
        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe("Fuobe can't use this address. Connect your own ComfyUI.");
      }
    } finally {
      setSetting("comfyUrl", "http://127.0.0.1:8188");
    }
  });

  it("reaches 127.0.0.1 only through the test hook: without it fetchPublic refuses the address", async () => {
    const f = await fake(readyFor(idx, [Z]));
    const a = auth.createAccount(`loop${++n}@example.com`, "long enough");
    auth.setAccountGpu(a.id, { url: `http://localhost:${f.port}` });
    const saved = globalThis.__fuobeGpuTestTransport;
    globalThis.__fuobeGpuTestTransport = undefined;
    try {
      const { events } = await runCheck(auth.createSession(a.id).value);
      expect(events.at(-1)).toMatchObject({ type: "report", problem: "unreachable" });
      expect(f.requests).toEqual([]);
    } finally {
      globalThis.__fuobeGpuTestTransport = saved;
    }
  });

  it("gets a plan from refs only, never with a token, and a 400 for anything else", async () => {
    const s = readyFor(idx, [Z]);
    s.files = {};
    s.combos = {};
    const f = await fake(s);
    const { cookie } = account(f);
    await runCheck(cookie);
    const res = await plan.GET(req(`/api/gpu/plan?ref=${encodeURIComponent("model:oss-z-image-turbo#t2i")}`, { cookie }));
    const p = await res.json();
    expect(res.status).toBe(200);
    expect(["almost", "setup"]).toContain(p.state);
    expect(p.steps.some((x: { kind: string }) => x.kind === "model")).toBe(true);
    expect(p.commands.bash).toContain("curl -L -C - --fail");
    expect(p.alternatives.cloud).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(/token=/);
    for (const bad of ["https://evil.example/x", "model:../../etc#x", ""]) expect((await plan.GET(req(`/api/gpu/plan?ref=${encodeURIComponent(bad)}`, { cookie }))).status).toBe(400);
  });
});

describe("the gate before a run (§13.1)", () => {
  const body = { feature: "image", modelId: "oss-z-image-turbo", op: "t2i" as const, prompt: "a koi pond at night" };

  it("stops a run whose model is missing with 409 gpu-setup and the plan, before anything is queued", async () => {
    const s = readyFor(idx, [Z]);
    s.files = {};
    s.combos = {};
    const f = await fake(s);
    const { cookie } = account(f);
    await runCheck(cookie);
    const before = (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
    const res = await generations.POST(req("/api/generations", { method: "POST", cookie, body }));
    expect(res.status).toBe(409);
    expect(res.headers.get("x-fuobe-gpu-setup")).toBe("1");
    const j = await res.json();
    expect(j).toMatchObject({ code: "gpu-setup", ref: "model:oss-z-image-turbo#t2i" });
    expect(j.plan.steps.length).toBeGreaterThan(0);
    expect((db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n).toBe(before);
    expect(f.requests.some((r) => r.path.includes("/prompt"))).toBe(false);
  });

  it("lets it through when the check is unknown, when only graphics memory is short, or with gpuCheck skip", async () => {
    const plain = { request: { ...body, account: "x", engine: "open" as const }, route: { provider: "comfyui", endpoint: Z }, op: "t2i", modelId: "oss-z-image-turbo", actor: "x" };
    // No check yet.
    const fresh = account(await fake(readyFor(idx, [Z])));
    expect(await gateGeneration(gpuTargetFor(req("/", { cookie: fresh.cookie }), "read"), plain)).toEqual({ ok: true });
    // Everything there on a 4 GB card.
    const small = account(await fake(readyFor(idx, [Z], { devices: [{ name: "cuda:0 Small", type: "cuda", vramGb: 4 }] })));
    await runCheck(small.cookie);
    expect(await gateGeneration(gpuTargetFor(req("/", { cookie: small.cookie }), "read"), plain)).toEqual({ ok: true });
    // Something missing, but the person said run anyway.
    const s = readyFor(idx, [Z]);
    s.files = {};
    s.combos = {};
    const missing = account(await fake(s));
    await runCheck(missing.cookie);
    const t = gpuTargetFor(req("/", { cookie: missing.cookie }), "read");
    expect(await gateGeneration(t, { ...plain, skip: true })).toEqual({ ok: true });
    expect((await gateGeneration(t, plain)).ok).toBe(false);
    // A cloud route is never checked.
    expect(await gateGeneration(t, { ...plain, route: { provider: "fal", endpoint: "x" } })).toEqual({ ok: true });
  });

  it("is switched off with FUOBE_GPU_PREFLIGHT=0", async () => {
    process.env.FUOBE_GPU_PREFLIGHT = "0";
    try {
      const { cookie } = account(null);
      expect(await (await readiness.GET(req("/api/gpu/readiness", { cookie }))).json()).toMatchObject({ connected: false, reason: "off" });
      expect(await (await badges.GET(req("/api/gpu/badges", { cookie }))).json()).toMatchObject({ connected: false, off: true });
      expect((await check.POST(req("/api/gpu/check", { method: "POST", cookie }))).status).toBe(404);
    } finally {
      delete process.env.FUOBE_GPU_PREFLIGHT;
    }
  });
});

describe("no secrets and no installs", () => {
  it("keeps src/lib/gpu and src/server/gpu away from the owner's LoRA keys and from any Manager write", () => {
    const files = [...fs.readdirSync("src/lib/gpu").map((f) => `src/lib/gpu/${f}`), ...fs.readdirSync("src/server/gpu").map((f) => `src/server/gpu/${f}`)];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/withToken|ensureLorasOnComfy|prepareCloudLoras|server\/loras/);
      expect(text, f).not.toMatch(/queue\/(task|install|install_model|start|reset)|manager\/reboot|\/upload\/|"\/prompt"|internal\/logs/);
    }
    // Nothing that runs on its own (Assist, MCP, schedules) imports the pre-flight's server side.
    for (const f of fs.readdirSync("src/server/assist", { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(f)) continue;
      expect(fs.readFileSync(path.join("src/server/assist", f), "utf8"), f).not.toMatch(/server\/gpu|from "\.\.\/gpu/);
    }
    expect(fs.readFileSync("src/server/mcp.ts", "utf8")).not.toMatch(/server\/gpu|"\.\/gpu/);
  });
});
