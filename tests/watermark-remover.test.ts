import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Generation, GenInput } from "@/lib/catalog/types";
import type { ComfyWorkflow, Manifest, ManifestWorkflow } from "@/lib/comfy";

// The Watermark Remover app (ComfyUI-Qwen-Watermark): the app and its hidden models, the three graphs and their pins, which
// graph runs and how the provider fills it, the kept marks' checks, the scan report read into regions, the repair's verdict
// kept as meta, the Library's hiding of scans, licences, the Library action, search words, the Edit link, the demo, and the
// visitor words.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-watermark-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: open runs fall back to the demo

const { setSetting } = await import("@/server/settings");
const { createGenerations, ensureRunner, getGeneration } = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const { demoWatermarkReport, mockProvider } = await import("@/server/providers/mock");
const { collectOutputs, prepareWorkflow } = await import("@/server/providers/comfyui");
const { APPS, getModel, getPreset, MODELS } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { OPERATION_OUTPUT } = await import("@/lib/catalog/types");
const { resolveWorkflowId, COMPANION_GRAPHS, WATERMARK_BRUSH_GRAPH } = await import("@/lib/comfy-variants");
const { HELPER_FEATURES, isHelperFeature } = await import("@/lib/library");
const { buildLicenceList, nodePack, workflowLicence } = await import("@/lib/licences");
const { outputActions } = await import("@/lib/output-actions");
const { APP_KEYWORDS } = await import("@/lib/command-search");
const { EDIT_STUDIO } = await import("@/lib/studios");
const { PRESET_ICONS } = await import("@/components/preset-icons");
const { commandsFor } = await import("@/lib/gpu/commands");
const { emptyInventory } = await import("@/lib/gpu/gather");
const W = await import("@/lib/watermark");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the database file open a moment longer.
  }
});

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const manifest = JSON.parse(read("workflows/comfyui/manifest.json")) as Manifest;
const entry = (id: string) => manifest.workflows.find((w) => w.id === id) as ManifestWorkflow;
const graph = (id: string) => JSON.parse(read(`workflows/comfyui/${id}.json`)) as ComfyWorkflow;
const requirements = JSON.parse(read("workflows/comfyui/requirements.json"));
const packs = JSON.parse(read("workflows/comfyui/packs.json"));
const pins = JSON.parse(read("workflows/comfyui/model-pins.json"));
const install = read("scripts/comfy/install-comfyui.sh");

const SCAN = "image-watermark-scan-qwen3vl";
const REMOVE = "image-watermark-remove-qwen21";
const BRUSH = "image-watermark-remove-qwen21-brush";
const PIN = "eef829d34d6e9d0d2ae0c1386fab7371a864cf34";
const SAM_URL = "https://huggingface.co/ybelkada/segment-anything/resolve/7790786db131bcdc639f24a915d9f2c331d843ee/checkpoints/sam_vit_b_01ec64.pth";
const SAM_SHA = "ec2df62732614e57411cdcf32a23ffdf28910380d03139ee0f4fcbe91eb8c912";
const LIVE_EDIT_FILES = ["diffusion_models/qwen_image_2.1_int8_convrot.safetensors", "text_encoders/qwen3vl_8b_int8_convrot.safetensors", "vae/qwen_image_2.1_vae_bf16.safetensors"];

/** A pack report like QWMDetect's, in pixels. */
const REPORT = JSON.stringify({
  coordinate_space: "pixels",
  image_size: [1000, 800],
  boxes: [
    { label: "stock site URL text", bbox: [80, 560, 920, 700], source_bbox: [120, 590, 880, 670], overlay_type: "translucent_text_logo", confidence: 0.93 },
    { label: "round brand mark", bbox: [760, 40, 980, 220], source_bbox: [790, 60, 950, 200], overlay_type: "text_logo", confidence: 0.81 },
    { label: "pasted cartoon", bbox: [10, 10, 200, 260], source_bbox: [30, 30, 180, 240], overlay_type: "irregular_sticker", confidence: 0.9 },
  ],
  rejected_boxes: [{ label: "faint mark", bbox: [400, 300, 520, 360], source_bbox: [410, 310, 510, 350], overlay_type: "rectangle", confidence: 0.4 }],
  status: "needs_review",
});

