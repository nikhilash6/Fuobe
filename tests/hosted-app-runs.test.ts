import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listenOnFreePort, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

/**
 * The apps made in one go (AI Influencer, Photodump, Fashion Factory, Character Sheet, Turnaround, Fly around) for an
 * account: on its own GPU as any tool run; with hosted runs on and no GPU of its own, on this install's GPUs as one run
 * held once; priced before Run with their place there. A character or pack the account doesn't have is refused.
 */
const dir = tempDir("fuobe-hosted-app-runs-");
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
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0, loras: [] }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const uploadsRoute = await import("@/app/api/uploads/route");
const gpuRoute = await import("@/app/api/account/gpu/route");
const routes = {
  photodump: await import("@/app/api/photodump/route"),
  character: await import("@/app/api/photodump/character/route"),
  fashion: await import("@/app/api/photodump/fashion/route"),
  influencer: await import("@/app/api/influencer/route"),
  turnaround: await import("@/app/api/turnaround/route"),
  flyAround: await import("@/app/api/fly-around/route"),
};
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const billing = await import("@/server/billing");
const { clearAccountLoras } = await import("@/server/account-loras");
const { hostedWords } = await import("@/server/hosted");
const HOSTED_WORDS = hostedWords((await import("@/lib/place-name")).placeOf(null));

