import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeFal, startFakeReplicate, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * Replicate's H3 Lite and HighSpeed read their reference lists as plain text ("Public URLs for up to 9 reference images",
 * items with no uri format: replicate.com/minimax/h3-lite/api, read 2026-11-06). Replicate passes them on as they are, so a
 * data: URI or a Files API link (api.replicate.com/v1/files/…, which needs the token) can't be read by the model. Stand-ins
 * only: no key, no paid call.
 */

process.env.FUOBE_DATA_DIR = tempDir("fuobe-replicate-public-links-");
delete process.env.FUOBE_PASSWORD;
globalThis.__fuobeTestDiskFree = 1e13;

const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const gens = await import("@/server/generations");
type Req = import("@/lib/catalog/types").GenerationRequest;

let rep: FakeCloud;
let fal: FakeCloud;
beforeAll(async () => {
  rep = await startFakeReplicate();
  fal = await startFakeFal();
  globalThis.__fuobeTestReplicateUrl = rep.url;
  globalThis.__fuobeTestFalUrl = fal.url;
  rep.keys["r8_standin"] = "good";
  fal.keys["fal_standin"] = "good";
  setSetting("replicateToken", "r8_standin");
  setSetting("cloudProvider", "replicate");
  setSetting("demoMode", "off");
});
afterAll(async () => {
  globalThis.__fuobeTestReplicateUrl = undefined;
  globalThis.__fuobeTestFalUrl = undefined;
  await rep.close();
  await fal.close();
});
beforeEach(() => {
  rep.log.length = 0;
  fal.log.length = 0;
  rep.pollsToFinish = Infinity;
});

const png = (bytes: number) => Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452000002000000020008060000007a7a1a6a", "hex"), Buffer.alloc(Math.max(0, bytes - 33), 1)]);
const mp4 = (bytes: number) => Buffer.concat([Buffer.from("000000186674797069736f6d", "hex"), Buffer.alloc(bytes - 12, 0)]);

async function settle(id: string) {
  for (let i = 0; i < 400; i++) {
    const g = gens.getGeneration(id)!;
    if (rep.log.some((r) => r.method === "POST" && r.path.endsWith("/predictions"))) return g;
    if (!["queued", "running"].includes(g.status)) return g;
    await new Promise((r) => setTimeout(r, 25));
  }
  return gens.getGeneration(id)!;
}

const refsRun = (): Req => ({
  feature: "video",
  modelId: "minimax-h3-lite",
  prompt: "Image 1 dances under warm light",
  engine: "cloud",
  inputs: { images: [saveFile({ data: png(200_000), contentType: "image/png", source: "upload" }).url], videos: [saveFile({ data: mp4(1_500_000), contentType: "video/mp4", source: "upload" }).url] },
} as Req);

// Skipped until the server side lands: FieldMap.publicLinks from scripts/gen-cloud-models.py and src/server/providers/replicate.ts prepareFile sending public links. It fails without that change.
describe.skip("H3 Lite references on Replicate go as public links", () => {
  it("with a fal.ai key, each reference file goes to fal's storage and its public link is sent", async () => {
    setSetting("falKey", "fal_standin");
    const [g] = gens.createGenerations(refsRun());
    await settle(g.id);
    const post = rep.log.find((r) => r.method === "POST" && r.path === "/v1/models/minimax/h3-lite/predictions");
    expect(post).toBeTruthy();
    const input = JSON.parse(post!.body).input;
    for (const u of [...input.reference_image_urls, ...input.reference_video_urls]) {
      expect(u.startsWith("data:")).toBe(false);
      expect(u).not.toMatch(/\/v1\/files\//);
      expect(u.startsWith(`${fal.url}/files/`)).toBe(true);
    }
    expect(rep.log.some((r) => r.path === "/v1/files")).toBe(false);
    await gens.cancelGeneration(g.id).catch(() => {});
  });

  it("with no fal.ai key, the run stops before its job, saying why", async () => {
    setSetting("falKey", "");
    const [g] = gens.createGenerations(refsRun());
    const done = await settle(g.id);
    expect(rep.log.some((r) => r.method === "POST" && r.path.endsWith("/predictions"))).toBe(false);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/public web links/);
  });
});
