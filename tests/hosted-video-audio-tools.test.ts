import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listenOnFreePort, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 120_000 });
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

/**
 * The Video tools (Remove object, Evolution, Mixed Media, Katana, Turnaround's estimate), the Audio tools and Translate &
 * dub for an account with no GPU of its own: with hosted runs on, each price check names its place on this install's
 * GPUs with the price and the line, and the run goes there through the one gate, held once for the whole run. With
 * hosted runs off, and for an account whose own GPU answers, nothing changes.
 */
const dir = tempDir("fuobe-hosted-video-audio-tools-");
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
const routes = {
  removeEstimate: await import("@/app/api/remove-object/estimate/route"),
  remove: await import("@/app/api/remove-object/route"),
  evolutionEstimate: await import("@/app/api/evolution/estimate/route"),
  evolution: await import("@/app/api/evolution/route"),
  mixedEstimate: await import("@/app/api/mixed-media/estimate/route"),
  mixed: await import("@/app/api/mixed-media/route"),
  katana: await import("@/app/api/katana/route"),
  turnaroundEstimate: await import("@/app/api/turnaround/estimate/route"),
  audio: await import("@/app/api/audio-tools/route"),
  dub: await import("@/app/api/dub/route"),
  restoreEstimate: await import("@/app/api/restore/estimate/route"),
  restore: await import("@/app/api/restore/route"),
};
const { ownSetupLabel, ownSetupOnly } = await import("@/lib/own-setup");
type OwnSetup = import("@/lib/own-setup").OwnSetup;
const { saveAccountKey } = await import("@/server/account-keys");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const billing = await import("@/server/billing");
const { clearAccountLoras } = await import("@/server/account-loras");
const { HOSTED_WORDS } = await import("@/server/hosted");

const CLIP = fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4"));
const src = { duration: 12, fps: 16, width: 72, height: 128, hasAudio: true };

let fake: FakeBilling;
const ids: Record<string, string> = {};
const cookies: Record<string, string> = {};
beforeAll(async () => {
  fake = await startFakeBilling();
  fake.price = { amount: 0, version: "free" };
  auth.setPassword("install password");
  for (const who of ["none", "gpu", "key"]) {
    ids[who] = auth.createAccount(`tools-${who}@example.com`, "long enough").id;
    cookies[who] = `${auth.SESSION_COOKIE}=${auth.createSession(ids[who]).value}`;
  }
  // "key" has a fal.ai key of its own and no GPU.
  saveAccountKey(ids.key, "fal", "fal-test-key-0001");
  globalThis.__fuobeTestGpuPort = comfy.port;
  expect((await gpuRoute.PUT(json("/api/account/gpu", "PUT", { url: comfy.url }, "gpu"))).status).toBe(200);
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  globalThis.__fuobeTestGpuPort = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN", "FUOBE_POOL_MEDIA_INPUTS"]) delete process.env[k];
  await fake.close();
  await comfy.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  for (const id of Object.values(ids)) clearAccountLoras(id);
  fake.policy = { hosted: true, pool: {}, uploads: { image: true, video: true, audio: true }, limits: { activeRuns: 7, waiting: 7, runsPerHour: 70, outputsPerRun: 4, maxMegapixels: 7, maxSeconds: 70, keepDays: 7, spaceBytes: 7 }, ttlS: 0 };
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

function json(url: string, method: string, body: unknown, who?: string): Request {
  const text = JSON.stringify(body);
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...(who && { cookie: cookies[who] }) },
    body: text,
  });
}
async function upload(who: string, data: Buffer, type: string, name: string): Promise<string> {
  const r = await uploadsRoute.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { host: "localhost:3000", cookie: cookies[who], "content-type": type, "x-file-name": name, "content-length": String(data.length) }, body: new Uint8Array(data) }));
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { url: string }).url;
}
const hostedOn = () => {
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_BILLING_URL = fake.url;
  process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
};
const places = (who: string, since: number) =>
  (db().prepare("SELECT request_json FROM generations WHERE json_extract(request_json, '$.account') = ? AND created_at >= ? ORDER BY created_at").all(ids[who], since) as { request_json: string }[]).map(
    (r) => (JSON.parse(r.request_json) as { place?: string }).place ?? "own",
  );
const reserves = () => fake.calls_of("/v1/reserve").length;

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

