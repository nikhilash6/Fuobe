import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startLocalComfy, type LocalComfy } from "./helpers/fake-local-comfy";
import { loadRoutes, tab, type ComputerRoutes } from "./helpers/computer-tab";

/**
 * The owner's ComfyUI on a hosted studio: an address on the server's own machine or network is never called for a
 * hosted page, the owner's computer is reported honestly (GET /api/status ownerGpu, GET /api/comfyui), the isolated
 * worker's workflows are refused on a computer, a run nothing connected can make opens "Connect your GPU" for the
 * owner's own browser only, and a finished result is kept whatever ComfyUI's place is by then.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-owner-computer-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing answers here: no test may reach a real ComfyUI on this machine.
const DEAD = "http://127.0.0.1:9";
process.env.COMFYUI_URL = DEAD;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
globalThis.__fuobeTestDiskFree = 1e13;

// The server's own fetch: recorded. Anything but the stand-ins answers 599 at once (no real network).
const realFetch = globalThis.fetch;
const fetched: string[] = [];
let allowed: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  fetched.push(url);
  if (allowed.some((a) => url.startsWith(a))) return realFetch(input, init);
  return new Response("not reachable in this test", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const testRoute = await import("@/app/api/providers/test/route");
const statusRoute = await import("@/app/api/status/route");
const comfyuiRoute = await import("@/app/api/comfyui/route");
const generationsRoute = await import("@/app/api/generations/route");
const meRoute = await import("@/app/api/auth/me/route");
const { hostedAddressRefusal } = await import("@/server/providers/comfy-address");
const { getSetting, setSetting } = await import("@/server/settings");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { writeSnapshot } = await import("@/server/gpu/snapshots");
const { relayFile, ISOLATED_ON_COMPUTER } = await import("@/server/providers/comfyui");
const { asAccount, getGeneration } = await import("@/server/generations");
const { RELAY_WORDS, RUNS_ON_COMPUTER_NOTE } = await import("@/lib/relay");
const { CONNECT_GPU_HEADER } = await import("@/lib/guest-access");

let fake: LocalComfy;
let routes: ComputerRoutes;
let owner = "";
let account = "";
let accountId = "";
const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };

beforeAll(async () => {
  fake = await startLocalComfy({ cors: `http://${HOST}`, steps: 2, stepMs: 10, latencyMs: 10 });
  allowed = [fake.url];
  routes = await loadRoutes();
  auth.setPassword("install password");
  owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
  accountId = auth.createAccount("someone@example.com", "long enough").id;
  auth.setAccountGpu(accountId, { mode: "computer" });
  account = `${auth.SESSION_COOKIE}=${auth.createSession(accountId).value}`;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestDiskFree = undefined;
  await fake.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
beforeEach(() => {
  resetRates();
  setSetting("comfyWhere", "server");
  setSetting("comfyUrl", "");
  setSetting("engineMode", "open");
  setSetting("demoMode", "off");
  process.env.COMFYUI_URL = DEAD;
  delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
  db().prepare("DELETE FROM relay_runners").run();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

const request = (url: string, o: { method?: string; body?: unknown; cookie?: string | null; headers?: Record<string, string> } = {}) => {
  const text = o.body === undefined ? undefined : JSON.stringify(o.body);
  const headers: Record<string, string> = { ...SITE_HEADERS, ...(o.cookie !== null && { cookie: o.cookie ?? owner }), ...(text && { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }), ...o.headers };
  return new Request(`http://${HOST}${url}`, { method: o.method ?? (text ? "POST" : "GET"), headers, body: text });
};

/** POST /api/providers/test as the owner's page; what it answered, and every fetch the server made meanwhile. */
async function connectTest(body: Record<string, unknown>) {
  fetched.length = 0;
  const res = await testRoute.POST(request("/api/providers/test", { body: { provider: "comfyui", field: "comfyUrl", ...body } }));
  return { body: (await res.json()) as { ok: boolean; detail: string; code?: string }, fetched: [...fetched] };
}