async function prepare(id: string, input: GenInput, ctx: { media?: Record<string, { width: number; height: number }>; vram?: number } = {}) {
  const res = await prepareWorkflow(id, input, {
    generationId: "g",
    op: id === SCAN ? "watermark-scan" : "watermark-remove",
    upload: async (_d, _t, name) => `up_${name}`,
    media: (name) => (ctx.media?.[name] ? { container: "image", hasVideo: false, ...ctx.media[name] } : undefined) as never,
    vram: async () => ctx.vram,
  });
  return { wf: res.workflow, id: res.manifest.id };
}

function png(w: number, h: number): Buffer {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([(i * 13) % 255, 120, 200, 255], i * 4);
  return encodePng({ width: w, height: h, data });
}

describe("1. the app", () => {
  it("is a Utility app with a page of its own, open source only, on the remover's route", () => {
    const app = APPS.find((a) => a.id === "app-watermark-remover")!;
    expect(app).toMatchObject({ type: "app", category: "Utility", tool: "watermark", cloud: null, userPrompt: "none", name: "Watermark Remover" });
    expect(app.look?.icon).toBe("ScanLine");
    expect(app.badges).toContain("new");
    expect(app.open).toMatchObject({ modelId: "oss-watermark-remover", op: "watermark-remove" });
    expect(PRESET_ICONS.ScanLine).toBeDefined();
    expect(app.description).toBe(W.COPY.tagline.replace(/\.$/, ""));
  });
});

describe("2. the hidden models", () => {
  it("route the scan and the removal to their graphs", () => {
    const scan = getModel("oss-watermark-scan")!;
    const remove = getModel("oss-watermark-remover")!;
    expect(scan).toMatchObject({ hidden: true, engine: "open", kind: "text" });
    expect(remove).toMatchObject({ hidden: true, engine: "open", kind: "image" });
    expect(scan.routes).toEqual([expect.objectContaining({ op: "watermark-scan", provider: "comfyui", endpoint: SCAN })]);
    expect(remove.routes).toEqual([expect.objectContaining({ op: "watermark-remove", provider: "comfyui", endpoint: REMOVE })]);
    expect(remove.options).toMatchObject({ maxImages: 1, promptOptional: true, seed: true });
  });
});

describe("3. the ops", () => {
  it("make text and an image, need no words, and ask for the picture in plain words", () => {
    expect(OPERATION_OUTPUT["watermark-scan"]).toBe("text");
    expect(OPERATION_OUTPUT["watermark-remove"]).toBe("image");
    const p = planGeneration({ feature: W.WATERMARK_SCAN_FEATURE, modelId: "oss-watermark-scan", op: "watermark-scan", inputs: { images: ["/a.png"] } }, getModel, getPreset);
    expect(p.op).toBe("watermark-scan");
    expect(() => planGeneration({ feature: "x", modelId: "oss-watermark-scan", op: "watermark-scan" }, getModel, getPreset)).toThrow("Add the picture to check");
    expect(() => planGeneration({ feature: "x", modelId: "oss-watermark-remover", op: "watermark-remove" }, getModel, getPreset)).toThrow("Add the picture to clean");
  });
});

describe("4. the manifest entries", () => {
  it("binds the picture, both seeds, the kept marks, the mode, the size and (brush) the mask", () => {
    expect(entry(SCAN)).toMatchObject({ capability: "watermark-scan", bindings: { image: [{ node: "1", input: "image" }] }, outputs: [{ node: "23", kind: "text", role: "report" }] });
    for (const id of [REMOVE, BRUSH]) {
      const e = entry(id);
      expect(e.capability).toBe("watermark-remove");
      expect(e.bindings.seed).toEqual([{ node: "12", input: "seed" }, { node: "30", input: "seed" }]);
      expect(e.bindings.maxSize).toEqual([{ node: "5", input: "max_side" }, { node: "28", input: "max_side" }]);
      expect(e.outputs).toEqual([{ node: "33", kind: "image" }, { node: "38", kind: "text", role: "quality" }]);
      expect(e.limits).toMatchObject({ maxWidth: 4096, maxHeight: 4096 });
    }
    expect(entry(REMOVE).bindings).toMatchObject({ detectMode: [{ node: "3", input: "mode" }], boxes: [{ node: "3", input: "boxes_json" }] });
    expect(entry(BRUSH).bindings.mask).toEqual([{ node: "50", input: "image" }]);
    expect(entry(BRUSH).bindings.boxes).toBeUndefined();
  });

  it("names the pack and uses Live edit's Qwen files plus SAM ViT-B", () => {
    for (const id of [SCAN, REMOVE, BRUSH]) expect(entry(id).customNodes).toEqual([{ name: "ComfyUI-Qwen-Watermark", repo: `https://github.com/overflowofedge/ComfyUI-Qwen-Watermark/tree/${PIN}` }]);
    for (const id of [REMOVE, BRUSH]) expect(entry(id).models.map((m) => `${m.folder}/${m.file}`).sort()).toEqual([...LIVE_EDIT_FILES, "sams/sam_vit_b_01ec64.pth"].sort());
    expect(entry(SCAN).models.map((m) => `${m.folder}/${m.file}`)).toEqual(["text_encoders/qwen3vl_8b_int8_convrot.safetensors"]);
  });
});

