import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tempDir } from "./helpers/temp-dir";
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-price-reads-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_TRUST_PROXY;

const auth = await import("@/server/auth");
const { saveFile } = await import("@/server/storage");
const { runAsTenant } = await import("@/server/tenant");
const { asVisitor } = await import("@/server/generations");
const { previewAudioTool } = await import("@/server/audio-tools");
const { MultiplierBody, MarketingBody, ClickToAdBody, referenceFacts } = await import("@/server/marketing");
const { KatanaBody, planKatana } = await import("@/server/katana");
const { videoLength } = await import("@/server/dub");
const { resetRates } = await import("@/server/rate");
const { proxy } = await import("@/proxy");
const dubRoute = await import("@/app/api/dub/route");
const audioRoute = await import("@/app/api/audio-tools/route");
const { gpuState } = await import("@/server/account-gpu");
const { splitTime } = await import("@/lib/av/split");

const MP4 = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "shorts-12s.mp4"));

let a = "";
let b = "";
// Placeholders where nothing is connected, as these runs were written for ("auto": code in this process only).
beforeAll(async () => (await import("@/server/settings")).setSetting("demoMode", "auto"));
beforeAll(() => {
  auth.setPassword("install password");
  a = auth.createAccount("price-a@example.com", "long enough").id;
  b = auth.createAccount("price-b@example.com", "long enough").id;
});
afterEach(() => {
  vi.restoreAllMocks();
  resetRates();
});

/** A mono 16-bit WAV, `seconds` long. */
function wav(seconds: number): Buffer {
  const rate = 8000;
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}

/** A price check as the proxy and priceAs run it: as that visitor, on its own GPU (none here). */
const asA = <T,>(fn: () => T) => asVisitor(null, fn, a);
const asGuest = <T,>(fn: () => T) => asVisitor(null, fn);
/** Every whole-file read the server could make. */
function wholeReads() {
  return [vi.spyOn(fs.promises, "readFile"), vi.spyOn(fs, "readFileSync")];
}
const called = (spies: ReturnType<typeof wholeReads>, file: string) => spies.some((s) => s.mock.calls.some((c) => String(c[0]).includes(path.basename(file))));