const beat = (cookie: string, body: Record<string, unknown>) => routes.beat.POST(request("/api/gpu/computer/beat", { body: { device: "device-owner-1", ...body }, cookie }), { params: Promise.resolve({}) });
const status = async (cookie: string | null = owner) => (await (await statusRoute.GET(request("/api/status", { cookie }))).json()) as Record<string, unknown> & { providers: Record<string, { configured: boolean }>; ownerGpu?: Record<string, unknown> };

describe("a hosted page never makes the server call a ComfyUI address on its own machine or network", () => {
  const REFUSED = ["http://127.0.0.1:3399", "localhost:3399", "http://localhost:3399", "http://10.255.255.1:3399", "http://169.254.169.254", "http://169.254.0.1:3399", "http://nas.local:3399", "http://[::1]:3399", "http://studio:3399"];

  it.each(REFUSED)("%s: refused with one line, and nothing is fetched", async (url) => {
    const r = await connectTest({ values: { comfyUrl: url }, place: "hosted" });
    expect(r.body).toMatchObject({ ok: false, code: "on-your-computer" });
    expect(r.body.detail).toMatch(/is Fuobe's server, not your computer|is on your own network, which Fuobe's server can't reach/);
    expect(r.fetched).toEqual([]);
  });

  it("with nothing typed and only the built-in address, asks for one instead of calling it", async () => {
    // The built-in address is this machine's 8188: in effect only for this one synchronous call, so nothing else in the
    // test run can reach a real ComfyUI there meanwhile.
    fetched.length = 0;
    process.env.COMFYUI_URL = "";
    const answer = hostedAddressRefusal("comfyUrl", undefined);
    process.env.COMFYUI_URL = DEAD;
    expect(await answer).toEqual({ ok: false, code: "on-your-computer", detail: "Type the address of a ComfyUI that Fuobe's server can reach." });
    expect(fetched).toEqual([]);
  });

  it("a saved local address is refused too; the isolated worker's address as well", async () => {
    setSetting("comfyUrl", "http://127.0.0.1:3399");
    expect((await connectTest({ place: "hosted" })).body.code).toBe("on-your-computer");
    const iso = await connectTest({ field: "comfyIsolatedUrl", values: { comfyIsolatedUrl: "http://127.0.0.1:8189" }, place: "hosted" });
    expect(iso.body.code).toBe("on-your-computer");
    expect(iso.fetched).toEqual([]);
  });

  it("FUOBE_ALLOW_PRIVATE_URLS=1 lets a private address (a VPN) be tested, never this machine", async () => {
    process.env.FUOBE_ALLOW_PRIVATE_URLS = "1";
    const lan = await connectTest({ values: { comfyUrl: "http://10.255.255.1:3399" }, place: "hosted" });
    expect(lan.body.code).toBeUndefined();
    expect(lan.fetched.some((u) => u.startsWith("http://10.255.255.1:3399/system_stats"))).toBe(true);
    const self = await connectTest({ values: { comfyUrl: "http://127.0.0.1:3399" }, place: "hosted" });
    expect(self.body.code).toBe("on-your-computer");
    expect(self.fetched).toEqual([]);
    expect((await connectTest({ values: { comfyUrl: "http://169.254.169.254" }, place: "hosted" })).body.code).toBe("on-your-computer");
  });

  it("an address from COMFYUI_URL with nothing typed is tested as before (a GPU box that runs both)", async () => {
    process.env.COMFYUI_URL = fake.url;
    const r = await connectTest({ place: "hosted" });
    expect(r.body.ok).toBe(true);
    expect(r.fetched.some((u) => u.startsWith(`${fake.url}/system_stats`))).toBe(true);
  });

  it("without the page's word (a local install), a loopback address is tested as before", async () => {
    const r = await connectTest({ values: { comfyUrl: fake.url } });
    expect(r.body).toMatchObject({ ok: true });
    expect(r.body.detail).toMatch(/^ComfyUI 0\.42\.0/);
    expect(r.fetched.some((u) => u.startsWith(`${fake.url}/system_stats`))).toBe(true);
  });

  it("a public address is tested", async () => {
    const r = await connectTest({ values: { comfyUrl: "https://93.184.216.34:8188" }, place: "hosted" });
    expect(r.body.code).toBeUndefined();
    expect(r.fetched.some((u) => u.startsWith("https://93.184.216.34:8188/system_stats"))).toBe(true);
    // A reserved range the server won't call: refused, said as a network it can't reach.
    const reserved = await connectTest({ values: { comfyUrl: "http://203.0.113.9:8188" }, place: "hosted" });
    expect(reserved.body).toEqual({ ok: false, code: "on-your-computer", detail: "203.0.113.9 is on your own network, which Fuobe's server can't reach." });
    expect(reserved.fetched).toEqual([]);
  });

  it("a name that leads to this machine or a private network is refused, without saying where it leads", async () => {
    const to = (ips: string[]) => async () => ips;
    expect(await hostedAddressRefusal("comfyUrl", "https://sneaky.example.com", { resolve: to(["127.0.0.1"]) })).toEqual({ ok: false, code: "on-your-computer", detail: "sneaky.example.com leads to a private address, so Fuobe's server won't call it." });
    const priv = await hostedAddressRefusal("comfyUrl", "https://lan.example.com", { resolve: to(["93.184.216.34", "10.0.0.5"]) });
    expect(priv?.code).toBe("on-your-computer");
    expect(priv?.detail).not.toContain("10.");
    expect(await hostedAddressRefusal("comfyUrl", "https://meta.example.com", { resolve: to(["169.254.169.254"]) })).not.toBeNull();
    expect(await hostedAddressRefusal("comfyUrl", "https://gpu.example.com", { resolve: to(["93.184.216.34"]) })).toBeNull();
    // A name that doesn't resolve goes on: the test itself says it can't reach it.
    expect(await hostedAddressRefusal("comfyUrl", "https://nowhere.example.com", { resolve: async () => Promise.reject(new Error("ENOTFOUND")) })).toBeNull();
  });

  it("while ComfyUI runs on the owner's computer, a server address is tested as a server when the page says so", async () => {
    setSetting("comfyWhere", "computer");
    // As before: the computer's word (no tab open).
    expect((await connectTest({ values: { comfyUrl: fake.url } })).body).toEqual({ ok: false, detail: RELAY_WORDS.noComputer });
    // With comfyWhere "server" among the values: the address itself answers.
    const r = await connectTest({ values: { comfyUrl: fake.url, comfyWhere: "server" } });
    expect(r.body.ok).toBe(true);
    expect(r.body.detail).not.toMatch(/on your computer/);
    expect(r.fetched.some((u) => u.startsWith(`${fake.url}/system_stats`))).toBe(true);
    // Nothing was saved by the test.
    expect(getSetting("comfyWhere")).toBe("computer");
  });
});

describe("the owner's computer in GET /api/status", () => {
  const KEYS = ["mode", "online", "comfy", "guard", "device", "vramBytes", "version", "port", "cors"];

  it("is absent in server mode, and said honestly in computer mode while ComfyUI stays configured", async () => {
    expect((await status()).ownerGpu).toBeUndefined();
    setSetting("comfyWhere", "computer");
    let s = await status();
    expect(s.ownerGpu).toEqual({ mode: "computer", online: false });
    expect(s.providers.comfyui.configured).toBe(true);

    expect((await beat(owner, { port: 8188, facts: { device: "cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync", vramBytes: 34_190_000_000, version: "0.42.0", cors: "exact", guard: true } })).status).toBe(200);
    s = await status();
    expect(s.ownerGpu).toEqual({ mode: "computer", online: true, guard: true, device: "cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync", vramBytes: 34_190_000_000, version: "0.42.0", port: 8188, cors: "exact" });
    for (const k of Object.keys(s.ownerGpu!)) expect(KEYS).toContain(k);

    await beat(owner, { ready: false });
    s = await status();
    expect(s.ownerGpu).toMatchObject({ online: false, comfy: "down" });
    await beat(owner, { ready: false, why: "setting" });
    expect((await status()).ownerGpu).toMatchObject({ online: false, comfy: "no-setting" });
    expect((await status()).providers.comfyui.configured).toBe(true);
  });

  it("is never in a guest's or an account's", async () => {
    setSetting("comfyWhere", "computer");
    await beat(owner, { facts: { device: "cuda:0 NVIDIA GeForce RTX 5090" } });
    for (const who of [null, account]) {
      const s = await status(who);
      expect(s.ownerGpu, String(who)).toBeUndefined();
      expect(JSON.stringify(s)).not.toContain("RTX 5090");
    }
  });
});

describe("GET /api/comfyui while ComfyUI runs on the owner's computer", () => {
  it("never asks a ComfyUI from here: checkmarks come from the computer's last check, none before one", async () => {
    setSetting("comfyWhere", "computer");
    fetched.length = 0;
    let body = await (await comfyuiRoute.GET(request("/api/comfyui"))).json();
    expect(body).toMatchObject({ reachable: false, where: "computer", checkedAt: null });
    const models = (body.workflows as { models: { file: string; folder: string; present: boolean | null }[] }[]).flatMap((w) => w.models);
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.present === null)).toBe(true);

    // The computer's tab sent a check: one folder has one file.
    const first = models[0];
    const have = { [first.file.split("/").pop()!]: 123 };
    const at = Date.now();
    writeSnapshot(
      { kind: "computer", key: "install", via: "browser" },
      { v: 1, via: "browser", checkedAt: at, tookMs: 10, reachable: true, devices: [], manager: { api: "none" }, nodes: { have: [], missing: [], total: 0, readAt: at, how: "object_info" }, combos: {}, packs: {}, models: { [first.folder]: { have, total: 1 } }, loras: {}, fingerprint: "x", errors: [] } as never,
    );
    await beat(owner, {});
    body = await (await comfyuiRoute.GET(request("/api/comfyui"))).json();
    expect(body).toMatchObject({ reachable: true, where: "computer", checkedAt: at });
    const after = (body.workflows as { models: { file: string; folder: string; present: boolean | null }[] }[]).flatMap((w) => w.models);
    expect(after.find((m) => m.file === first.file && m.folder === first.folder)?.present).toBe(true);
    expect(after.some((m) => m.folder === first.folder && m.file !== first.file && m.present === false)).toBe(true);
    // Folders the check didn't read stay unknown.
    expect(after.some((m) => m.folder !== first.folder && m.present === null)).toBe(true);
    expect(fetched).toEqual([]);
  });

  it("tells an account nothing of the owner's", async () => {
    setSetting("comfyWhere", "computer");
    const body = await (await comfyuiRoute.GET(request("/api/comfyui", { cookie: account }))).json();
    expect(body.reachable).toBeNull();
    expect(body.where).toBeUndefined();
    expect((body.workflows as { models: { present: unknown }[] }[]).every((w) => w.models.every((m) => m.present === null))).toBe(true);
  });
});