type Tool = {
  name: string;
  /** The price check: its route and body. */
  check: (files: Files) => [{ POST: (r: Request) => Promise<Response> }, string, unknown];
  /** The run itself (none: the price check only). */
  run?: (files: Files) => [{ POST: (r: Request) => Promise<Response> }, string, unknown];
  /** A step this install's GPUs don't carry yet (the tool's own LoRAs): refused there before Run. */
  ownOnly?: boolean;
};
type Files = { clip: string; pic: string };

const removal = (f: Files) => ({ engine: "open", mode: "type", prompt: "the skateboard", source: { url: f.clip, name: "skate.mp4", ...src }, range: { start: 0, end: 3 } });
const evolution = (f: Files) => ({ engine: "open", source: { url: f.clip, ...src }, range: { start: 0, end: 6 }, direction: "A paper world." });
const mixed = (f: Files) => ({ engine: "open", presetId: "mixed-sketch", source: { url: f.clip, ...src }, range: { start: 0, end: 1 }, fps: 4, resolution: "1K" });
const katana = (f: Files) => ({ engine: "open", reference: f.clip, photos: [f.pic], segments: [{ start: 0, end: 3 }], duration: 12 });
const split = (f: Files) => ({ tool: "split", engine: "open", media: f.clip, kind: "video" });
const dub = (f: Files) => ({ engine: "open", mode: "steps", video: f.clip, targets: ["es"] });

const TOOLS: Tool[] = [
  { name: "Remove object", check: (f) => [routes.removeEstimate, "/api/remove-object/estimate", removal(f)], run: (f) => [routes.remove, "/api/remove-object", removal(f)] },
  { name: "Evolution", check: (f) => [routes.evolutionEstimate, "/api/evolution/estimate", evolution(f)], run: (f) => [routes.evolution, "/api/evolution", evolution(f)] },
  { name: "Mixed Media", check: (f) => [routes.mixedEstimate, "/api/mixed-media/estimate", mixed(f)], run: (f) => [routes.mixed, "/api/mixed-media", mixed(f)], ownOnly: true },
  { name: "Katana", check: (f) => [routes.katana, "/api/katana?preview=1", katana(f)], run: (f) => [routes.katana, "/api/katana", katana(f)] },
  { name: "Turnaround", check: (f) => [routes.turnaroundEstimate, "/api/turnaround/estimate", { engine: "open", views: { front: f.pic, back: f.pic } }], ownOnly: true },
  { name: "Split soundtrack", check: (f) => [routes.audio, "/api/audio-tools?preview=1", split(f)], run: (f) => [routes.audio, "/api/audio-tools", split(f)] },
  { name: "Translate & dub", check: (f) => [routes.dub, "/api/dub?preview=1", dub(f)], run: (f) => [routes.dub, "/api/dub", dub(f)] },
];

const filesOf = async (who: string): Promise<Files> => ({ clip: await upload(who, CLIP, "video/mp4", "clip.mp4"), pic: await upload(who, TINY_PNG, "image/png", "me.png") });
const call = (who: string, [route, url, body]: [{ POST: (r: Request) => Promise<Response> }, string, unknown]) => route.POST(json(url, "POST", body, who));

