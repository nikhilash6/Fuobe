import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { applyMentions, type ElementLora, type StudioElement } from "@/lib/catalog/elements";
import { onEngine, runsOn } from "@/lib/catalog/engines";
import { planGeneration } from "@/lib/catalog/plan";
import { HOSTED_TRAINERS } from "@/lib/catalog/trainers.generated";
import {
  aiToolkitJob,
  AITK_FAMILIES,
  datasetName,
  falTrainingInput,
  familyLead,
  familyOfModel,
  getTrainer,
  getTrainingTarget,
  identityFor,
  identityKey,
  loraFamily,
  runsSomewhere,
  needsConsent,
  photosBlocker,
  photoTips,
  licenceNote,
  targetsFor,
  trainedLoraUrl,
  trainerCost,
  TRAINING_FAMILIES,
  TRAINING_FAMILY_IDS,
  TRAINING_TARGETS,
  triggerFor,
  usableOn,
} from "@/lib/catalog/training";
import { buildPayload } from "@/lib/catalog/payload";
import { OWN_LOOK, soulPostSteps, soulRecipe } from "@/lib/catalog/soul";
import { zip } from "@/server/zip";

const ROOT = path.resolve(__dirname, "..");

describe("Fuobe Soul ID targets (build plan O3)", () => {
  it("makes short, rare trigger words", () => {
    expect(triggerFor("Nova_Reyes")).toBe("nvrysfz");
    expect(triggerFor("Al")).toBe("alfz");
  });

  it("has no Higgsfield target: every one trains on fal or the user's GPU", () => {
    expect(TRAINING_TARGETS.map((t) => t.provider).every((p) => p === "fal" || p === "ai-toolkit")).toBe(true);
    expect(TRAINING_TARGETS.map((t) => t.id)).not.toContain("soul-id-v2");
    expect(TRAINING_TARGETS.map((t) => t.id)).not.toContain("soul-id-cinema");
  });

  it("retargets training to the Fuobe Soul models, whose LoRAs run on both engines", () => {
    for (const t of TRAINING_TARGETS) {
      expect(t.modelIds.length).toBeGreaterThan(0);
      for (const id of t.modelIds) expect(getModel(id), `${t.id} → ${id}`).toBeDefined();
    }
    expect(getTrainingTarget("fal-z-image")!.modelIds).toEqual(expect.arrayContaining(["fuobe-soul", "fuobe-soul-cinema"]));
    expect(getTrainingTarget("aitk-z-image")!.modelIds).toEqual(expect.arrayContaining(["fuobe-soul", "fuobe-soul-cinema"]));
    expect(getTrainingTarget("fal-qwen-2512")!.modelIds).toContain("fuobe-soul-hd");
    // An Original family's lead model is one model on both engines; another base leads with its own model per engine.
    for (const f of TRAINING_FAMILY_IDS) {
      const fam = TRAINING_FAMILIES[f];
      for (const [engine, id] of Object.entries(fam.lead)) {
        const lead = getModel(id)!;
        expect(lead, `${f} → ${id}`).toBeDefined();
        expect(runsOn(lead, engine as "open" | "cloud"), `${f} leads with ${id} on ${engine}`).toBe(true);
        expect(fam.models).toContain(id);
      }
      if (fam.original) expect(runsOn(getModel(familyLead(f))!, "open") && runsOn(getModel(familyLead(f))!, "cloud")).toBe(true);
      // Every model of a family belongs to it alone, and every one can carry a LoRA there.
      for (const id of fam.models) expect(familyOfModel(id)).toBe(f);
    }
    expect(familyLead("flux1-dev", "open")).toBe("oss-flux1-dev");
    expect(familyLead("flux1-dev", "cloud")).toBe("flux-1-dev-lora-cloud");
    expect(familyLead("krea-2", "open")).toBe("krea-2-turbo-lora-cloud");
  });

  it("trains on every base fal or AI-Toolkit trains: licences are information, never a gate", () => {
    const families = new Set(TRAINING_TARGETS.map((t) => t.family));
    expect([...families]).toEqual(TRAINING_FAMILY_IDS);
    for (const t of TRAINING_TARGETS.filter((x) => x.provider === "fal")) {
      const tr = getTrainer(t.trainer)!;
      expect(tr, t.id).toBeDefined();
      expect(t).toMatchObject({ licence: tr.licence, commercial: tr.commercial });
    }
    // Non-commercial and revenue-tier weights are offered, with their licence on the target (the admin decides in Settings).
    expect(getTrainingTarget("fal-flux2-dev")).toMatchObject({ commercial: false, licence: "FLUX [dev] Non-Commercial License" });
    expect(getTrainingTarget("aitk-flux1-dev")).toMatchObject({ commercial: false, licence: "FLUX.1 [dev] Non-Commercial License", price: "Free" });
    expect(getTrainingTarget("fal-flux2-klein-9b")!.commercial).toBe(false);
    expect(getTrainingTarget("fal-krea-2")!.commercial).toBeNull();
    expect(getTrainingTarget("aitk-z-image")).toMatchObject({ licence: "Apache-2.0", commercial: true });
    expect(licenceNote(getTrainingTarget("fal-flux2-dev")!)).toBe("FLUX [dev] Non-Commercial License · non-commercial weights");
    expect(licenceNote(getTrainingTarget("fal-krea-2")!)).toMatch(/revenue tiers$/);
    expect(licenceNote(getTrainingTarget("fal-z-image")!)).toBe("Apache-2.0 · commercial use");
  });

  it("prices every cloud training at fal's price for its steps (research §3.3)", () => {
    // $0.85 per 1,000 steps: the default 2,000-step run is $1.70 (research §4.5).
    expect(getTrainingTarget("fal-z-image")).toMatchObject({ steps: 2000, learningRate: 0.0005, costUsd: 1.7, price: "≈ $1.70 (2,000 steps)" });
    expect(getTrainingTarget("fal-qwen-2512")).toMatchObject({ steps: 1000, costUsd: 1.5 });
    expect(getTrainingTarget("fal-z-image-style")).toMatchObject({ steps: 1500, costUsd: 3.39, extra: { training_type: "style" } });
    expect(getTrainingTarget("aitk-z-image")).toMatchObject({ price: "Free", costUsd: 0 });
    // fal's floors: 500 billed steps on Z-Image Turbo v2.
    expect(trainerCost(getTrainer("fal-ai/z-image-turbo-trainer-v2"), 100)).toBe(0.43);
    // The other bases at their trainer's own defaults: FLUX portrait $2.40 per 1,000 (at least $2.40), FLUX.2 [dev]
    // $0.0064 a step, klein 4B $0.005, klein 9B $0.0043, Krea 2 $0.003.
    expect(getTrainingTarget("fal-flux1-portrait")).toMatchObject({ steps: 2500, costUsd: 6 });
    expect(trainerCost(getTrainer("fal-ai/flux-lora-portrait-trainer"), 300)).toBe(2.4);
    expect(getTrainingTarget("fal-flux2-dev")).toMatchObject({ steps: 1000, costUsd: 6.4 });
    expect(getTrainingTarget("fal-flux2-klein-4b")).toMatchObject({ costUsd: 5 });
    expect(getTrainingTarget("fal-flux2-klein-9b")).toMatchObject({ costUsd: 4.3 });
    expect(getTrainingTarget("fal-krea-2")).toMatchObject({ costUsd: 3, price: "≈ $3.00 (1,000 steps)" });
    for (const t of TRAINING_TARGETS) expect(t.price).toBe(t.provider === "ai-toolkit" ? "Free" : `≈ $${t.costUsd.toFixed(2)} (${t.steps.toLocaleString("en-US")} steps)`);
  });

  it("offers subject trainings to characters and style trainings to styles, consent for people only", () => {
    expect(targetsFor("character").map((t) => t.id)).toEqual([
      "aitk-z-image",
      "fal-z-image",
      "aitk-qwen-2512",
      "fal-qwen-2512",
      "aitk-flux1-dev",
      "fal-flux1-portrait",
      "aitk-flux2-dev",
      "fal-flux2-dev",
      "aitk-flux2-klein-4b",
      "fal-flux2-klein-4b",
      "fal-flux2-klein-9b",
      "fal-krea-2",
      "aitk-flux3-klein",
      "fal-flux3-klein",
    ]);
    // The portrait trainer crops to a face: no style on it, and no place or object either (they train on FLUX.1 on the GPU).
    // Fuobe Soul's style trains on fal's Z-Image trainer.
    expect(targetsFor("style").map((t) => t.id)).not.toContain("fal-flux1-portrait");
    for (const kind of ["location", "prop"] as const) {
      expect(targetsFor(kind).map((t) => t.id)).not.toContain("fal-flux1-portrait");
      expect(targetsFor(kind).map((t) => t.id)).toContain("aitk-flux1-dev");
    }
    expect(targetsFor("style").map((t) => t.id).slice(0, 2)).toEqual(["aitk-z-image", "fal-z-image-style"]);
    expect(targetsFor("voice")).toEqual([]);
    expect(needsConsent("character")).toBe(true);
    expect(needsConsent("style")).toBe(false);
  });

  it("follows Higgsfield's photo rules: 5 to start, 20+ recommended, 80 at most", () => {
    expect(photosBlocker(4, "Maya")).toMatch(/at least 5 photos of Maya/);
    expect(photosBlocker(5)).toBeNull();
    expect(photosBlocker(81)).toMatch(/up to 80/);
    const photos = Array.from({ length: 8 }, (_, i) => ({ key: `p${i % 7}`, width: i === 0 ? 400 : 1024, height: 1024 }));
    const tips = photoTips(photos);
    expect(tips[0]).toMatch(/20\+ photos.*you have 8/);
    expect(tips.join(" ")).toMatch(/1 photo is smaller than 512 px/);
    expect(tips.join(" ")).toMatch(/1 duplicate photo/);
    expect(photoTips(Array.from({ length: 20 }, (_, i) => ({ key: String(i) })))).toEqual([]);
  });

  it("writes fal's request from the trainer's own fields: zip, steps, caption, learning rate, training type", () => {
    expect(falTrainingInput(getTrainingTarget("fal-z-image")!, "https://fal/zip", "photo of mayafz")).toEqual({
      image_data_url: "https://fal/zip",
      steps: 2000,
      default_caption: "photo of mayafz",
      learning_rate: 0.0005,
    });
    expect(falTrainingInput(getTrainingTarget("fal-z-image-style")!, "z", "mayafz style")).toEqual({ image_data_url: "z", steps: 1500, default_caption: "mayafz style", training_type: "style" });
    // Trainers that take the zip in images_data_url and a trigger phrase instead of a default caption.
    expect(falTrainingInput(getTrainingTarget("fal-flux1-portrait")!, "z", "photo of mayafz", "mayafz")).toEqual({ images_data_url: "z", steps: 2500, trigger_phrase: "mayafz" });
    expect(falTrainingInput(getTrainingTarget("fal-krea-2")!, "z", "photo of mayafz", "mayafz")).toEqual({ images_data_url: "z", steps: 1000, trigger_phrase: "mayafz", resolution: 1024 });
    // FLUX.2 [dev] also runs on ComfyUI: its LoRA comes back with ComfyUI's key names. The cloud-only klein families keep fal's.
    expect(falTrainingInput(getTrainingTarget("fal-flux2-dev")!, "z", "photo of mayafz", "mayafz")).toEqual({
      image_data_url: "z",
      steps: 1000,
      default_caption: "photo of mayafz",
      output_lora_format: "comfy",
    });
    expect(falTrainingInput(getTrainingTarget("fal-flux2-klein-9b")!, "z", "photo of mayafz")).not.toHaveProperty("output_lora_format");
    expect(falTrainingInput(getTrainingTarget("fal-flux2-klein-4b")!, "z", "photo of mayafz")).not.toHaveProperty("output_lora_format");
    expect(datasetName(0, "jpg")).toBe("001.jpg");
    expect(datasetName(11, "txt")).toBe("012.txt");
  });

  it("writes AI-Toolkit jobs for Z-Image Turbo with the training adapter, rank 16–32", () => {
    const job = aiToolkitJob({ name: "x", trigger: "nvrysfz", datasetFolder: "/d", outputFolder: "/o" });
    const p = job.config.process[0];
    expect(p.trigger_word).toBe("nvrysfz");
    expect(p.model.arch).toBe("zimage:turbo");
    expect(p.model.assistant_lora_path).toMatch(/training_adapter_v2/);
    expect(p.datasets[0].folder_path).toBe("/d");
    expect(p.train.steps).toBe(2000);
    expect(p.network.linear).toBe(16);
    expect(aiToolkitJob({ name: "x", trigger: "t", datasetFolder: "/d", outputFolder: "/o", photos: 30 }).config.process[0].network.linear).toBe(32);
    expect(aiToolkitJob({ name: "x", trigger: "t", datasetFolder: "/d", outputFolder: "/o", kind: "style", photos: 30 }).config.process[0]).toMatchObject({ network: { linear: 16 }, train: { steps: 1500 } });
  });

  it("writes AI-Toolkit jobs for each base it trains, with AI-Toolkit's arch names", () => {
    const arch = (family: (typeof AITK_FAMILIES)[number]) => aiToolkitJob({ name: "x", trigger: "t", datasetFolder: "/d", outputFolder: "/o", family }).config.process[0];
    expect(arch("qwen-image-2512").model).toMatchObject({ name_or_path: "Qwen/Qwen-Image-2512", arch: "qwen_image" });
    expect(arch("flux1-dev").model).toMatchObject({ name_or_path: "black-forest-labs/FLUX.1-dev", arch: "flux" });
    expect(arch("flux1-dev").sample).toMatchObject({ guidance_scale: 4, sample_steps: 20 });
    expect(arch("flux2-dev").model).toMatchObject({ arch: "flux2" });
    expect(arch("flux2-klein-4b").model).toMatchObject({ name_or_path: "black-forest-labs/FLUX.2-klein-base-4B", arch: "flux2_klein_4b" });
    // Every GPU target trains a base AI-Toolkit has a config for; the cloud-only bases say so.
    for (const t of TRAINING_TARGETS.filter((x) => x.provider === "ai-toolkit")) expect(AITK_FAMILIES).toContain(t.family);
    expect(() => aiToolkitJob({ name: "x", trigger: "t", datasetFolder: "/d", outputFolder: "/o", family: "krea-2" })).toThrow(/train it in the cloud/);
  });

  it("reads the LoRA from the field each trainer returns it in", () => {
    expect(trainedLoraUrl(getTrainingTarget("fal-krea-2")!, { lora_file: { url: "k" }, config_file: { url: "c" } })).toBe("k");
    expect(trainedLoraUrl(getTrainingTarget("fal-z-image")!, { diffusers_lora_file: { url: "z" }, config_file: { url: "c" } })).toBe("z");
    expect(trainedLoraUrl(getTrainingTarget("fal-z-image")!, { config_file: { url: "c" } })).toBeUndefined();
  });

  it("sends a trained LoRA on the FLUX, klein and Krea models' hosted LoRA routes", () => {
    for (const id of ["flux-1-dev-lora-cloud", "flux-1-krea-lora-cloud", "flux-2-dev-lora-cloud", "flux-2-klein-9b-lora-cloud", "krea-2-turbo-lora-cloud"]) {
      const route = getModel(id)!.routes[0];
      expect(route.map?.loras, id).toMatchObject({ shape: "items", key: "loras" });
      const body = buildPayload(route.map!, { prompt: "x", loras: [{ file: "fuobe/m.safetensors", url: "https://x/m.safetensors", strength: 0.9 }] });
      expect(body.loras, id).toEqual([{ path: "https://x/m.safetensors", scale: 0.9 }]);
    }
    // Each carries its weights' licence as data for Settings (information, never a gate).
    expect(getModel("flux-1-dev-lora-cloud")!.licence).toMatchObject({ licence: "FLUX.1 [dev] Non-Commercial License", commercial: false });
    expect(getModel("flux-2-dev-lora-cloud")!.licence).toMatchObject({ licence: "FLUX [dev] Non-Commercial License", commercial: false });
    expect(getModel("flux-2-klein-9b-lora-cloud")!.licence).toMatchObject({ commercial: false });
    expect(getModel("krea-2-turbo-lora-cloud")!.licence).toMatchObject({ licence: expect.stringMatching(/Krea 2 Community/), commercial: null });
    expect(getModel("flux-1-krea-lora-cloud")!.licence?.note).toMatch(/non-commercial/);
    expect(getModel("z-image-turbo-cloud")!.licence).toMatchObject({ licence: "Apache-2.0", commercial: true });
  });

  it("switches hosted Z-Image to its LoRA endpoint only when a LoRA URL is present", () => {
    const route = getModel("z-image-turbo-cloud")!.routes[0];
    expect(route.loraEndpoint).toBe("fal-ai/z-image/turbo/lora");
    expect(buildPayload(route.map!, { prompt: "x" }).loras).toBeUndefined();
  });

  it("writes zips other tools can read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-zip-"));
    const file = path.join(dir, "kit.zip");
    fs.writeFileSync(file, zip([{ name: "dataset/001.txt", data: Buffer.from("photo of nvrysfz") }, { name: "a.yaml", data: Buffer.from("{}") }]));
    const out = execFileSync("python3", ["-I", "-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(), z.read('dataset/001.txt').decode())", file]).toString();
    expect(out.trim()).toBe("None photo of nvrysfz");
  });
});

