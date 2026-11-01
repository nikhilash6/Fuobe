import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { GenInput, Operation } from "@/lib/catalog/types";
import type { ComfyWorkflow, ManifestWorkflow } from "@/lib/comfy";

// Package nm10-qwen21-fast (docs/research/new-models-10.md §6.7): Qwen-Image 2.1 in 2-6 steps (Options → Speed), on 16 GB
// cards (Options → GPU, Zen Image Edit's small encoder), with the Texture-Fix VAE (Options → Decoder) and the 2.1
// Next-Scene LoRA for Storyboard's next frames. All on the open engine: Qwen-Image 2.1 isn't hosted on fal or Replicate.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-qwen21-fast-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel, getPreset } = await import("@/lib/catalog");
const { controlSets, planGeneration } = await import("@/lib/catalog/plan");
const { libraryEntry } = await import("@/lib/catalog/loras");
const { planStoryboard, storyboardModels, STORYBOARD_MODELS } = await import("@/lib/catalog/storyboard");
const { resolveWorkflowId } = await import("@/lib/comfy-variants");
const { controlsFor } = await import("@/lib/composer");
const Q = await import("@/lib/qwen21-speed");
const { STUDIO_ROWS, studioTool, toolFor } = await import("@/server/gpu/tools");
const { previewGeneration } = await import("@/server/generations");
const { changeAccess, modelLicence } = await import("@/server/model-access");
const { setSetting } = await import("@/server/settings");
const { EDIT_STUDIO, INPAINT_STUDIO } = await import("@/lib/studios");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const LIBRARY = path.join(process.cwd(), "workflows/comfyui");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(LIBRARY, f), "utf8"));
const manifest = read("manifest.json") as { workflows: ManifestWorkflow[] };
const entry = (id: string) => manifest.workflows.find((w) => w.id === id)!;
const graph = (id: string) => read(`${id}.json`) as ComfyWorkflow;
const pins = read("model-pins.json") as Record<string, { revision: string; sizeBytes: number; sha256: string }>;
const index = read("requirements.json") as { workflows: Record<string, { files: string[]; optional: string[]; packs: Record<string, string[]>; vramGb: number; firstRun: string[]; validated?: boolean }>; files: Record<string, { pinnedUrl: string; sizeBytes: number }>; packs: Record<string, { commit: string; classes: string[] }> };
const ofClass = (wf: ComfyWorkflow, cls: string) => Object.entries(wf).filter(([, n]) => n.class_type === cls);
const has = (id: string) => manifest.workflows.some((w) => w.id === id);
const variant = (endpoint: string, op: string, extra: Record<string, unknown>, vramGb?: number, images = 0) =>
  resolveWorkflowId(endpoint, { op, clips: 0, images, audio2: false, extra, has, vramGb });

async function prepare(id: string, input: GenInput, op: Operation, media: Record<string, { width: number; height: number }> = {}, vramGb?: number) {
  return prepareWorkflow(id, { seed: 7, ...input }, {
    generationId: "g-q21",
    op,
    upload: async (_d, _t, name) => `up_${name}`,
    media: (name) => media[name] as never,
    serverRam: async () => undefined,
    vramGb: async () => vramGb,
  });
}

/** Each speed's LoRA, its pinned download and its schedule (the cards, read 2026-11-01). */
const TIERS = {
  draft: {
    file: "Qwen-Image-2.1-DMD2-2steps-v1.5.safetensors",
    url: "https://huggingface.co/linoyts/Qwen-Image-2.1-DMD2-2steps/resolve/5bae28369ecea3232405c17a53c04d35d15796b8/pytorch_lora_weights_v1_5.safetensors",
    bytes: 67144520,
    sigmas: [1, 0.5, 0],
  },
  fast: {
    file: "Qwen-Image-2.1-Lightning-4steps.safetensors",
    url: "https://huggingface.co/lightx2v/Qwen-Image-2.1-Lightning/resolve/6b0a1176327c01522a44276c5da67331a025b6fc/pytorch_lora_weights.safetensors",
    bytes: 67144280,
    sigmas: [1, 0.857192, 0.666756, 0.400096, 0],
  },
  details: {
    file: "p_q_image_2.1_6_steps_upsampled_v0.2_comfyui_bf16.safetensors",
    url: "https://huggingface.co/PrunaAI/P-Q-Image-2.1-Comfy/resolve/aa7dcecb1767e220e31a55706e33fd057c9a3fca/p_q_image_2.1_6_steps_upsampled_v0.2_comfyui_bf16.safetensors",
    bytes: 344061264,
    sigmas: [1, 0.961054, 0.918949, 0.769302, 0.545554, 0.222292, 0],
  },
} as const;
const sigmasOf = (s: unknown) => String(s).split(",").map(Number);