describe("hosted runs on: an account with no GPU of its own runs them on this install's GPUs", () => {
  beforeEach(hostedOn);
  for (const t of TOOLS) {
    it(`${t.name}: its price check names the place, and its run is held once with every step there`, async () => {
      const f = await filesOf("none");
      const check = await call("none", t.check(f));
      expect(check.status, await check.clone().text()).toBe(200);
      const priced = (await check.json()) as { place?: string; quote?: { allowed: boolean; text: string }; line?: { place: number } };
      expect(priced.place, JSON.stringify(priced)).toBe("pool");
      expect(priced.line?.place).toBeGreaterThan(0);
      if (t.ownOnly) {
        // A step this install's GPUs don't carry yet (its own LoRAs): Run stays off and says so; pressed anyway, nothing is held or made.
        expect(priced.quote).toMatchObject({ allowed: false, text: HOSTED_WORDS.notOffered });
        if (!t.run) return;
        const before = reserves();
        const since = Date.now();
        const r = await call("none", t.run(f));
        expect(r.status).toBe(403);
        expect(((await r.json()) as { error: string }).error).toBe(HOSTED_WORDS.notOffered);
        expect(reserves()).toBe(before);
        expect(places("none", since)).toEqual([]);
        return;
      }
      expect(priced.quote?.allowed, JSON.stringify(priced.quote)).toBe(true);
      if (!t.run) return;
      const before = reserves();
      const since = Date.now();
      const r = await send(() => call("none", t.run!(f)));
      expect(r.status, await r.clone().text()).toBe(201);
      expect(reserves() - before).toBe(1);
      const made = places("none", since);
      expect(made.length).toBeGreaterThan(0);
      expect(made.every((p) => p === "pool")).toBe(true);
    });
  }

  it("an account whose own GPU answers keeps it: no place in its price check, and its run stays on its GPU", async () => {
    const f = await filesOf("gpu");
    for (const t of TOOLS) {
      const check = await call("gpu", t.check(f));
      expect(((await check.json()) as { place?: string }).place, t.name).toBeUndefined();
    }
    const since = Date.now();
    const before = reserves();
    for (const t of TOOLS.filter((x) => x.run && !x.ownOnly)) {
      // One at a time, as the account's limit on runs going at once asks.
      db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
      const r = await send(() => call("gpu", t.run!(f)));
      expect(r.status, `${t.name}: ${await r.clone().text()}`).toBe(201);
    }
    expect(reserves()).toBe(before);
    const made = places("gpu", since);
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((p) => p === "own")).toBe(true);
  });
});

describe("hosted runs on: one press of Run is one run and one hold, however often it is sent", () => {
  beforeEach(hostedOn);
  const pressed: [string, (f: Files) => [{ POST: (r: Request) => Promise<Response> }, string, unknown], string][] = [
    ["Split soundtrack", (f) => [routes.audio, "/api/audio-tools", { ...split(f), requestId: "press-split-0001" }], "audio-tools"],
    ["Translate & dub", (f) => [routes.dub, "/api/dub", { ...dub(f), requestId: "press-dub-00001" }], "dub"],
  ];
  for (const [name, run, scope] of pressed) {
    it(`${name}: a resend gets the first run, in this server process or another`, async () => {
      const f = await filesOf("none");
      db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
      const before = reserves();
      const since = Date.now();
      const first = await send(() => call("none", run(f)));
      expect(first.status, await first.clone().text()).toBe(201);
      const answer = await first.text();
      const rows = places("none", since).length;
      expect(rows).toBeGreaterThan(0);
      // The reserve names the press: the account, the tool and the page's id, never a fresh id.
      const sent = fake.calls_of("/v1/reserve").at(-1)!.body as { requestId: string };
      const id = (run(f)[2] as { requestId: string }).requestId;
      expect(sent.requestId).toBe(`r_${crypto.createHash("sha256").update(`${ids.none}\n${scope}\n${id}`).digest("hex").slice(0, 32)}`);
      const again = await call("none", run(f));
      expect(again.status).toBe(201);
      expect(await again.text()).toBe(answer);
      // Another server process (nothing of the first press in its memory) answers the same, from the database.
      globalThis.__fuobeShortsRequests?.clear();
      const elsewhere = await call("none", run(f));
      expect(elsewhere.status).toBe(201);
      expect(await elsewhere.text()).toBe(answer);
      expect(reserves() - before).toBe(1);
      expect(places("none", since)).toHaveLength(rows);
    });

    it(`${name}: on an account's own GPU every send of a press makes its run, as before, and nothing of it is kept`, async () => {
      const f = await filesOf("gpu");
      const before = reserves();
      const since = Date.now();
      const counts: number[] = [];
      for (let i = 0; i < 2; i++) {
        // One at a time, as the account's limit on runs going at once asks.
        db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
        const r = await send(() => call("gpu", run(f)));
        expect(r.status, await r.clone().text()).toBe(201);
        counts.push(places("gpu", since).length);
      }
      expect(counts[0]).toBeGreaterThan(0);
      expect(counts[1]).toBe(counts[0] * 2);
      expect(places("gpu", since).every((p) => p === "own")).toBe(true);
      expect(db().prepare("SELECT COUNT(*) AS n FROM run_requests WHERE account = ?").get(ids.gpu)).toEqual({ n: 0 });
      expect(reserves()).toBe(before);
    });
  }
});