describe("gen-trainers.py", () => {
  it("writes what is committed (the trainers match the research)", () => {
    const file = path.join(ROOT, "src/lib/catalog/trainers.generated.ts");
    const before = fs.readFileSync(file, "utf8");
    execFileSync("python3", ["scripts/gen-trainers.py"], { cwd: ROOT });
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });
  it("records every fal trainer with its licence as data (non-commercial ones too) and where its LoRA comes back", () => {
    expect(HOSTED_TRAINERS.find((t) => t.id === "fal-ai/flux-2-klein-9b-base-trainer")).toMatchObject({ commercial: false, loraOutput: ["diffusers_lora_file"] });
    expect(HOSTED_TRAINERS.find((t) => t.id === "fal-ai/krea-2-trainer")).toMatchObject({ commercial: null, dataField: "images_data_url", loraOutput: ["lora_file"] });
    // Wan 2.2's image trainer returns two LoRAs (low and high noise); the video trainers learn from clips.
    expect(HOSTED_TRAINERS.find((t) => t.id === "fal-ai/wan-22-image-trainer")!.loraOutput).toEqual(["diffusers_lora_file", "high_noise_lora"]);
    expect(HOSTED_TRAINERS.filter((t) => t.media === "video").map((t) => t.id)).toContain("fal-ai/ltx23-trainer-v2/i2v");
    const used = new Set(TRAINING_TARGETS.map((t) => t.trainer).filter(Boolean));
    expect(HOSTED_TRAINERS.filter((t) => used.has(t.id)).some((t) => t.commercial === false)).toBe(true);
    for (const t of HOSTED_TRAINERS.filter((x) => used.has(x.id))) expect(t.loraOutput.length, t.id).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The trained LoRA on a run

const lora = (o: Partial<ElementLora>): ElementLora => ({ engine: "cloud", modelId: "fuobe-soul", family: "z-image-turbo", file: "fuobe/maya-abc123.safetensors", trigger: "myfz", strength: 1, ...o });
const maya = (loras: ElementLora[]): StudioElement => ({
  id: "m1",
  name: "Maya",
  handle: "Maya",
  kind: "character",
  description: null,
  references: ["/api/files/a.png", "/api/files/b.png"],
  loras,
  status: "ready",
  createdAt: 0,
});

describe("a Soul ID on every model of its family, on both engines", () => {
  const soul = getModel("fuobe-soul")!;
  const openSoul = onEngine(soul, "open");
  const cloudSoul = onEngine(soul, "cloud");

  it("reads the family of LoRAs from before O3 from the model they were trained for", () => {
    expect(loraFamily({ modelId: "oss-z-image-turbo" })).toBe("z-image-turbo");
    expect(loraFamily({ modelId: "z-image-turbo-cloud" })).toBe("z-image-turbo");
    expect(loraFamily({ modelId: "soul-2", referenceId: "ref" })).toBeUndefined();
  });

  it("runs a fal-trained LoRA on the cloud by URL and on the open engine from Fuobe's copy", () => {
    const fal = lora({ url: "https://v3.fal.media/maya.safetensors", own: true });
    expect(usableOn(fal, "cloud") && usableOn(fal, "open")).toBe(true);
    expect(identityFor([fal], cloudSoul)).toBe(fal);
    expect(identityFor([fal], openSoul)).toBe(fal);
    expect(identityFor([fal], onEngine(getModel("fuobe-soul-cinema")!, "cloud"))).toBe(fal);
    // Another family needs its own training.
    expect(identityFor([fal], onEngine(getModel("fuobe-soul-hd")!, "cloud"))).toBeUndefined();
  });

  it("runs a GPU-trained LoRA in the cloud only when Fuobe keeps its file", () => {
    const gpu = lora({ engine: "open" });
    expect(usableOn(gpu, "open")).toBe(true);
    expect(usableOn(gpu, "cloud")).toBe(false);
    expect(usableOn({ ...gpu, own: true }, "cloud")).toBe(true);
  });

  it("prefers the LoRA trained on the run's engine, then the newest", () => {
    const gpu = lora({ engine: "open", own: true, trainedAt: 2, file: "fuobe/gpu.safetensors" });
    const cloud = lora({ url: "https://x/c.safetensors", trainedAt: 1, file: "fuobe/cloud.safetensors" });
    expect(identityFor([gpu, cloud], openSoul)).toBe(gpu);
    expect(identityFor([gpu, cloud], cloudSoul)).toBe(cloud);
  });

  it("never uses a demo training or a Higgsfield Soul ID", () => {
    expect(identityFor([lora({ demo: true, url: "x" })], cloudSoul)).toBeUndefined();
    expect(identityFor([{ engine: "cloud", modelId: "fuobe-soul", file: "", trigger: "", referenceId: "ref" }], cloudSoul)).toBeUndefined();
    // What Assist reports as trained: only LoRAs some run can use.
    expect(runsSomewhere(lora({ demo: true, url: "x" }))).toBe(false);
    expect(runsSomewhere(lora({ modelId: "soul-2", family: undefined, file: "", referenceId: "ref" }))).toBe(false);
    expect(runsSomewhere(lora({ url: "x" }))).toBe(true);
    // A GPU LoRA without Fuobe's copy, for a family that runs only in the cloud: nothing can run it.
    expect(runsSomewhere(lora({ engine: "open", modelId: "flux-2-klein-4b-cloud", family: "flux2-klein-4b" }))).toBe(false);
    expect(runsSomewhere(lora({ engine: "open", modelId: "flux-2-klein-4b-cloud", family: "flux2-klein-4b", own: true }))).toBe(true);
  });

  it("names one file attached for two families as two LoRAs, so removing one keeps the other", () => {
    const z = lora({ file: "mine/maya.safetensors", own: true });
    const flux = lora({ file: "mine/maya.safetensors", own: true, modelId: "oss-flux1-dev", family: "flux1-dev" });
    expect(identityKey(z)).not.toBe(identityKey(flux));
    expect([z, flux].filter((l) => ![identityKey(flux)].includes(identityKey(l)))).toEqual([z]);
    expect(identityKey(lora({ modelId: "soul-2", family: undefined, file: "", referenceId: "ref-1" }))).toBe("ref-1");
  });

  it("scales an @character's LoRA by the character strength on FLUX too, and never sends the setting to the provider", () => {
    const flux = getModel("flux-1-dev-lora-cloud")!;
    const el = maya([lora({ url: "https://v3.fal.media/maya.safetensors", own: true, modelId: "flux-1-dev-lora-cloud", family: "flux1-dev" })]);
    const { request } = applyMentions({ feature: "image", modelId: flux.id, prompt: "@Maya on a beach" }, flux, [el]);
    const plan = planGeneration({ ...request, params: { extra: { characterStrength: 0.5 } } }, getModel, getPreset);
    expect(plan.loras[0]).toMatchObject({ file: "fuobe/maya-abc123.safetensors", strength: 0.8 });
    expect(plan.params.extra?.characterStrength).toBeUndefined();
    // The server sends Fuobe's own LoRA by the copy it picks (prepareCloudLoras sets hostedUrl).
    const body = buildPayload(flux.routes[0].map!, { ...plan.params, prompt: plan.prompt, loras: plan.loras.map((l) => ({ ...l, hostedUrl: l.url })) });
    expect(body.loras).toEqual([{ path: "https://v3.fal.media/maya.safetensors", scale: 0.8 }]);
    expect(body).not.toHaveProperty("characterStrength");
    // Without the setting the LoRA keeps its own strength.
    expect(planGeneration(request, getModel, getPreset).loras[0].strength).toBe(1);
  });

  it("puts the @character's LoRA first on Fuobe Soul, at the character strength's scale", () => {
    const el = maya([lora({ url: "https://v3.fal.media/maya.safetensors", own: true })]);
    const { request } = applyMentions({ feature: "image", modelId: soul.id, engine: "cloud", prompt: "@Maya on a beach" }, cloudSoul, [el]);
    expect(request.loras).toEqual([{ file: "fuobe/maya-abc123.safetensors", url: "https://v3.fal.media/maya.safetensors", strength: 1, trigger: "myfz", own: true }]);
    expect(request.inputs?.images).toBeUndefined();
    const plan = planGeneration({ ...request, params: { extra: { characterStrength: 0.5 } } }, (id) => (id === soul.id ? cloudSoul : getModel(id)), getPreset);
    expect(plan.loras[0]).toMatchObject({ file: "fuobe/maya-abc123.safetensors", strength: 0.8 });
    expect(plan.prompt).toMatch(/myfz Maya on a beach/);
  });

  it("makes a trained moodboard the look on Fuobe Soul: its LoRA alone, no look words, tail or grade", () => {
    const style = { file: "fuobe/dusk-a1.safetensors", strength: 1, trigger: "dskfz", own: true as const };
    const r = soulRecipe("soul", "dskfz Dusk, a lighthouse at night", { look: OWN_LOOK, userLoras: [style] });
    expect(r.loras).toEqual([style]);
    expect(r.prompt).toBe("dskfz Dusk, a lighthouse at night.");
    expect(r.grade).toBeUndefined();
    expect(soulPostSteps("fuobe-soul", OWN_LOOK)).toBeUndefined();
  });

  it("falls back to reference photos when no LoRA runs there", () => {
    const el = maya([lora({ engine: "open" })]);
    const nb = getModel("nano-banana-pro")!;
    expect(applyMentions({ feature: "image", modelId: nb.id, prompt: "@Maya" }, nb, [el]).request.inputs?.images).toEqual(["/api/files/a.png", "/api/files/b.png"]);
  });
});