describe("5. the graph files", () => {
  it("keep only the declared outputs, run the int8 UNET, and route the brush's mask to QWMDetect", () => {
    const outputsOf = (g: ComfyWorkflow) => Object.entries(g).filter(([, n]) => /^(SaveImage|PreviewImage|PreviewAny|MaskPreview)$/.test(n.class_type)).map(([id]) => id).sort();
    expect(outputsOf(graph(SCAN))).toEqual(["23"]);
    expect(graph(SCAN)["23"].inputs.source).toEqual(["3", 1]);
    for (const id of [REMOVE, BRUSH]) {
      const g = graph(id);
      expect(outputsOf(g)).toEqual(["33", "38"]);
      expect(g["6"].inputs.unet_name).toBe("qwen_image_2.1_int8_convrot.safetensors");
      expect(g["33"].inputs.images).toEqual(["37", 0]);
      expect(g["38"].inputs.source).toEqual(["37", 2]);
      for (const n of Object.values(g)) expect(n.class_type).not.toMatch(/^(MaskToImage)$/);
    }
    const b = graph(BRUSH);
    expect(b["50"]).toMatchObject({ class_type: "LoadImageMask", inputs: { channel: "red" } });
    expect(b["3"].inputs).toMatchObject({ mode: "manual_mask", manual_mask: ["50", 0] });
  });
});

describe("6. requirements and pins", () => {
  it("pins the pack, its folder, SAM with its SHA-256, and installs segment-anything by name instead of the pack's requirements", () => {
    expect(packs["ComfyUI-Qwen-Watermark"]).toMatchObject({ repo: "https://github.com/overflowofedge/ComfyUI-Qwen-Watermark", commit: PIN, subdir: null, folders: ["sams"], requirementsTxt: false, pip: ["segment-anything==1.0"] });
    expect(install).toContain(`[ComfyUI-Qwen-Watermark]="https://github.com/overflowofedge/ComfyUI-Qwen-Watermark ${PIN}"`);
    expect(install).toContain(`${SAM_SHA}  sam_vit_b_01ec64.pth.part`);
    expect(pins[SAM_URL]).toEqual({ revision: "7790786db131bcdc639f24a915d9f2c331d843ee", sizeBytes: 375042383, sha256: SAM_SHA });
    expect(requirements.packs["ComfyUI-Qwen-Watermark"]).toMatchObject({ commit: PIN, folders: ["sams"], requirementsTxt: false, pip: ["segment-anything==1.0"] });
    expect(requirements.files["sams/sam_vit_b_01ec64.pth"]).toMatchObject({ url: SAM_URL, pinnedUrl: SAM_URL, sizeBytes: 375042383, sha256: SAM_SHA, presence: "unobservable" });
    expect(requirements.workflows[REMOVE].packs["ComfyUI-Qwen-Watermark"]).toEqual(["QWMComposite", "QWMDetect", "QWMFinal", "QWMPrepare", "QWMRefineMask", "QWMResidualDetect"]);
  });

  it("writes the pinned packages, never the requirements file, in the setup commands", () => {
    const inv = emptyInventory("server", 1);
    const c = commandsFor([{ kind: "pack-install", pack: "ComfyUI-Qwen-Watermark" }], { inv, idx: requirements });
    for (const shell of [c.bash, c.powershell]) {
      expect(shell).toContain("-m pip install segment-anything==1.0");
      expect(shell).not.toContain("requirements.txt");
      expect(shell).toContain(`checkout ${PIN}`);
    }
  });
});

