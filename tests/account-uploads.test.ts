import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { TINY_PNG } from "./helpers/fake-comfy-runner";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-account-uploads-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOWED_ORIGINS;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const { POST } = await import("@/app/api/uploads/route");
const { proxy, config } = await import("@/proxy");
const { GUEST_HEADER, CONNECT_GPU_HEADER } = await import("@/lib/guest-access");
const { db } = await import("@/server/db");
const { hit, resetRates } = await import("@/server/rate");
afterAll(() => {
  globalThis.__fuobeTestDiskFree = undefined;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

let a = "";
let b = "";
let noGpu = "";
let cookieA = "";
let cookieB = "";
let cookieNoGpu = "";
let owner = "";
beforeAll(() => {
  auth.setPassword("install password");
  a = auth.createAccount("up-a@example.com", "long enough").id;
  b = auth.createAccount("up-b@example.com", "long enough").id;
  noGpu = auth.createAccount("up-nogpu@example.com", "long enough").id;
  auth.setAccountGpu(a, { url: "https://gpu-a.example" });
  auth.setAccountGpu(b, { url: "https://gpu-b.example" });
  cookieA = auth.createSession(a).value;
  cookieB = auth.createSession(b).value;
  cookieNoGpu = auth.createSession(noGpu).value;
  owner = auth.createSession().value;
});
beforeEach(() => resetRates());

/** A body stream that fails if anything reads it: the route must answer before. */
const unread = () =>
  new ReadableStream<Uint8Array>({
    pull() {
      throw new Error("the body was read");
    },
  });

function upload(body: BodyInit | null, o: { cookie?: string; type?: string; name?: string; length?: number | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", ...o.headers };
  if (o.cookie) headers.cookie = `${auth.SESSION_COOKIE}=${o.cookie}`;
  if (o.type) headers["content-type"] = o.type;
  if (o.name) headers["x-file-name"] = encodeURIComponent(o.name);
  const length = o.length === undefined ? (body instanceof Uint8Array ? body.length : undefined) : o.length;
  if (length !== null && length !== undefined) headers["content-length"] = String(length);
  return POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers, body, duplex: "half" } as RequestInit));
}