describe("Qwen-Image 2.1's speed graphs", () => {
  const tiers = Object.entries(Q.QWEN21_SPEED_GRAPH).flatMap(([base, t]) => Object.entries(t).filter(([s]) => s !== "turbo").map(([speed, id]) => ({ base, speed: speed as keyof typeof TIERS, id: id! })));

  it("has Draft and Fast for text to image, edits, inpaint and expand, and 'writes the details' for text to image and edits", () => {
    expect(tiers.map((t) => t.id).sort()).toEqual(
      ["t2i-draft", "t2i-fast", "t2i-details", "edit-draft", "edit-fast", "edit-details", "inpaint-draft", "inpaint-fast", "outpaint-draft", "outpaint-fast"].map((x) => `qwen-image-21-${x}`).sort(),
    );
    expect(Q.QWEN21_SPEED_GRAPH["qwen-image-21-edit"].turbo).toBe("qwen-image-21-turbo-edit");
  });

  it("is the base graph with one LoRA and the LoRA's sigma schedule at CFG 1, and nothing else changed", () => {
    for (const t of tiers) {
      const wf = graph(t.id);
      const base = graph(t.base);
      const loras = ofClass(wf, "LoraLoaderModelOnly").filter(([, n]) => n.inputs.lora_name === TIERS[t.speed].file);
      expect(loras, t.id).toHaveLength(1);
      expect(loras[0][1].inputs.strength_model).toBe(1);
      expect(sigmasOf(ofClass(wf, "ManualSigmas")[0][1].inputs.sigmas), t.id).toEqual(TIERS[t.speed].sigmas);
      expect(ofClass(wf, "KSampler"), t.id).toHaveLength(0);
      expect(ofClass(wf, "CFGGuider")[0][1].inputs.cfg).toBe(1);
      expect(ofClass(wf, "KSamplerSelect")[0][1].inputs.sampler_name).toBe("euler");
      // The rest of the owner's graph is as it was (models, encoder, decoder, the pictures' handling).
      for (const [id, n] of Object.entries(base)) {
        if (n.class_type === "KSampler" || n.class_type === "SaveImage" || n.class_type === "QwenImage21Cache") continue;
        expect(wf[id], `${t.id} ${id}`).toEqual(n);
      }
      // The speed LoRA goes after the model (and after Expand's outpaint LoRA).
      const from = loras[0][1].inputs.model as [string, number];
      expect(wf[from[0]].class_type).toBe(t.base.endsWith("outpaint") ? "LoraLoaderModelOnly" : "UNETLoader");
    }
  });

  it("pins each LoRA at the revision its card was read at, with its size, and lists the clean decoder as optional", () => {
    for (const t of tiers) {
      const e = entry(t.id);
      const m = e.models.find((x) => x.file === TIERS[t.speed].file)!;
      expect(m, t.id).toMatchObject({ folder: "loras", url: TIERS[t.speed].url, sizeGb: Math.round((TIERS[t.speed].bytes / 1e9) * 100) / 100 });
      expect(pins[TIERS[t.speed].url].sizeBytes).toBe(TIERS[t.speed].bytes);
      expect(pins[TIERS[t.speed].url].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(index.workflows[t.id].files).toContain(`loras/${TIERS[t.speed].file}`);
      expect(index.workflows[t.id].optional).toEqual([`vae/${Q.CLEAN_VAE}`]);
      expect(e.bindings.seed).toEqual([{ node: "70", input: "noise_seed" }]);
      expect(e.bindings.steps).toBeUndefined();
      expect(e.license).toMatch(/Qwen Research License/);
      // The graph check on the CPU ComfyUI: text to image and edits (inpaint and expand need AusBoss's pack, which it lacks).
      if (/-(t2i|edit)-/.test(t.id)) expect(e.validated, t.id).toBe(true);
      else expect(e.customNodes.map((c) => c.name)).toEqual(["ausboss-nodes"]);
    }
    expect(index.files[`vae/${Q.CLEAN_VAE}`]).toMatchObject({ sizeBytes: 675509688 });
    expect(index.files[`vae/${Q.CLEAN_VAE}`].pinnedUrl).toContain("/madebyollin/texture-fix-vae-for-qwen-image-2.1/resolve/9a10df811f183323e4e94d255c18add1924ce340/");
  });

  it("shifts the Lightning schedule for the canvas as its card does, and keeps 1 MP's in the graph", () => {
    expect(sigmasOf(Q.lightningSigmas(1024, 1024))).toEqual(TIERS.fast.sigmas);
    const big = sigmasOf(Q.lightningSigmas(2048, 2048));
    expect(big[1]).toBeCloseTo(0.917701, 5);
    expect(big[3]).toBeCloseTo(0.553369, 5);
    expect(big.at(-1)).toBe(0);
    expect([...Q.LIGHTNING_GRAPHS].sort()).toEqual(tiers.filter((t) => t.speed === "fast").map((t) => t.id).sort());
  });
});

describe("Options → Speed, GPU and Decoder", () => {
  it("picks the speed's graph per operation, and Full (the default) keeps the owner's", () => {
    expect(variant("qwen-image-21-t2i", "t2i", {})).toBe("qwen-image-21-t2i");
    expect(variant("qwen-image-21-t2i", "t2i", { speed: "full" })).toBe("qwen-image-21-t2i");
    expect(variant("qwen-image-21-t2i", "t2i", { speed: "draft" })).toBe("qwen-image-21-t2i-draft");
    expect(variant("qwen-image-21-edit", "edit", { speed: "fast" }, undefined, 2)).toBe("qwen-image-21-edit-fast");
    expect(variant("qwen-image-21-edit", "edit", { speed: "turbo" })).toBe("qwen-image-21-turbo-edit");
    expect(variant("qwen-image-21-inpaint", "inpaint", { speed: "fast" })).toBe("qwen-image-21-inpaint-fast");
    expect(variant("qwen-image-21-outpaint", "outpaint", { speed: "draft" })).toBe("qwen-image-21-outpaint-draft");
    // A speed an operation doesn't have runs at Full: Turbo makes edits only, "writes the details" no inpaint.
    expect(variant("qwen-image-21-t2i", "t2i", { speed: "turbo" })).toBe("qwen-image-21-t2i");
    expect(variant("qwen-image-21-inpaint", "inpaint", { speed: "details" })).toBe("qwen-image-21-inpaint");
    // Other models' graphs never move; Marketing Image's product shot still wins on the edit graph.
    expect(variant("flux3-klein-t2i", "t2i", { speed: "draft" }, 16)).toBe("flux3-klein-t2i");
    expect(variant("qwen-image-21-edit", "edit", { productShot: true, speed: "draft" }, undefined, 1)).toBe("product-shot-qwen-edit-2509");
  });

  it("runs the small encoder under 24 GB on Auto, as asked otherwise, and never at another speed", () => {
    expect(Q.smallGpu(16)).toBe(true);
    expect(Q.smallGpu(23.6)).toBe(true);
    expect(Q.smallGpu(24)).toBe(false);
    expect(Q.smallGpu(undefined)).toBe(false);
    expect(Q.smallGpu(0)).toBe(false);
    expect(variant("qwen-image-21-t2i", "t2i", {}, 16)).toBe("qwen-image-21-t2i-small");
    expect(variant("qwen-image-21-edit", "edit", {}, 12)).toBe("qwen-image-21-edit-small");
    expect(variant("qwen-image-21-t2i", "t2i", {}, 24)).toBe("qwen-image-21-t2i");
    expect(variant("qwen-image-21-t2i", "t2i", {}, undefined)).toBe("qwen-image-21-t2i");
    expect(variant("qwen-image-21-t2i", "t2i", { gpu: "large" }, 16)).toBe("qwen-image-21-t2i");
    expect(variant("qwen-image-21-t2i", "t2i", { gpu: "small" }, 48)).toBe("qwen-image-21-t2i-small");
    expect(variant("qwen-image-21-t2i", "t2i", { speed: "fast" }, 16)).toBe("qwen-image-21-t2i-fast");
    // Inpaint and expand have no small-encoder graph.
    expect(variant("qwen-image-21-inpaint", "inpaint", {}, 16)).toBe("qwen-image-21-inpaint");
  });

  it("puts the three controls on Qwen-Image 2.1 under Options, each value on the operations that have it", () => {
    const m = getModel("oss-qwen-image-21")!;
    expect(m.options.controls?.map((c) => c.param)).toEqual(["speed", "gpu", "decoder"]);
    expect(m.options.controls?.find((c) => c.param === "speed")?.default).toBe("full");
    expect(m.options.controls?.find((c) => c.param === "decoder")?.default).toBe("standard");
    expect(m.tagline).toMatch(/Draft to Full speed/);
    const values = (op: string) => Object.fromEntries(controlsFor(m.options.controls!, op).map((c) => [c.param, c.values]));
    expect(values("edit")).toEqual({ speed: ["draft", "fast", "details", "turbo", "full"], gpu: ["large", "small"], decoder: ["standard", "clean"] });
    expect(values("t2i").speed).toEqual(["draft", "fast", "details", "full"]);
    // Inpaint has no small-encoder graph: the GPU choice leaves.
    expect(values("inpaint")).toEqual({ speed: ["draft", "fast", "full"], decoder: ["standard", "clean"] });
    expect(controlsFor(m.options.controls!)).toBe(m.options.controls);
    expect(getModel("oss-qwen-image-21-turbo")!.options.controls?.map((c) => c.param)).toEqual(["decoder"]);
    expect(EDIT_STUDIO.controlsTitle).toBe("Options");
    expect(INPAINT_STUDIO.controlsTitle).toBe("Options");
  });

  it("writes Clean as the Texture-Fix VAE, and the default leaves the graph's own decoder", () => {
    const m = getModel("oss-qwen-image-21")!;
    expect(controlSets(m, { extra: { decoder: "clean", speed: "fast" } }).extra).toEqual({ vae: Q.CLEAN_VAE, speed: "fast" });
    expect(controlSets(m, {}).extra).toBeUndefined();
    const plan = planGeneration({ feature: "image", modelId: "oss-qwen-image-21", prompt: "a koi pond", params: { extra: { decoder: "clean" } } }, getModel, getPreset);
    expect(plan.params.extra).toEqual({ vae: Q.CLEAN_VAE });
  });
});

describe("a Qwen-Image 2.1 run on your GPU", () => {
  it("binds the Lightning schedule for the canvas, the clean decoder, and sends the options to no node", async () => {
    const { manifest: m, workflow: wf } = await prepare("qwen-image-21-t2i", { prompt: "a koi pond", aspectRatio: "1:1", resolution: "2K", extra: { speed: "fast", gpu: "large", vae: Q.CLEAN_VAE } }, "t2i");
    expect(m.id).toBe("qwen-image-21-t2i-fast");
    expect(wf["5"].inputs).toMatchObject({ width: 2048, height: 2048 });
    expect(sigmasOf(wf["73"].inputs.sigmas)).toEqual(sigmasOf(Q.lightningSigmas(2048, 2048)));
    expect(wf["3"].inputs.vae_name).toBe(Q.CLEAN_VAE);
    expect(wf["70"].inputs.noise_seed).toBe(7);
    expect(JSON.stringify(wf)).not.toMatch(/"(speed|gpu|decoder)"/);
  });

  it("follows image 1's size for an edit's Lightning schedule", async () => {
    const { manifest: m, workflow: wf } = await prepare("qwen-image-21-edit", { prompt: "make it night", images: ["/api/files/a.png"], extra: { speed: "fast" } }, "edit", {});
    expect(m.id).toBe("qwen-image-21-edit-fast");
    // Without the picture's header the graph keeps its 1 MP schedule.
    expect(sigmasOf(wf["73"].inputs.sigmas)).toEqual(TIERS.fast.sigmas);
  });

  it("runs the small encoder by the GPU's memory, with the references it was given", async () => {
    const small = await prepare("qwen-image-21-edit", { prompt: "the cat on the beach", images: ["/api/files/a.png", "/api/files/b.png"] }, "edit", {}, 16);
    expect(small.manifest.id).toBe("qwen-image-21-edit-small");
    const enc = small.workflow["5"];
    expect(enc.class_type).toBe("ZenImage21TextEncode");
    expect(Object.keys(enc.inputs).filter((k) => k.startsWith("image_")).sort()).toEqual(["image_1", "image_2"]);
    expect(small.workflow["12"]).toBeUndefined();
    expect(small.workflow["4"].inputs.shift).toBe(5);
    const large = await prepare("qwen-image-21-edit", { prompt: "the cat", images: ["/api/files/a.png"] }, "edit", {}, 32);
    expect(large.manifest.id).toBe("qwen-image-21-edit");
    const asked = await prepare("qwen-image-21-t2i", { prompt: "a fox", extra: { gpu: "small" } }, "t2i", {}, 80);
    expect(asked.manifest.id).toBe("qwen-image-21-t2i-small");
    expect(asked.workflow["5"].inputs).toMatchObject({ prompt: "a fox", width: 1024, height: 1024 });
  });

  it("holds a speed whose LoRA is switched off in Models & licences", () => {
    setSetting("demoMode", "on");
    const req = { feature: "image", modelId: "oss-qwen-image-21", prompt: "a koi pond", params: { extra: { speed: "draft" } } } as const;
    expect(() => previewGeneration(req)).not.toThrow();
    changeAccess([{ kind: "lora", id: TIERS.draft.file, on: false }]);
    try {
      expect(() => previewGeneration(req)).toThrow(/Draft · 2 steps runs with the LoRA .* switched off in Settings → Models & licences/);
      expect(() => previewGeneration({ ...req, params: { extra: { speed: "fast" } } })).not.toThrow();
    } finally {
      changeAccess([{ kind: "reset" }]);
      setSetting("demoMode", "off");
    }
  });
});

describe("the small-GPU route", () => {
  it("is Zen Image Edit on the stock DiT and VAE, its pack pinned, its downloads said, English only", () => {
    for (const id of ["qwen-image-21-t2i-small", "qwen-image-21-edit-small"]) {
      const wf = graph(id);
      expect(ofClass(wf, "CLIPLoader"), id).toHaveLength(0);
      expect(ofClass(wf, "ZenImage21AdapterLoader")[0][1].inputs).toMatchObject({ adapter_file: "models/adapter_v12.safetensors", text_encoder: "Qwen/Qwen3.5-0.8B" });
      expect(ofClass(wf, "UNETLoader")[0][1].inputs.unet_name).toBe("qwen_image_2.1_int8_convrot.safetensors");
      const w = index.workflows[id];
      expect(w.vramGb).toBe(16);
      expect(Object.keys(w.packs)).toEqual(["zen-image-edit-comfyui"]);
      expect(w.firstRun.join(" ")).toMatch(/adapter_v12\.safetensors.*Qwen3\.5-0\.8B/s);
      expect(entry(id).validated).toBe(false);
    }
    expect(index.packs["zen-image-edit-comfyui"]).toMatchObject({ commit: "7a29e58c973b84798df926e3251727884fdacc2d", classes: ["ZenImage21AdapterLoader", "ZenImage21TextEncode"] });
    const m = getModel("oss-qwen-image-21-small")!;
    expect(m.hidden).toBe(true);
    expect(m.tagline).toMatch(/English prompts only/);
    expect(m.routes.map((r) => [r.op, r.endpoint])).toEqual([
      ["t2i", "qwen-image-21-t2i-small"],
      ["edit", "qwen-image-21-edit-small"],
    ]);
  });

  it("has its row on the GPU pre-flight board, whose page opens the Image studio", () => {
    const row = STUDIO_ROWS.find((r) => r.href === "/image/small-gpu")!;
    expect(row).toMatchObject({ label: "Image on a 16 GB GPU", group: "Images" });
    const t = studioTool(row)!;
    expect(t.workflows).toEqual(["qwen-image-21-t2i-small", "qwen-image-21-edit-small"]);
    expect(t.kind).toBe("image");
    expect(toolFor("studio:/image/small-gpu")?.workflows).toEqual(t.workflows);
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/(studio)/image/small-gpu/page.tsx"), "utf8");
    expect(page).toMatch(/redirect\("\/image"\)/);
  });
});

describe("Storyboard's next scene on Qwen-Image 2.1", () => {
  it("makes the next frames on the 2.1 Next-Scene graph on your GPU, the classic one when asked, and keeps the cloud's", () => {
    expect(STORYBOARD_MODELS.open.next).toBe("oss-qwen-image-21-next-scene");
    expect(storyboardModels("open", undefined, "classic").next).toBe("oss-qwen-next-scene");
    expect(storyboardModels("open", undefined, "qwen-21").next).toBe("oss-qwen-image-21-next-scene");
    expect(storyboardModels("cloud", undefined, "qwen-21")).toBe(STORYBOARD_MODELS.cloud);
    const scenes = ["the heroine on the rooftop at dusk", "the camera pulls back over the city"];
    const board = planStoryboard({ engine: "open", scenes, references: ["/api/files/hero.png"] });
    expect(board[1]).toMatchObject({ modelId: "oss-qwen-image-21-next-scene", chainFrom: "first", inputs: { images: ["/api/files/hero.png"] } });
    expect(board[1].prompt).toMatch(/^Next Scene: /);
    expect(planStoryboard({ engine: "open", scenes, nextScene: "classic" })[1].modelId).toBe("oss-qwen-next-scene");
    expect(planStoryboard({ engine: "cloud", scenes, nextScene: "classic" })[1].modelId).toBe("qwen-image-edit-2509-cloud");
  });

  it("runs akhaliq's LoRA at 0.7 on a softened previous panel, the prompt led by Next Scene: once", async () => {
    const m = getModel("oss-qwen-image-21-next-scene")!;
    expect(m.routes.map((r) => r.endpoint)).toEqual(["qwen-image-21-next-scene"]);
    expect(m.options.loras?.map((l) => [l.file, l.strength])).toEqual([["Qwen-Image-2.1-Next-Scene-step2500.safetensors", 0.7]]);
    const plan = planGeneration({ feature: "storyboard", modelId: m.id, prompt: "Next Scene: the camera pulls back", inputs: { images: ["/api/files/p.png"] } }, getModel, getPreset);
    expect(plan.prompt).toBe("Next Scene: the camera pulls back");
    const { workflow: wf } = await prepare("qwen-image-21-next-scene", { prompt: "the camera pulls back", images: ["/api/files/p.png"], loras: plan.loras }, "edit");
    expect(wf["30"].inputs.prompt).toBe("Next Scene: the camera pulls back");
    // The graph loads the LoRA itself: the plan's copy isn't added twice.
    expect(ofClass(wf, "LoraLoaderModelOnly").map(([, n]) => [n.inputs.lora_name, n.inputs.strength_model])).toEqual([["Qwen-Image-2.1-Next-Scene-step2500.safetensors", 0.7]]);
    expect(wf["15"]).toMatchObject({ class_type: "ImageBlur", inputs: { blur_radius: 1, sigma: 0.5, image: ["10", 0] } });
    expect(wf["20"].inputs.image).toEqual(["15", 0]);
    // No character reference: its branch goes.
    expect(wf["11"]).toBeUndefined();
    expect(wf["30"].inputs["images.image_2"]).toBeUndefined();
    expect(wf["32"].inputs).toMatchObject({ steps: 28, cfg: 1 });
    expect(entry("qwen-image-21-next-scene").validated).toBe(true);
    expect(index.workflows["qwen-image-21-next-scene"].files).toContain("loras/Qwen-Image-2.1-Next-Scene-step2500.safetensors");
  });
});

describe("licences, recorded and switched on", () => {
  it("lists each LoRA in the library with its pinned file and licence", () => {
    const want: Record<string, string> = {
      [TIERS.draft.file]: "Qwen Research",
      [TIERS.fast.file]: "Not stated in the repository",
      [TIERS.details.file]: "Qwen Research",
      "Qwen-Image-2.1-Next-Scene-step2500.safetensors": "Apache-2.0",
    };
    for (const [file, licence] of Object.entries(want)) {
      const e = libraryEntry({ file })!;
      expect(e, file).toBeDefined();
      expect(e.group).toBe("adapter");
      expect(e.licence.name).toContain(licence);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
    }
  });

  it("gives the small-GPU and next-scene models a licence row each", () => {
    for (const id of ["oss-qwen-image-21-small", "oss-qwen-image-21-next-scene"]) {
      const l = modelLicence(getModel(id)!);
      expect(l.licence.name, id).toMatch(/Qwen Research/);
    }
    expect(modelLicence(getModel("oss-qwen-image-21-small")!).packs).toEqual(["zen-image-edit-comfyui"]);
  });
});
