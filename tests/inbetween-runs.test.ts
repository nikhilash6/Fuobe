import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keyTimes, WORKFLOW_TIMING } from "@/lib/inbetween";

// Fuobe Animation's runs in demo mode (no keys, no GPU): one row on your GPU, one clip per gap and a join in the cloud.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-inbetween-runs-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a2e2b6a40000000049454e44ae426082", "hex");
const frames = (n: number) => Array.from({ length: n }, () => saveFile({ data: png, contentType: "image/png", source: "upload" }).url);

async function settle(id: string, ms = 40_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe("Fuobe Animation runs", () => {
  it("is one run on your GPU, every gap in one graph", async () => {
    const images = frames(5);
    const items = gens.createGenerations({
      feature: "video",
      modelId: "fuobe-animation",
      engine: "open",
      prompt: "a fox leaps over a log",
      inputs: { images },
      params: { aspectRatio: "16:9", keyframeTimes: keyTimes(WORKFLOW_TIMING), extra: { inbetween: WORKFLOW_TIMING, stillMouth: true } },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ op: "keyframes", modelId: "fuobe-animation" });
    expect(items[0].costUsd).toBe(0);
    expect((await settle(items[0].id)).status).toBe("succeeded");
  }, 60_000);

  it("is one hosted clip per gap in the cloud, each as long as its gap, with its own words, then joined", async () => {
    const images = frames(3);
    const timing = { gaps: [{ frames: 33, speed: 1 as const, prompt: "it lands" }, { frames: 17, speed: 1 as const }], fps: 16 as const };
    const [film, ...clips] = gens.createGenerations({
      feature: "video",
      modelId: "fuobe-animation",
      engine: "cloud",
      prompt: "a fox leaps",
      inputs: { images },
      params: { aspectRatio: "16:9", keyframeTimes: keyTimes(timing), extra: { inbetween: timing, stillMouth: true } },
    });
    expect(film).toMatchObject({ op: "concat" });
    expect(clips.map((c) => c.op)).toEqual(["flf2v", "flf2v"]);
    expect(clips.map((c) => c.request.params?.duration)).toEqual([2, 1]);
    expect(clips.map((c) => c.request.prompt)).toEqual(["a fox leaps. it lands. mouth does not move", "a fox leaps. mouth does not move"]);
    expect(clips.every((c) => c.request.params?.extra?.inbetween === undefined)).toBe(true);
    expect(clips.map((c) => [c.request.inputs?.images, c.request.inputs?.endImage])).toEqual([
      [[images[0]], images[1]],
      [[images[1]], images[2]],
    ]);
    expect((await settle(film.id, 60_000)).status).toBe("succeeded");
  }, 70_000);

  it("refuses the GPU's speeds in the cloud before anything starts", () => {
    const before = gens.listGenerations({ limit: 500 }).length;
    const timing = { gaps: [{ frames: 17, speed: 3 as const }], fps: 16 as const };
    expect(() =>
      gens.createGenerations({ feature: "video", modelId: "fuobe-animation", engine: "cloud", prompt: "x", inputs: { images: frames(2) }, params: { keyframeTimes: [0, 1], extra: { inbetween: timing } } }),
    ).toThrow(/your GPU/);
    expect(gens.listGenerations({ limit: 500 }).length).toBe(before);
  });
});
