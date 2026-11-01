import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
const jar = { set: vi.fn(), delete: vi.fn(), get: vi.fn() };
vi.mock("next/headers", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/headers")>()), cookies: async () => jar }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-space-limits-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ACCOUNTS_DISK_GB;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const { db } = await import("@/server/db");
const files = await import("@/server/account-files");
const { saveFile } = await import("@/server/storage");
const { enter, hit, resetRates } = await import("@/server/rate");
const uploads = await import("@/app/api/uploads/route");
const signup = await import("@/app/api/auth/signup/route");

const GB = 2 ** 30;
const DAY = 24 * 60 * 60_000;
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d4948445200000010000000100806000000", "hex"), Buffer.alloc(64)]);

let fresh = "";
let old = "";
beforeAll(() => {
  auth.setPassword("install password");
  fresh = auth.createAccount("fresh@example.com", "long enough").id;
  old = auth.createAccount("old@example.com", "long enough").id;
  for (const id of [fresh, old]) auth.setAccountGpu(id, { url: "https://gpu.example.com" });
  // An account made 8 days ago (auth.json is the accounts' store).
  const file = path.join(dir, "auth.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { accounts: { id: string; createdAt: number }[] };
  for (const a of data.accounts) if (a.id === old) a.createdAt = Date.now() - 8 * DAY;
  fs.writeFileSync(file, JSON.stringify(data));
  // A new modified time, so the auth module reads the file again (it caches by that time).
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
});
afterEach(() => {
  delete process.env.FUOBE_ACCOUNTS_DISK_GB;
  delete process.env.FUOBE_TRUST_PROXY;
  resetRates();
  db().prepare("DELETE FROM assets WHERE account_id IS NOT NULL").run();
});
afterAll(() => {
  globalThis.__fuobeTestDiskFree = undefined;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

/** A result of `account` that weighs `bytes` (only its row says so). */
function weigh(account: string, bytes: number) {
  const a = saveFile({ data: Buffer.from("x"), contentType: "image/png", source: "generation", accountId: account });
  db().prepare("UPDATE assets SET size = ? WHERE id = ?").run(bytes, a.id);
}

const upload = (account: string) =>
  uploads.POST(
    new Request("http://localhost:3000/api/uploads", {
      method: "POST",
      headers: { cookie: `${auth.SESSION_COOKIE}=${auth.createSession(account).value}`, "content-type": "image/png", "x-file-name": "a.png", "content-length": String(PNG.length) },
      body: PNG,
    }),
  );

describe("M-6: accounts can't fill the server's disk", () => {
  it("a new account keeps 1 GB in its first 7 days, then 3 GB", async () => {
    expect(files.accountTotalBytes(fresh)).toBe(1 * GB);
    expect(files.accountTotalBytes(old)).toBe(files.ACCOUNT_LIMITS.totalBytes);
    weigh(fresh, 1 * GB - 10);
    const r = await upload(fresh);
    expect(r.status).toBe(413);
    expect((await r.json()).error).toMatch(/1 GB.*first 7 days/);
    weigh(old, 1 * GB - 10);
    expect((await upload(old)).status).toBe(201);
  });

  it("all accounts together keep at most a share of the disk (FUOBE_ACCOUNTS_DISK_GB)", async () => {
    process.env.FUOBE_ACCOUNTS_DISK_GB = "2";
    weigh(old, 1.5 * GB);
    expect(files.diskHasRoom()).toBe(true);
    weigh(fresh, 0.6 * GB);
    expect(files.diskHasRoom()).toBe(false);
    const r = await upload(old);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe(files.ACCOUNT_MESSAGES.diskLow);
  });

  it("by default, all accounts together keep at most a quarter of the disk", () => {
    expect(files.accountsMaxBytes(400 * GB)).toBe(100 * GB);
  });

  it("a few form uploads (held in memory) at once across every account; a file sent as it is never waits for others", async () => {
    const multipart = (account: string) => {
      const body = new FormData();
      body.set("file", new File([PNG], "a.png", { type: "image/png" }));
      const probe = new Request("http://localhost:3000/api/uploads", { method: "POST", body });
      return probe.arrayBuffer().then((buf) =>
        uploads.POST(
          new Request("http://localhost:3000/api/uploads", {
            method: "POST",
            headers: { cookie: `${auth.SESSION_COOKIE}=${auth.createSession(account).value}`, "content-type": probe.headers.get("content-type")!, "content-length": String(buf.byteLength) },
            body: buf,
          }),
        ),
      );
    };
    const held = Array.from({ length: files.ACCOUNT_LIMITS.uploadsAtOnceAll }, () => enter("up:accounts", files.ACCOUNT_LIMITS.uploadsAtOnceAll));
    try {
      expect(held.every(Boolean)).toBe(true);
      const r = await multipart(old);
      expect(r.status).toBe(429);
      expect((await r.json()).error).toBe(files.ACCOUNT_MESSAGES.uploadsBusy);
      // Streamed to disk, so it holds no memory: other accounts' uploads don't hold it up.
      expect((await upload(old)).status).toBe(201);
    } finally {
      for (const release of held) release?.();
    }
    expect((await multipart(old)).status).toBe(201);
  });

  it("an upload that stops arriving is ended, and frees its place", async () => {
    const limits = files.ACCOUNT_LIMITS as { uploadIdleMs: number };
    const idle = limits.uploadIdleMs;
    limits.uploadIdleMs = 200;
    try {
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          if (!sent) {
            sent = true;
            c.enqueue(new Uint8Array(PNG.subarray(0, 16)));
          }
          // Then nothing more, ever.
          return new Promise(() => {});
        },
      });
      const r = await uploads.POST(
        new Request("http://localhost:3000/api/uploads", {
          method: "POST",
          headers: { cookie: `${auth.SESSION_COOKIE}=${auth.createSession(old).value}`, "content-type": "image/png", "x-file-name": "a.png", "content-length": String(PNG.length) },
          body,
          duplex: "half",
        } as RequestInit),
      );
      expect(r.status).toBe(408);
      expect((await r.json()).error).toBe(files.ACCOUNT_MESSAGES.uploadStalled);
      // Its place is free again: two more at once still fit.
      expect((await Promise.all([upload(old), upload(old)])).map((x) => x.status)).toEqual([201, 201]);
    } finally {
      limits.uploadIdleMs = idle;
    }
  });

  it("an address (a whole office or class on one network) makes at most 20 accounts a day", async () => {
    process.env.FUOBE_TRUST_PROXY = "1";
    const from = (ip: string, email: string) =>
      signup.POST(new Request("http://localhost:3000/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email, password: "long enough" }) }));
    // Ten people in one room sign up, a few seconds apart (the per-minute limit is 5).
    const aMinuteLater = () => delete (globalThis as Record<string, unknown>).__fuobeSignupGuard;
    for (let i = 0; i < 5; i++) expect((await from("203.0.113.5", `room${i}@example.com`)).status, `person ${i}`).toBe(201);
    aMinuteLater();
    for (let i = 5; i < 10; i++) expect((await from("203.0.113.5", `room${i}@example.com`)).status, `person ${i}`).toBe(201);
    aMinuteLater();
    for (let i = 10; i < 20; i++) hit("signup-day:203.0.113.5", 20, DAY);
    const r = await from("203.0.113.5", "sixth@example.com");
    expect(r.status).toBe(429);
    // It says what happened: the network, not the person, made the accounts.
    expect((await r.json()).error).toBe("Too many new accounts from this network today. Try again tomorrow.");
    const ok = await signup.POST(
      new Request("http://localhost:3000/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.6" }, body: JSON.stringify({ email: "sixth@example.com", password: "long enough" }) }),
    );
    expect(ok.status).toBe(201);
  });
});
