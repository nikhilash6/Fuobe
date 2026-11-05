import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { placeOf } from "@/lib/place-name";
import { NextRequest } from "next/server";
import { listenOnFreePort, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 120_000 });
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

/**
 * The run surfaces beyond the studios' composer, for an account with no GPU of its own: Shorts, Cinema Studio and the
 * Image studio's palette lock reach this install's GPUs through the one gate, held once for the whole run; a tool that
 * reads its body itself gets the place and the price shown from the request's headers. With hosted runs off, and for an
 * account whose own GPU answers, nothing changes.
 */
const dir = tempDir("fuobe-hosted-surface-runs-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
delete process.env.ANTHROPIC_API_KEY;
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenOnFreePort(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "both", delayMs: 0, loras: [] }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const gpuRoute = await import("@/app/api/account/gpu/route");
const uploadsRoute = await import("@/app/api/uploads/route");
const sessionsRoute = await import("@/app/api/shorts/sessions/route");
const estimateRoute = await import("@/app/api/shorts/estimate/route");
const projectsRoute = await import("@/app/api/cinema/projects/route");
const generateRoute = await import("@/app/api/cinema/projects/[id]/generate/route");
const retryRoute = await import("@/app/api/cinema/projects/[id]/items/[generationId]/retry/route");
const lockRoute = await import("@/app/api/palettes/lock/route");
const { proxy } = await import("@/proxy");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const billing = await import("@/server/billing");
const hostedRun = await import("@/server/hosted-run");
const toolRun = await import("@/server/account-tool-run");
const { createGenerations } = await import("@/server/generations");
const { clearAccountLoras } = await import("@/server/account-loras");
const access = await import("@/lib/guest-access");

const CLIP = fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4"));

let fake: FakeBilling;
const ids: Record<string, string> = {};
const cookies: Record<string, string> = {};
beforeAll(async () => {
  fake = await startFakeBilling();
  auth.setPassword("install password");
  for (const who of ["none", "gpu"]) {
    ids[who] = auth.createAccount(`surfaces-${who}@example.com`, "long enough").id;
    cookies[who] = `${auth.SESSION_COOKIE}=${auth.createSession(ids[who]).value}`;
  }
  globalThis.__fuobeTestGpuPort = comfy.port;
  expect((await gpuRoute.PUT(json("/api/account/gpu", "PUT", { url: comfy.url }, "gpu"))).status).toBe(200);
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  globalThis.__fuobeTestGpuPort = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await fake.close();
  await comfy.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  delete process.env.FUOBE_HOSTED_RUNS;
  delete process.env.FUOBE_BILLING_URL;
  delete process.env.FUOBE_BILLING_TOKEN;
  for (const id of Object.values(ids)) clearAccountLoras(id);
  fake.policy = { hosted: true, pool: {}, uploads: { image: true, video: true, audio: true }, limits: { activeRuns: 7, waiting: 7, runsPerHour: 70, outputsPerRun: 4, maxMegapixels: 7, maxSeconds: 70, keepDays: 7, spaceBytes: 7 }, ttlS: 0 };
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

function json(url: string, method: string, body: unknown, who?: string, headers: Record<string, string> = {}): Request {
  const text = JSON.stringify(body);
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...(who && { cookie: cookies[who] }), ...headers },
    body: text,
  });
}
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) }) as never;
const viaProxy = (url: string, who?: string) =>
  proxy(new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: { host: "localhost:3000", ...(who && { cookie: cookies[who] }), "content-type": "application/json" }, body: "{}" }));
const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";

async function upload(who: string, data: Buffer, type: string, name: string): Promise<string> {
  const r = await uploadsRoute.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { host: "localhost:3000", cookie: cookies[who], "content-type": type, "x-file-name": name, "content-length": String(data.length) }, body: new Uint8Array(data) }));
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { url: string }).url;
}

/** The stored requests of an account's runs made since `since` (as the runner reads them). */
const runsSince = (who: string, since: number) =>
  (db().prepare("SELECT request_json FROM generations WHERE json_extract(request_json, '$.account') = ? AND created_at >= ? ORDER BY created_at").all(ids[who], since) as { request_json: string }[]).map(
    (r) => JSON.parse(r.request_json) as { place?: string; hold?: string; modelId: string },
  );