describe("runs", () => {
  const run = (body: Record<string, unknown>, o: { cookie?: string; headers?: Record<string, string> } = {}) => generationsRoute.POST(request("/api/generations", { body, ...o }));
  const relayTasks = () => (db().prepare("SELECT COUNT(*) AS n FROM relay_tasks").get() as { n: number }).n;

  it("a workflow for the isolated worker is refused on the owner's computer before anything is queued", async () => {
    setSetting("comfyWhere", "computer");
    const before = relayTasks();
    const r = await run({ feature: "audio", modelId: "oss-thinksound", prompt: "a door slams" });
    const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(422);
    expect(j.error).toBe(ISOLATED_ON_COMPUTER);
    expect(relayTasks()).toBe(before);
  });

  it("nothing connected runs it: the owner's own page gets the Connect your GPU marker, a script's token never does", async () => {
    const page = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" });
    expect(page.status).toBe(422);
    expect(page.headers.get(CONNECT_GPU_HEADER)).toBe("1");
    expect(await page.json()).toMatchObject({ code: "connect-gpu", error: "Connect ComfyUI in Settings to run this model" });

    const { token } = auth.createToken("script");
    const script = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" }, { cookie: null as never, headers: { authorization: `Bearer ${token}` } });
    expect(script.status).toBe(422);
    expect(script.headers.get(CONNECT_GPU_HEADER)).toBeNull();
    expect((await script.json()).code).toBeUndefined();

    // An account's refusal is its own (403), as before.
    auth.setAccountGpu(accountId, null);
    try {
      const acct = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" }, { cookie: account });
      expect(acct.status).toBe(403);
      expect(acct.headers.get(CONNECT_GPU_HEADER)).toBe("1");
    } finally {
      auth.setAccountGpu(accountId, { mode: "computer" });
    }
  });

  it("a script's open-source run while ComfyUI is on the owner's computer says it waits for that computer", async () => {
    setSetting("comfyWhere", "computer");
    const { token } = auth.createToken("script 2");
    const r = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" }, { cookie: null as never, headers: { authorization: `Bearer ${token}` } });
    const j = await r.json();
    expect(r.status, JSON.stringify(j)).toBe(201);
    expect(j.notes).toContain(RUNS_ON_COMPUTER_NOTE);
  });

  it("a finished result on the owner's computer is the owner's alone, and is kept if ComfyUI moved meanwhile", async () => {
    setSetting("comfyWhere", "computer");
    const r = await run({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse at dusk" });
    expect(r.status).toBe(201);
    const id = ((await r.json()).items as { id: string }[])[0].id;
    const tick = () => globalThis.__fuobeRunner?.tick();
    const task = async () => db().prepare("SELECT id, state, principal FROM relay_tasks WHERE generation_id = ?").get(id) as { id: string; state: string; principal: string } | undefined;
    for (let i = 0; i < 200 && !(await task()); i++) {
      await tick();
      await new Promise((res) => setTimeout(res, 20));
    }
    expect((await task())?.principal).toBe("owner");
    // An account's tab never gets the owner's job.
    const theirs = tab(routes, account, fake.port, { device: "device-acct-1" });
    await theirs.runner.beat();
    await theirs.runner.claimAndRun();
    expect((await task())?.state).toBe("waiting");
    // The owner's tab runs it to the end of the task (the server hasn't kept the result yet).
    const mine = tab(routes, owner, fake.port, { device: "device-owner-1" });
    await mine.runner.beat();
    await mine.runner.claimAndRun();
    const t = await task();
    expect(t?.state).toBe("done");
    const url = `relay:${t!.id}/view?filename=x.png&n=0`;
    // ComfyUI moves to the server just then: the owner's result is still found, never as an account.
    setSetting("comfyWhere", "server");
    expect(relayFile(url)).not.toBeNull();
    expect(asAccount(accountId, () => relayFile(url))).toBeNull();
    for (let i = 0; i < 100; i++) {
      await tick();
      const g = getGeneration(id);
      if (g && g.status !== "queued" && g.status !== "running") break;
      await new Promise((res) => setTimeout(res, 30));
    }
    expect(getGeneration(id)?.status).toBe("succeeded");
  });
});

describe("no owner secret reaches a page", () => {
  it("not the ComfyUI token, not a key, not in any answer the owner's or a visitor's page reads", async () => {
    setSetting("comfyToken", "comfy-secret-token-123456");
    setSetting("anthropicKey", "sk-ant-secret-key-123456");
    setSetting("comfyWhere", "computer");
    await beat(owner, { facts: { device: "cuda:0 NVIDIA GeForce RTX 5090" } });
    try {
      const answers = [
        await (await statusRoute.GET(request("/api/status"))).text(),
        await (await statusRoute.GET(request("/api/status", { cookie: account }))).text(),
        await (await meRoute.GET(request("/api/auth/me"))).text(),
        await (await comfyuiRoute.GET(request("/api/comfyui"))).text(),
        await (await routes.claim.POST(request("/api/gpu/computer/claim", { body: { device: "device-owner-1" } }), { params: Promise.resolve({}) })).text(),
      ];
      for (const a of answers) {
        expect(a).not.toContain("comfy-secret-token");
        expect(a).not.toContain("sk-ant-secret");
      }
    } finally {
      setSetting("comfyToken", "");
      setSetting("anthropicKey", "");
    }
  });
});
