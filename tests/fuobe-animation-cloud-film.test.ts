import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keyTimes } from "@/lib/inbetween";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { TINY_MP4 } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// Fuobe Animation's cloud film with a fal key (not demo mode), on the stand-in fal: the film is planned with its AniSora
// LoRA, each gap is one request to fal's Wan 2.2 A14B `/lora` endpoint in the shape its OpenAPI schema takes
// (https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/wan/v2.2-a14b/image-to-video/lora), and the
// clips are joined with fal's merge-videos. No real call.
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

beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["test-fal"] = "good";
  fal.pollsToFinish = 1;
  setSetting("falKey", "test-fal");
  setSetting("demoMode", "off");
  // Each endpoint's documented output: Wan's { video: File, prompt, seed }, merge-videos' { video: File, metadata }.
  fal.script = (r) => {
    const path = r.path.split("?")[0];
    if (r.method === "GET" && path === "/files/out.mp4") return { status: 200, body: TINY_MP4.toString("latin1"), headers: { "Content-Type": "video/mp4" } };
    if (r.method === "GET" && /^\/fal-ai\/wan\/requests\/[^/]+$/.test(path)) return { status: 200, body: { video: { url: `${fal.url}/files/out.mp4`, content_type: "video/mp4" }, prompt: "p", seed: 1 } };
    if (r.method === "GET" && /^\/fal-ai\/ffmpeg-api\/requests\/[^/]+$/.test(path)) return { status: 200, body: { video: { url: `${fal.url}/files/out.mp4`, content_type: "video/mp4" }, metadata: {} } };
    return null;
  };
});

afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  await fal.close();
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

describe("Fuobe Animation in the cloud with a fal key", () => {
  it("keeps AniSora on the film: each gap goes to Wan 2.2's /lora with it, then the clips are joined", async () => {
    const images = frames(3);
    const timing = { gaps: [{ frames: 17, speed: 1 as const, prompt: "it lands" }, { frames: 81, speed: 1 as const }], fps: 16 as const };
    const from = fal.log.length;
    const [film, ...clips] = gens.createGenerations({
      feature: "video",
      modelId: "fuobe-animation",
      engine: "cloud",
      op: "keyframes",
      prompt: "a fox leaps",
      inputs: { images },
      params: { aspectRatio: "16:9", resolution: "480p", seed: 42, numOutputs: 1, duration: 6, keyframeTimes: keyTimes(timing), extra: { inbetween: timing } },
    });
    expect(film).toMatchObject({ op: "concat", modelId: "join-clips" });
    expect(clips.map((c) => c.op)).toEqual(["flf2v", "flf2v"]);
    expect((await settle(film.id, 60_000)).status).toBe("succeeded");

    const posts = fal.log.slice(from).filter((r) => r.method === "POST" && !r.path.startsWith("/storage"));
    const gaps = posts.filter((r) => r.path === "/fal-ai/wan/v2.2-a14b/image-to-video/lora").map((r) => JSON.parse(r.body));
    expect(gaps).toHaveLength(2);
    for (const body of gaps) {
      expect(body).toMatchObject({
        image_url: expect.stringMatching(/^http/),
        end_image_url: expect.stringMatching(/^http/),
        aspect_ratio: "16:9",
        resolution: "480p",
        interpolator_model: "none",
        frames_per_second: 16,
        loras: [{ path: ANISORA.url, scale: 1, transformer: "high" }],
      });
      expect(typeof body.prompt).toBe("string");
      expect(body.seed).toBe(42);
    }
    // Each gap's own frames: 17 and 81 (4n + 1, within the schema's 17-161).
    expect(gaps.map((b) => b.num_frames).sort((a, b) => a - b)).toEqual([17, 81]);
    // The join: fal's merge-videos takes the clips in order (video_urls, at least 2).
    const join = posts.find((r) => r.path === "/fal-ai/ffmpeg-api/merge-videos");
    expect(JSON.parse(join!.body).video_urls).toHaveLength(2);
  }, 90_000);
});
