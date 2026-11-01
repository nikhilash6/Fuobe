import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SwapProject, SwapTake } from "@/lib/catalog/swap-studio";
import type { SwapProjectView } from "@/server/swap-studio";

vi.setConfig({ testTimeout: 240_000 });
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

// Character Swap Studio's Sharpen (package n7-4-character-swap-2k) through the API in demo mode (no keys, no ComfyUI):
// the cloud makes each chosen take again at 2K as a version beside it, the assembly uses it once it is picked; and the
// route under the owner's public sign-up (guests and accounts get own-gpu-tool, as for every studio job).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-swap-sharpen-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_PUBLIC_SIGNUP;

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const projects = await import("@/app/api/swap-studio/projects/route");
const project = await import("@/app/api/swap-studio/projects/[id]/route");
const clips = await import("@/app/api/swap-studio/projects/[id]/clips/route");
const queue = await import("@/app/api/swap-studio/projects/[id]/queue/route");
const sharpen = await import("@/app/api/swap-studio/projects/[id]/sharpen/route");
const assemble = await import("@/app/api/swap-studio/projects/[id]/assemble/route");
const estimate = await import("@/app/api/swap-studio/projects/[id]/estimate/route");
const stop = await import("@/app/api/swap-studio/projects/[id]/stop/route");

const req = (method: string, body?: unknown) => new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A tiny MP4 header `seconds` long with one `width`×`height` video track: enough for the server's header read. */
function mp4(seconds: number, width: number, height: number): Buffer {
  const box = (type: string, ...body: Buffer[]) => {
    const data = Buffer.concat(body);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + data.length);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, data]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(0x10000, 40);
  tkhd.writeUInt32BE(0x10000, 56);
  tkhd.writeUInt32BE(width << 16, 76);
  tkhd.writeUInt32BE(height << 16, 80);
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(1000, 12);
  mdhd.writeUInt32BE(seconds * 1000, 16);
  const hdlr = Buffer.alloc(24);
  hdlr.write("vide", 8, "latin1");
  const trak = box("trak", box("tkhd", tkhd), box("mdia", box("mdhd", mdhd), box("hdlr", hdlr)));
  return Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0isomiso2mp41", "latin1")), box("moov", box("mvhd", mvhd), trak)]);
}

let clip = "";
let hero = "";
beforeAll(() => {
  setSetting("demoMode", "auto");
  clip = saveFile({ data: mp4(6, 1920, 1080), contentType: "video/mp4", source: "upload", name: "street.mp4" }).url;
  hero = saveFile({ data: encodePng({ width: 64, height: 64, data: Buffer.alloc(64 * 64 * 4, 200) }), contentType: "image/png", source: "upload", name: "hero.png" }).url;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function view(id: string): Promise<SwapProjectView> {
  const res = await project.GET(req("GET"), ctx(id) as never);
  expect(res.status).toBe(200);
  return res.json();
}
async function patch(id: string, edit: unknown): Promise<SwapProject> {
  const res = await project.PATCH(req("PATCH", edit), ctx(id) as never);
  if (res.status !== 200) throw new Error(`${res.status}: ${(await res.json()).error}`);
  return res.json();
}
async function post(route: { POST: (r: Request, c: never) => Promise<Response> }, id: string, body: unknown, status = 201) {
  const res = await route.POST(req("POST", body), ctx(id) as never);
  const out = await res.json();
  if (res.status !== status) throw new Error(`${res.status}: ${out.error}`);
  return out;
}
async function until(id: string, done: (v: SwapProjectView) => boolean, ms = 150_000): Promise<SwapProjectView> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await view(id);
    if (done(v)) return v;
    if (Date.now() > end) throw new Error(`timed out: ${JSON.stringify(Object.values(v.gens).map((g) => g.status))}`);
    await sleep(300);
  }
}