const reserves = () => fake.calls_of("/v1/reserve").length;
const hostedOn = () => {
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_BILLING_URL = fake.url;
  process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
};
const shownHeaders = () => ({ [access.RUN_SHOWN_HEADER]: access.shownHeader({ amount: fake.price.amount, priceVersion: fake.price.version }) });

/** A run that names a LoRA its ComfyUI lacks is answered with the file (409): put it there, then send it again. */
async function send(call: () => Promise<Response>): Promise<Response> {
  let r = await call();
  for (let i = 0; i < 3 && r.status === 409; i++) {
    const j = (await r.clone().json()) as { code: string; fix?: { items: { file: string }[] } };
    if (j.code !== "comfy_missing_model" || !j.fix) break;
    comfy.opts.loras = [...(comfy.opts.loras ?? []), ...j.fix.items.map((x) => x.file)];
    for (const id of Object.values(ids)) clearAccountLoras(id);
    r = await call();
  }
  return r;
}

describe("the place and the price shown, from a run's headers", () => {
  it("a body's own fields win; a header fills in what the body leaves out; a broken header is ignored", () => {
    const h = new Headers({ [access.RUN_PLACE_HEADER]: "pool", [access.RUN_SHOWN_HEADER]: access.shownHeader({ amount: 3, priceVersion: "v3" }) });
    expect(hostedRun.readWishes({}, h)).toEqual({ wish: "pool", shown: { amount: 3, priceVersion: "v3" } });
    expect(hostedRun.readWishes({ place: "own", shown: { amount: 1, priceVersion: "v1" } }, h)).toEqual({ wish: "own", shown: { amount: 1, priceVersion: "v1" } });
    expect(hostedRun.readWishes({}, new Headers({ [access.RUN_PLACE_HEADER]: "elsewhere", [access.RUN_SHOWN_HEADER]: "%7Bnot json" }))).toEqual({ wish: undefined, shown: null });
    expect(hostedRun.readWishes(null)).toEqual({ wish: undefined, shown: null });
  });

  it("a tool's run reads them when its route passed none: the price shown, and its own GPU asked for", async () => {
    hostedOn();
    const steps = [{ request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox in the snow" } }];
    const account = auth.accountById(ids.none)!;
    const start = () => createGenerations(steps[0].request);
    // No price shown: the run priced higher than nothing is asked about again (the card offers the new price).
    const bare = await toolRun.runAccountTool(json("/api/x", "POST", {}, "none"), account, { tool: "test", files: [], plan: () => steps, start });
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(((await bare.response.json()) as { code: string }).code).toBe("price-changed");
    // The same run sent again with the new price in a header starts, held once.
    const before = reserves();
    const since = Date.now();
    const again = await toolRun.runAccountTool(json("/api/x", "POST", {}, "none", shownHeaders()), account, { tool: "test", files: [], plan: () => steps, start });
    expect(again.ok).toBe(true);
    expect(reserves() - before).toBe(1);
    expect(runsSince("none", since).every((q) => q.place === "pool")).toBe(true);
    // Its own GPU asked for in a header: never this install's GPUs.
    expect(await toolRun.toolPriceCheck(json("/api/x?preview=1", "POST", {}, "gpu", { [access.RUN_PLACE_HEADER]: "own" }), () => steps)).toBeNull();
    const own = await toolRun.toolPriceCheck(json("/api/x?preview=1", "POST", {}, "gpu", { [access.RUN_PLACE_HEADER]: "pool" }), () => steps);
    expect(own?.place).toBe("pool");
  });
});

describe("Shorts for an account with no GPU of its own", () => {
  it("hosted runs on: the session runs on this install's GPUs as one run, held once; its estimate names the place", async () => {
    hostedOn();
    expect(passed(await viaProxy("/api/shorts/sessions", "none"))).toBe(true);
    const clip = await upload("none", CLIP, "video/mp4", "dance.mp4");
    const body = { engine: "open", presetId: "shorts-claymation", source: { url: clip, name: "dance.mp4" }, range: { start: 0, end: 10 }, aspectRatio: "9:16", language: "auto" };
    const est = await estimateRoute.POST(json("/api/shorts/estimate", "POST", body, "none"));
    expect(est.status, await est.clone().text()).toBe(200);
    const priced = (await est.json()) as { place?: string; quote?: { allowed: boolean; amount: number; priceVersion: string }; line?: { place: number } };
    expect(priced.place).toBe("pool");
    expect(priced.quote?.allowed).toBe(true);
    expect(priced.line?.place).toBeGreaterThanOrEqual(1);
    const before = reserves();
    const since = Date.now();
    const r = await send(() => sessionsRoute.POST(json("/api/shorts/sessions", "POST", body, "none", shownHeaders())));
    expect(r.status, await r.clone().text()).toBe(201);
    expect(reserves() - before).toBe(1);
    const rows = runsSince("none", since);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((q) => q.place === "pool")).toBe(true);
    expect(new Set(rows.map((q) => q.hold)).size).toBe(1);
  });

  it("an account whose own GPU answers keeps it: no hold, nothing stamped for this install's GPUs", async () => {
    hostedOn();
    const clip = await upload("gpu", CLIP, "video/mp4", "dance.mp4");
    const before = reserves();
    const since = Date.now();
    const body = { engine: "open", presetId: "shorts-claymation", source: { url: clip, name: "dance.mp4" }, range: { start: 0, end: 10 }, aspectRatio: "9:16", language: "auto" };
    const r = await send(() => sessionsRoute.POST(json("/api/shorts/sessions", "POST", body, "gpu")));
    expect(r.status, await r.clone().text()).toBe(201);
    expect(reserves()).toBe(before);
    expect(runsSince("gpu", since).some((q) => q.place === "pool")).toBe(false);
  });
});

describe("Cinema Studio for an account with no GPU of its own", () => {
  const STILL = { engine: "open", mode: "image", action: "generate", prompt: "A detective under a neon sign in the rain, a wide shot", batch: 1, aspectRatio: "16:9", settings: { camera: "modern", lens: "clean-sharp", focal: "35mm" } };
  const project = async (who: string) => {
    const r = await projectsRoute.POST(json("/api/cinema/projects", "POST", { name: "Night film" }, who));
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { id: string }).id;
  };

  it("hosted runs on: a take runs on this install's GPUs, held once; its price check names the place", async () => {
    hostedOn();
    const id = await project("none");
    const check = await generateRoute.POST(json(`/api/cinema/projects/${id}/generate?preview=1`, "POST", { input: STILL }, "none"), params({ id }));
    expect(check.status, await check.clone().text()).toBe(200);
    const priced = (await check.json()) as { place: string; quote?: { allowed: boolean } };
    expect(priced.place).toBe("pool");
    expect(priced.quote?.allowed).toBe(true);
    const before = reserves();
    const since = Date.now();
    const r = await send(() => generateRoute.POST(json(`/api/cinema/projects/${id}/generate`, "POST", { input: STILL }, "none", shownHeaders()), params({ id })));
    expect(r.status, await r.clone().text()).toBe(201);
    expect(reserves() - before).toBe(1);
    const rows = runsSince("none", since);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((q) => q.place === "pool" && !!q.hold)).toBe(true);
  });

  it("a batch of 4 when a run here makes one at a time: said in the price check and on Run, nothing held or made", async () => {
    hostedOn();
    fake.policy = { ...fake.policy, limits: { ...(fake.policy.limits as object), outputsPerRun: 1 } };
    const id = await project("none");
    const four = { ...STILL, batch: 4 };
    const words = hostedRun.gateText({ ok: false, reason: "outputs", cap: 1 }, false, placeOf(null));
    const check = await generateRoute.POST(json(`/api/cinema/projects/${id}/generate?preview=1`, "POST", { input: four }, "none"), params({ id }));
    expect(check.status, await check.clone().text()).toBe(200);
    expect(((await check.json()) as { quote?: { allowed: boolean; text: string } }).quote).toMatchObject({ allowed: false, text: words });
    const before = reserves();
    const since = Date.now();
    const r = await generateRoute.POST(json(`/api/cinema/projects/${id}/generate`, "POST", { input: four }, "none", shownHeaders()), params({ id }));
    expect(r.status, await r.clone().text()).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe(words);
    expect(reserves()).toBe(before);
    expect(runsSince("none", since)).toEqual([]);
    // One take at a time runs, priced and held for exactly what it makes.
    const one = await send(() => generateRoute.POST(json(`/api/cinema/projects/${id}/generate`, "POST", { input: STILL }, "none", shownHeaders()), params({ id })));
    expect(one.status, await one.clone().text()).toBe(201);
    expect(reserves() - before).toBe(1);
    const held = fake.calls_of("/v1/reserve").at(-1)!.body as { run: { jobs: number; outputsPerJob: number } };
    expect(held.run).toMatchObject({ jobs: 1, outputsPerJob: 1 });
    expect(runsSince("none", since)).toHaveLength(1);
  });

  it("one press of Generate sent twice is one take and one hold, in this server process or another; a retry too", async () => {
    hostedOn();
    const id = await project("none");
    const press = { input: STILL, requestId: "press-cinema-0001" };
    const before = reserves();
    const since = Date.now();
    const first = await send(() => generateRoute.POST(json(`/api/cinema/projects/${id}/generate`, "POST", press, "none", shownHeaders()), params({ id })));
    expect(first.status, await first.clone().text()).toBe(201);
    const answer = (await first.json()) as { items: { id: string }[] };
    const sent = fake.calls_of("/v1/reserve").at(-1)!.body as { requestId: string };
    expect(sent.requestId).toBe(`r_${crypto.createHash("sha256").update(`${ids.none}\ncinema:${id}\n${press.requestId}`).digest("hex").slice(0, 32)}`);
    const again = await generateRoute.POST(json(`/api/cinema/projects/${id}/generate`, "POST", press, "none", shownHeaders()), params({ id }));
    expect(((await again.json()) as { items: { id: string }[] }).items.map((g) => g.id)).toEqual(answer.items.map((g) => g.id));
    globalThis.__fuobeShortsRequests?.clear();
    const elsewhere = await generateRoute.POST(json(`/api/cinema/projects/${id}/generate`, "POST", press, "none", shownHeaders()), params({ id }));
    expect(elsewhere.status).toBe(201);
    expect(((await elsewhere.json()) as { items: { id: string }[] }).items.map((g) => g.id)).toEqual(answer.items.map((g) => g.id));
    expect(reserves() - before).toBe(1);
    expect(runsSince("none", since)).toHaveLength(answer.items.length);
    // A retry of a take: its own press, sent twice, is one run too.
    const take = answer.items[0].id;
    db().prepare("UPDATE generations SET status = 'failed' WHERE id = ?").run(take);
    const retry = () => retryRoute.POST(json(`/api/cinema/projects/${id}/items/${take}/retry`, "POST", { requestId: "press-retry-0001" }, "none", shownHeaders()), params({ id, generationId: take }));
    const r1 = await send(retry);
    expect(r1.status, await r1.clone().text()).toBe(201);
    globalThis.__fuobeShortsRequests?.clear();
    const r2 = await retry();
    expect(await r2.text()).toBe(await r1.text());
    expect(reserves() - before).toBe(2);
  });

  it("an account whose own GPU answers is priced and run there, as before", async () => {
    hostedOn();
    const id = await project("gpu");
    const check = await generateRoute.POST(json(`/api/cinema/projects/${id}/generate?preview=1`, "POST", { input: STILL }, "gpu"), params({ id }));
    expect(((await check.json()) as { place: string }).place).toBe("own");
    const before = reserves();
    const since = Date.now();
    const r = await send(() => generateRoute.POST(json(`/api/cinema/projects/${id}/generate`, "POST", { input: STILL }, "gpu"), params({ id })));
    expect(r.status, await r.clone().text()).toBe(201);
    expect(reserves()).toBe(before);
    expect(runsSince("gpu", since).some((q) => q.place === "pool")).toBe(false);
  });
});

