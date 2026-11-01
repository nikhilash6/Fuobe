import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { GenInput, Generation } from "@/lib/catalog/types";
import type { ComfyWorkflow, ManifestWorkflow } from "@/lib/comfy";

// Tap to Recolor: tap a piece, pick a colour; SAM 3.1 makes the mask from the taps and Qwen-Image 2.1 repaints only that
// piece (qwen-image-21-recolor). Everything here runs without a GPU or a ComfyUI.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-recolor-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel, getPreset } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { outputActions } = await import("@/lib/output-actions");
const R = await import("@/lib/catalog/recolor");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const LIBRARY = path.join(process.cwd(), "workflows/comfyui");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(LIBRARY, f), "utf8"));
const manifest = read("manifest.json") as { workflows: ManifestWorkflow[] };
const entry = manifest.workflows.find((w) => w.id === "qwen-image-21-recolor")!;
const plan = (r: Parameters<typeof planGeneration>[0]) => planGeneration(r, getModel, getPreset);
const taps = [
  { x: 400, y: 600, label: "positive" as const },
  { x: 420, y: 700, label: "positive" as const },
  { x: 300, y: 900, label: "negative" as const },
];
const frame = { width: 1024, height: 1280 };

async function prepare(input: GenInput, media?: { width: number; height: number }) {
  return prepareWorkflow("qwen-image-21-recolor", { seed: 7, ...input }, {
    generationId: "g",
    op: "edit",
    upload: async (_d, _t, name) => `up_${name}`,
    media: () => (media ? { container: "image", hasVideo: false, hasAudio: false, ...media } : undefined),
    serverRam: async () => undefined,
  });
}
const at = (wf: ComfyWorkflow, key: string) => (entry.bindings[key] ?? []).map((t) => wf[t.node].inputs[t.input]);

