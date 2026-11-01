import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A route's GET opts out of prerendering with connection(), which needs a request scope.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-image-studios-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { createElement } = await import("@/server/elements");
const palettes = await import("@/server/palettes");
const moodboards = await import("@/server/moodboards");
const { PALETTES } = await import("@/lib/catalog/cinema");
const { MODELS } = await import("@/lib/catalog");
const palettesRoute = await import("@/app/api/palettes/route");
const paletteRoute = await import("@/app/api/palettes/[id]/route");
const lockRoute = await import("@/app/api/palettes/lock/route");
const moodboardsRoute = await import("@/app/api/moodboards/route");
const photodumpRoute = await import("@/app/api/photodump/route");
const packsRoute = await import("@/app/api/photodump/packs/route");
const fashionRoute = await import("@/app/api/photodump/fashion/route");
const characterRoute = await import("@/app/api/photodump/character/route");
const retryRoute = await import("@/app/api/photodump/retry/route");
const trainRoute = await import("@/app/api/moodboards/[id]/train/route");
const generationsRoute = await import("@/app/api/generations/route");
const { db } = await import("@/server/db");
const { listGenerations } = gens;
const { applySignature, withSignatureWords } = await import("@/lib/catalog/palettes");
const { toPick } = await import("@/components/moodboards/logic");
const { extractOutputs } = await import("@/lib/catalog/payload");
const { aiToolkitJob, trainingCaption } = await import("@/lib/catalog/training");
const { getModel } = await import("@/lib/catalog");