describe("H-3: price checks read only the header of the asker's own files", () => {
  it("audio Join and Loop: never another's file, and it answers like a file that is gone", async () => {
    const owners = saveFile({ data: wav(30), contentType: "audio/wav", source: "upload" }).url;
    const others = saveFile({ data: wav(30), contentType: "audio/wav", source: "upload", accountId: b }).url;
    for (const url of [owners, others]) {
      await expect(asA(() => previewAudioTool({ tool: "loop", engine: "open", audio: url, duration: 60 }))).rejects.toThrow(/gone/);
      await expect(asGuest(() => previewAudioTool({ tool: "loop", engine: "open", audio: url, duration: 60 }))).rejects.toThrow(/gone/);
    }
    // The owner still prices with any file.
    expect((await previewAudioTool({ tool: "loop", engine: "open", audio: owners, duration: 60 })).summary).toMatch(/Loops it/);
  });

  it("Split soundtrack and its remux: never another's file, and it answers like a file that is gone", async () => {
    const owners = saveFile({ data: wav(30), contentType: "audio/wav", source: "upload" }).url;
    const others = saveFile({ data: wav(30), contentType: "audio/wav", source: "upload", accountId: b }).url;
    const mine = saveFile({ data: wav(30), contentType: "audio/wav", source: "upload", accountId: a }).url;
    const video = saveFile({ data: MP4, contentType: "video/mp4", source: "upload", accountId: a }).url;
    for (const url of [owners, others]) {
      await expect(asA(() => previewAudioTool({ tool: "split", engine: "open", media: url, kind: "audio" }))).rejects.toThrow(/gone/);
      await expect(asGuest(() => previewAudioTool({ tool: "split", engine: "open", media: url, kind: "audio" }))).rejects.toThrow(/gone/);
      await expect(asA(() => previewAudioTool({ tool: "remux", engine: "open", video, audio: url }))).rejects.toThrow("That mix is gone");
      await expect(asA(() => previewAudioTool({ tool: "remux", engine: "open", video: url, audio: mine }))).rejects.toThrow("That video is gone");
    }
    // Its own file: the header's length and channels, never the whole file. The owner still prices with any file.
    const spies = wholeReads();
    expect(await asA(() => previewAudioTool({ tool: "split", engine: "open", media: mine, kind: "audio" }))).toMatchObject({ length: 30, channels: 1, demo: false });
    expect(called(spies, mine)).toBe(false);
    expect((await asA(() => previewAudioTool({ tool: "remux", engine: "open", video, audio: mine }))).steps).toBe(1);
    expect((await previewAudioTool({ tool: "split", engine: "open", media: others, kind: "audio" })).channels).toBe(1);
  });

  it("audio Join: ten copies of its own file read its header, not the whole file", async () => {
    const mine = saveFile({ data: wav(20), contentType: "audio/wav", source: "upload", accountId: a }).url;
    const spies = wholeReads();
    const p = await asA(() => previewAudioTool({ tool: "join", engine: "open", clips: Array.from({ length: 10 }, () => ({ url: mine })), crossfade: 0 }));
    expect(p.length).toBeGreaterThan(190);
    expect(called(spies, mine)).toBe(false);
  });

  it("audio: an own file bigger than an upload may be is never read; the browser's length is used", async () => {
    const mine = saveFile({ data: wav(5), contentType: "audio/wav", source: "upload", accountId: a });
    // Its result grew past what an upload of sound may be (50 MB).
    fs.truncateSync(path.join(dir, "files", mine.relPath), 51 * 2 ** 20);
    const opened = vi.spyOn(fs, "openSync");
    const spies = wholeReads();
    const p = await asA(() => previewAudioTool({ tool: "loop", engine: "open", audio: mine.url, sourceDuration: 7, duration: 60 }));
    expect(p.summary).toMatch(/Loops it/);
    expect(opened.mock.calls.some((c) => String(c[0]).includes(path.basename(mine.relPath)))).toBe(false);
    expect(called(spies, mine.relPath)).toBe(false);
  });

  it("Katana: another's clip is never read, and an own clip is read by its header", () => {
    const owners = saveFile({ data: MP4, contentType: "video/mp4", source: "upload" }).url;
    const mine = saveFile({ data: MP4, contentType: "video/mp4", source: "upload", accountId: a }).url;
    const body = (reference: string) => KatanaBody.parse({ engine: "open", reference, photos: [reference] });
    expect(() => asA(() => planKatana(body(owners)))).toThrow(/how long the reference is/);
    const spies = wholeReads();
    expect(asA(() => planKatana(body(mine))).input.segments.at(-1)?.end).toBeCloseTo(12, 0);
    expect(called(spies, mine)).toBe(false);
  });

  it("Dub: another's video gives what the browser measured, never the file's length", () => {
    const owners = saveFile({ data: MP4, contentType: "video/mp4", source: "upload" }).url;
    expect(asA(() => videoLength(owners, 3))).toBe(3);
    expect(asGuest(() => videoLength(owners))).toBeUndefined();
    expect(videoLength(owners)).toBeCloseTo(12, 0);
    const mine = saveFile({ data: MP4, contentType: "video/mp4", source: "upload", accountId: a }).url;
    const spies = wholeReads();
    expect(asA(() => videoLength(mine))).toBeCloseTo(12, 0);
    expect(called(spies, mine)).toBe(false);
  });
});