describe("Tap to Recolor in the catalog", () => {
  it("is a Fashion app with its own page, on the open engine only", () => {
    const app = getPreset(R.RECOLOR.appId)!;
    expect(app.type).toBe("app");
    expect(app.name).toBe("Tap to Recolor");
    expect(app.category).toBe("Fashion");
    expect(app.tool).toBe("recolor");
    expect(app.cloud).toBeNull();
    expect(app.open).toMatchObject({ modelId: "oss-recolor", op: "edit" });
    expect(app.options?.map((o) => o.key)).toEqual(["item", "colour"]);
  });

  it("runs on a hidden model whose one route is the recolor graph, and asks for taps", () => {
    const m = getModel("oss-recolor")!;
    expect(m.engine).toBe("open");
    expect(m.hidden).toBe(true);
    expect(m.routes.map((r) => [r.op, r.endpoint])).toEqual([["edit", "qwen-image-21-recolor"]]);
    expect(m.options.requires).toMatchObject({ images: 1, points: true, msg: R.RECOLOR_TAP_FIRST });
  });

  it("lists the graph with its bindings, its four files and its pack, unvalidated until it runs on a GPU", () => {
    expect(entry.capability).toBe("recolor");
    expect(Object.keys(entry.bindings).sort()).toEqual(["filenamePrefix", "image", "maskGrow", "negativeCoords", "positiveCoords", "prompt", "seed", "steps"]);
    expect(entry.models.map((m) => m.file).sort()).toEqual([
      "qwen3vl_8b_int8_convrot.safetensors",
      "qwen_image_2.1_int8_convrot.safetensors",
      "qwen_image_2.1_vae_bf16.safetensors",
      "sam3.1_multiplex_fp16.safetensors",
    ]);
    for (const m of entry.models) expect(m.url, m.file).toMatch(/^https:\/\/huggingface\.co\/Comfy-Org\//);
    expect(entry.customNodes.map((c) => c.name)).toEqual(["ausboss-nodes"]);
    expect(entry.validated).toBe(false);
    expect(entry.defaults).toMatchObject({ steps: 25, maskGrow: 4 });
    const req = read("requirements.json") as { workflows: Record<string, { files: string[]; packs: Record<string, string[]> }> };
    expect(req.workflows["qwen-image-21-recolor"].files).toContain("checkpoints/sam3.1_multiplex_fp16.safetensors");
    expect(Object.keys(req.workflows["qwen-image-21-recolor"].packs)).toEqual(["ausboss-nodes"]);
  });

  it("is the same graph in the library as the hand-built one", () => {
    const hand = fs.readFileSync(path.join(process.cwd(), "scripts/comfy/hand-built/qwen-image-21-recolor.json"), "utf8");
    expect(JSON.parse(hand)).toEqual(read("qwen-image-21-recolor.json"));
  });
});

describe("Tap to Recolor's graph", () => {
  const wf = read("qwen-image-21-recolor.json") as ComfyWorkflow;
  it("masks the tapped piece with SAM 3.1's point path, crops around it, repaints it and stitches it back without a tone match", () => {
    expect(wf["14"].class_type).toBe("SAM3_Detect");
    expect(wf["14"].inputs).toMatchObject({ positive_coords: ["12", 0], negative_coords: ["13", 0], model: ["4", 0], image: ["10", 0] });
    expect(wf["14"].inputs.conditioning).toBeUndefined();
    expect(wf["20"].inputs.mask).toEqual(["15", 0]);
    expect(wf["25"].class_type).toBe("SetLatentNoiseMask");
    expect(wf["27"].inputs).toMatchObject({ steps: 25, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 });
    expect(wf["30"].class_type).toBe("AUSBOSS_NODES_StitchInpaint");
    expect(wf["30"].inputs.color_match).toBe(0);
    expect(wf["90"].inputs.images).toEqual(["30", 0]);
  });

  it("binds the photo, the taps as point lists, the words, the seed and the run's prefix", async () => {
    const { workflow } = await prepare({ prompt: "Change the colour of the dress to soft ivory (#F2EBDD).", images: ["photo.png"], points: taps, extra: { frameWidth: 1024, frameHeight: 1280 } } as GenInput);
    expect(at(workflow, "image")).toEqual(["photo.png"]);
    expect(JSON.parse(String(at(workflow, "positiveCoords")[0]))).toEqual([
      { x: 400, y: 600 },
      { x: 420, y: 700 },
    ]);
    expect(JSON.parse(String(at(workflow, "negativeCoords")[0]))).toEqual([{ x: 300, y: 900 }]);
    expect(at(workflow, "prompt")).toEqual(["Change the colour of the dress to soft ivory (#F2EBDD)."]);
    expect(at(workflow, "seed")).toEqual([7]);
    expect(at(workflow, "filenamePrefix")).toEqual(["fuobe/g"]);
    // The size the taps came with isn't a graph input.
    expect(JSON.stringify(workflow)).not.toContain("frameWidth");
  });

  it("moves taps placed on a smaller copy onto the photo's own pixels, inside the picture", async () => {
    const { workflow } = await prepare({ prompt: "x", images: ["photo.png"], points: [{ x: 512, y: 640 }, { x: 2000, y: -5 }], extra: { frameWidth: 1024, frameHeight: 1280 } } as GenInput, { width: 2048, height: 2560 });
    expect(JSON.parse(String(at(workflow, "positiveCoords")[0]))).toEqual([
      { x: 1024, y: 1280 },
      { x: 2047, y: 0 },
    ]);
    expect(at(workflow, "negativeCoords")).toEqual([""]);
  });

  it("refuses a run with no tap on the piece", async () => {
    await expect(prepare({ prompt: "x", images: ["photo.png"], points: [{ x: 1, y: 1, label: "negative" }] } as GenInput)).rejects.toThrow(R.RECOLOR_TAP_FIRST);
    await expect(prepare({ prompt: "x", images: ["photo.png"] } as GenInput)).rejects.toThrow(R.RECOLOR_TAP_FIRST);
  });
});

describe("Tap to Recolor's runs", () => {
  it("builds one run per colour with the taps, and the words from the swatch", () => {
    const req = R.recolorRequest({ image: "/api/files/a.png", points: taps, frame, colour: "emerald", item: "dress" });
    expect(req).toMatchObject({ feature: "app:app-tap-to-recolor", presetId: "app-tap-to-recolor", modelId: "oss-recolor", op: "edit", engine: "open", inputs: { images: ["/api/files/a.png"] } });
    expect(req.params?.extra).toEqual({ frameWidth: 1024, frameHeight: 1280 });
    const p = plan(req);
    expect(p.op).toBe("edit");
    expect(p.prompt).toBe(
      "Change the colour of the dress to deep emerald green (#0E6B4F). Keep its fabric, weave, folds, seams, stitching, sheen, print and shadows exactly as they are, so only the colour is new.",
    );
    expect(p.params.points).toHaveLength(3);
  });

  it("names a custom colour by its nearest name with its code, and the piece in the middle when the piece is Auto", () => {
    const p = plan(R.recolorRequest({ image: "/api/files/a.png", points: taps, frame, colour: "c98b93" }));
    expect(p.prompt).toMatch(/^Change the colour of the piece in the middle of the picture to dusty rose pink \(#C98B93\)\. Keep its fabric/);
  });

  it("asks for a tap before it runs, and for a real colour", () => {
    expect(() => plan(R.recolorRequest({ image: "/api/files/a.png", points: [], frame, colour: "emerald" }))).toThrow(R.RECOLOR_TAP_FIRST);
    expect(() => R.recolorRequest({ image: "/api/files/a.png", points: taps, frame, colour: "not-a-colour" })).toThrow("Pick a colour");
  });

  it("writes only what the photo should show", () => {
    const words = [R.RECOLOR_TEMPLATE, ...R.SWATCHES.map((s) => s.words), ...R.ITEMS.map((i) => i.words)].join(" ");
    expect(words).not.toMatch(/\b(no|not|never|without|free of)\b/i);
  });
});

describe("Tap to Recolor's colours", () => {
  it("reads colour codes in their short and long forms", () => {
    expect(R.normaliseHex("#abc")).toBe("#AABBCC");
    expect(R.normaliseHex("0e6b4f")).toBe("#0E6B4F");
    expect(R.normaliseHex("#12345")).toBeNull();
  });

  it("names a code by its nearest colour", () => {
    expect(R.nearestColourName("#0E6B4F")).toBe("deep emerald green");
    expect(R.nearestColourName("#FFFFFF")).toBe("pure white");
    expect(R.nearestColourName("#D0201F")).toBe("scarlet red");
    expect(R.colourChip("#4E2E1F")).toEqual({ label: "Chocolate brown", hex: "#4E2E1F" });
    expect(R.colourChip("crimson")).toEqual({ label: "Crimson", hex: "#A3142C" });
  });

  it("keeps at most eight taps of each kind", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ x: i, y: i }));
    expect(JSON.parse(R.recolorCoords(many)[0])).toHaveLength(R.RECOLOR.maxPoints);
  });
});

describe("Recolor from the Library", () => {
  it("offers Recolor on an image result, opening the app with that picture", () => {
    const g = { id: "g1", feature: "image", kind: "image", status: "succeeded", outputs: [{ url: "/api/files/x.png", kind: "image" }], request: {}, favorite: false } as unknown as Generation;
    const a = outputActions(g, 0).find((x) => x.id === "recolor");
    expect(a).toMatchObject({ label: "Recolor", placement: "menu", href: "/apps/app-tap-to-recolor?image=%2Fapi%2Ffiles%2Fx.png" });
  });
});