describe("7. which graph runs", () => {
  const base = { op: "watermark-remove", clips: 0, images: 1, audio2: false, extra: {}, has: () => true };
  it("runs the brush graph with a mask, the boxes graph without, and checks the removal along with a scan", () => {
    expect(WATERMARK_BRUSH_GRAPH[REMOVE]).toBe(BRUSH);
    expect(resolveWorkflowId(REMOVE, base)).toBe(REMOVE);
    expect(resolveWorkflowId(REMOVE, { ...base, mask: true })).toBe(BRUSH);
    expect(resolveWorkflowId(REMOVE, { ...base, mask: true, has: (id) => id !== BRUSH })).toBe(REMOVE);
    expect(COMPANION_GRAPHS[SCAN]).toEqual([REMOVE]);
  });

  it("prepareWorkflow picks the same graph", async () => {
    expect((await prepare(REMOVE, { images: ["a.png"], mask: "m.png" })).id).toBe(BRUSH);
    expect((await prepare(REMOVE, { images: ["a.png"] })).id).toBe(REMOVE);
  });
});

describe("8. how the provider fills the removal", () => {
  const boxes = JSON.stringify({ boxes: [{ bbox: [10, 20, 300, 120], overlay_type: "text_logo", label: "caption" }] });
  it("seeds both passes at random, per run", async () => {
    const a = (await prepare(REMOVE, { images: ["a.png"], extra: { boxes } })).wf;
    const b = (await prepare(REMOVE, { images: ["a.png"], extra: { boxes } })).wf;
    expect(a["12"].inputs.seed).toBe(a["30"].inputs.seed);
    expect(a["12"].inputs.seed).not.toBe(802146);
    expect(a["12"].inputs.seed).not.toBe(b["12"].inputs.seed);
  });

  it("kept marks: manual_boxes with clean JSON clamped to the picture", async () => {
    const { wf } = await prepare(REMOVE, { images: ["a.png"], extra: { boxes: JSON.stringify({ boxes: [{ bbox: [-50, 20, 3000, 120], overlay_type: "weird", label: "caption" }] }) } }, { media: { "a.png": { width: 1200, height: 800 } } });
    expect(wf["1"].inputs.image).toBe("a.png");
    expect(wf["3"].inputs.mode).toBe("manual_boxes");
    expect(JSON.parse(String(wf["3"].inputs.boxes_json))).toEqual({ coordinate_space: "pixels", boxes: [{ bbox: [0, 20, 1200, 120], overlay_type: "unknown", label: "caption" }] });
  });

  it("a brush: manual_mask on the brush graph, the mask on its loader", async () => {
    const { wf } = await prepare(REMOVE, { images: ["a.png"], mask: "m.png", extra: { boxes } });
    expect(wf["3"].inputs.mode).toBe("manual_mask");
    expect(wf["50"].inputs.image).toBe("m.png");
  });

  it("no marks from an API caller: the pack finds them itself", async () => {
    expect((await prepare(REMOVE, { images: ["a.png"] })).wf["3"].inputs.mode).toBe("auto_qwen");
  });

  it("the repair size follows the picture and the GPU, never the request", async () => {
    const size = async (media: { width: number; height: number } | undefined, vram?: number) =>
      (await prepare(REMOVE, { images: ["a.png"], extra: { boxes, maxSize: 4096, detectMode: "auto_qwen" } }, { media: media && { "a.png": media }, vram })).wf;
    const plain = await size({ width: 1600, height: 1200 });
    expect([plain["5"].inputs.max_side, plain["28"].inputs.max_side]).toEqual([1024, 1024]);
    expect(plain["3"].inputs.mode).toBe("manual_boxes");
    expect((await size({ width: 4000, height: 3000 }))["5"].inputs.max_side).toBe(1536);
    expect((await size({ width: 4000, height: 3000 }, 12 * 2 ** 30))["28"].inputs.max_side).toBe(768);
    expect(W.maxSideFor(1000, 1000, 32 * 2 ** 30)).toBe(1024);
  });

  it("refuses a picture over 4096 px in words", async () => {
    await expect(prepare(REMOVE, { images: ["a.png"], extra: { boxes } }, { media: { "a.png": { width: 5000, height: 3000 } } })).rejects.toThrow(W.COPY.tooBig);
    await expect(prepare(SCAN, { images: ["a.png"] }, { media: { "a.png": { width: 300, height: 4100 } } })).rejects.toThrow(W.COPY.tooBig);
  });
});