let fake: FakeBilling;
const ids: Record<string, string> = {};
const cookies: Record<string, string> = {};
beforeAll(async () => {
  fake = await startFakeBilling();
  fake.price = { amount: 0, version: "free" };
  auth.setPassword("install password");
  for (const who of ["none", "gpu"]) {
    ids[who] = auth.createAccount(`apps-${who}@example.com`, "long enough").id;
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
  fake.policy = { hosted: true, pool: {}, uploads: { image: true, video: false, audio: false }, limits: { activeRuns: 0, waiting: 0, runsPerHour: 0, outputsPerRun: 4, maxMegapixels: 0, maxSeconds: 0, keepDays: 7, spaceBytes: 7 }, ttlS: 0 };
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
async function upload(who: string): Promise<string> {
  const r = await uploadsRoute.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { host: "localhost:3000", cookie: cookies[who], "content-type": "image/png", "x-file-name": "me.png", "content-length": String(TINY_PNG.length) }, body: new Uint8Array(TINY_PNG) }));
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

/** Send a run on the account's own GPU; a LoRA its ComfyUI lacks is put there (the 409 names it), then it is sent again. */
async function send(call: () => Promise<Response>): Promise<Response> {
  let r = await call();
  if (r.status === 409) {
    const j = (await r.clone().json()) as { code: string; fix?: { items: { file: string }[] } };
    expect(j.code).toBe("comfy_missing_model");
    comfy.opts.loras = [...(comfy.opts.loras ?? []), ...j.fix!.items.map((i) => i.file)];
    clearAccountLoras(ids.gpu);
    r = await call();
  }
  return r;
}

type Case = {
  name: string;
  route: { POST: (r: Request) => Promise<Response> };
  url: string;
  body: (pic: string) => Record<string, unknown>;
  /** Refused on this install's GPUs before Run, in these words (a step that runs only on an own GPU for now). */
  ownOnly?: string | RegExp;
};
const CASES: Case[] = [
  { name: "Photodump", route: routes.photodump, url: "/api/photodump", body: (pic) => ({ packId: "winter-special", engine: "open", selfie: pic, aspectRatio: "3:4" }) },
  // AI Influencer's open sheet carries its casting look's LoRAs, which this install's GPUs don't carry yet.
  { name: "AI Influencer", route: routes.influencer, url: "/api/influencer", body: () => ({ engine: "open", state: {}, start: "scratch" }), ownOnly: HOSTED_WORDS.notOffered },
  { name: "Character Sheet", route: routes.character, url: "/api/photodump/character", body: () => ({ mode: "describe", engine: "open", prompt: "a surfer from Lisbon" }) },
  // The turnaround's angle LoRA isn't one this install's GPUs carry yet, and Fly around's path is drawn from a 3D step.
  { name: "Turnaround", route: routes.turnaround, url: "/api/turnaround", body: (pic) => ({ engine: "open", views: { front: pic, back: pic } }), ownOnly: HOSTED_WORDS.notOffered },
  { name: "Fly around", route: routes.flyAround, url: "/api/fly-around", body: (pic) => ({ engine: "open", image: pic, orbit: { degrees: 90, direction: "cw" } }), ownOnly: /^Runs on your own GPU · \d+ GB$/ },
];

describe("hosted runs off: an account's app runs as any tool run, on its own GPU", () => {
  for (const c of CASES) {
    it(`${c.name}: no GPU or key is asked to connect one; its own GPU runs it`, async () => {
      const none = await c.route.POST(json(c.url, "POST", c.body(await upload("gpu")), "none"));
      expect([403, 404], await none.clone().text()).toContain(none.status);
      const since = Date.now();
      const pic = await upload("gpu");
      const r = await send(() => c.route.POST(json(c.url, "POST", c.body(pic), "gpu")));
      expect(r.status, await r.clone().text()).toBe(201);
      const made = places("gpu", since);
      expect(made.length).toBeGreaterThan(0);
      expect(made.every((p) => p === "own")).toBe(true);
    });
  }
});

describe("hosted runs on: an account with no GPU of its own runs the apps on this install's GPUs", () => {
  beforeEach(hostedOn);
  for (const c of CASES) {
    it(`${c.name}: one hold for the whole run, every step there, and its price check names the place`, async () => {
      const pic = await upload("none");
      const check = await c.route.POST(json(`${c.url}?preview=1`, "POST", c.body(pic), "none"));
      const priced = (await check.json()) as { place?: string; quote?: { allowed: boolean; text: string } };
      expect(priced.place, JSON.stringify(priced)).toBe("pool");
      if (c.ownOnly) {
        // Run stays off and says why; pressed anyway, nothing is held or made.
        // A label (never a refusal): Run opens the own setup it names.
        expect(priced.quote).toMatchObject({ allowed: false, text: typeof c.ownOnly === "string" ? c.ownOnly : expect.stringMatching(c.ownOnly), ownSetup: expect.objectContaining({ need: "gpu" }) });
        const before = reserves();
        const since = Date.now();
        const r = await c.route.POST(json(c.url, "POST", c.body(pic), "none"));
        expect(r.status).toBe(403);
        const refusedWith = (await r.json()) as { error: string; code: string; ownSetup?: unknown };
        expect(refusedWith.error).toMatch(typeof c.ownOnly === "string" ? new RegExp(`^${c.ownOnly}$`) : c.ownOnly);
        expect(refusedWith).toMatchObject({ code: "connect-gpu", ownSetup: expect.objectContaining({ need: "gpu" }) });
        expect(reserves()).toBe(before);
        expect(places("none", since)).toEqual([]);
        return;
      }
      expect(priced.quote?.allowed, JSON.stringify(priced.quote)).toBe(true);
      const since = Date.now();
      const before = reserves();
      const r = await c.route.POST(json(c.url, "POST", c.body(pic), "none"));
      expect(r.status, await r.clone().text()).toBe(201);
      expect(reserves() - before).toBe(1);
      const made = places("none", since);
      expect(made.length).toBeGreaterThan(0);
      expect(made.every((p) => p === "pool")).toBe(true);
    });
  }

  it("an account whose own GPU answers keeps it", async () => {
    const since = Date.now();
    const before = reserves();
    const r = await routes.photodump.POST(json("/api/photodump", "POST", CASES[0].body(await upload("gpu")), "gpu"));
    expect(r.status, await r.clone().text()).toBe(201);
    expect(reserves()).toBe(before);
    expect(places("gpu", since).every((p) => p === "own")).toBe(true);
  });

  it("a character or pack the account doesn't have is refused, and nothing is held or made", async () => {
    const before = reserves();
    const since = Date.now();
    const asks = [
      () => routes.photodump.POST(json("/api/photodump", "POST", { packId: "winter-special", engine: "open", elementId: "el-1" }, "none")),
      async () => routes.photodump.POST(json("/api/photodump", "POST", { packId: "my-own-pack", engine: "open", selfie: await upload("none") }, "none")),
      () => routes.fashion.POST(json("/api/photodump/fashion", "POST", { step: "base", templateId: "t", elementId: "el-1", engine: "open" }, "none")),
    ];
    for (const ask of asks) {
      const r = await ask();
      expect(r.status, await r.clone().text()).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
    expect(reserves()).toBe(before);
    expect(places("none", since)).toEqual([]);
  });

  it("another account's file never goes in", async () => {
    const theirs = await upload("gpu");
    const r = await routes.photodump.POST(json("/api/photodump", "POST", CASES[0].body(theirs), "none"));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it("a guest signs up first; its price check is answered", async () => {
    const r = await routes.flyAround.POST(json("/api/fly-around", "POST", { engine: "open", image: "/api/files/x.png", orbit: { degrees: 90, direction: "cw" } }));
    expect(r.status).toBe(401);
    const c = await routes.character.POST(json("/api/photodump/character?preview=1", "POST", { mode: "describe", engine: "open", prompt: "a surfer" }));
    expect(((await c.json()) as { place?: string }).place).toBe("pool");
  });
});
