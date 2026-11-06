import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * Files an endpoint documents it refuses never reach it as they are. A picture outside an endpoint's size, format or
 * alpha rules goes as a fitted copy (src/server/fit-still.ts: Qwen Image 3 edit takes 384-2048 px a side), and a clip in a
 * container the endpoint refuses is stopped before upload (clipFileProblem: FLUX.3 Video edits an MP4 clip only).
 * Stand-in fal.ai (tests/helpers/fake-cloud.ts): no real key, no paid call.
 */
process.env.FUOBE_DATA_DIR = tempDir("fuobe-hosted-input-files-");
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ENGINE_MODE;
globalThis.__fuobeTestDiskFree = 1e13;

const gens = await import("@/server/generations");
const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const { imageSize } = await import("@/lib/image-size");

let fal: FakeCloud;
beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["owner-fal"] = "good";
  setSetting("falKey", "owner-fal");
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fal.close();
});

async function settle(id: string, done: () => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    await globalThis.__fuobeRunner?.tick();
    const g = gens.getGeneration(id, { includeDeleted: true })!;
    if (done() || !["queued", "running"].includes(g.status) || Date.now() > end) return g;
    await new Promise((r) => setTimeout(r, 15));
  }
}
const submits = (endpoint: string) => fal.log.filter((r) => r.method === "POST" && r.path.split("?")[0] === `/${endpoint}`);
const uploads = () => fal.log.filter((r) => r.method === "PUT" && r.path.startsWith("/upload/"));

describe("files outside an endpoint's documented limits", () => {
  it("a picture over Qwen Image 3 edit's 2048 px goes as a 2048 px copy without alpha", async () => {
    const png = await sharp({ create: { width: 3000, height: 1000, channels: 4, background: { r: 200, g: 120, b: 40, alpha: 0.5 } } })
      .png()
      .toBuffer();
    const ref = saveFile({ data: png, contentType: "image/png", name: "wide.png", source: "upload" }).url;
    const from = fal.log.length;
    const [g] = gens.createGenerations({ feature: "image", modelId: "qwen-image-3", engine: "cloud", op: "edit", prompt: "make the sky pink", inputs: { images: [ref] } });
    await settle(g.id, () => submits("alibaba/qwen-image-3/edit").length > 0);
    const sent = fal.log.slice(from).filter((r) => r.method === "PUT" && r.path.startsWith("/upload/"));
    expect(sent).toHaveLength(1);
    const data = Buffer.from(sent[0].body, "latin1");
    expect(imageSize(data)).toEqual({ width: 2048, height: 682 });
    const meta = await sharp(data).metadata();
    expect(meta.hasAlpha).toBe(false);
    expect(submits("alibaba/qwen-image-3/edit")).toHaveLength(1);
    await gens.cancelGeneration(g.id).catch(() => {});
  });

  it("a WebM clip for FLUX.3 Video's edit is stopped before it is uploaded", async () => {
    const ref = saveFile({ data: Buffer.from("\x1aE\xdf\xa3webm", "latin1"), contentType: "video/webm", name: "clip.webm", source: "upload" }).url;
    const before = uploads().length;
    const [g] = gens.createGenerations({ feature: "video-edit", modelId: "flux-3-video", engine: "cloud", op: "v2v", prompt: "make it snow", inputs: { video: ref } });
    const done = await settle(g.id, () => false);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/FLUX\.3 Video takes an MP4 clip under 50 MB/);
    expect(uploads().length).toBe(before);
    expect(fal.log.some((r) => r.method === "POST" && r.path.includes("flux-3"))).toBe(false);
  });
});
