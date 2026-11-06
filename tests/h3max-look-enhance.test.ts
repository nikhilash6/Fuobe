import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * fal's H3 Max looks put their own style on the clip. Each endpoint's prompt field (fal's queue OpenAPI for
 * minimax/h3-max/styles/<slug>) says "Describe the scene, action, camera and sound. The … style is applied automatically."
 * So Enhance adds no light, lens or film look of Fuobe's to a look's prompt, as Soul's enhancer adds no style to Soul's.
 * Other video models keep the full rewrite. The AI helper is off, so the offline rewrite runs (an account's run always
 * gets it). Stand-in fal.ai (tests/helpers/fake-cloud.ts): no real key, no paid call.
 */
process.env.FUOBE_DATA_DIR = tempDir("fuobe-look-enhance-");
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const { getModel } = await import("@/lib/catalog");
const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration } = await import("@/server/generations");
type GenerationRequest = import("@/lib/catalog/types").GenerationRequest;

const LOOKS = ["minimax-h3-max-look-pixel", "minimax-h3-max-look-hand-drawn", "minimax-h3-max-look-low-poly", "minimax-h3-max-look-retro-toon", "minimax-h3-max-look-vhs"];
const IDEA = "A lighthouse keeper climbs a spiral stair at night, rain on the glass, a foghorn far off";
/** The offline rewrite's own look: light, lens, film. */
const FUOBE_LOOK = /cinematic|volumetric|depth of field|film look|realistic physics/i;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const MP4 = `data:video/mp4;base64,${Buffer.from("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom", "latin1").toString("base64")}`;

let fal: FakeCloud;
beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["stand-in-fal-key"] = "good";
  fal.pollsToFinish = 0;
  setSetting("falKey", "stand-in-fal-key");
  setSetting("enhanceProvider", "none");
  // A look's answer as fal's output schema has it: {video: File, seed}.
  fal.script = (r) => (r.method === "GET" && /\/requests\/[^/]+$/.test(r.path.split("?")[0]) ? { status: 200, body: { video: { url: MP4, content_type: "video/mp4" }, seed: 1 } } : null);
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  await fal.close();
});

/** The prompt fal got for one enhanced run of `modelId`. */
async function sentPrompt(modelId: string, images?: string[]): Promise<{ path: string; prompt: string }> {
  const m = getModel(modelId)!;
  fal.log.length = 0;
  const [g] = createGenerations({ feature: "video", modelId, engine: "cloud", prompt: IDEA, ...(images && { inputs: { images } }), params: { ...m.defaults, enhancePrompt: true } } as GenerationRequest);
  for (let i = 0; i < 1500 && !["failed", "succeeded", "canceled"].includes(getGeneration(g.id)!.status); i++) await new Promise((r) => setTimeout(r, 10));
  expect(getGeneration(g.id)!.status, `${modelId}: ${getGeneration(g.id)!.error}`).toBe("succeeded");
  const submit = fal.log.find((r) => r.method === "POST" && !r.path.startsWith("/storage/"))!;
  return { path: submit.path, prompt: JSON.parse(submit.body).prompt };
}

describe("Enhance on an H3 Max look leaves the look to fal", () => {
  it.each(LOOKS)("%s: words and a first frame, enhanced without Fuobe's light, lens or film look", async (id) => {
    for (const images of [undefined, [PNG]]) {
      const { path, prompt } = await sentPrompt(id, images);
      expect(path).toBe(`/${getModel(id)!.routes[0].endpoint}`);
      expect(prompt.startsWith(IDEA)).toBe(true);
      expect(prompt.length).toBeGreaterThan(IDEA.length);
      expect(prompt).not.toMatch(FUOBE_LOOK);
    }
  });

  it("another video model keeps the full rewrite (MiniMax H3 on fal)", async () => {
    const { path, prompt } = await sentPrompt("minimax-h3");
    expect(path).toBe("/minimax/h3/text-to-video");
    expect(prompt).toMatch(/24fps film look/);
  });
});