describe("hosted runs on: a tool that runs on a visitor's own setup only", () => {
  beforeEach(hostedOn);
  const restore = (f: Files) => ({ engine: "open", source: { url: f.clip, name: "old.mp4", ...src } });

  // A GPU of its own: Restore's gated LoRA goes with no visitor's key, so no key is named.
  const restoreSetup = () => {
    const gpu = { ...(ownSetupOnly("video-tools:restore") as Extract<OwnSetup, { need: "gpu" }>) };
    delete gpu.orKey;
    return gpu;
  };

  it("Restore & colourise: its price check says its setup's label, and Run opens that setup with nothing held or made", async () => {
    const setup = restoreSetup();
    const f = await filesOf("none");
    const check = await routes.restoreEstimate.POST(json("/api/restore/estimate", "POST", restore(f), "none"));
    expect(check.status, await check.clone().text()).toBe(200);
    const priced = (await check.json()) as { place?: string; quote?: Record<string, unknown> };
    expect(priced.place).toBe("pool");
    expect(priced.quote).toMatchObject({ allowed: false, text: ownSetupLabel(setup), ownSetup: setup });
    const before = reserves();
    const since = Date.now();
    const r = await routes.restore.POST(json("/api/restore", "POST", restore(f), "none"));
    expect(r.status, await r.clone().text()).toBe(403);
    expect(await r.json()).toMatchObject({ code: "connect-gpu", error: ownSetupLabel(setup), ownSetup: setup });
    expect(reserves()).toBe(before);
    expect(places("none", since)).toEqual([]);
  });

  it("Restore & colourise: an account with a key of its own and no GPU is sent to a GPU of its own, never to its key", async () => {
    const setup = restoreSetup();
    expect(ownSetupLabel(setup)).not.toMatch(/key/i);
    const f = await filesOf("key");
    const check = await routes.restoreEstimate.POST(json("/api/restore/estimate", "POST", restore(f), "key"));
    expect(check.status, await check.clone().text()).toBe(200);
    expect(((await check.json()) as { quote?: Record<string, unknown> }).quote).toMatchObject({ allowed: false, text: ownSetupLabel(setup), ownSetup: setup });
    const before = reserves();
    const since = Date.now();
    const r = await routes.restore.POST(json("/api/restore", "POST", restore(f), "key"));
    expect(r.status, await r.clone().text()).toBe(403);
    expect(await r.json()).toMatchObject({ code: "connect-gpu", error: ownSetupLabel(setup), ownSetup: setup });
    expect(reserves()).toBe(before);
    expect(places("key", since)).toEqual([]);
  });

  it("Restore & colourise: an account whose own GPU answers runs it there, with no place in its price check", async () => {
    const f = await filesOf("gpu");
    const check = await routes.restoreEstimate.POST(json("/api/restore/estimate", "POST", restore(f), "gpu"));
    expect(((await check.json()) as { place?: string }).place).toBeUndefined();
    db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
    const before = reserves();
    const since = Date.now();
    const r = await send(() => routes.restore.POST(json("/api/restore", "POST", restore(f), "gpu")));
    expect(r.status, await r.clone().text()).toBe(201);
    expect(reserves()).toBe(before);
    const made = places("gpu", since);
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((p) => p === "own")).toBe(true);
  });
});

describe("hosted runs off: as today", () => {
  it("no price check names a place, and an account with no GPU of its own is asked to connect one", async () => {
    // Its files were uploaded while hosted runs were on (with them off, it can't upload any).
    hostedOn();
    const f = await filesOf("none");
    for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
    billing.resetBillingCache();
    const calls = fake.calls_of("/v1/reserve").length + fake.calls_of("/v1/quote").length;
    for (const t of TOOLS) {
      const check = await call("none", t.check(f));
      expect(((await check.clone().json()) as { place?: string }).place, `${t.name}: ${await check.clone().text()}`).toBeUndefined();
    }
    const since = Date.now();
    for (const t of TOOLS.filter((x) => x.run)) {
      const r = await call("none", t.run!(f));
      expect(r.status, t.name).toBe(403);
      expect(((await r.json()) as { code?: string }).code, t.name).toBe("connect-gpu");
    }
    expect(places("none", since)).toEqual([]);
    expect(fake.calls_of("/v1/reserve").length + fake.calls_of("/v1/quote").length).toBe(calls);
  });
});
