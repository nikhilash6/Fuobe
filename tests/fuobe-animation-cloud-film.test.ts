import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keyTimes, resampleGap } from "@/lib/inbetween";
import { startFakeFal, startFakeReplicate, type FakeCloud } from "./helpers/fake-cloud";
import { TINY_MP4 } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";
import { bodyProblems } from "./helpers/provider-schemas";

// Fuobe Animation's cloud film with a Replicate token and a fal key (not demo mode), on the stand-in providers: each gap
// is one prediction on Replicate's fast Wan 2.2 (https://replicate.com/wan-video/wan-2.2-i2v-fast/api/schema) with
// AniSora as the high-noise expert's weights, made at 81 frames; a shorter gap is brought down to its own frames with
// fal's extract-nth-frame and images-to-video, and the gaps are joined with fal's merge-videos. No real call.
const dir = tempDir("fuobe-animation-cloud-film-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { loraEntry } = await import("@/lib/catalog/loras");

const ANISORA = loraEntry("anisora-3-2-i2v-high")!;
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a2e2b6a40000000049454e44ae426082", "hex");
const frames = (n: number) => Array.from({ length: n }, () => saveFile({ data: png, contentType: "image/png", source: "upload" }).url);

let fal: FakeCloud;
let rep: FakeCloud;

beforeAll(async () => {
  fal = await startFakeFal();
  rep = await startFakeReplicate();
  globalThis.__fuobeTestFalUrl = fal.url;
  globalThis.__fuobeTestReplicateUrl = rep.url;
  fal.keys["test-fal"] = "good";
  rep.keys["test-rep"] = "good";
  fal.pollsToFinish = 1;
  rep.pollsToFinish = 1;
  setSetting("falKey", "test-fal");
  setSetting("replicateToken", "test-rep");
  setSetting("demoMode", "off");
  // Replicate's answer: the clip's URL. fal's: the frames ({ images, frame_count }), then a video ({ video: File }).
  const frameCount = new Map<string, number>();
  rep.script = (r) => {
    const path = r.path.split("?")[0];
    if (r.method === "GET" && path === "/files/clip.mp4") return { status: 200, body: TINY_MP4.toString("latin1"), headers: { "Content-Type": "video/mp4" } };
    const one = /^\/v1\/predictions\/([^/]+)$/.exec(path);
    if (one && r.method === "GET") return { status: 200, body: { id: one[1], status: "succeeded", output: `${rep.url}/files/clip.mp4` } };
    return null;
  };
  fal.script = (r) => {
    const path = r.path.split("?")[0];
    if (r.method === "GET" && path === "/files/out.mp4") return { status: 200, body: TINY_MP4.toString("latin1"), headers: { "Content-Type": "video/mp4" } };
    if (r.method === "GET" && /^\/files\/frames-\d+-\d+\.png$/.test(path)) return { status: 200, body: png.toString("latin1"), headers: { "Content-Type": "image/png" } };
    if (r.method === "POST" && path === "/fal-ai/workflow-utilities/extract-nth-frame") {
      const id = `frames-${frameCount.size + 1}`;
      frameCount.set(id, JSON.parse(r.body).max_frames);
      const base = `${fal.url}/fal-ai/workflow-utilities/requests/${id}`;
      return { status: 200, body: { request_id: id, status_url: `${base}/status`, response_url: base, cancel_url: `${base}/cancel` } };
    }
    const taken = /^\/fal-ai\/workflow-utilities\/requests\/(frames-\d+)$/.exec(path);
    if (r.method === "GET" && taken) {
      const n = frameCount.get(taken[1]) ?? 1;
      return { status: 200, body: { frame_count: n, images: Array.from({ length: n }, (_, i) => ({ url: `${fal.url}/files/${taken[1]}-${i}.png`, content_type: "image/png" })) } };
    }
    if (r.method === "GET" && /^\/fal-ai\/ffmpeg-api\/requests\/[^/]+$/.test(path)) return { status: 200, body: { video: { url: `${fal.url}/files/out.mp4`, content_type: "video/mp4" }, metadata: {} } };
    return null;
  };
});

afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestReplicateUrl = undefined;
  await fal.close();
  await rep.close();
});

