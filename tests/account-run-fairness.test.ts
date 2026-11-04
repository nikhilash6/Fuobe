import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

const dir = tempDir("fuobe-run-fairness-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
globalThis.__fuobeTestDiskFree = 1e13;

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response("not stubbed", { status: 599 })) as typeof fetch;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { ACCOUNT_LIMITS } = await import("@/server/account-files");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");

let fake: FakeComfy;
let a = "";
let cookie = "";
// Placeholders where nothing is connected, as these runs were written for ("auto": code in this process only).
beforeAll(async () => (await import("@/server/settings")).setSetting("demoMode", "auto"));
beforeAll(async () => {
  fake = await startFakeComfy({ loras: [], delayMs: 0 });
  globalThis.__fuobeTestGpuPort = fake.port;
  auth.setPassword("install password");
  a = auth.createAccount("fair-a@example.com", "long enough").id;
  auth.setAccountGpu(a, { url: fake.url });
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
});
beforeEach(() => resetRates());
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestGpuPort = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fake.close();
});

const run = (image: string) => {
  const text = JSON.stringify({ feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", prompt: "", inputs: { images: [image] } });
  return generationsRoute.POST(
    new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }),
  );
};
const activeRuns = () =>
  (
    db()
      .prepare("SELECT COUNT(DISTINCT COALESCE(batch_id, id)) AS n FROM generations WHERE status IN ('queued', 'running') AND json_extract(request_json, '$.account') = ?")
      .get(a) as { n: number }
  ).n;

describe("M-8: one account can't crowd out the others' runs", () => {
  it("starts at most 4 runs at once, however many requests arrive together", async () => {
    const image = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", accountId: a }).url;
    const answers = await Promise.all(Array.from({ length: 8 }, () => run(image)));
    expect(answers.filter((r) => r.status === 201).length).toBeLessThanOrEqual(ACCOUNT_LIMITS.activeRuns);
    expect(answers.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(8 - ACCOUNT_LIMITS.activeRuns);
    expect(activeRuns()).toBeLessThanOrEqual(ACCOUNT_LIMITS.activeRuns);
  });

  it("polls every account in turn: a long queue of one account's jobs never hides another's", () => {
    db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
    const [template] = gens.createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "open" });
    const row = db().prepare("SELECT * FROM generations WHERE id = ?").get(template.id) as Record<string, unknown>;
    db().prepare("UPDATE generations SET status = 'canceled' WHERE id = ?").run(template.id);
    const cols = Object.keys(row);
    const insert = db().prepare(`INSERT INTO generations (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`);
    const add = (id: string, account: string | null, createdAt: number) =>
      insert.run({ ...row, id, batch_id: null, status: "running", external_id: `ext-${id}`, created_at: createdAt, request_json: JSON.stringify({ ...JSON.parse(row.request_json as string), account: account ?? undefined }) });
    const t = Date.now() - 60_000;
    for (let i = 0; i < 150; i++) add(`busy${i}`, "account-busy", t + i);
    add("other1", "account-other", t + 1000);
    add("owner1", null, t + 2000);
    const ids = gens.rowsToPoll().map((r) => r.id);
    expect(ids.length).toBeLessThanOrEqual(100);
    expect(ids).toContain("other1");
    // The owner's first, then each account's jobs in turn.
    expect(ids[0]).toBe("owner1");
    expect(ids.indexOf("other1")).toBeLessThan(ids.indexOf("busy1"));
  });
});