describe("the Image studio's palette lock for accounts", () => {
  const lock = (who: string | undefined, extra: Record<string, unknown> = {}) =>
    lockRoute.POST(
      json("/api/palettes/lock", "POST", { request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a silk scarf on a marble table", params: { numOutputs: 2 }, signature: {} }, colors: ["#112233", "#aabbcc"], ...extra }, who),
    );

  it("hosted runs off: refused to every account as before, at the proxy and at the route; nothing runs on its own GPU", async () => {
    for (const who of ["none", "gpu", undefined]) {
      const at = await viaProxy("/api/palettes/lock", who);
      expect(at.status).toBe(403);
      expect(((await at.json()) as { code: string }).code).toBe("own-gpu-tool");
    }
    const since = Date.now();
    for (const who of ["none", "gpu"]) {
      const r = await lock(who);
      expect(r.status).toBe(403);
      expect(((await r.json()) as { code: string }).code).toBe("own-gpu-tool");
    }
    expect(runsSince("gpu", since)).toEqual([]);
    expect(runsSince("none", since)).toEqual([]);
    // A guest signs up first at the route.
    expect((await lock(undefined)).status).toBe(401);
  });

  it("hosted runs on: an account reaches the route, a guest signs up first; an own GPU that goes first keeps its colours in the prompt", async () => {
    hostedOn();
    expect(passed(await viaProxy("/api/palettes/lock", "none"))).toBe(true);
    expect(passed(await viaProxy("/api/palettes/lock", "gpu"))).toBe(true);
    const guest = await viaProxy("/api/palettes/lock");
    expect(guest.status).toBe(401);
    expect(guest.headers.get(access.GUEST_HEADER)).toBe("1");
    // Its own GPU goes first: the lock never runs there (the composer sends its colours in the prompt instead).
    const since = Date.now();
    const own = await lock("gpu");
    expect(own.status).toBe(403);
    expect(((await own.json()) as { code: string }).code).toBe("own-gpu-tool");
    expect(runsSince("gpu", since)).toEqual([]);
    // Asked for this install's GPUs by name, it runs there.
    const there = await send(() => lock("gpu", { place: "pool", shown: { amount: fake.price.amount, priceVersion: fake.price.version } }));
    expect(there.status, await there.clone().text()).toBe(201);
    const rows = runsSince("gpu", since);
    expect(rows.length).toBe(4);
    expect(rows.every((q) => q.place === "pool")).toBe(true);
  });

  it("hosted runs on: no more pictures at once than a run there makes, as a studio run there is cut", async () => {
    hostedOn();
    fake.policy = { ...fake.policy, limits: { ...(fake.policy.limits as object), outputsPerRun: 1 } };
    const since = Date.now();
    const r = await send(() =>
      lockRoute.POST(
        json(
          "/api/palettes/lock",
          "POST",
          { request: { feature: "image", modelId: "oss-z-image-turbo", prompt: "a silk scarf on a marble table", params: { numOutputs: 4 }, signature: {} }, colors: ["#112233"], shown: { amount: fake.price.amount, priceVersion: fake.price.version } },
          "none",
        ),
      ),
    );
    expect(r.status, await r.clone().text()).toBe(201);
    const rows = runsSince("none", since);
    // One picture and its recolouring.
    expect(rows.map((q) => q.modelId).sort()).toEqual(["oss-palette-image", "oss-z-image-turbo"]);
    const reserve = fake.calls_of("/v1/reserve").at(-1)!.body as { run: { steps: { model: string; jobs: number }[] } };
    expect(reserve.run.steps.find((s) => s.model === "oss-z-image-turbo")?.jobs).toBe(1);
  });

  it("hosted runs on: an account with no GPU gets both images and their recolouring as one run, held once", async () => {
    hostedOn();
    const before = reserves();
    const since = Date.now();
    const r = await send(() => lock("none", { shown: { amount: fake.price.amount, priceVersion: fake.price.version } }));
    expect(r.status, await r.clone().text()).toBe(201);
    expect(((await r.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
    expect(reserves() - before).toBe(1);
    const rows = runsSince("none", since);
    expect(rows.length).toBe(4);
    expect(rows.every((q) => q.place === "pool")).toBe(true);
    expect(new Set(rows.map((q) => q.hold)).size).toBe(1);
  });
});

void TINY_PNG;