beforeAll(() => {
  setSetting("demoMode", "auto");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const json = (method: string, body?: unknown, url = "http://x/api") =>
  new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const upload = () => saveFile({ data: PNG, contentType: "image/png", source: "upload" }).url;

async function settle(id: string, ms = 40_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id, { includeDeleted: true })!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe("palettes", () => {
  it("seeds Cinema Studio's 50 palettes once, with their slugs and the 12th colour as background", async () => {
    // (GET /api/palettes returns exactly these two; route GETs need a request scope, so the server functions are called here.)
    const body = { items: palettes.listPalettes(), caps: palettes.signatureCaps() };
    const builtins = body.items.filter((p) => p.source === "builtin");
    expect(builtins).toHaveLength(50);
    expect(builtins.map((p) => p.slug)).toEqual(PALETTES.map((p) => p.slug));
    expect(builtins[0].colors).toHaveLength(12);
    expect(builtins[0].background).toBe(builtins[0].colors[11]);
    expect(palettes.listPalettes().filter((p) => p.source === "builtin")).toHaveLength(50);
    // Which models take a palette comes from their field maps.
    const native = Object.keys(body.caps.native).sort();
    const fromMaps = MODELS.filter((m) => m.routes.some((r) => r.map?.palette)).map((m) => m.id).sort();
    expect(native).toEqual(fromMaps);
    expect(body.caps.native["recraft-4-1"]).toEqual({ max: 10, background: "background_color" });
    expect(body.caps.native["ideogram-3"]).toEqual({ max: 12 });
  });

  it("gives a built-in palette its catalog name on an install seeded before the name was fixed", () => {
    db().prepare("UPDATE palettes SET name = 'Crimson Vigi' WHERE id = 'builtin-crimson-vigi'").run();
    globalThis.__fuobePalettesSeeded = false;
    expect(palettes.getPalette("builtin-crimson-vigi")?.name).toBe("Crimson Vigil");
    expect(palettes.listPalettes().filter((p) => p.source === "builtin")).toHaveLength(50);
  });

  it("saves, renames and deletes your palettes; built-ins stay", async () => {
    const bad = await palettesRoute.POST(json("POST", { name: "x", colors: ["#zzzzzz"] }));
    expect(bad.status).toBe(400);
    const res = await palettesRoute.POST(json("POST", { name: "Sea Glass", colors: ["#aabbcc", "112233"], background: "#000000", source: "manual" }));
    expect(res.status).toBe(201);
    const p = await res.json();
    expect(p.colors).toEqual(["#AABBCC", "#112233"]);
    expect(palettes.listPalettes()[0].id).toBe(p.id);
    expect((await paletteRoute.PATCH(json("PATCH", { name: "Sea Glass II" }), params({ id: p.id }))).status).toBe(200);
    expect((await paletteRoute.DELETE(json("DELETE"), params({ id: "builtin-static-noon" }))).status).toBe(400);
    expect((await paletteRoute.DELETE(json("DELETE"), params({ id: p.id }))).status).toBe(204);
    expect((await paletteRoute.DELETE(json("DELETE"), params({ id: p.id }))).status).toBe(404);
  });

  it("locks an open image to the palette with a chained palette-transfer step", async () => {
    const res = await lockRoute.POST(
      json("POST", { request: { feature: "image", modelId: "oss-qwen-image", prompt: "a lighthouse", params: { numOutputs: 2, palette: ["#102030"] } }, colors: ["#102030", "#2a9d8f"] }),
    );
    expect(res.status).toBe(201);
    const { items } = (await res.json()) as { items: { id: string; modelId: string; op: string; batchId: string; request: { step?: { label: string } } }[] };
    expect(items).toHaveLength(4);
    expect(new Set(items.map((g) => g.batchId)).size).toBe(1);
    const locks = items.filter((g) => g.modelId === "oss-palette-image");
    expect(locks.map((g) => g.op)).toEqual(["color-match", "color-match"]);
    expect(locks[0].request.step?.label).toBe("Palette lock 1 of 2");
    expect((locks[0].request as { title?: string }).title).toBe("a lighthouse");
    expect(items.find((g) => g.modelId === "oss-qwen-image")!.request.step?.label).toBe("Before palette lock 1 of 2");
    const done = await settle(locks[0].id);
    expect(done.status).toBe("succeeded");
    expect(done.request.params?.palette).toEqual(["#102030", "#2A9D8F"]);
  }, 45_000);
});

describe("style signature on the server", () => {
  it("keeps the user's words in the stored request and runs with the signature's sentences", async () => {
    const signed = applySignature(
      { feature: "image", modelId: "nano-banana-pro", prompt: "a lighthouse at dusk", params: { numOutputs: 1 } },
      { palette: { id: "p1", name: "Teal Dusk", colors: ["#102030", "#2A9D8F"], background: "#264653", slug: null } },
      { caps: palettes.signatureCaps(), getModel },
    );
    const res = await generationsRoute.POST(json("POST", signed.request));
    expect(res.status).toBe(201);
    const [g] = (await res.json()).items;
    expect(g.request.prompt).toBe("a lighthouse at dusk");
    expect(g.request.signature.palette.name).toBe("Teal Dusk");
    expect(g.request.signature.from.modelId).toBe("nano-banana-pro");
    // The row's prompt (what the model got) has the palette sentence once.
    expect(g.prompt).toBe(withSignatureWords(signed.request).prompt);
    expect(g.prompt.match(/Color palette/g)).toHaveLength(1);
  });
});

describe("moodboards", () => {
  it("refuses boards outside Higgsfield's limits, in its words", async () => {
    const few = await moodboardsRoute.POST(json("POST", { name: "x", images: [upload(), upload()] }));
    expect(few.status).toBe(400);
    expect((await few.json()).error).toBe("Upload at least 5 photos to continue.");
    const noName = await moodboardsRoute.POST(json("POST", { name: " ", images: Array.from({ length: 5 }, upload) }));
    expect((await noName.json()).error).toBe("Please enter a moodboard name");
  });

  it("builds a board through its cover job (open: collages on Krea 2 Style Reference), then it's usable", async () => {
    const images = Array.from({ length: 6 }, upload);
    const res = await moodboardsRoute.POST(json("POST", { name: "Neon Haze", images, collages: [upload()], engine: "open" }));
    expect(res.status).toBe(201);
    const m = await res.json();
    expect(["queued", "running", "cover"]).toContain(m.status);
    expect(m.refs).toEqual(images);
    const g = gens.getGeneration(m.generationId)!;
    // Krea 2 Style Reference: trained for style reference, the same one or two collages as references.
    expect(g.modelId).toBe("oss-style-krea2");
    expect(g.prompt).toMatch(/^A moodboard cover for “Neon Haze”: one striking, purely visual image/);
    expect(g.feature).toBe("moodboard");
    expect(g.request.inputs?.images).toEqual(m.collages);
    await settle(m.generationId);
    const done = moodboards.getMoodboard(m.id)!;
    expect(done.status).toBe("complete");
    // A demo cover makes no Recraft style and keeps the first image as the cover.
    expect(done.styleId).toBeNull();
    expect(done.cover).toBe(images[0]);
    const list = { items: moodboards.listMoodboards(), curated: moodboards.curatedMoodboards() };
    expect(list.items.map((x) => x.id)).toContain(m.id);
    expect(list.curated).toHaveLength(33);
    expect(new Set(list.curated.map((c) => c.category))).toEqual(new Set(["All presets", "Mood", "Styles", "Camera"]));
    // A style LoRA on the GPU needs AI-Toolkit: with demo mode off and no URL, the board says where to set it up and makes no element.
    setSetting("demoMode", "off");
    try {
      expect(() => moodboards.trainMoodboard(m.id, "aitk-z-image")).toThrow(/AI-Toolkit URL/);
    } finally {
      setSetting("demoMode", "auto");
    }
    expect(moodboards.getMoodboard(m.id)!.lora).toBeNull();
    // In demo mode it runs a demo training: the board shows it, and nothing real is attached.
    expect(moodboards.trainMoodboard(m.id, "aitk-z-image").lora?.status).toBe("training");
  }, 45_000);

  it("prepares cloud boards on Recraft V4 Styles with the 10 most representative images", () => {
    const images = Array.from({ length: 12 }, upload);
    const m = moodboards.createMoodboard({ name: "Paper Cut", images, engine: "cloud" });
    const g = gens.getGeneration(m.generationId!)!;
    expect(g.modelId).toBe("recraft-4-style");
    expect(g.request.inputs?.images).toEqual(images.slice(0, 10));
    expect(m.refs).toHaveLength(10);
    // Training a style LoRA needs AI-Toolkit; until then it says where to set it up.
    expect(() => moodboards.trainMoodboard(m.id)).toThrow(/still training/);
    expect(moodboards.deleteMoodboard(m.id)).toBe(true);
    expect(moodboards.getMoodboard(m.id)).toBeNull();
  });

  it("keeps the Recraft style id a real cover job returns, and Recraft then runs on the saved style", () => {
    // Recraft V4 Styles answers with the style it made from the inline images (fal: images + style_id).
    const out = extractOutputs({ images: [{ url: "https://fal.media/cover.png", content_type: "image/png" }], style_id: "3f6c1a2b-0000-4000-8000-000000000000" }, "edit");
    expect(out[0].meta?.styleId).toBe("3f6c1a2b-0000-4000-8000-000000000000");
    const images = Array.from({ length: 6 }, upload);
    const m = moodboards.createMoodboard({ name: "Paper Cut", images, engine: "cloud" });
    // Stand in for the fal run: the cover job finished on fal with that output.
    db()
      .prepare("UPDATE generations SET status = 'succeeded', provider = 'fal', outputs_json = ? WHERE id = ?")
      .run(JSON.stringify([{ url: images[0], kind: "image", meta: { styleId: "3f6c1a2b-0000-4000-8000-000000000000" } }]), m.generationId);
    const done = moodboards.getMoodboard(m.id)!;
    expect(done.status).toBe("complete");
    expect(done.styleId).toBe("3f6c1a2b-0000-4000-8000-000000000000");
    expect(done.cover).toBe(images[0]);
    const r = applySignature({ feature: "image", modelId: "recraft-4-1", prompt: "a fox", params: { numOutputs: 1 } }, { moodboard: toPick(done) }, { caps: palettes.signatureCaps(), getModel });
    expect(r.modelId).toBe("recraft-4-style-saved");
    expect(r.request.params?.styleId).toBe("3f6c1a2b-0000-4000-8000-000000000000");
    moodboards.deleteMoodboard(m.id);
  });

  it("a cloud board whose cover job can't start (no key, demo off) is ready from its images", () => {
    setSetting("demoMode", "off");
    try {
      const m = moodboards.createMoodboard({ name: "No Key", images: Array.from({ length: 5 }, upload), engine: "cloud" });
      expect(m.status).toBe("complete");
      expect(m.generationId).toBeNull();
      expect(m.styleId).toBeNull();
      expect(toPick(m).refs).toHaveLength(5);
      moodboards.deleteMoodboard(m.id);
    } finally {
      setSetting("demoMode", "auto");
    }
  });

  it("a style LoRA trains with the style preset, on the GPU or in the cloud as the engine mode allows", async () => {
    const job = aiToolkitJob({ name: "x", trigger: "nnhzfz", datasetFolder: "/d", outputFolder: "/o", kind: "style" });
    const train = job.config.process[0];
    expect(train.train.steps).toBe(1500);
    expect(train.sample.prompts.every((p: string) => p.endsWith("nnhzfz style"))).toBe(true);
    expect(aiToolkitJob({ name: "x", trigger: "t", datasetFolder: "/d", outputFolder: "/o" }).config.process[0].train.steps).toBe(2000);
    expect(trainingCaption("style", "nnhzfz", "the visual style of the “Neon Haze” moodboard.")).toBe("nnhzfz style, the visual style of the “Neon Haze” moodboard");
    expect(trainingCaption("character", "mayafz")).toBe("photo of mayafz");

    setSetting("demoMode", "off");
    const m = moodboards.createMoodboard({ name: "Cloud Only", images: Array.from({ length: 5 }, upload), engine: "cloud" });
    setSetting("demoMode", "auto");
    setSetting("engineMode", "cloud");
    try {
      // The GPU is ruled out on a cloud-only install, even as a demo; the cloud style trainer is what's offered.
      const res = await trainRoute.POST(json("POST", { target: "aitk-z-image" }), params({ id: m.id }) as never);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/cloud APIs only/);
      expect(moodboards.getMoodboard(m.id)!.lora).toBeNull();
      const targets = (await (await trainRoute.GET()).json()).targets as { id: string; price: string; blocker: string | null; demo: boolean }[];
      expect(targets.map((t) => [t.id, t.price])).toEqual([
        ["aitk-z-image", "Free"],
        ["fal-z-image-style", "≈ $3.39 (1,500 steps)"],
      ]);
      expect(targets[0].blocker).toMatch(/cloud APIs only/);
      // No target named: the engine mode's (the cloud), here a demo (no fal key).
      const started = await trainRoute.POST(json("POST"), params({ id: m.id }) as never);
      expect(started.status).toBe(202);
      expect((await started.json()).lora.status).toBe("training");
    } finally {
      setSetting("engineMode", "both");
      moodboards.deleteMoodboard(m.id);
    }
  });
});

describe("photodump, fashion factory and character sheet runs", () => {
  it("prices and makes an Instadump from one selfie as one batch", async () => {
    const selfie = upload();
    const preview = await (await photodumpRoute.POST(json("POST", { packId: "winter-special", engine: "cloud", selfie, aspectRatio: "3:4" }, "http://x/api/photodump?preview=1"))).json();
    // Instadump's Original: Qwen-Image-Edit 2511 (hosted) with the selfie as reference.
    expect(preview).toMatchObject({ modelId: "qwen-image-edit-2511-cloud", count: 9, demo: true });
    const res = await photodumpRoute.POST(json("POST", { packId: "winter-special", engine: "cloud", selfie, aspectRatio: "3:4" }));
    expect(res.status).toBe(201);
    const { batchId, items } = await res.json();
    expect(items).toHaveLength(9);
    expect(items.every((g: { batchId: string; feature: string }) => g.batchId === batchId && g.feature === "photodump")).toBe(true);
    expect(items[0].request.batchTitle).toBe("Winter special · Selfie");
    expect(items[0].request.inputs.images).toEqual([selfie]);
    expect((await settle(items[0].id)).status).toBe("succeeded");
  }, 45_000);

  it("retries a canceled photo inside its batch (the failed one goes to the Trash)", async () => {
    const { batchId, items } = await (await photodumpRoute.POST(json("POST", { packId: "winter-special", engine: "cloud", selfie: upload(), aspectRatio: "3:4" }))).json();
    const victim = items[3];
    await gens.cancelGeneration(victim.id);
    expect(gens.getGeneration(victim.id)!.status).toBe("canceled");
    const res = await retryRoute.POST(json("POST", { id: victim.id }));
    expect(res.status).toBe(201);
    const { items: again } = await res.json();
    expect(again).toHaveLength(1);
    expect(again[0].batchId).toBe(batchId);
    expect(again[0].request.step.label).toBe("Photo 4 of 9");
    expect(again[0].request.batchTitle).toBe(victim.request.batchTitle);
    // The run still has 9 photos: the canceled one is in the Trash.
    const run = listGenerations({ features: ["photodump"], limit: 200 }).filter((g) => g.batchId === batchId);
    expect(run).toHaveLength(9);
    expect(run.some((g) => g.id === victim.id)).toBe(false);
    // Only failed or canceled photos of a photo run can be retried.
    expect((await retryRoute.POST(json("POST", { id: again[0].id }))).status).toBe(422);
  }, 45_000);

  it("says on the Qwen edit models that the aspect ratio doesn't apply", async () => {
    // Qwen-Image 2.1 has ratios for text to image, but its edit graph takes no size: the photo's shape it is.
    const preview = await (await photodumpRoute.POST(json("POST", { packId: "winter-special", engine: "open", selfie: upload(), aspectRatio: "16:9" }, "http://x/api/photodump?preview=1"))).json();
    expect(preview.modelId).toBe("oss-qwen-image-21");
    expect(preview.fixedAspect).toBe(true);
    expect(preview.notes.join()).toMatch(/Qwen-Image 2.1 keeps the shape of your photo/);
    // A Qwen-Image-Edit 2511 pick saved before runs on Qwen-Image 2.1.
    const old = await (await photodumpRoute.POST(json("POST", { packId: "winter-special", engine: "open", selfie: upload(), aspectRatio: "16:9", modelId: "oss-qwen-edit" }, "http://x/api/photodump?preview=1"))).json();
    expect(old).toMatchObject({ modelId: "oss-qwen-image-21", fixedAspect: true });
    // Krea 2 Identity Edit draws on a canvas of the shape asked for.
    const krea = await (await photodumpRoute.POST(json("POST", { packId: "winter-special", engine: "open", selfie: upload(), aspectRatio: "16:9", modelId: "oss-krea2-identity-edit" }, "http://x/api/photodump?preview=1"))).json();
    expect(krea).toMatchObject({ modelId: "oss-krea2-identity-edit", fixedAspect: false });
    const cloud = await (await photodumpRoute.POST(json("POST", { packId: "winter-special", engine: "cloud", selfie: upload(), aspectRatio: "16:9" }, "http://x/api/photodump?preview=1"))).json();
    expect(cloud.fixedAspect).toBe(false);
    // Picking Fuobe Soul with a selfie says why it runs on Qwen-Image-Edit.
    const z = await (await photodumpRoute.POST(json("POST", { packId: "zen", engine: "open", selfie: upload(), modelId: "fuobe-soul" }, "http://x/api/photodump?preview=1"))).json();
    expect(z.notes[0]).toMatch(/needs a character with a trained Soul ID/);
  });

  it("makes a user pack and a character's photodump on the open engine", async () => {
    const pack = await (await packsRoute.POST(json("POST", { name: "Mine", refs: [upload(), upload()] }))).json();
    expect(pack.id).toMatch(/^user-/);
    const el = createElement({ name: "Maya", kind: "character", references: [upload()] });
    const { items } = await (await photodumpRoute.POST(json("POST", { packId: pack.id, engine: "open", elementId: el.id }))).json();
    expect(items).toHaveLength(2);
    expect(items[0].modelId).toBe("oss-qwen-image-21");
    // The pack's photo, then Maya's reference (her @mention resolves on the server).
    expect(items[0].request.inputs.images).toEqual([pack.refs[0]]);
    expect(items[0].request.prompt).toMatch(/^@Maya recreated in image 1/);
    const bad = await photodumpRoute.POST(json("POST", { packId: "zen", engine: "cloud" }));
    expect(bad.status).toBe(400);
  });

  it("runs the Fashion Factory steps", async () => {
    const el = createElement({ name: "Ines", kind: "character", references: [upload()] });
    const base = await (await fashionRoute.POST(json("POST", { step: "base", templateId: "red-room", elementId: el.id, engine: "cloud" }))).json();
    expect(base.items[0]).toMatchObject({ modelId: "qwen-image-edit-2511-cloud", feature: "fashion" });
    expect(base.items[0].request.params).toMatchObject({ aspectRatio: "3:4", numOutputs: 4 });
    const outfit = await (await fashionRoute.POST(json("POST", { step: "outfit", templateId: "red-room", base: upload(), garment: upload(), engine: "cloud" }))).json();
    // Fuobe Try-On in the cloud: FLUX.2 [klein] 4B with the try-on LoRA, its trigger leading the words.
    expect(outfit.items[0]).toMatchObject({ modelId: "fuobe-tryon", engine: "cloud" });
    const outfitPreview = await (await fashionRoute.POST(json("POST", { step: "outfit", templateId: "red-room", base: upload(), garment: upload(), engine: "cloud" }, "http://x/api/fashion?preview=1"))).json();
    expect(outfitPreview).toMatchObject({ modelId: "fuobe-tryon", demo: true });
    const partner = await (await fashionRoute.POST(json("POST", { step: "outfit", templateId: "red-room", base: upload(), garment: upload(), engine: "cloud", modelId: "fashn-tryon" }))).json();
    expect(partner.items[0].modelId).toBe("fashn-tryon");
    const set = await (await fashionRoute.POST(json("POST", { step: "photoset", templateId: "red-room", dressed: upload(), engine: "open" }))).json();
    expect(set.items).toHaveLength(9);
    expect(set.items.every((g: { modelId: string; batchId: string }) => g.modelId === "oss-qwen-image-21" && g.batchId === set.batchId)).toBe(true);
    const missing = await fashionRoute.POST(json("POST", { step: "photoset", templateId: "nope", dressed: upload(), engine: "open" }));
    expect((await missing.json()).error).toBe("Template required");
  });

  it("makes character sheets from references, a Soul Cast build and a description", async () => {
    const tooMany = await characterRoute.POST(json("POST", { mode: "reference", engine: "cloud", images: Array.from({ length: 6 }, upload) }));
    expect((await tooMany.json()).error).toBe("Maximum 5 images");
    const long = await characterRoute.POST(json("POST", { mode: "describe", engine: "cloud", prompt: "x".repeat(2100) }));
    expect((await long.json()).error).toBe("Keep the description under 2,000 characters");
    const badCast = await characterRoute.POST(json("POST", { mode: "cast", engine: "cloud", cast: { genre: { nested: true } } }));
    expect((await badCast.json()).error).toBe("Check the cast fields");
    const ref = await (await characterRoute.POST(json("POST", { mode: "reference", engine: "cloud", images: [upload(), upload()] }))).json();
    expect(ref.items[0]).toMatchObject({ modelId: "nano-banana-pro", op: "edit", feature: "character-sheet" });
    const cast = await (await characterRoute.POST(json("POST", { mode: "cast", engine: "open", cast: { genre: "Western", gender: "Female", age: 30, archetype: "Rebel" } }))).json();
    expect(cast.items[0].modelId).toBe("oss-zimage-soul-cast");
    expect(cast.items[0].prompt).toMatch(/30-year-old woman, the rebel archetype/);
    // The Soul Cast sheet graph is Fuobe Soul's own base: the casting look's words and LoRAs go on it (as in Cinema).
    expect(cast.items[0].prompt).toMatch(/^Realism, /);
    expect(cast.items[0].request.loras.map((l: { file: string }) => l.file)).toEqual(["suayptalha-z-image-turbo-realism.safetensors", "AWPortrait-Z.safetensors"]);
    // In the cloud the cast sheet is Fuobe Soul's, in Cinema's casting look.
    const soul = await (await characterRoute.POST(json("POST", { mode: "cast", engine: "cloud", cast: { genre: "Drama" } }))).json();
    expect(soul.items[0]).toMatchObject({ modelId: "fuobe-soul", engine: "cloud", presetId: "v1-realistic" });
    expect(soul.notes ?? []).toEqual([]);
    const described = await (await characterRoute.POST(json("POST", { mode: "describe", engine: "cloud", prompt: "a surfer from Lisbon" }))).json();
    expect(described.error).toBeUndefined();
    // The AI Influencer app's sheet is Fuobe Soul's in the cloud (build plan O10), in the casting look.
    expect(described.items[0]).toMatchObject({ presetId: "app-ai-influencer", modelId: "fuobe-soul", engine: "cloud", feature: "app:app-ai-influencer", status: "queued" });
    const app = await (await characterRoute.POST(json("POST", { mode: "describe", engine: "open", prompt: "a surfer from Lisbon" }))).json();
    expect(app.items[0]).toMatchObject({ presetId: "app-ai-influencer", modelId: "oss-zimage-soul-cast", feature: "app:app-ai-influencer" });
    // …and on your GPU the app's sheet runs in the same look.
    expect(app.items[0].prompt).toMatch(/^Realism, An original character: a surfer from Lisbon/);
  });
});
