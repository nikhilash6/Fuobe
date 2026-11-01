import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";

/**
 * Your keys: every account limit applies to runs on its own key too, before anything reaches the provider: runs at
 * once, runs an hour, outputs a run, its space. A result that doesn't fit its space fails the run and keeps nothing.
 */
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-keys-limits-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ENGINE_MODE;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const generationsRoute = await import("@/app/api/generations/route");
const { db } = await import("@/server/db");
const { saveFile } = await import("@/server/storage");
const { resetRates, hit } = await import("@/server/rate");
const files = await import("@/server/account-files");

let fal: FakeCloud;
let A = "";
let cookie = "";
beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["acct-fal-A"] = "good";
  auth.setPassword("install password");
  A = auth.createAccount("limits-a@example.com", "long enough").id;
  keys.saveAccountKey(A, "fal", "acct-fal-A");
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(A).value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fal.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
beforeEach(async () => {
  resetRates();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
  db().prepare("DELETE FROM assets WHERE account_id IS NOT NULL").run();
  await new Promise((r) => setTimeout(r, 100));
  fal.log.length = 0;
  fal.pollsToFinish = 2;
});

const post = (body: Record<string, unknown>) => {
  const text = JSON.stringify({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "a quiet harbour", ...body });
  return generationsRoute.POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(text.length) }, body: text }));
};
const submits = () => fal.log.filter((r) => r.method === "POST").length;
/** A file of the account that weighs `bytes` (only its row says so). */
function weigh(bytes: number) {
  const a = saveFile({ data: Buffer.from("x"), contentType: "image/png", source: "generation", accountId: A });
  db().prepare("UPDATE assets SET size = ? WHERE id = ?").run(bytes, a.id);
}
const row = (id: string) => db().prepare("SELECT status, error FROM generations WHERE id = ?").get(id) as { status: string; error: string | null };

describe("an account's limits hold for runs on its own key", () => {
  it("4 runs at once: the 5th waits (429), before the provider hears of it", async () => {
    fal.pollsToFinish = Infinity;
    for (let i = 0; i < files.ACCOUNT_LIMITS.activeRuns; i++) expect((await post({})).status).toBe(201);
    for (let i = 0; i < 50 && submits() < 4; i++) await new Promise((r) => setTimeout(r, 10));
    const fifth = await post({});
    expect(fifth.status).toBe(429);
    expect((await fifth.json()).error).toBe(files.ACCOUNT_MESSAGES.activeRuns);
    expect(submits()).toBe(4);
  });

  it("60 runs an hour", async () => {
    for (let i = 0; i < files.ACCOUNT_LIMITS.runsPerHour; i++) hit(`run:${A}`, files.ACCOUNT_LIMITS.runsPerHour, 60 * 60_000);
    const r = await post({});
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe(files.ACCOUNT_MESSAGES.runRate);
    expect(fal.log).toEqual([]);
  });

  it("up to 4 outputs a run, said in the run's notes, and sent as 4 to the provider", async () => {
    const r = await post({ params: { numOutputs: 8 } });
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.notes).toContain("Account runs make up to 4 at a time.");
    for (let i = 0; i < 50 && submits() < 1; i++) await new Promise((r) => setTimeout(r, 10));
    const sent = fal.log.find((x) => x.method === "POST");
    expect(JSON.parse(sent!.body).num_images ?? 4).toBeLessThanOrEqual(4);
  });

  it("full space: 413 before anything reaches the provider", async () => {
    weigh(files.accountTotalBytes(A));
    const r = await post({});
    expect(r.status).toBe(413);
    expect(fal.log).toEqual([]);
  });

  it("a result that doesn't fit its space fails the run and keeps nothing", async () => {
    const r = await post({});
    const id = (await r.json()).items[0].id as string;
    for (let i = 0; i < 100 && !db().prepare("SELECT external_id FROM generations WHERE id = ?").pluck().get(id); i++) await new Promise((r) => setTimeout(r, 10));
    weigh(files.accountTotalBytes(A) - 10);
    for (let i = 0; i < 40 && ["queued", "running"].includes(row(id).status); i++) {
      await globalThis.__fuobeRunner?.tick();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(row(id).status).toBe("failed");
    expect(row(id).error).toMatch(/space|full|GB/i);
    expect(db().prepare("SELECT COUNT(*) FROM assets WHERE generation_id = ?").pluck().get(id)).toBe(0);
  });
});
