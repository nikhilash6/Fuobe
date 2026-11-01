/**
 * Live edit doesn't wear a picture down (spec §6): 10 kept edits through the scheduler, the graph builder and the step
 * stack, against the ComfyUI stand-in with a lossy round trip on every render (noise and blur over the whole frame,
 * as a VAE's would add). The stand-in can only check the bookkeeping; GPU-TEST.md measures real pictures.
 *
 * - hybrid (Fuobe's method): every base is a full-size PNG master, and the pixels no edit touched are bit-identical to
 *   the original after 10 edits (SSIM 1.000, sharpness 100 %);
 * - chain without the paste-back (every edit re-encodes the whole picture): SSIM falls below 0.98;
 * - the reference app's way, each kept 512 live frame as the next base: SSIM falls below 0.90.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLiveGraph, slotBindings, type LiveGraphParams } from "@/lib/live/graph";
import { inputName, pngSize } from "@/lib/live/names";
import { LiveScheduler } from "@/lib/live/scheduler";
import { StepStack, type Master, type Method } from "@/lib/live/steps";
import { renderKey } from "@/lib/live/text";
import { startLocalComfy, type LocalComfy } from "./helpers/fake-local-comfy";
import { gray, laplacianVariance, outside, ssim } from "./helpers/image-metrics";

const W = 1536;
const H = 2048;
const EDITS = ["gold hoop earrings", "a red silk scarf", "a black leather bag", "puffed sleeves", "a sign that says OPEN", "copper hair", "a pearl necklace", "deep red lipstick", "a velvet ribbon", "a silver brooch"];

let fake: LocalComfy;
let original: Buffer;

beforeAll(async () => {
  fake = await startLocalComfy({ cors: "off", stepMsAt512: 1, latencyMs: 1, lossy: true });
  // A detailed picture: fine texture over smooth shapes (a 512 round trip loses the texture).
  const px = Buffer.alloc(W * H * 3);
  let s = 1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const n = (s >>> 24) % 48;
      const i = (y * W + x) * 3;
      px[i] = (60 + ((x * 140) / W) + n) & 255;
      px[i + 1] = (50 + ((y * 120) / H) + n) & 255;
      px[i + 2] = (90 + (((x + y) % 256) >> 2) + n) & 255;
    }
  original = await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
}, 60_000);

afterAll(() => fake?.close());

async function upload(bytes: Buffer): Promise<string> {
  const { name } = await inputName(bytes, "png");
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), name);
  form.append("type", "input");
  form.append("overwrite", "true");
  const r = await fetch(`${fake.url}/upload/image`, { method: "POST", body: form });
  expect(r.ok).toBe(true);
  return name;
}

/** One render through the stand-in (the link path: saved to temp, read from /view). */
async function render(p: LiveGraphParams, signal: AbortSignal): Promise<Buffer> {
  const id = randomUUID();
  const { graph } = buildLiveGraph({ ...p, to: "temp" });
  const r = await fetch(`${fake.url}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph, prompt_id: id, client_id: "drift-test", front: true }) });
  expect(r.ok).toBe(true);
  for (;;) {
    if (signal.aborted) throw new Error("aborted");
    const h = (await (await fetch(`${fake.url}/history/${id}`)).json()) as Record<string, { outputs: Record<string, { images?: { filename: string }[] }> }>;
    const img = h[id]?.outputs?.["90"]?.images?.[0];
    if (img) {
      await fetch(`${fake.url}/history`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [id] }) });
      return Buffer.from(await (await fetch(`${fake.url}/view?filename=${img.filename}&subfolder=&type=temp`)).arrayBuffer());
    }
    if (h[id]) throw new Error("render failed");
    await new Promise((res) => setTimeout(res, 3));
  }
}

const master = async (bytes: Buffer, name: string): Promise<Master> => {
  const size = pngSize(bytes)!;
  const { sha256 } = await inputName(bytes, "png");
  return { name, w: size.w, h: size.h, sha256, format: "png" };
};

/**
 * 10 kept edits, each after two live frames, by a method: "hybrid" (paste-back), "chain" (no paste-back, whole-picture
 * edits), or "preview" (the reference app's: the shown 512 live frame becomes the next base).
 */
async function session(method: Method | "preview") {
  const sched = new LiveScheduler<LiveGraphParams, Buffer>({ run: (job, signal) => render(job.payload, signal) });
  const first = await upload(original);
  const stack = StepStack.from(await master(original, first));
  const bases: string[] = [];
  const touched: [number, number, number, number][] = [];
  let seq = 0;
  let previewBase: { name: string; bytes: Buffer } | null = null;
  for (const [k, text] of EDITS.entries()) {
    const seed = 1000 + k;
    const baseName = method === "preview" && previewBase ? previewBase.name : stack.base(method === "preview" ? "hybrid" : method)!.name;
    const paste = method === "chain" ? ("off" as const) : ("auto" as const);
    // Two live frames while typing: small WebP, never a base.
    let lastLive: Buffer | null = null;
    for (const words of [text.split(" ").slice(0, -1).join(" ") || text, text]) {
      const o = await sched.submit({ seq: ++seq, slot: "live", key: renderKey({ base: baseName, text: words, seed, size: 512 }), payload: { prompt: words, seed, base: baseName, ...slotBindings("live", { liveSize: 512, keepRes: 1536, hasMask: false, to: "temp" }), paste } });
      expect(o.ok).toBe(true);
      if (o.ok) {
        lastLive = o.result;
        stack.sawLive((await inputName(o.result, "png")).sha256);
        stack.sawLive((await inputName(o.result, "webp")).sha256);
      }
    }
    if (method === "preview") {
      // The reference app kept the live frame it showed (a 512 PNG) as the next base.
      const png = await sharp(lastLive!).png().toBuffer();
      previewBase = { name: await upload(png), bytes: png };
      bases.push(previewBase.name);
      continue;
    }
    const o = await sched.submit({ seq: ++seq, slot: "keep", key: renderKey({ base: baseName, text, seed, size: 1536, quality: "keep" }), payload: { prompt: text, seed, base: baseName, ...slotBindings("keep", { liveSize: 512, keepRes: 1536, hasMask: false, to: "temp" }), paste } });
    expect(o.ok).toBe(true);
    if (!o.ok) throw new Error("keep failed");
    const name = await upload(o.result);
    stack.keep({ text, norm: text, seed, method, keepRes: 1536, master: await master(o.result, name), ms: 0 });
    bases.push(baseName);
    const r = fake.renders.at(-1)!;
    if (r.touched) touched.push(r.touched);
  }
  const final = method === "preview" ? previewBase!.bytes : fake.inputs.get(stack.head!.master.name)!;
  return { stack, bases, touched, final };
}

describe("stacked live edits", () => {
  it("hybrid: every base is a full-size PNG master and untouched pixels stay exactly as they were", async () => {
    const posted = fake.log.length;
    const { stack, touched, final } = await session("hybrid");
    expect(stack.path()).toHaveLength(11);
    // Every graph's node 10 names a PNG master at full size (or the original), never a live frame's bytes.
    const prompts = fake.log.slice(posted).filter((l) => l.prompt?.prompt);
    expect(prompts.length).toBe(30);
    for (const l of prompts) {
      const name = String(l.prompt!.prompt!["10"].inputs.image);
      const bytes = fake.inputs.get(name)!;
      expect(pngSize(bytes)).toEqual({ w: W, h: H });
      const { sha256 } = await inputName(bytes, "png");
      expect(stack.isLive(sha256)).toBe(false);
    }
    const a = await gray(original);
    const b = await gray(final);
    const unchanged = outside(touched);
    const score = ssim(a, b, unchanged);
    console.log(`hybrid: unchanged-region SSIM after 10 edits = ${score.toFixed(4)}, ${touched.length} edited areas`);
    expect(score).toBe(1);
    expect(laplacianVariance(b, unchanged) / laplacianVariance(a, unchanged)).toBe(1);
  }, 120_000);

  it("chain without the paste-back drifts (the reason for it)", async () => {
    const { touched, final } = await session("chain");
    expect(touched).toHaveLength(0);
    const score = ssim(await gray(original), await gray(final));
    console.log(`chain without paste-back: SSIM after 10 edits = ${score.toFixed(4)}`);
    expect(score).toBeLessThan(0.98);
  }, 120_000);

  it("negative control: kept 512 previews as the base wear the picture down", async () => {
    const { final } = await session("preview");
    const score = ssim(await gray(original), await gray(final, { w: W, h: H }));
    console.log(`512 preview as base: SSIM after 10 edits = ${score.toFixed(4)}`);
    expect(score).toBeLessThan(0.9);
  }, 120_000);
});