describe("a Split soundtrack price check never calls a GPU (main: an account's address a few times a minute at most)", () => {
  /** A stand-in for an account's ComfyUI (a CUDA host with both DBS models) that counts what it is asked. */
  async function standInGpu() {
    const hits: Record<string, number> = {};
    const server = http.createServer((req, res) => {
      const at = (req.url ?? "").split("?")[0];
      hits[at] = (hits[at] ?? 0) + 1;
      const files = ["DBS-BSRNN-DnR/config.json", "DBS-BSRNN-DnR/model.safetensors", "DBS-TIGER-DnR/config.json", "DBS-TIGER-DnR/model.safetensors"];
      const body =
        at === "/system_stats"
          ? { system: { comfyui_version: "0.41.0" }, devices: [{ name: "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync", type: "cuda", vram_total: 24 * 2 ** 30 }] }
          : at === "/models/dbs"
            ? files
            : null;
      res.writeHead(body ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as AddressInfo).port;
    return { hits, port, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
  }
  const price = (body: unknown, session: string) =>
    audioRoute.POST(
      new Request("http://localhost:3000/api/audio-tools?preview=1", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${auth.SESSION_COOKIE}=${session}` },
        body: JSON.stringify(body),
      }),
    );

  it("an account's: its GPU is asked nothing; the pick and the time come from what its last status check read", async () => {
    const gpu = await standInGpu();
    const g = globalThis as { __fuobeComfyDevice?: unknown; __fuobeComfyDbs?: unknown; __fuobeAccountGpus?: unknown };
    g.__fuobeComfyDevice = g.__fuobeComfyDbs = g.__fuobeAccountGpus = undefined;
    globalThis.__fuobeTestGpuPort = gpu.port;
    auth.setAccountGpu(a, { url: gpu.url });
    auth.setAccountGpu(b, { url: gpu.url });
    try {
      const sessionA = auth.createSession(a).value;
      const mine = saveFile({ data: wav(30), contentType: "audio/wav", source: "upload", accountId: a }).url;
      const split = { tool: "split", engine: "open", media: mine, kind: "audio" };
      // No status check yet: a CPU's pick and time, no device, no models.
      for (let i = 0; i < 20; i++) {
        const r = await price(split, sessionA);
        expect(r.status).toBe(200);
        const p = await r.json();
        expect(p).toMatchObject({ demo: false, hostPick: "fast", length: 30, channels: 1 });
        expect(p.device).toBeUndefined();
        expect(p.installed).toBeUndefined();
        expect(p.estimate).toEqual(splitTime({ seconds: 30, quality: "fast", mode: "mono", channels: 1 }));
      }
      expect(gpu.hits).toEqual({});
      // The status strip asks it (main's check, at most every 30 s): from then on the price check knows it is a CUDA GPU.
      await gpuState(a, auth.accountGpu(a)!);
      expect(gpu.hits).toEqual({ "/system_stats": 1 });
      delete gpu.hits["/system_stats"];
      const all = await Promise.all(Array.from({ length: 10 }, () => price({ ...split, stereo: true }, sessionA)));
      for (const r of all) {
        const p = await r.json();
        expect(p).toMatchObject({ hostPick: "best", device: "cuda" });
        expect(p.installed).toBeUndefined();
        expect(p.estimate).toEqual(splitTime({ seconds: 30, quality: "best", mode: "each channel", channels: 1, device: "cuda" }));
      }
      expect(gpu.hits).toEqual({});
      // Another account on the same address hasn't been checked: its price check knows nothing of it, and asks nothing.
      const theirs = saveFile({ data: wav(10), contentType: "audio/wav", source: "upload", accountId: b }).url;
      const pb = await (await price({ tool: "split", engine: "open", media: theirs, kind: "audio" }, auth.createSession(b).value)).json();
      expect(pb).toMatchObject({ hostPick: "fast", length: 10 });
      expect(pb.device).toBeUndefined();
      // A guest: an account's file is gone to it, and nothing is asked.
      expect((await price(split, "")).status).toBe(422);
      expect(gpu.hits).toEqual({});
    } finally {
      auth.setAccountGpu(a, null);
      auth.setAccountGpu(b, null);
      g.__fuobeAccountGpus = undefined;
      globalThis.__fuobeTestGpuPort = undefined;
      await gpu.close();
    }
  });
});

describe("H-2: the ad multiplier's price check keeps nothing a request sends", () => {
  it("refuses a file path over 500 characters, in every studio body that takes one", () => {
    const long = `/api/files/${"a".repeat(600)}`;
    expect(MultiplierBody.safeParse({ engine: "open", video: long, duration: 10, mode: "prompt", quality: "720p" }).success).toBe(false);
    expect(KatanaBody.safeParse({ engine: "open", reference: long, photos: ["/api/files/x.png"] }).success).toBe(false);
    expect(KatanaBody.safeParse({ engine: "open", reference: "/api/files/x.mp4", photos: [long] }).success).toBe(false);
    expect(MarketingBody.shape.reference.safeParse(long).success).toBe(false);
    expect(ClickToAdBody.shape.avatar.safeParse(long).success).toBe(false);
  });

  it("the Dub price check refuses a long path too", async () => {
    const r = await dubRoute.POST(
      new Request("http://localhost/api/dub?preview=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine: "open", mode: "steps", video: `/api/files/${"a".repeat(600)}`, targets: ["es"] }) }),
    );
    expect(r.status).toBe(400);
  });

  it("caches a clip's facts by the file, not by the text of the request, and never a failed read", async () => {
    const mine = saveFile({ data: MP4, contentType: "video/mp4", source: "upload", accountId: a }).url;
    const spies = wholeReads();
    const first = await asA(() => referenceFacts(mine));
    expect(first.aspect).toBeDefined();
    expect(called(spies, mine)).toBe(false);
    // The same file under other names (?1, ?2…) is one entry; a read that failed adds none.
    const sizeOf = () => (globalThis as { __fuobeStoredFacts?: Map<unknown, unknown> }).__fuobeStoredFacts?.size ?? 0;
    const before = sizeOf();
    for (let i = 0; i < 20; i++) await asA(() => referenceFacts(`${mine}?${i}`));
    for (let i = 0; i < 20; i++) await asGuest(() => referenceFacts(`/api/files/uploads/nope/${i}.mp4`));
    expect(sizeOf()).toBe(before);
  });

  it("L-11: another's clip answers 'unknown', even after its owner's check filled the cache", async () => {
    const owners = saveFile({ data: MP4, contentType: "video/mp4", source: "upload" }).url;
    expect((await referenceFacts(owners)).aspect).toBeDefined();
    expect(await asGuest(() => referenceFacts(owners))).toEqual({ sound: null });
    expect(await runAsTenant({ kind: "account", id: b }, () => referenceFacts(owners))).toEqual({ sound: null });
  });
});

describe("H-2 / H-3: price checks are rate-limited per visitor", () => {
  const post = (url: string, cookie?: string, ip = "203.0.113.7") =>
    new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(cookie && { cookie: `${auth.SESSION_COOKIE}=${cookie}` }) }, body: "{}" });
  const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";

  it("a guest gets 120 a minute, then a plain 429; another visitor is not affected", async () => {
    process.env.FUOBE_TRUST_PROXY = "1";
    try {
      for (let i = 0; i < 120; i++) expect(passed(proxy(post("/api/ads/multiplier/estimate"))), `check ${i}`).toBe(true);
      const r = proxy(post("/api/audio-tools?preview=1"));
      expect(r.status).toBe(429);
      expect(r.headers.get("retry-after")).toBeTruthy();
      expect((await r.json()).error).toMatch(/Too many price checks/);
      expect(passed(proxy(post("/api/katana?preview=1", undefined, "198.51.100.9")))).toBe(true);
    } finally {
      delete process.env.FUOBE_TRUST_PROXY;
    }
  });

  it("without a trusted proxy (every guest is one shared key), guests share a much larger budget, and the 429 says how to fix it", async () => {
    expect(process.env.FUOBE_TRUST_PROXY).toBeUndefined();
    for (let i = 0; i < 600; i++) expect(passed(proxy(post("/api/ads/multiplier/estimate", undefined, `198.51.100.${i % 250}`))), `check ${i}`).toBe(true);
    for (let i = 600; i < 1200; i++) proxy(post("/api/ads/multiplier/estimate"));
    const r = proxy(post("/api/ads/multiplier/estimate"));
    expect(r.status).toBe(429);
    expect((await r.json()).error).toMatch(/FUOBE_TRUST_PROXY=1/);
  });

  it("an account gets its own budget; the owner is never limited", () => {
    const account = auth.createSession(a).value;
    for (let i = 0; i < 120; i++) expect(passed(proxy(post("/api/dub?preview=1", account)))).toBe(true);
    expect(proxy(post("/api/dub?preview=1", account)).status).toBe(429);
    const owner = auth.createSession().value;
    for (let i = 0; i < 200; i++) expect(passed(proxy(post("/api/dub?preview=1", owner)))).toBe(true);
  });
});
