import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-finish-limits-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const { createGenerations } = await import("@/server/generations");
const { ACCOUNT_LIMITS, ACCOUNT_MESSAGES } = await import("@/server/account-files");
const { saveFile } = await import("@/server/storage");
const { hit, resetRates } = await import("@/server/rate");
const finish = await import("@/app/api/generations/[id]/finish/route");

let a = "";
let cookie = "";
let owner = "";
// Placeholders where nothing is connected, as these runs were written for ("auto": code in this process only).
beforeAll(async () => (await import("@/server/settings")).setSetting("demoMode", "auto"));
beforeAll(() => {
  auth.setPassword("install password");
  a = auth.createAccount("finisher@example.com", "long enough").id;
  auth.setAccountGpu(a, { url: "https://gpu.example.com" });
  cookie = auth.createSession(a).value;
  owner = auth.createSession().value;
});
afterEach(() => {
  globalThis.__fuobeTestDiskFree = 1e13;
  resetRates();
});
afterAll(() => {
  globalThis.__fuobeTestDiskFree = undefined;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), Buffer.alloc(64)]);

/** A finished Fuobe Soul run with a graded picture to finish, made by `account` (or the owner). */
function soulRun(account?: string): string {
  const [g] = createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a fox", engine: "open", presetId: "v1-90s-grain" });
  const raw = { url: "/api/files/outputs/raw.png", kind: "image", meta: { look: "v1-90s-grain", grade: "portra" } };
  db()
    .prepare("UPDATE generations SET status = 'succeeded', outputs_json = ?, request_json = CASE WHEN ? IS NULL THEN request_json ELSE json_set(request_json, '$.account', ?) END WHERE id = ?")
    .run(JSON.stringify([raw]), account ?? null, account ?? null, g.id);
  return g.id;
}

function post(id: string, session: string) {
  const body = new FormData();
  body.set("file", new File([PNG], "finished.png", { type: "image/png" }));
  body.set("index", "0");
  return finish.POST(new Request(`http://localhost:3000/api/generations/${id}/finish`, { method: "POST", headers: { cookie: `${auth.SESSION_COOKIE}=${session}` }, body }), {
    params: Promise.resolve({ id }),
  } as never);
}

describe("M-5: an account's finished pictures count like its other files", () => {
  it("finishes its own run's picture, stored as its own", async () => {
    const r = await post(soulRun(a), cookie);
    expect(r.status).toBe(200);
    const url = (await r.json()).outputs[0].url as string;
    expect(db().prepare("SELECT account_id FROM assets WHERE rel_path = ?").get(url.slice("/api/files/".length).replaceAll("/", path.sep))).toEqual({ account_id: a });
  });

  it("refuses when the server is short of space, as an upload would be", async () => {
    globalThis.__fuobeTestDiskFree = 0;
    const r = await post(soulRun(a), cookie);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe(ACCOUNT_MESSAGES.diskLow);
    // The owner's own finish doesn't depend on the accounts' floor.
    expect((await post(soulRun(), owner)).status).toBe(200);
  });

  it("refuses when the account's files are full", async () => {
    const big = saveFile({ data: Buffer.from("x"), contentType: "image/png", source: "upload", accountId: a });
    db().prepare("UPDATE assets SET size = ? WHERE id = ?").run(ACCOUNT_LIMITS.newAccountBytes, big.id);
    try {
      const r = await post(soulRun(a), cookie);
      expect(r.status).toBe(413);
      expect((await r.json()).error).toMatch(/Your files have reached 1 GB/);
    } finally {
      db().prepare("DELETE FROM assets WHERE id = ?").run(big.id);
    }
  });

  it("reads at most two of an account's pictures at once", async () => {
    const { enter } = await import("@/server/rate");
    const held = [enter(`finish-now:${a}`, 2), enter(`finish-now:${a}`, 2)];
    try {
      const r = await post(soulRun(a), cookie);
      expect(r.status).toBe(429);
      expect(r.headers.get("retry-after")).toBeTruthy();
    } finally {
      for (const release of held) release?.();
    }
    expect((await post(soulRun(a), cookie)).status).toBe(200);
  });

  it("stops reading an account's chunked picture soon after 32 MB", async () => {
    const chunk = new Uint8Array(2 ** 20);
    const enc = new TextEncoder();
    let pulled = 0;
    let started = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (!started) {
          started = true;
          return c.enqueue(enc.encode('--x\r\nContent-Disposition: form-data; name="file"; filename="big.png"\r\nContent-Type: image/png\r\n\r\n'));
        }
        if (pulled >= 100 * 2 ** 20) {
          c.enqueue(enc.encode("\r\n--x--\r\n"));
          return c.close();
        }
        pulled += chunk.length;
        c.enqueue(chunk);
      },
    });
    const id = soulRun(a);
    const r = await finish.POST(
      new Request(`http://localhost:3000/api/generations/${id}/finish`, { method: "POST", headers: { cookie: `${auth.SESSION_COOKIE}=${cookie}`, "content-type": "multipart/form-data; boundary=x" }, body, duplex: "half" } as RequestInit),
      { params: Promise.resolve({ id }) } as never,
    );
    expect(r.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(34 * 2 ** 20);
  });

  it("has an hourly limit", async () => {
    for (let i = 0; i < ACCOUNT_LIMITS.finishesPerHour; i++) hit(`finish:${a}`, ACCOUNT_LIMITS.finishesPerHour, 60 * 60_000);
    const r = await post(soulRun(a), cookie);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
  });
});
