import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeFal, startFakeReplicate, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * A setting the composer offers because another route of the model reads it (Nano Banana Pro's seed and count on fal)
 * is never dropped without a word by the route the run goes to (Replicate's, which has neither): the run's notes say
 * what it goes without, and a count the route can't take is made as one job per result. Stand-in Replicate
 * (tests/helpers/fake-cloud.ts): no real key, no paid call.
 */
process.env.FUOBE_DATA_DIR = tempDir("fuobe-route-drops-");
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ENGINE_MODE;
globalThis.__fuobeTestDiskFree = 1e13;

const gens = await import("@/server/generations");
const { setSetting } = await import("@/server/settings");

let rep: FakeCloud;
let fal: FakeCloud;
beforeAll(async () => {
  rep = await startFakeReplicate();
  fal = await startFakeFal();
  globalThis.__fuobeTestReplicateUrl = rep.url;
  globalThis.__fuobeTestFalUrl = fal.url;
  rep.keys["owner-rep"] = "good";
  fal.keys["owner-fal"] = "good";
  setSetting("replicateToken", "owner-rep");
  setSetting("falKey", "");
});
afterAll(async () => {
  globalThis.__fuobeTestReplicateUrl = undefined;
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await rep.close();
  await fal.close();
});

async function settle(id: string, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    await globalThis.__fuobeRunner?.tick();
    const g = gens.getGeneration(id, { includeDeleted: true })!;
    if (!["queued", "running"].includes(g.status) || Date.now() > end) return g;
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe("a setting the chosen route has no field for", () => {
  it("is named in the run's notes, and a count it can't take is made one job per result", async () => {
    const made = gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "a quiet harbour at dawn", params: { seed: 7, numOutputs: 3 } });
    expect(made).toHaveLength(3);
    expect(made.every((g) => g.provider === "replicate")).toBe(true);
    const notes = made[0].notes ?? [];
    expect(notes).toContain("Nano Banana Pro on Replicate doesn't take a seed: this run goes without");
    expect(notes.join(" ")).not.toMatch(/number of results/);
    const done = await Promise.all(made.map((g) => settle(g.id)));
    expect(done.map((g) => g.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(done.reduce((n, g) => n + g.outputs.length, 0)).toBe(3);
  });

  it("says nothing when the run asks for nothing the route drops", () => {
    const [g] = gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "a quiet harbour at dawn" });
    expect((g.notes ?? []).join(" ")).not.toMatch(/doesn't take/);
  });
});

/** Qwen-Image-Edit 2511: Replicate makes 1:1, 16:9, 9:16, 4:3 or 3:4 and takes no negative prompt; fal takes 3:2 and one. */
describe("a run whose route can't honour a setting", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const qwen = { feature: "image" as const, modelId: "qwen-image-edit-2511-cloud", engine: "cloud" as const, prompt: "the harbour at dusk", negativePrompt: "blur", inputs: { images: [PNG] }, params: { aspectRatio: "3:2" } };
  const sent = (log: { method: string; path: string; body: string }[]) => log.filter((r) => r.method === "POST" && /predictions|qwen-image-edit/.test(r.path)).map((r) => JSON.parse(r.body || "{}"));

  it("runs anyway on the only route ready: the closest shape, no negative prompt, and a note it keeps", async () => {
    setSetting("falKey", "");
    rep.log.length = 0;
    const [g] = gens.createGenerations(qwen);
    expect(g.provider).toBe("replicate");
    expect(g.notes).toEqual(
      expect.arrayContaining(["Qwen-Image-Edit 2511 (hosted) on Replicate doesn't take a negative prompt: this run goes without", "Qwen-Image-Edit 2511 (hosted) on Replicate doesn't make 3:2: this run is made at 4:3"]),
    );
    const done = await settle(g.id);
    expect(done.status).toBe("succeeded");
    expect(done.request.notice).toBe("Replicate's Qwen-Image-Edit 2511 made this at 4:3 in place of 3:2 and without the negative prompt.");
    const input = sent(rep.log).at(-1)?.input ?? {};
    expect(input.aspect_ratio).toBe("4:3");
    expect(input).not.toHaveProperty("negative_prompt");
  });

  it("goes to the route the request names, with everything as asked and nothing to say", async () => {
    setSetting("falKey", "owner-fal");
    setSetting("cloudProvider", "replicate");
    try {
      fal.log.length = 0;
      const [g] = gens.createGenerations({ ...qwen, prefer: "fal" });
      expect(g.provider).toBe("fal");
      expect((g.notes ?? []).join(" ")).not.toMatch(/doesn't (take|make)/);
      const done = await settle(g.id);
      expect(done.status).toBe("succeeded");
      expect(done.request.notice).toBeUndefined();
      const body = sent(fal.log).at(-1) ?? {};
      expect(body.image_size).toBe("landscape_4_3");
      expect(body.negative_prompt).toBe("blur");
      // Named Replicate ("Run anyway" on it), it stays there although fal.ai is ready and makes 3:2.
      const [r] = gens.createGenerations({ ...qwen, prefer: "replicate" });
      expect(r.provider).toBe("replicate");
      expect((await settle(r.id)).request.notice).toMatch(/^Replicate's Qwen-Image-Edit 2511 made this at 4:3/);
    } finally {
      setSetting("cloudProvider", "auto");
      setSetting("falKey", "");
    }
  });

  it("says nothing on a shape and settings the route takes", async () => {
    const [g] = gens.createGenerations({ ...qwen, negativePrompt: undefined, params: { aspectRatio: "16:9" } });
    expect(g.provider).toBe("replicate");
    expect((g.notes ?? []).join(" ")).not.toMatch(/doesn't (take|make)/);
    expect((await settle(g.id)).request.notice).toBeUndefined();
  });
});
