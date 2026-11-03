/**
 * Live edit's routes on the server path (a local install), against the ComfyUI stand-in: a session, a staged picture,
 * live frames over the stream, a settle and a Keep that stores exactly the settled bytes, a stale render taken off
 * ComfyUI (only ours, never another client's), recovery after ComfyUI restarts and loses its input folder; and who may
 * use which route (guests, accounts by their GPU, the owner).
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FrameReader, type Frame } from "@/lib/live/frames";
import { CONNECT_GPU_MESSAGE, GUEST_RUN_MESSAGE, LIBRARY_MESSAGE, accountLive, liveRoute } from "@/lib/guest-access";
import { startLocalComfy, type IndexLike, type LocalComfy } from "./helpers/fake-local-comfy";
import { tempDir } from "./helpers/temp-dir";

// Route handlers are called directly, outside a Next request: connection() has nothing to wait for.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-live-api-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;
const has = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/requirements.json"), "utf8")) as IndexLike;
const fake: LocalComfy = await startLocalComfy({ cors: "off", has, stepMsAt512: 10, latencyMs: 5 });
process.env.COMFYUI_URL = fake.url;

const auth = await import("@/server/auth");
const { proxy } = await import("@/proxy");
const uploads = await import("@/app/api/uploads/route");
const session = await import("@/app/api/live/session/route");
const inputs = await import("@/app/api/live/inputs/route");
const render = await import("@/app/api/live/render/route");
const masters = await import("@/app/api/live/masters/route");
const save = await import("@/app/api/live/save/route");
const { resetRates } = await import("@/server/rate");

let owner = "";
let acct = "";
let acctCookie = "";
let picture: Buffer;

beforeAll(async () => {
  auth.setPassword("install password");
  owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
  acct = auth.createAccount("live@example.com", "long enough password").id;
  acctCookie = `${auth.SESSION_COOKIE}=${auth.createSession(acct).value}`;
  const w = 768;
  const h = 1024;
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 7919) % 251;
  picture = await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  globalThis.__fuobeLiveSocket?.ws?.close();
  await fake.close();
});
beforeEach(() => resetRates());

const req = (url: string, body: unknown, cookie = owner, init: RequestInit = {}) =>
  new Request(`http://localhost:3000${url}`, { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body), ...init });

async function frames(res: Response): Promise<Frame[]> {
  const r = new FrameReader();
  const out: Frame[] = [];
  const reader = res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(...r.push(value));
  }
  return out;
}
const image = (f: Frame[]) => f.find((x) => x.kind === "image") as Extract<Frame, { kind: "image" }> | undefined;
const events = (f: Frame[]) => f.filter((x) => x.kind === "event").map((x) => (x as Extract<Frame, { kind: "event" }>).event);

let sid = "";
let base = "";
let seq = 0;
const ask = (o: Record<string, unknown>, init: RequestInit = {}) => render.POST(req("/api/live/render", { sessionId: sid, seq: ++seq, slot: "live", seed: 7, size: 512, keepRes: 1024, base, method: "hybrid", ...o }, owner, init));

describe("the server path", () => {
  it("opens a session and stages a picture under its content name", async () => {
    const up = await uploads.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { cookie: owner, host: "localhost:3000", "content-type": "image/png", "x-file-name": "portrait.png", "content-length": String(picture.length) }, body: new Uint8Array(picture) }));
    expect(up.status).toBe(201);
    const file = ((await up.json()) as { url: string }).url;
    const s = await session.POST(req("/api/live/session", {}));
    expect(s.status).toBe(200);
    const sj = (await s.json()) as { sessionId: string; mode: string; nodes: { live: boolean } };
    expect(sj).toMatchObject({ mode: "server", nodes: { live: true } });
    sid = sj.sessionId;
    const i = await inputs.POST(req("/api/live/inputs", { sessionId: sid, file }));
    expect(i.status).toBe(200);
    const ij = (await i.json()) as { name: string; width: number; height: number };
    expect(ij).toMatchObject({ width: 768, height: 1024 });
    expect(ij.name).toMatch(/^fuobe_lv[\w-]{20}\.png$/);
    base = ij.name;
    expect(fake.inputs.get(base)?.equals(picture)).toBe(true);
    // The same bytes again: no second upload.
    const uploadsBefore = fake.log.filter((l) => l.path === "/upload/image").length;
    await inputs.POST(req("/api/live/inputs", { sessionId: sid, file }));
    expect(fake.log.filter((l) => l.path === "/upload/image").length).toBe(uploadsBefore);
  });

  it("renders a live frame: front of the queue, over the socket, then out of ComfyUI's history", async () => {
    const posted = fake.log.length;
    const f = await frames(await ask({ text: "add gold hoop earrings" }));
    const img = image(f);
    expect(events(f).map((e) => e.type)).toEqual(expect.arrayContaining(["queued", "started", "progress"]));
    expect(img?.header).toMatchObject({ slot: "live", type: "image/webp" });
    expect(Math.max(img!.header.w, img!.header.h)).toBeLessThanOrEqual(640);
    const prompt = fake.log.slice(posted).find((l) => l.prompt)!;
    expect(prompt.prompt).toMatchObject({ front: true });
    expect(String(prompt.prompt!.client_id)).toMatch(/^fuobe-live-/);
    expect(prompt.prompt!.prompt!["10"].inputs.image).toBe(base);
    await vi.waitFor(() => expect(fake.log.slice(posted).some((l) => l.path === "/history" && l.method === "POST")).toBe(true));
    expect(fake.history.has(prompt.prompt!.prompt_id!)).toBe(false);
  });

  it("keeps exactly the settled picture: the same bytes, no second render", async () => {
    const settled = image(await frames(await ask({ slot: "settle", text: "add gold hoop earrings" })))!;
    expect(settled.header.type).toBe("image/png");
    expect([settled.header.w, settled.header.h]).toEqual([768, 1024]);
    const posts = fake.posts();
    const kept = image(await frames(await ask({ slot: "keep", text: "add gold hoop earrings." })))!;
    expect(fake.posts()).toBe(posts);
    expect(kept.header.sha256).toBe(settled.header.sha256);
    expect(Buffer.from(kept.data).equals(Buffer.from(settled.data))).toBe(true);
    expect(kept.header.url).toMatch(/^\/api\/files\//);
    expect(kept.header.name).toMatch(/^fuobe_lv/);
    // The master is staged as the next base.
    expect(fake.inputs.get(kept.header.name!)?.equals(Buffer.from(kept.data))).toBe(true);
    // A keep without a settle renders at keep quality.
    const fresh = image(await frames(await ask({ slot: "keep", text: "a red silk scarf" })))!;
    expect(fake.posts()).toBe(posts + 1);
    expect(fresh.header).toMatchObject({ type: "image/png", w: 768, h: 1024 });
  });

  it("takes a stale render off ComfyUI when the tab lets go of it, and never another client's job", async () => {
    fake.opts.stepMsAt512 = 400;
    const theirs = fake.foreign(300);
    const ctl = new AbortController();
    const posted = fake.log.length;
    const res = await ask({ text: "a velvet ribbon" }, { signal: ctl.signal });
    const reading = frames(res).catch(() => []);
    await vi.waitFor(() => expect(fake.log.slice(posted).some((l) => l.prompt)).toBe(true));
    const id = fake.log.slice(posted).find((l) => l.prompt)!.prompt!.prompt_id;
    const t0 = Date.now();
    ctl.abort();
    await vi.waitFor(() => expect(fake.log.slice(posted).some((l) => (l.path === "/queue" || l.path === "/interrupt") && l.method === "POST")).toBe(true));
    expect(Date.now() - t0).toBeLessThan(500);
    await reading;
    const stops = fake.log.slice(posted).filter((l) => (l.path === "/queue" || l.path === "/interrupt") && l.method === "POST");
    for (const s of stops) expect(JSON.stringify(s.body)).toContain(id!);
    expect(stops.some((s) => JSON.stringify(s.body).includes(theirs))).toBe(false);
    fake.opts.stepMsAt512 = 10;
    await vi.waitFor(() => expect(fake.history.has(theirs)).toBe(true), { timeout: 5000 });
  });

  it("stages its pictures again after ComfyUI restarts and loses its input folder", async () => {
    fake.restart({ wipeInputs: true });
    expect(fake.inputs.size).toBe(0);
    const f = await frames(await ask({ text: "copper hair" }));
    expect(image(f)?.header.type).toBe("image/webp");
    expect(fake.inputs.has(base)).toBe(true);
  }, 15_000);

  it("a keep of the text just settled, once the held render is gone, still gets its picture (the same graph again)", async () => {
    const settled = image(await frames(await ask({ slot: "settle", text: "a pearl necklace" })))!;
    const posts = fake.posts();
    const kept = image(await frames(await ask({ slot: "keep", text: "a pearl necklace", fromSettled: false })))!;
    expect(fake.posts()).toBe(posts + 1);
    expect(kept.header).toMatchObject({ type: "image/png", w: settled.header.w, h: settled.header.h });
  });

  it("refuses pictures the session didn't stage", async () => {
    const r = await ask({ text: "x", base: "fuobe_lvAAAAAAAAAAAAAAAAAAAA.png" });
    expect(r.status).toBe(409);
  });

  it("refuses a method it doesn't know", async () => {
    const r = await ask({ text: "x", method: "hybrid<script>" });
    expect(r.status).toBe(400);
    expect(r.headers.get("X-Live-Key")).toBeNull();
  });

  it("gives every editor its own session, and ends one when its tab closes", async () => {
    const a = ((await (await session.POST(req("/api/live/session", {}))).json()) as { sessionId: string }).sessionId;
    const b = ((await (await session.POST(req("/api/live/session", { sessionId: a }))).json()) as { sessionId: string }).sessionId;
    expect(b).not.toBe(a);
    expect((await session.POST(req("/api/live/session", { sessionId: a, end: true }))).status).toBe(200);
    const r = await render.POST(req("/api/live/render", { sessionId: a, seq: 1, slot: "live", seed: 7, size: 512, keepRes: 1024, text: "x" }));
    expect(r.status).toBe(410);
  });
});

describe("who may use live edit", () => {
  const through = (method: string, url: string, cookie?: string) =>
    proxy(new NextRequest(`http://localhost:3000${url}`, { method, headers: { host: "localhost:3000", ...(cookie && { cookie }) } }));

  it("names its routes", () => {
    expect(liveRoute("/api/live/render")).toBe("render");
    expect(liveRoute("/api/live/nodes")).toBe("nodes");
    expect(liveRoute("/api/live/render/x")).toBeNull();
    expect(accountLive("render", null)).toBe("connect-gpu");
    expect(accountLive("render", "link")).toBe("pass");
    expect(accountLive("masters", "computer")).toBe("pass");
    expect(accountLive("save", "link")).toBe("library");
    expect(accountLive("nodes", null)).toBe("pass");
  });

  it("a guest gets the sign-up answer on every route but the node download", async () => {
    for (const [m, r] of [["POST", "session"], ["POST", "inputs"], ["POST", "render"], ["POST", "cancel"], ["GET", "events"], ["POST", "masters"], ["POST", "save"]] as const) {
      const res = through(m, `/api/live/${r}`);
      expect(res.status, r).toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe(GUEST_RUN_MESSAGE);
    }
    expect(through("GET", "/api/live/nodes").headers.get("x-middleware-next")).toBe("1");
  });

  it("an account: its own GPU only, its own files, no Library", async () => {
    auth.setAccountGpu(acct, null);
    for (const r of ["session", "inputs", "render", "cancel", "masters"]) {
      const res = through("POST", `/api/live/${r}`, acctCookie);
      expect(res.status, r).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe(CONNECT_GPU_MESSAGE);
    }
    expect(through("GET", "/api/live/events", acctCookie).status).toBe(403);
    auth.setAccountGpu(acct, { url: "https://gpu.example.com", token: "t" });
    for (const r of ["session", "inputs", "render", "cancel", "masters"]) expect(through("POST", `/api/live/${r}`, acctCookie).headers.get("x-middleware-next"), r).toBe("1");
    const s = through("POST", "/api/live/save", acctCookie);
    expect(s.status).toBe(403);
    expect(((await s.json()) as { error: string }).error).toBe(LIBRARY_MESSAGE);
    auth.setAccountGpu(acct, { mode: "computer" });
    expect(through("POST", "/api/live/masters", acctCookie).headers.get("x-middleware-next")).toBe("1");
    // The server path isn't for a computer: the route says so.
    const sess = await session.POST(req("/api/live/session", {}, acctCookie));
    expect(sess.status).toBe(409);
  });

  it("stores a master from a tab on its own computer: the owner's file, or the account's own", async () => {
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#884422" } }).png().toBuffer();
    const post = (cookie: string, body: Buffer) => masters.POST(new Request("http://localhost:3000/api/live/masters", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "image/png" }, body: new Uint8Array(body) }));
    const o = await post(owner, png);
    expect(o.status).toBe(201);
    expect(((await o.json()) as { url: string }).url).toMatch(/^\/api\/files\//);
    auth.setAccountGpu(acct, { mode: "computer" });
    const a = await post(acctCookie, png);
    expect(a.status).toBe(201);
    const webp = await sharp(png).webp().toBuffer();
    expect((await post(owner, webp)).status).toBe(415);
    expect((await post("", png)).status).toBe(401);
  });

  it("only the owner saves to the Library", async () => {
    const r = await save.POST(req("/api/live/save", { master: "/api/files/uploads/2026-11-01/x.png", steps: [{ text: "gold earrings", seed: 1 }] }));
    expect(r.status).toBe(201);
    const g = (await r.json()) as { feature: string; modelId: string; prompt: string };
    expect(g).toMatchObject({ feature: "live-edit", modelId: "oss-qwen-image-21-live", prompt: "gold earrings" });
    auth.setAccountGpu(acct, { url: "https://gpu.example.com" });
    expect((await save.POST(req("/api/live/save", { master: "/api/files/x.png", steps: [] }, acctCookie))).status).toBe(403);
  });
});