describe("Sharpen on the cloud (demo mode)", () => {
  let id = "";

  it("makes each chosen take again at 2K beside it, priced first; the assembly uses it once picked", async () => {
    id = (await post(projects, "", { name: "Street", engine: "cloud", character: { image: hero, description: "a chrome robot" } })).id;
    let p = await post(clips, id, { url: clip, name: "street.mp4" });
    let c = p.clips[0];
    expect(c.source).toMatchObject({ width: 1920, height: 1080 });
    const shot = c.shots[0];
    p = await patch(id, { type: "shot", clipId: c.id, shotId: shot.id, patch: { settings: { useAnchor: false } } });
    p = await patch(id, { type: "layout", clipId: c.id, shotId: shot.id, op: { op: "partition", frames: 144 } });
    const seg = p.clips[0].shots[0].segments![0];

    // Nothing chosen yet: Sharpen says so.
    await expect(post(sharpen, id, { clipId: c.id, tier: "2K" })).rejects.toThrow(/Choose a take for every swapped segment first/);
    await post(queue, id, { clipId: c.id, shotId: shot.id, segmentId: seg.id, mode: "all" });
    let v = await until(id, (x) => x.project.clips[0].shots[0].segments!.every((g) => !!g.selectedTake && x.gens[g.takes[0].genId!]?.status === "succeeded"));
    const take = v.project.clips[0].shots[0].segments![0].takes[0];

    // The price: one 6 s take at 2K is 6 whole seconds at $0.1625 (a demo here, so it costs nothing to run).
    const est = await (await estimate.GET(req("GET"), ctx(id) as never)).json();
    expect(est.sharpen[c.id]).toMatchObject({ takes: 1, seconds: 6 });
    expect(Object.keys(est.sharpen[c.id].costUsd)).toEqual(["2K"]);

    // The cloud makes 2K or 4K; 4K adds nothing to a film joined at 1920 × 1080; 1080p isn't on fal.
    await expect(post(sharpen, id, { clipId: c.id, tier: "1080p" })).rejects.toThrow(/The cloud makes 2K or 4K/);
    p = await post(sharpen, id, { clipId: c.id, tier: "4K" });
    let t: SwapTake = p.clips[0].shots[0].segments![0].takes[0];
    expect(t.finish).toMatchObject({ engine: "cloud", asked: "4K", tier: "2K", use: false });
    const steps = t.finish!.stepIds!.map((s) => gens.getGeneration(s)!);
    expect(steps.map((g) => g.modelId)).toEqual(["trim-video", "fuobe-character-swap", "trim-video"]);
    const swap = steps[1].request;
    expect(swap.params).toMatchObject({ resolution: "2K", seed: take.seed, duration: 6, sourceDuration: 6 });
    expect(swap.prompt).toBe(gens.getGeneration(take.stepIds![1])!.request.prompt);
    expect(swap.loras?.[0]?.file).toMatch(/swap/);
    // Asked again while it is being made: nothing to do.
    await expect(post(sharpen, id, { clipId: c.id, tier: "2K" })).rejects.toThrow(/already has a 2K version/);

    v = await until(id, (x) => x.gens[x.project.clips[0].shots[0].segments![0].takes[0].finish!.genId!]?.status === "succeeded");
    t = v.project.clips[0].shots[0].segments![0].takes[0];
    c = v.project.clips[0];
    // Not picked: the assembly is the 768p take.
    let q = await post(assemble, id, { clipId: c.id });
    expect(q.clips[0].assembly.takes).toEqual([t.id]);
    const first = await until(id, (x) => ["succeeded", "failed"].includes(x.gens[x.project.clips[0].assembly!.genId!]?.status ?? ""));
    const failed = Object.entries(first.gens).filter(([, g]) => g.status === "failed");
    expect(failed.map(([gid, g]) => `${gens.getGeneration(gid)?.modelId}: ${g.error}`)).toEqual([]);
    // Picked after comparing: a new assembly with the 2K version in it.
    await patch(id, { type: "take", clipId: c.id, shotId: shot.id, segmentId: seg.id, takeId: t.id, finishUse: true });
    q = await post(assemble, id, { clipId: c.id });
    expect(q.clips[0].assembly.takes).toEqual([`${t.id}@${t.finish!.id}`]);
    const parts = q.clips[0].assembly.stepIds.map((s: string) => gens.getGeneration(s)!);
    // The take's piece is the 2K version scaled to the film (1920 × 1080: fal merge-videos' 512–2048 px).
    const scaled = parts.find((g: { modelId: string }) => g.modelId === "scale-video")!;
    expect(scaled.request.inputs?.video).toBe(v.gens[t.finish!.genId!].url);
    expect(scaled.request.params).toMatchObject({ extra: { width: 1920, height: 1080 } });
  });

  it("only a finished version can be picked, and Stop stops what is being made", async () => {
    const p = (await view(id)).project;
    const c = p.clips[0];
    const shot = c.shots[0];
    const seg = shot.segments![0];
    await expect(patch(id, { type: "take", clipId: c.id, shotId: shot.id, segmentId: seg.id, takeId: "take-nope", finishUse: true })).rejects.toThrow(/422/);
    const r = await post(stop, id, { kind: "finish", clipId: c.id }, 200);
    expect(r.id).toBe(id);
  });
});

