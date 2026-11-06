import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeReplicate, type FakeCloud } from "./helpers/fake-cloud";
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
beforeAll(async () => {
  rep = await startFakeReplicate();
  globalThis.__fuobeTestReplicateUrl = rep.url;
  rep.keys["owner-rep"] = "good";
  setSetting("replicateToken", "owner-rep");
  setSetting("falKey", "");
});
afterAll(async () => {
  globalThis.__fuobeTestReplicateUrl = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await rep.close();
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