describe("9. the kept marks' checks", () => {
  const check = W.checkWatermarkBoxes;
  it("refuses what can't be read, nothing at all, and too many", () => {
    expect(() => check("{nope")).toThrow(/couldn't be read/);
    expect(() => check(JSON.stringify({ boxes: [] }))).toThrow("Pick at least one mark to remove");
    expect(() => check(JSON.stringify({ boxes: [{ bbox: [NaN, 0, 1, 1] }, { bbox: [5, 5, 5, 9] }] }))).toThrow("Pick at least one mark to remove");
    expect(() => check({ boxes: Array.from({ length: 33 }, () => ({ bbox: [0, 0, 10, 10] })) })).toThrow("Pick up to 32 marks at a time");
    expect(check({ boxes: Array.from({ length: 32 }, () => ({ bbox: [0, 0, 10, 10] })) }).count).toBe(32);
  });

  it("clamps, orders, types, trims labels and forces pixels", () => {
    const r = JSON.parse(check({ coordinate_space: "xyxy_1000", boxes: [{ bbox: [500, 400, -20, 10], source_bbox: [1, 2, 3, 4], overlay_type: "MOSAIC", label: `x\u0000y${"z".repeat(200)}` }] }, { width: 300, height: 200 }).json);
    expect(r.coordinate_space).toBe("pixels");
    expect(r.boxes[0].bbox).toEqual([0, 10, 300, 200]);
    expect(r.boxes[0].source_bbox).toEqual([1, 2, 3, 4]);
    expect(r.boxes[0].overlay_type).toBe("mosaic");
    expect(r.boxes[0].label).toHaveLength(80);
    expect(r.boxes[0].label.startsWith("x y")).toBe(true);
    expect(Object.keys(r.boxes[0]).sort()).toEqual(["bbox", "label", "overlay_type", "source_bbox"]);
  });

  it("is checked when the run is planned: a 400 in words, and a brushed run drops the boxes", () => {
    const req = (extra: Record<string, unknown>, mask?: string) =>
      planGeneration({ feature: W.WATERMARK_FEATURE, presetId: "app-watermark-remover", modelId: "oss-watermark-remover", op: "watermark-remove", inputs: { images: ["/a.png"], ...(mask && { mask }) }, params: { extra } }, getModel, getPreset);
    expect(() => req({ boxes: JSON.stringify({ boxes: [] }) })).toThrow("Pick at least one mark to remove");
    expect(JSON.parse(String(req({ boxes: JSON.stringify({ boxes: [{ bbox: [0, 0, 5, 5], extra: "dropped" }] }) }).params.extra?.boxes))).toEqual({ coordinate_space: "pixels", boxes: [{ bbox: [0, 0, 5, 5], overlay_type: "unknown", label: "watermark" }] });
    expect(req({ boxes: "nonsense" }, "/m.png").params.extra?.boxes).toBeUndefined();
  });
});

describe("10. the scan report, read into regions", () => {
  it("outlines the tight boxes, maps the chips, and starts the less sure marks kept", () => {
    const s = W.parseScanReport(REPORT)!;
    expect([s.width, s.height]).toEqual([1000, 800]);
    expect(s.regions.map((r) => [r.chip, r.on])).toEqual([
      ["Text", true],
      ["Logo", true],
      ["Sticker", true],
      ["Block", false],
    ]);
    expect(s.regions[0].box).toEqual([120, 590, 880, 670]);
    expect(s.regions[0].repair).toEqual([80, 560, 920, 700]);
    expect(W.parseScanReport("not json")).toBeNull();
    expect(W.parseScanReport(JSON.stringify({ coordinate_space: "xyxy_1000", image_size: [10, 10], boxes: [] }))).toBeNull();
    expect(W.parseScanReport(JSON.stringify({ coordinate_space: "pixels", image_size: [10, 10], boxes: [] }))!.regions).toEqual([]);
  });

  it("names the chips from the type and the scan's words", () => {
    expect(W.chipFor("text_logo", "a website URL")).toBe("Text");
    expect(W.chipFor("translucent_text_logo", "©2024 photographer signature")).toBe("Text");
    expect(W.chipFor("text_logo", "a round emblem")).toBe("Logo");
    expect(W.chipFor("mosaic")).toBe("Mosaic");
    expect(W.chipFor("irregular_sticker")).toBe("Sticker");
    expect(W.chipFor("rectangle")).toBe("Block");
    expect(W.chipFor("unknown")).toBe("Mark");
  });

  it("a tap picks the smallest region under it; the counts and the request follow the toggles", () => {
    const { regions } = W.parseScanReport(REPORT)!;
    expect(W.regionAt(regions, 800, 100)?.chip).toBe("Logo");
    expect(W.regionAt(regions, 500, 500)).toBeNull();
    expect(W.regionAt(regions, 500, 585, 10)?.chip).toBe("Text");
    const overlapping = [...regions, { ...regions[0], id: "big", box: [0, 0, 1000, 800] as [number, number, number, number] }];
    expect(W.regionAt(overlapping, 800, 100)?.chip).toBe("Logo");
    expect(W.foundLine(3)).toBe("Found 3. Tap any you want to keep.");
    expect(W.removeLabel(3)).toBe("Remove 3");
    expect(W.removeLabel(0)).toBe("Everything is kept");
    const sent = JSON.parse(W.keptBoxesJson(regions.map((r) => (r.chip === "Logo" ? { ...r, on: false } : r))));
    expect(sent.coordinate_space).toBe("pixels");
    expect(sent.boxes.map((b: { overlay_type: string }) => b.overlay_type)).toEqual(["translucent_text_logo", "irregular_sticker"]);
    expect(sent.boxes[0]).toMatchObject({ bbox: [80, 560, 920, 700], source_bbox: [120, 590, 880, 670] });
    expect(() => W.checkWatermarkBoxes(W.keptBoxesJson(regions))).not.toThrow();
  });
});

describe("11. the repair's verdict and the Library", () => {
  it("folds QWMFinal's report into the picture's meta, never a result of its own", () => {
    const outs = collectOutputs(
      {
        outputs: {
          "33": { images: [{ filename: "w_00001_.png", subfolder: "fuobe", type: "output" }] },
          "38": { text: [JSON.stringify({ status: "needs_review", selected_pass: 2, outside_mask_max_difference: 0, needs_review: true, reasons: ["residual_unverified"], first_pass_quality: { big: 1 } })] },
        },
      } as never,
      entry(REMOVE),
    );
    expect(outs).toHaveLength(1);
    expect(outs[0].kind).toBe("image");
    expect(outs[0].meta?.quality).toEqual({ status: "needs_review", selectedPass: 2, outsideMaskMaxDifference: 0, needsReview: true, reasons: ["residual_unverified"] });
    expect(W.rejectedRepair(W.qualityOf(JSON.stringify({ status: "rejected_first_pass" })))).toBe(true);
    expect(W.rejectedRepair(W.qualityOf(JSON.stringify({ status: "completed_clean_first_pass" })))).toBe(false);
  });

  it("keeps the scans out of the Library", () => {
    expect(HELPER_FEATURES).toContain(W.WATERMARK_SCAN_FEATURE);
    expect(isHelperFeature(W.WATERMARK_SCAN_FEATURE)).toBe(true);
    expect(isHelperFeature(W.WATERMARK_FEATURE)).toBe(false);
  });
});

describe("12. licences", () => {
  it("lists the pack as MIT and the graphs with the Qwen-Image 2.1 terms", () => {
    expect(nodePack("ComfyUI-Qwen-Watermark")?.licence).toMatchObject({ name: "MIT", class: "commercial" });
    expect(nodePack("ComfyUI-Qwen-Watermark")?.repo).toBe(`https://github.com/overflowofedge/ComfyUI-Qwen-Watermark/tree/${PIN}`);
    expect(entry(REMOVE).license).toMatch(/^Qwen Research License Agreement \(Qwen-Image 2\.1\): NON-COMMERCIAL.*SAM ViT-B \(segment-anything\) Apache-2\.0; ComfyUI-Qwen-Watermark nodes MIT$/);
    expect(entry(SCAN).license).toBe("Qwen3-VL 8B Apache-2.0; ComfyUI-Qwen-Watermark nodes MIT");
    expect(workflowLicence(entry(REMOVE))).toBeTruthy();
    const list = buildLicenceList(MODELS, manifest.workflows);
    expect(JSON.stringify(list)).toContain("Watermark Remover");
    expect(read("CREDITS.md")).toContain("ComfyUI-Qwen-Watermark");
  });
});

describe("13. the Library action", () => {
  const gen = (o: Partial<Generation>, kind: "image" = "image", url = "/api/files/out/x.png"): Generation =>
    ({ id: "g1", status: "succeeded", feature: "image", op: "t2i", provider: "comfyui", outputs: [{ url, kind }], request: {}, createdAt: "", ...o }) as unknown as Generation;
  const has = (g: Generation) => outputActions(g, 0).find((a) => a.id === "remove-watermark");
  it("is on pictures, opens the app with the picture, and isn't on vectors or the app's own results", () => {
    expect(has(gen({}))).toMatchObject({ label: "Remove watermark", placement: "menu", href: "/apps/app-watermark-remover?image=%2Fapi%2Ffiles%2Fout%2Fx.png" });
    expect(has(gen({ op: "vectorize" }, "image", "/api/files/out/x.svg"))).toBeUndefined();
    expect(has(gen({ feature: W.WATERMARK_FEATURE }))).toBeUndefined();
  });
});

describe("14. search and the Edit studio", () => {
  it("finds the app by its words and links it from Edit", () => {
    expect(APP_KEYWORDS["app-watermark-remover"]).toMatch(/watermark.*logo.*caption.*mosaic/);
    expect(EDIT_STUDIO.related).toEqual({ href: "/apps/app-watermark-remover", label: "Remove watermarks, captions and logos automatically" });
  });
});

describe("15. the demo", () => {
  it("the scan finds two marks sized to the picture, and the removal gives the picture back", { timeout: 60_000 }, async () => {
    const report = JSON.parse(demoWatermarkReport(`data:image/png;base64,${png(400, 300).toString("base64")}`));
    expect(report.image_size).toEqual([400, 300]);
    expect(report.boxes).toHaveLength(2);
    expect(W.parseScanReport(JSON.stringify(report))!.regions.map((r) => r.chip)).toEqual(["Text", "Logo"]);
    expect(mockProvider.id).toBe("mock");

    ensureRunner();
    const picture = saveFile({ data: png(64, 48), contentType: "image/png", source: "upload" });
    const [scan] = createGenerations({ feature: W.WATERMARK_SCAN_FEATURE, modelId: "oss-watermark-scan", op: "watermark-scan", inputs: { images: [picture.url] } });
    const s = await settled(scan.id);
    expect(s.status).toBe("succeeded");
    const parsed = W.parseScanReport(s.outputs.find((o) => o.kind === "text")?.text)!;
    expect([parsed.width, parsed.height]).toEqual([64, 48]);
    const [removal] = createGenerations({
      feature: W.WATERMARK_FEATURE,
      presetId: "app-watermark-remover",
      modelId: "oss-watermark-remover",
      op: "watermark-remove",
      inputs: { images: [picture.url] },
      params: { extra: { boxes: W.keptBoxesJson(parsed.regions) } },
    });
    const r = await settled(removal.id);
    expect(r.status).toBe("succeeded");
    expect(r.outputs[0].kind).toBe("image");
  });
});

describe("16. visitor words", () => {
  it("never name models, masks, nodes, graphs or internal status", () => {
    const BANNED = /\b(model|mask|node|graph|LoRA|SAM|Qwen|seed|confidence|review|needs_review|VLM)\b/i;
    const visitor = [W.COPY.name, W.COPY.tagline, W.COPY.hero, W.COPY.subline, ...W.COPY.details, W.COPY.scanning, W.COPY.removing, W.COPY.empty, W.COPY.rejected, W.COPY.tooBig, W.COPY.noneKept, W.COPY.hint];
    for (const s of visitor) expect(s, s).not.toMatch(BANNED);
    const app = APPS.find((a) => a.id === "app-watermark-remover")!;
    for (const s of [app.name, app.description, app.parity ?? ""]) expect(s, s).not.toMatch(BANNED);
    // The page's own strings (JSX text and string literals), past the owner-only row.
    for (const f of ["watermark-tool.tsx", "regions.tsx", "flip-compare.tsx"]) {
      const src = read(`src/components/watermark/${f}`)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/\{owner && quality[\s\S]*?<\/p>\s*\)\}/, "");
      const texts = [...src.matchAll(/>([^<>{}]+)</g)].map((m) => m[1].trim()).filter(Boolean);
      const quoted = [...src.matchAll(/"([A-Z][^"]{3,})"/g)].map((m) => m[1]);
      for (const t of [...texts, ...quoted]) expect(t, `${f}: ${t}`).not.toMatch(BANNED);
    }
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settled(id: string, ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) {
    const g = getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`${id} is still ${g.status}`);
    await sleep(50);
  }
}