describe("the route under the owner's public sign-up", () => {
  it("gives guests and accounts own-gpu-tool (a studio job, like Assemble), and the owner the route", async () => {
    process.env.FUOBE_PASSWORD = "install password";
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    try {
      const auth = await import("@/server/auth");
      const { proxy } = await import("@/proxy");
      const access = await import("@/lib/guest-access");
      const account = auth.createAccount("sharpen@example.com", "long enough");
      const cookie = auth.createSession(account.id).value;
      auth.setAccountGpu(account.id, { url: "https://gpu.example" });
      const at = (url: string, c?: string) => new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: c ? { cookie: `${auth.SESSION_COOKIE}=${c}` } : {}, body: "{}" });
      for (const p of ["/api/swap-studio/projects/swap-1/sharpen", "/api/swap-studio/projects/swap-1/assemble", "/api/genjutsu"]) {
        for (const c of [undefined, cookie]) {
          const r = proxy(at(p, c));
          expect(r.status, `${p} ${c ? "account" : "guest"}`).toBe(403);
          expect(await r.json()).toEqual({ error: access.OWN_GPU_TOOL_MESSAGE, code: "own-gpu-tool" });
        }
      }
      // Genjutsu's price check (2K included) stays open to visitors.
      expect(access.isPriceCheck("POST", "/api/genjutsu/estimate", "")).toBe(true);
      expect(proxy(at("/api/genjutsu/estimate")).headers.get("x-middleware-next")).toBe("1");
    } finally {
      delete process.env.FUOBE_PASSWORD;
      delete process.env.FUOBE_PUBLIC_SIGNUP;
    }
  });

  it("an account's composite through /api/generations reads only its own files", async () => {
    const auth = await import("@/server/auth");
    const { accountInputProblem } = await import("@/server/account-inputs");
    const a = auth.createAccount("composite@example.com", "long enough");
    const own = saveFile({ data: mp4(3, 1920, 1080), contentType: "video/mp4", source: "upload", name: "mine.mp4", accountId: a.id }).url;
    const request = (videos: string[], mask: string) => ({ inputs: { videos, mask }, params: { extra: { windowStart: 0, takeStart: 0, maskStart: 0 } } });
    expect(accountInputProblem(request([own, own, own], own), a.id)).toBeNull();
    // The owner's footage, or a link, is refused.
    expect(accountInputProblem(request([clip, own, own], own), a.id)).toMatchObject({ code: "input-not-yours" });
    expect(accountInputProblem(request([own, own, own], "https://x.example/m.mp4"), a.id)).toMatchObject({ code: "input-not-allowed" });
  });
});