describe("POST /api/uploads checks who is asking itself (the proxy doesn't run on it)", () => {
  it("is left out of the proxy's matcher, and only that path", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/api/uploads")).toBe(false);
    expect(re.test("/api/uploadsx")).toBe(true);
    expect(re.test("/api/uploads/x")).toBe(true);
    expect(re.test("/api/files/x")).toBe(true);
    expect(re.test("/motions")).toBe(true);
  });

  it("asks a guest to sign up", async () => {
    const r = await upload(TINY_PNG, { type: "image/png" });
    expect(r.status).toBe(401);
    expect(r.headers.get(GUEST_HEADER)).toBe("1");
    expect((await r.json()).error).toMatch(/free account/);
  });

  it("refuses another website", async () => {
    const r = await upload(TINY_PNG, { cookie: cookieA, type: "image/png", headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });

  it("asks an account to connect its GPU first", async () => {
    const r = await upload(TINY_PNG, { cookie: cookieNoGpu, type: "image/png" });
    expect(r.status).toBe(403);
    expect(r.headers.get(CONNECT_GPU_HEADER)).toBe("1");
    expect((await r.json()).code).toBe("connect-gpu");
  });
});

describe("an account's upload", () => {
  it("stores a picture as its own, typed by its bytes, whatever name it was given", async () => {
    const r = await upload(TINY_PNG, { cookie: cookieA, type: "image/png", name: "../../x.html" });
    expect(r.status).toBe(201);
    const asset = await r.json();
    expect(asset).toMatchObject({ kind: "image", contentType: "image/png", accountId: a, source: "upload", name: "x.html" });
    expect(asset.relPath).toMatch(/\.png$/);
    const row = db().prepare("SELECT account_id FROM assets WHERE id = ?").get(asset.id) as { account_id: string };
    expect(row.account_id).toBe(a);
    expect(fs.readFileSync(path.join(dir, "files", asset.relPath)).equals(TINY_PNG)).toBe(true);
  });

  it("refuses a page that says it is a picture", async () => {
    const r = await upload(Buffer.from("<!doctype html><script>alert(1)</script>".padEnd(200)), { cookie: cookieA, type: "image/png", name: "x.png" });
    expect(r.status).toBe(415);
    expect((await r.json()).error).toMatch(/PNG, JPEG or WebP/);
  });

  it("refuses an oversized file before reading a byte", async () => {
    const pic = await upload(unread(), { cookie: cookieA, type: "image/png", name: "big.png", length: 26 * 2 ** 20 });
    expect(pic.status).toBe(413);
    expect((await pic.json()).error).toMatch(/over 25 MB/);
    const clip = await upload(unread(), { cookie: cookieA, type: "video/mp4", name: "big.mp4", length: 96 * 2 ** 20 });
    expect(clip.status).toBe(413);
    expect((await clip.json()).error).toMatch(/over 95 MB/);
    const form = await upload(unread(), { cookie: cookieA, type: "multipart/form-data; boundary=x", length: 27 * 2 ** 20 });
    expect(form.status).toBe(413);
    expect((await form.json()).error).toMatch(/Reload the page/);
  });

  it("needs the file's size", async () => {
    const r = await upload(unread(), { cookie: cookieA, type: "image/png", length: null });
    expect(r.status).toBe(411);
  });

  it("stops at 1 GB of uploads", async () => {
    db()
      .prepare("INSERT INTO assets (id, kind, rel_path, content_type, size, source, created_at, account_id) VALUES ('full', 'video', 'uploads/x/full.mp4', 'video/mp4', ?, 'upload', ?, ?)")
      .run(2 ** 30, Date.now(), a);
    try {
      const r = await upload(TINY_PNG, { cookie: cookieA, type: "image/png" });
      expect(r.status).toBe(413);
      expect((await r.json()).error).toMatch(/reached 1 GB/);
    } finally {
      db().prepare("DELETE FROM assets WHERE id = 'full'").run();
    }
  });

  it("allows 60 an hour", async () => {
    for (let i = 0; i < 60; i++) hit(`up:h:${a}`, 60, 60 * 60_000);
    const r = await upload(TINY_PNG, { cookie: cookieA, type: "image/png" });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("takes a small multipart form from an older page", async () => {
    const form = new FormData();
    form.append("file", new File([TINY_PNG], "old.png", { type: "image/png" }));
    // The form's bytes as a browser sends them, with the boundary its content-type names (a FormData body sent again
    // is serialized with a boundary of its own, which the first request's content-type doesn't name).
    const req = new Request("http://localhost:3000/api/uploads", { method: "POST", body: form });
    const r = await upload(new Uint8Array(await req.arrayBuffer()), { cookie: cookieA, type: req.headers.get("content-type")! });
    expect(r.status).toBe(201);
    expect((await r.json()).accountId).toBe(a);
  });

  it("is readable by its account only", async () => {
    const asset = await (await upload(TINY_PNG, { cookie: cookieA, type: "image/png" })).json();
    const get = (cookie?: string) => proxy(new NextRequest(`http://localhost:3000${asset.url}`, { headers: cookie ? { cookie: `${auth.SESSION_COOKIE}=${cookie}` } : {} }));
    expect(get(cookieA).headers.get("x-middleware-next")).toBe("1");
    expect(get(cookieB).status).toBe(403);
    expect(get().status).toBe(401);
    expect(get(owner).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("the owner's upload", () => {
  it("still takes a form and a raw file", async () => {
    const form = new FormData();
    form.append("file", new File([TINY_PNG], "mine.png", { type: "image/png" }));
    const viaForm = await POST(new Request("http://localhost:3000/api/uploads", { method: "POST", body: form, headers: { cookie: `${auth.SESSION_COOKIE}=${owner}`, host: "localhost:3000" } }));
    expect(viaForm.status).toBe(201);
    expect((await viaForm.json()).accountId).toBeUndefined();
    const raw = await upload(TINY_PNG, { cookie: owner, type: "image/png", name: "raw.png" });
    expect(raw.status).toBe(201);
    expect(await raw.json()).toMatchObject({ kind: "image", name: "raw.png", source: "upload" });
    const gif = await upload(Buffer.from("GIF89a....."), { cookie: owner, type: "image/gif", name: "a.gif" });
    expect(gif.status).toBe(201);
  });

  it("without a password, refuses a host this install doesn't answer to", async () => {
    auth.setPassword(null);
    try {
      const r = await upload(TINY_PNG, { type: "image/png", headers: { host: "rebound.example" } });
      expect(r.status).toBe(403);
      expect((await r.json()).error).toMatch(/isn't a local address/);
    } finally {
      auth.setPassword("install password");
    }
  });
});
