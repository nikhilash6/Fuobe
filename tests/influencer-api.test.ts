import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-influencer-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { db } = await import("@/server/db");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const route = await import("@/app/api/influencer/route");
const estimateRoute = await import("@/app/api/influencer/estimate/route");
const { compileCastPrompt } = await import("@/lib/influencer");
const { soulRecipe } = await import("@/lib/catalog/soul");
const { CAST_LOOK } = await import("@/lib/catalog/soul-cards");
const { retryPhoto } = await import("@/server/photodump");

beforeAll(() => {
  setSetting("demoMode", "auto");
});
afterEach(() => {
  setSetting("engineMode", "both");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const upload = () => saveFile({ data: PNG, contentType: "image/png", source: "upload" }).url;
const post = (body: unknown, preview = false) =>
  route.POST(new Request(`http://x/api/influencer${preview ? "?preview=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const state = { tier: "freak", picks: { gender: ["female"], hair: ["hs_beehive"], aesthetic: ["goth"] }, locked: [] };

async function settle(id: string, ms = 40_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id, { includeDeleted: true })!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe("/api/influencer", () => {
  it("prices a cloud sheet on Fuobe Soul (Nano Banana Pro or Seedream 5.0 Pro when asked); a retired model id runs the default", async () => {
    const cloud = await (await post({ engine: "cloud", state, start: "scratch" }, true)).json();
    expect(cloud).toMatchObject({ modelId: "fuobe-soul", modelName: "Fuobe Soul", count: 1, steps: 1, demo: true });
    expect((await (await post({ engine: "cloud", state, start: "scratch", modelId: "ai-influencer" }, true)).json()).modelId).toBe("fuobe-soul");
    const face = await (await post({ engine: "cloud", state, start: "face", photo: upload() }, true)).json();
    expect(face).toMatchObject({ modelId: "qwen-image-edit-2511-cloud", count: 1, steps: 2 });
    expect((await (await post({ engine: "cloud", state, start: "scratch", modelId: "nano-banana-pro" }, true)).json()).modelId).toBe("nano-banana-pro");
    // The same price at /api/influencer/estimate (where the evaluation harness prices studio routes).
    const estimate = await (await estimateRoute.POST(new Request("http://x/api/influencer/estimate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine: "cloud", state, start: "scratch" }) }))).json();
    expect(estimate).toMatchObject({ modelId: "fuobe-soul", count: 1, steps: 1, demo: true });
    const seedream = await (await post({ engine: "cloud", state, start: "scratch", modelId: "seedream-5-pro" }, true)).json();
    expect(seedream.modelId).toBe("seedream-5-pro");
  });

  it("prices the open sheet as free, in two steps with a face", async () => {
    const face = upload();
    const open = await (await post({ engine: "open", state, start: "face", photo: face }, true)).json();
    expect(open).toMatchObject({ modelId: "oss-qwen-image-21", count: 1, steps: 2 });
    expect(open.notes).toEqual(["Two steps: Z-Image Turbo draws the sheet, then Qwen-Image 2.1 puts your face on it"]);
  });

  it("makes the open sheet, then puts the face on it, as one batch (demo)", async () => {
    const face = upload();
    const res = await post({ engine: "open", state, start: "face", photo: face, clothing: [upload()], direction: "A potter from Porto" });
    expect(res.status).toBe(201);
    const run = await res.json();
    expect(run.items.map((g: { feature: string; modelId: string }) => [g.feature, g.modelId])).toEqual([
      ["influencer-step", "oss-zimage-soul-cast"],
      ["influencer", "oss-qwen-image-21"],
    ]);
    // The Soul Cast sheet graph runs in Fuobe Soul's casting look: its words and LoRAs around the compiled character.
    expect(run.items[0].prompt).toContain(compileCastPrompt({ state: state as never, direction: "A potter from Porto" }));
    expect(run.items[0].prompt).toBe(soulRecipe("soul", compileCastPrompt({ state: state as never, direction: "A potter from Porto" }), { look: CAST_LOOK }).prompt);
    expect(run.items[0].request.presetId).toBeUndefined();
    expect(run.sheet.id).toBe(run.items[1].id);
    expect(run.items.map((g: { request: { step?: { label: string } } }) => g.request.step?.label)).toEqual(["Drawing the sheet", "With your face"]);
    expect(new Set(run.items.map((g: { batchId: string }) => g.batchId))).toEqual(new Set([run.batchId]));
    const done = await settle(run.sheet.id);
    expect(done.status).toBe("succeeded");
    // The edit took the sheet first, then the face and the clothing.
    expect(done.request.inputs?.images?.[1]).toBe(face);
    expect(done.request.inputs?.images).toHaveLength(3);
    expect(done.outputs.length).toBeGreaterThan(0);
  }, 60_000);

  it("retries a failed sheet in its run, but not a face pass whose sheet never came", async () => {
    const run = await (await post({ engine: "open", state, start: "face", photo: upload() })).json();
    await gens.cancelGeneration(run.items[0].id);
    const pass = await settle(run.sheet.id);
    expect(pass.status).toBe("failed");
    // Both steps run again, chained, in the same batch; the failed ones go to the Trash.
    const again = retryPhoto(pass.id);
    expect(again.map((g) => [g.feature, g.modelId, g.batchId])).toEqual([
      ["influencer-step", "oss-zimage-soul-cast", run.batchId],
      ["influencer", "oss-qwen-image-21", run.batchId],
    ]);
    expect(gens.getGeneration(pass.id)).toBeNull();
    const redone = await settle(again[1].id);
    expect(redone.status).toBe("succeeded");
    expect(redone.request.inputs?.images).toHaveLength(2);
    const one = await (await post({ engine: "cloud", state, start: "scratch" })).json();
    await gens.cancelGeneration(one.items[0].id);
    expect(one.items).toHaveLength(1);
    expect(one.items[0].request.step).toBeUndefined();
    expect(retryPhoto(one.items[0].id)[0]).toMatchObject({ feature: "influencer", batchId: one.items[0].batchId });
  }, 60_000);

  it("retries a face pass that never launched with the sheet chained in again (canceled while it waited)", async () => {
    const face = upload();
    const run = await (await post({ engine: "open", state, start: "face", photo: face })).json();
    const [sheet, pass] = run.items as { id: string }[];
    await gens.cancelGeneration(pass.id);
    expect((await settle(sheet.id)).status).toBe("succeeded");
    const sheetUrl = gens.getGeneration(sheet.id)!.outputs[0].url;
    expect(gens.getGeneration(pass.id)!.request.inputs?.images).toEqual([face]);
    // Only the pass runs again: it waits for the finished sheet, then gets it as image 1.
    const again = retryPhoto(pass.id);
    expect(again.map((g) => [g.feature, g.modelId, g.batchId])).toEqual([["influencer", "oss-qwen-image-21", run.batchId]]);
    expect(gens.getGeneration(pass.id)).toBeNull();
    const redone = await settle(again[0].id);
    expect(redone.status).toBe("succeeded");
    expect(redone.request.inputs?.images).toEqual([sheetUrl, face]);
    // A pass that launched (the sheet is in its request) and then failed is retried as it was: no second sheet.
    db().prepare("UPDATE generations SET status = 'failed' WHERE id = ?").run(redone.id);
    const once = retryPhoto(redone.id);
    expect(once).toHaveLength(1);
    expect(db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(once[0].id)).toEqual({ depends_on: null });
    expect((await settle(once[0].id)).request.inputs?.images).toEqual([sheetUrl, face]);
  }, 60_000);

  it("follows the engine mode", async () => {
    setSetting("engineMode", "open");
    const run = await (await post({ engine: "cloud", state, start: "scratch" })).json();
    expect(run.items.map((g: { modelId: string }) => g.modelId)).toEqual(["oss-zimage-soul-cast"]);
    expect(run.items[0].feature).toBe("influencer");
  });

  it("says what is wrong, in Higgsfield's words where it has them", async () => {
    const tooMany = await post({ engine: "cloud", state, start: "scratch", clothing: [upload(), upload(), upload(), upload()] });
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error).toBe("You can add up to three clothing references");
    const long = await post({ engine: "cloud", state, start: "scratch", direction: "x".repeat(4001) });
    expect((await long.json()).error).toBe("Keep the direction under 4,000 characters");
    const outside = await post({ engine: "cloud", state, start: "face", photo: "https://example.com/me.jpg" });
    expect((await outside.json()).error).toBe("Upload the photo again");
    const noFace = await post({ engine: "cloud", state, start: "face" });
    expect(noFace.status).toBe(422);
    expect((await noFace.json()).error).toBe("Add your photo first");
    const conflict = { tier: "total", picks: { body_type: ["body_heavy"], height: ["h_tall"] } };
    expect((await (await post({ engine: "cloud", state: conflict, start: "scratch" }, true)).json()).error).toBe("Heavy build cannot be combined with Tall or Very tall.");
    expect((await post({ engine: "cloud", state: conflict, start: "scratch" })).status).toBe(422);
    // Picks the tier doesn't show are dropped, not refused.
    const hidden = await (await post({ engine: "open", state: { tier: "normal", picks: { hair: ["hs_wings"] } }, start: "scratch" })).json();
    expect(hidden.items[0].prompt).toContain(compileCastPrompt({ state: { tier: "normal", picks: {}, locked: [] } }));
  });
});
