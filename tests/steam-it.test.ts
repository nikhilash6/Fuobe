import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation, GenInput } from "@/lib/catalog/types";
import type { ComfyWorkflow } from "@/lib/comfy";

/*
 * The Steam It app: a creased outfit comes out pressed and crisp, and nothing else changes. On the open engine
 * SAM 3.1 finds the clothes, Qwen-Image 2.1 repaints only them and every other pixel is pasted back from the upload
 * (steam-it-qwen-image-21); in the cloud the same words run on the default edit model.
 */

vi.setConfig({ testTimeout: 60_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-steam-it-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { loadManifest, prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel, getPreset, MODELS } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { appStudio } = await import("@/lib/studios");
const { withRecipe } = await import("@/lib/catalog/preset-recipes");
const { buildLicenceList } = await import("@/lib/licences");
const { guestRead } = await import("@/lib/guest-access");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const LIBRARY = path.join(process.cwd(), "workflows/comfyui");
const WORKFLOW = "steam-it-qwen-image-21";
const NEGATION = /\b(no|not|never|nothing|none|without|don't|do not|doesn't|avoid)\b/i;
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a2e2b6a40000000049454e44ae426082", "hex");

async function settle(id: string, ms = 40_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function prepare(input: GenInput) {
  const uploads: string[] = [];
  const res = await prepareWorkflow(WORKFLOW, { seed: 7, ...input }, {
    generationId: "gen1",
    op: "edit",
    upload: async (_d, _t, name) => {
      uploads.push(name);
      return name;
    },
    media: () => undefined,
    serverRam: async () => undefined,
  });
  return { ...res, uploads };
}
const ofClass = (wf: ComfyWorkflow, cls: string) => Object.entries(wf).filter(([, n]) => n.class_type === cls);

describe("Steam It app", () => {
  const app = getPreset("app-steam-it")!;

  it("is a Fashion app with one photo, a Finish choice and no typing", () => {
    expect(app).toMatchObject({
      type: "app",
      name: "Steam It",
      category: "Fashion",
      description: "A creased outfit, pressed and crisp",
      userPrompt: "none",
      cloud: { modelId: "nano-banana-pro", op: "edit" },
      open: { modelId: "oss-steam-it", op: "edit" },
    });
    expect(app.inputs).toEqual([{ key: "image", label: "Outfit", hint: "A photo of the outfit, worn, laid flat or on a hanger", accept: "image", required: true }]);
    expect(app.options).toHaveLength(1);
    const finish = app.options![0];
    expect(finish).toMatchObject({ key: "finish", label: "Finish", default: "pressed" });
    expect(finish.choices.map((c) => c.label)).toEqual(["Steamed", "Pressed", "Tailored"]);
  });

  it("its words name only the finished fabric and what stays the same", () => {
    for (const c of app.options![0].choices) {
      const words = app.promptTemplate.replace("{option:finish}", c.prompt);
      expect(words, c.value).not.toMatch(NEGATION);
      expect(words, c.value).not.toMatch(/wrinkl|rumpl|crumpl/i);
      expect(words, c.value).toMatch(/^Steam and press the clothing so the fabric is /);
      expect(words, c.value).toMatch(/exact colour, print, weave, seams, buttons and fit/);
      expect(words, c.value).toMatch(/person, pose, face, hair, background and light exactly as in the picture\.$/);
    }
  });

  it("plans one edit on either engine, and asks for the photo when it is missing", () => {
    for (const modelId of ["nano-banana-pro", "oss-steam-it"]) {
      const plan = planGeneration({ feature: "app:app-steam-it", presetId: app.id, modelId, inputs: { images: ["/a.png"] } }, getModel, getPreset);
      expect(plan.op, modelId).toBe("edit");
      expect(plan.jobs, modelId).toBe(1);
    }
    expect(() => planGeneration({ feature: "app:app-steam-it", presetId: app.id, modelId: "oss-steam-it" }, getModel, getPreset)).toThrow(/Add a photo of the outfit/);
    const config = withRecipe(appStudio(app), (id) => !!getModel(id));
    expect(config.appModels?.open).toEqual(["oss-steam-it"]);
  });

  it("runs its own graph on the open engine: a hidden model, one image", () => {
    const m = getModel("oss-steam-it")!;
    expect(m).toMatchObject({ engine: "open", kind: "image", hidden: true, family: "qwen-image" });
    expect(m.routes.map((r) => [r.op, r.provider, r.endpoint])).toEqual([["edit", "comfyui", WORKFLOW]]);
    expect(m.options.maxImages).toBe(1);
    expect(m.tagline).toMatch(/20 GB GPU · non-commercial weights$/);
  });

  it("the library entry: hand-built, Qwen-Image 2.1 + SAM 3.1 + the AusBoss crop and stitch, listed as not validated", () => {
    const wf = loadManifest().workflows.find((w) => w.id === WORKFLOW)!;
    expect(wf).toMatchObject({ capability: "edit", file: `${WORKFLOW}.json`, validated: false, vramGb: 20, defaults: { steps: 25 } });
    expect(wf.source).toBe(`hand-built (scripts/comfy/hand-built/${WORKFLOW}.json)`);
    expect(wf.models.map((m) => `${m.folder}/${m.file}`)).toEqual([
      "diffusion_models/qwen_image_2.1_int8_convrot.safetensors",
      "text_encoders/qwen3vl_8b_int8_convrot.safetensors",
      "vae/qwen_image_2.1_vae_bf16.safetensors",
      "checkpoints/sam3.1_multiplex_fp16.safetensors",
    ]);
    expect(wf.models.find((m) => m.file.startsWith("sam3.1"))!.url).toMatch(/\/resolve\/7bb8374780a725b4353ed31f3a9395c9742b5621\//);
    expect(wf.customNodes).toEqual([{ name: "ausboss-nodes", repo: "https://github.com/ausboss/ComfyUI-AusBoss" }]);
    expect(wf.license).toMatch(/Qwen Research License.*NON-COMMERCIAL.*SAM License.*AusBoss nodes MIT/);
    // The library file is the hand-built graph as the build writes it.
    const built = JSON.parse(fs.readFileSync(path.join(LIBRARY, `${WORKFLOW}.json`), "utf8"));
    const hand = JSON.parse(fs.readFileSync(path.join(process.cwd(), `scripts/comfy/hand-built/${WORKFLOW}.json`), "utf8"));
    expect(built).toEqual(hand);
    // The GPU pre-flight knows its nodes and files.
    const req = JSON.parse(fs.readFileSync(path.join(LIBRARY, "requirements.json"), "utf8"));
    expect(req.workflows[WORKFLOW]).toMatchObject({
      packs: { "ausboss-nodes": ["AUSBOSS_NODES_CropForInpaint", "AUSBOSS_NODES_StitchInpaint"] },
      files: ["checkpoints/sam3.1_multiplex_fp16.safetensors", "diffusion_models/qwen_image_2.1_int8_convrot.safetensors", "text_encoders/qwen3vl_8b_int8_convrot.safetensors", "vae/qwen_image_2.1_vae_bf16.safetensors"],
      vramGb: 20,
    });
    expect(req.workflows[WORKFLOW].core).toEqual(expect.arrayContaining(["SAM3_Detect", "TextEncodeQwenImage21", "SetLatentNoiseMask", "GrowMask"]));
  });

  it("binds the photo and the words; SAM 3.1 finds the clothing and only the grown mask is repainted and stitched back", async () => {
    const { workflow: wf } = await prepare({ prompt: "Steam and press the clothing.", images: ["outfit.png"] });
    expect(wf["10"]).toMatchObject({ class_type: "LoadImage", inputs: { image: "outfit.png" } });
    expect(wf["23"]).toMatchObject({ class_type: "TextEncodeQwenImage21", inputs: { prompt: "Steam and press the clothing.", resolution: 0, "images.image_1": ["20", 0] } });
    expect(wf["27"]).toMatchObject({ class_type: "KSampler", inputs: { seed: 7, steps: 25, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1, latent_image: ["25", 0] } });
    expect(wf["90"]).toMatchObject({ class_type: "SaveImage", inputs: { filename_prefix: "fuobe/gen1", images: ["30", 0] } });
    // The mask: SAM 3.1's "clothing", every garment in one mask, grown 16 px before the crop so the paste-back follows it.
    expect(wf["4"]).toMatchObject({ class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sam3.1_multiplex_fp16.safetensors" } });
    expect(wf["11"]).toMatchObject({ class_type: "CLIPTextEncode", inputs: { text: "clothing", clip: ["4", 1] } });
    expect(wf["12"]).toMatchObject({ class_type: "SAM3_Detect", inputs: { threshold: 0.4, individual_masks: false, image: ["10", 0], conditioning: ["11", 0] } });
    expect(wf["13"]).toMatchObject({ class_type: "GrowMask", inputs: { expand: 16, mask: ["12", 0] } });
    expect(wf["20"]).toMatchObject({ class_type: "AUSBOSS_NODES_CropForInpaint", inputs: { image: ["10", 0], mask: ["13", 0], blend_pixels: 8, target_megapixels: 2 } });
    expect(wf["25"]).toMatchObject({ class_type: "SetLatentNoiseMask", inputs: { samples: ["24", 0], mask: ["20", 1] } });
    expect(wf["30"]).toMatchObject({ class_type: "AUSBOSS_NODES_StitchInpaint", inputs: { stitcher: ["20", 2], inpainted: ["29", 0] } });
    // Nothing else is loaded: no painted mask, no second picture, no LoRA.
    expect(ofClass(wf, "LoadImage")).toHaveLength(1);
    expect(ofClass(wf, "LoadImageMask")).toHaveLength(0);
    expect(ofClass(wf, "LoraLoaderModelOnly")).toHaveLength(0);
    await expect(prepare({ prompt: "x" })).rejects.toThrow(/Add/);
  });

  it("is listed in Models & licences as non-commercial", () => {
    const list = buildLicenceList(MODELS, loadManifest().workflows);
    const row = list.rows.find((r) => r.id === "oss-steam-it")!;
    expect(row).toMatchObject({ workflows: [WORKFLOW], inCatalog: true });
    expect(row.flags).toContain("non-commercial");
    expect(row.licences.join(" ")).toMatch(/SAM License/);
  });

  it("a guest opens the app page; a run is the generations route, closed to guests", () => {
    expect(guestRead("/apps/app-steam-it")).toEqual({ kind: "pass" });
    expect(guestRead("/api/generations")).toMatchObject({ kind: "empty" });
  });

  it("a demo run on the open engine finishes with a picture", async () => {
    const img = saveFile({ data: png, contentType: "image/png", name: "outfit.png", source: "upload" }).url;
    const [g] = gens.createGenerations({ feature: "app:app-steam-it", presetId: "app-steam-it", modelId: "oss-steam-it", inputs: { images: [img] }, presetOptions: { finish: "steamed" } });
    expect(g.costUsd).toBe(0);
    expect(g.prompt).toMatch(/so the fabric is smooth and freshly steamed, falling in soft, clean drapes\./);
    const done = await settle(g.id);
    expect(done.status, done.error ?? "").toBe("succeeded");
    expect(done.outputs[0]).toMatchObject({ kind: "image" });
  });
});