async function settle(id: string, ms = 40_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("Fuobe Animation in the cloud with a Replicate token", () => {
  it("makes each gap on Replicate's fast Wan 2.2 with AniSora, brings it to the gap's frames and joins the film", async () => {
    const images = frames(3);
    const timing = { gaps: [{ frames: 17, speed: 1 as const, prompt: "it lands" }, { frames: 81, speed: 1 as const }], fps: 16 as const };
    const repFrom = rep.log.length;
    const falFrom = fal.log.length;
    const [film, ...steps] = gens.createGenerations({
      feature: "video",
      modelId: "fuobe-animation",
      engine: "cloud",
      op: "keyframes",
      prompt: "a fox leaps",
      inputs: { images },
      params: { aspectRatio: "16:9", resolution: "480p", seed: 42, numOutputs: 1, duration: 6, keyframeTimes: keyTimes(timing), extra: { inbetween: timing } },
    });
    expect(film).toMatchObject({ op: "concat", modelId: "join-clips" });
    // The 17-frame gap: its clip, its frames (every 5th of 81), the gap at 16 fps; the 81-frame gap as made.
    expect(steps.map((c) => c.op)).toEqual(["flf2v", "extract-frames", "images-to-video", "flf2v"]);
    const done = await settle(film.id, 60_000);
    const why = [film, ...steps].map((g) => `${g.op}: ${gens.getGeneration(g.id)!.status} ${gens.getGeneration(g.id)!.message ?? ""} ${(gens.getGeneration(g.id) as { error?: string }).error ?? ""}`).join(" | ");
    expect(done.status, why).toBe("succeeded");

    const predictions = rep.log.slice(repFrom).filter((r) => r.method === "POST" && /predictions$/.test(r.path));
    expect(predictions.map((r) => r.path)).toEqual(["/v1/models/wan-video/wan-2.2-i2v-fast/predictions", "/v1/models/wan-video/wan-2.2-i2v-fast/predictions"]);
    for (const r of predictions) {
      const { input } = JSON.parse(r.body) as { input: Record<string, unknown> };
      expect(input).toMatchObject({
        image: expect.stringMatching(/^(http|data:)/),
        last_image: expect.stringMatching(/^(http|data:)/),
        resolution: "480p",
        num_frames: 81,
        frames_per_second: 16,
        interpolate_output: false,
        seed: 42,
        lora_weights_transformer: ANISORA.url,
        lora_scale_transformer: 1,
      });
      expect(input).not.toHaveProperty("lora_weights_transformer_2");
      expect(bodyProblems("replicate", "wan-video/wan-2.2-i2v-fast", input)).toEqual([]);
    }

    const posts = fal.log.slice(falFrom).filter((r) => r.method === "POST" && !r.path.startsWith("/storage"));
    const extract = posts.filter((r) => r.path === "/fal-ai/workflow-utilities/extract-nth-frame").map((r) => JSON.parse(r.body));
    expect(extract).toEqual([expect.objectContaining({ frame_interval: 5, max_frames: 17, output_format: "jpg", quality: 95 })]);
    const back = posts.filter((r) => r.path === "/fal-ai/ffmpeg-api/images-to-video").map((r) => JSON.parse(r.body));
    expect(back).toHaveLength(1);
    expect(back[0].fps).toBe(16);
    expect(back[0].images).toHaveLength(17);
    const join = posts.find((r) => r.path === "/fal-ai/ffmpeg-api/merge-videos");
    expect(JSON.parse(join!.body).video_urls).toHaveLength(2);
  }, 90_000);

  it("one gap shorter than 81 frames: the gap brought to its length is the film", () => {
    const timing = { gaps: [{ frames: 33, speed: 1 as const }], fps: 16 as const };
    const [film, ...steps] = gens.createGenerations({
      feature: "video",
      modelId: "fuobe-animation",
      engine: "cloud",
      op: "keyframes",
      prompt: "a fox turns",
      inputs: { images: frames(2) },
      params: { aspectRatio: "16:9", resolution: "480p", keyframeTimes: keyTimes(timing), extra: { inbetween: timing } },
    });
    expect(film.op).toBe("images-to-video");
    expect(film.request.chain?.map((s) => s.index)).toEqual(resampleGap(81, 33)!.picks);
    expect(steps.map((s) => s.op).sort()).toEqual(["extract-frames", "flf2v"]);
    for (const g of [film, ...steps]) void gens.cancelGeneration(g.id);
  });
});
