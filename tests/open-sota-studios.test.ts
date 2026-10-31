import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { StudioConfig } from "@/components/studio/studio-context";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { defaultModelFor, EFFECT_CHAIN_MODELS } from "@/lib/catalog/canvas";
import { ANCHOR_MODELS, anchorModel } from "@/lib/catalog/character-swap";
import { CINEMA_MODELS, LOCATION_MODELS, RECOMPOSE_MODELS } from "@/lib/catalog/cinema";
import { FASHION_MODELS, fashionModel, PHOTODUMP_MODELS, photodumpModel, type PhotoSubject } from "@/lib/catalog/packs";
import { imageLimit, movedAppRequest, planGeneration } from "@/lib/catalog/plan";
import type { Engine, GenerationRequest, ModelDef } from "@/lib/catalog/types";
import type { Manifest } from "@/lib/comfy";
import { bestForStudio, filterModels, settingsShape, studioBest, viewerDefaults, writesCaptions } from "@/lib/composer";
import { TOOL_MODELS } from "@/lib/layers";
import { EDIT_STUDIO, IMAGE_STUDIO, INPAINT_STUDIO, LIPSYNC_STUDIO, VIDEO_STUDIO } from "@/lib/studios";

// The owner's SOTA image families (2026-10-31): the newest models are the first picks on your GPU, in his order.

/** What a studio's picker shows as "Best for this studio" on an engine (composer.tsx: the picker's models and ops). */
function best(studio: StudioConfig, engine: Engine): string[] {
  const ops = studio.pickerOps ?? studio.ops;
  const models = filterModels(MODELS, { kind: studio.kind, ops });
  return studioBest(models, engine, studio.defaultModels[engine], ops);
}

const openIds = MODELS.filter((m) => m.engine === "open").map((m) => m.id);
const before = (a: string, b: string) => expect(openIds.indexOf(a), `${a} before ${b}`).toBeLessThan(openIds.indexOf(b));

describe("studio defaults on your GPU", () => {
  it("Image opens on Ideogram 4, Edit and Inpaint on Qwen-Image 2.1", () => {
    expect(IMAGE_STUDIO.defaultModels.open).toBe("oss-ideogram-4");
    expect(EDIT_STUDIO.defaultModels.open).toBe("oss-qwen-image-21");
    expect(INPAINT_STUDIO.defaultModels.open).toBe("oss-qwen-image-21");
    expect(getModel("oss-qwen-image-21")!.routes.map((r) => r.op)).toEqual(expect.arrayContaining(["edit", "inpaint", "outpaint"]));
  });

  it("the cloud defaults stay as they were", () => {
    for (const s of [IMAGE_STUDIO, EDIT_STUDIO, INPAINT_STUDIO]) expect(s.defaultModels.cloud).toBe("nano-banana-pro");
  });
});

describe('"Best for this studio" on your GPU', () => {
  it("Image: Ideogram 4, then Qwen-Image 2.1, Krea 2 Realism and MOSS-Image (FIBO 2 Dev is next)", () => {
    expect(best(IMAGE_STUDIO, "open")).toEqual(["oss-ideogram-4", "oss-qwen-image-21", "oss-krea2-realism", "oss-moss-image"]);
    const t2i = MODELS.filter((m) => m.engine === "open" && m.badges?.includes("top") && m.routes.some((r) => r.op === "t2i")).map((m) => m.id);
    expect(t2i.indexOf("oss-fibo2-dev")).toBe(4);
  });

  it("Edit: the new edit models, Qwen-Image 2.1 first, not the text-to-image models its first route would rank", () => {
    expect(best(EDIT_STUDIO, "open")).toEqual(["oss-qwen-image-21", "oss-qwen-image-21-turbo", "oss-fibo2-dev", "oss-fibo2-edit-turbo"]);
  });

  it("Inpaint: Qwen-Image 2.1; Krea 2 Inpaint stays out while its add-on isn't on the owner's ComfyUI", () => {
    expect(best(INPAINT_STUDIO, "open")).toEqual(["oss-qwen-image-21"]);
    expect(filterModels(MODELS, { kind: "image", ops: INPAINT_STUDIO.ops }).map((m) => m.id)).toContain("oss-krea2-inpaint");
  });

  it("Image: MOSS-Image is a top pick only on the int8 encoder, never the w4a8 build that faulted the driver", () => {
    const wf = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/moss-image-t2i.json"), "utf8")) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    const encoders = Object.values(wf).filter((n) => n.class_type === "CLIPLoader").map((n) => n.inputs.clip_name);
    expect(encoders).toEqual(["qwen3.5_9b_int8_convrot.safetensors"]);
    expect(getModel("oss-moss-image")!.badges).toContain("top");
  });

  it("a default whose first route is the studio's ranks as before, on both engines", () => {
    for (const s of [IMAGE_STUDIO, VIDEO_STUDIO, LIPSYNC_STUDIO]) {
      for (const engine of ["cloud", "open"] as const) {
        const ops = s.pickerOps ?? s.ops;
        const models = filterModels(MODELS, { kind: s.kind, ops });
        const id = s.defaultModels[engine];
        const op = models.find((m) => m.id === id)?.routes[0]?.op;
        expect(best(s, engine), `${s.title} ${engine}`).toEqual(bestForStudio(models, engine, id, 4, op).map((m) => m.id));
      }
    }
  });
});

describe("catalog order: the owner's ranking", () => {
  it("text to image: Ideogram 4, Qwen-Image 2.1, Krea 2, MOSS-Image, FIBO 2, then the older models", () => {
    before("oss-ideogram-4", "oss-qwen-image-21");
    before("oss-qwen-image-21", "oss-krea2-realism");
    before("oss-krea2-turbo", "oss-moss-image");
    before("oss-moss-image", "oss-fibo2-dev");
    before("oss-fibo2-dev", "oss-z-image-turbo");
  });

  it("edits: Qwen-Image 2.1 (and its Turbo), FIBO 2, Krea 2, then Qwen-Image-Edit 2511 and Kontext", () => {
    before("oss-qwen-image-21-turbo", "oss-fibo2-edit-turbo");
    before("oss-fibo2-edit-turbo", "oss-krea2-edit");
    before("oss-krea2-inpaint", "oss-qwen-edit");
    before("oss-krea2-inpaint", "oss-flux-kontext");
    before("oss-krea2-inpaint", "oss-flux-fill");
  });

  it("MOSS-Image is main's one model, listed once", () => {
    expect(openIds.filter((id) => id.startsWith("oss-moss"))).toEqual(["oss-moss-image"]);
    expect(getModel("oss-moss-image")!.routes.map((r) => r.endpoint)).toEqual(["moss-image-t2i"]);
  });
});

describe("apps and tools pick the new models first", () => {
  const openRoute = (id: string) => getPreset(id)!.open!;

  it("an edit app runs on Qwen-Image 2.1; Expand and Zoom Out on its expand graph", () => {
    expect(openRoute("app-sketch-to-real")).toMatchObject({ modelId: "oss-qwen-image-21", op: "edit" });
    for (const id of ["app-expand-image", "app-zoom-out"]) {
      const r = openRoute(id);
      expect(r).toMatchObject({ modelId: "oss-qwen-image-21", op: "outpaint" });
      // The expand graph reads the words as what fills the margins: they never name the subject.
      expect(r.promptTemplate).not.toMatch(/subject|people|person/i);
    }
  });

  it("apps tied to an older model by a LoRA or a tuned recipe keep it", () => {
    expect(openRoute("app-angles")).toMatchObject({ modelId: "oss-qwen-edit", loras: [expect.objectContaining({ file: "qwen-image-edit-2511-multiple-angles-lora.safetensors" })] });
    expect(openRoute("app-relight").modelId).toBe("oss-qwen-relight");
    expect(openRoute("app-product-shot").modelId).toBe("oss-product-shot");
    expect(openRoute("app-virtual-try-on").modelId).toBe("oss-tryon-klein");
    expect(TOOL_MODELS.angles.open).toEqual(["oss-qwen-edit"]);
    expect(RECOMPOSE_MODELS.open).toEqual(["oss-qwen-edit", "oss-qwen-image-21"]);
  });

  it("Layers: Qwen-Image 2.1 edits, inpaints, expands and makes a layer first; Ideogram 4 is the next pick for a layer", () => {
    expect(TOOL_MODELS.regenerate.open).toEqual(["oss-qwen-image-21", "oss-qwen-image-21-turbo", "oss-qwen-edit", "oss-flux-kontext"]);
    // A lone object on a plain background is what Ideogram 4's safety filter answers with a grey card most often.
    expect(TOOL_MODELS["generate-layer"].open).toEqual(["oss-qwen-image-21", "oss-ideogram-4", "oss-z-image-turbo", "oss-qwen-image"]);
    for (const tool of ["text-edit", "regional", "expand", "inpaint", "enhance"] as const) expect(TOOL_MODELS[tool].open[0], tool).toBe("oss-qwen-image-21");
    // Each first model does what its tool asks of it.
    const does = (m: ModelDef, op: string) => m.routes.some((r) => r.op === op);
    expect(does(getModel(TOOL_MODELS.expand.open[0])!, "outpaint")).toBe(true);
    expect(does(getModel(TOOL_MODELS.inpaint.open[0])!, "inpaint")).toBe(true);
    expect(does(getModel(TOOL_MODELS["generate-layer"].open[0])!, "t2i")).toBe(true);
  });

  it("Canvas: new nodes open on Ideogram 4 and Qwen-Image 2.1", () => {
    expect(defaultModelFor("t2i", "open")?.id).toBe("oss-ideogram-4");
    expect(defaultModelFor("edit", "open")?.id).toBe("oss-qwen-image-21");
    expect(defaultModelFor("t2i", "cloud")?.id).toBe("nano-banana-pro");
  });

  it("Cinema stills offer Ideogram 4 and Qwen-Image 2.1 right after Fuobe Soul; Soul Location, Qwen-Image 2.1 and Krea 2 Realism", () => {
    expect(CINEMA_MODELS.image.open.slice(1, 3)).toEqual(["oss-ideogram-4", "oss-qwen-image-21"]);
    // A place with no one in it is what Ideogram 4's safety filter blocks most: Soul Location doesn't offer it.
    expect(LOCATION_MODELS.open.slice(1, 3)).toEqual(["oss-qwen-image-21", "oss-krea2-realism"]);
    expect(LOCATION_MODELS.open).not.toContain("oss-ideogram-4");
  });

  it("Canvas' Effects 2.0 chains set the scene on Qwen-Image 2.1 on your GPU", () => {
    expect(EFFECT_CHAIN_MODELS.edit).toEqual({ cloud: "qwen-image-edit-2511-cloud", open: "oss-qwen-image-21-turbo" });
  });

  it("Photodump, Fashion Factory and Character swap offer Qwen-Image 2.1 before Qwen-Image-Edit 2511", () => {
    const selfie: PhotoSubject = { kind: "selfie", url: "/api/files/uploads/me.png" };
    expect(PHOTODUMP_MODELS.open).toEqual(["fuobe-soul", "oss-qwen-image-21", "oss-qwen-edit"]);
    expect(photodumpModel(selfie, "open", {}).modelId).toBe("oss-qwen-image-21");
    expect(photodumpModel(selfie, "open", {}, "oss-qwen-edit").modelId).toBe("oss-qwen-edit");
    expect(FASHION_MODELS.outfit.open).toEqual(["fuobe-tryon", "oss-qwen-image-21", "oss-qwen-edit"]);
    expect(fashionModel("photoset", "open")).toBe("oss-qwen-image-21");
    expect(ANCHOR_MODELS.open.map((m) => m.id)).toEqual(["oss-qwen-image-21", "oss-qwen-edit"]);
    expect(anchorModel("open").id).toBe("oss-qwen-image-21");
    // The cloud lists are untouched.
    expect(photodumpModel(selfie, "cloud", {}).modelId).toBe("qwen-image-edit-2511-cloud");
    expect(fashionModel("photoset", "cloud")).toBe("qwen-image-edit-2511-cloud");
  });
});

describe("app runs stored before the apps moved to Qwen-Image 2.1", () => {
  const stored = (modelId: string, presetId: string, op?: GenerationRequest["op"]): GenerationRequest => ({
    feature: "app",
    modelId,
    presetId,
    ...(op && { op }),
    prompt: "",
    inputs: { images: ["/api/files/uploads/me.png"] },
  });

  it("an edit app's run on Qwen-Image-Edit 2511 and Expand's on FLUX Fill run on Qwen-Image 2.1, and say so", () => {
    // As planGeneration refused them before: apps pin their model.
    expect(() => planGeneration(stored("oss-qwen-edit", "app-character-swap", "edit"), getModel, getPreset)).toThrow(/runs on oss-qwen-image-21/);
    const swap = movedAppRequest(stored("oss-qwen-edit", "app-character-swap", "edit"), getModel, getPreset);
    expect(swap.request).toMatchObject({ modelId: "oss-qwen-image-21", op: "edit", presetId: "app-character-swap" });
    expect(swap.note).toBe("Character Swap now runs on Qwen-Image 2.1");
    expect(planGeneration(swap.request, getModel, getPreset)).toMatchObject({ op: "edit", model: { id: "oss-qwen-image-21" } });
    for (const id of ["app-expand-image", "app-zoom-out"]) {
      const moved = movedAppRequest(stored("oss-flux-fill", id, "outpaint"), getModel, getPreset);
      expect(moved.request, id).toMatchObject({ modelId: "oss-qwen-image-21", op: "outpaint" });
      expect(planGeneration(moved.request, getModel, getPreset).op).toBe("outpaint");
    }
  });

  it("leaves alone an app a LoRA ties to the old model, a model the app never ran on, and a request without an app", () => {
    const angles = stored("oss-qwen-edit", "app-angles", "edit");
    expect(movedAppRequest(angles, getModel, getPreset)).toEqual({ request: angles });
    const kontext = stored("oss-flux-kontext", "app-character-swap", "edit");
    expect(movedAppRequest(kontext, getModel, getPreset)).toEqual({ request: kontext });
    const plain = { ...stored("oss-qwen-edit", "app-character-swap", "edit"), presetId: undefined };
    expect(movedAppRequest(plain, getModel, getPreset)).toEqual({ request: plain });
  });
});

describe("what the composer offers for Qwen-Image 2.1's and FIBO 2's edits", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/manifest.json"), "utf8")) as Manifest;
  const sized = (workflow: string) => {
    const b = manifest.workflows.find((w) => w.id === workflow)!.bindings;
    return !!(b.width || b.height);
  };

  it("no aspect ratio or size where the graph follows image 1; both for text to image", () => {
    const q = getModel("oss-qwen-image-21")!;
    for (const op of ["edit", "inpaint", "outpaint"] as const) {
      const shape = settingsShape(q, op, "image", true);
      expect([shape.aspect, shape.resolution], op).toEqual([null, null]);
    }
    expect(settingsShape(q, "t2i", "image", true)).toMatchObject({ aspect: q.options.aspectRatios, resolution: ["1K", "1.5K", "2K"] });
    // Before the operation is known (Inpaint with no prompt yet): the studio's operations decide.
    expect(settingsShape(q, undefined, "image", true, {}, INPAINT_STUDIO.ops)).toMatchObject({ aspect: null, resolution: null });
    expect(settingsShape(q, undefined, "image", true, {}, IMAGE_STUDIO.ops).aspect).toEqual(q.options.aspectRatios);
    expect(settingsShape(getModel("oss-fibo2-dev")!, "edit", "image", true).aspect).toBeNull();
    // Krea 2 Edit's graph takes a size: its chips stay.
    expect(settingsShape(getModel("oss-krea2-edit")!, "edit", "image", true).aspect).toContain("auto");
  });

  it("marks a route unsized exactly when its graph has no width or height binding (the owner's new models)", () => {
    const families = ["ideogram", "qwen-image", "krea", "moss", "bria"];
    for (const m of MODELS.filter((x) => x.engine === "open" && families.includes(x.family ?? "") && (x.options.aspectRatios?.length ?? 0) > 1)) {
      for (const r of m.routes.filter((x) => x.provider === "comfyui")) expect(!!r.unsized, `${m.id} ${r.op}`).toBe(!sized(r.endpoint));
    }
  });

  it("Qwen-Image 2.1 inpaints and expands the picture alone: no reference is offered, and one sent is refused, not dropped", () => {
    const q = getModel("oss-qwen-image-21")!;
    expect([imageLimit(q, "edit"), imageLimit(q, "inpaint"), imageLimit(q, "outpaint"), imageLimit(q, undefined)]).toEqual([4, 1, 1, 4]);
    const masked: GenerationRequest = {
      feature: "edit",
      modelId: q.id,
      prompt: "the lamp from image 2",
      inputs: { images: ["/api/files/uploads/room.png", "/api/files/uploads/lamp.png"], mask: "/api/files/uploads/mask.png" },
    };
    expect(() => planGeneration(masked, getModel, getPreset)).toThrow("Qwen-Image 2.1 paints the masked area of one picture — remove the references, or clear the mask to edit with them");
    expect(planGeneration({ ...masked, inputs: { ...masked.inputs, images: masked.inputs!.images!.slice(0, 1) } }, getModel, getPreset).op).toBe("inpaint");
    // Without the mask the same two pictures are an edit with a reference.
    expect(planGeneration({ ...masked, inputs: { images: masked.inputs!.images } }, getModel, getPreset).op).toBe("edit");
  });
});

describe("Ideogram 4 as the Image studio's default", () => {
  const owner = (helper: string, local: unknown) => ({ llm: { helper, local } });

  it("is the default only where the server writes its caption with a local model", () => {
    expect(writesCaptions(undefined)).toBeUndefined();
    expect(writesCaptions(owner("auto", { kind: "ollama" }))).toBe(true);
    expect(writesCaptions(owner("auto", null))).toBe(false);
    expect(writesCaptions(owner("none", { kind: "ollama" }))).toBe(false);
    // An account or a guest never uses the install's LLM.
    expect(writesCaptions({ viewer: { kind: "account", gpu: { connected: true } } })).toBe(false);
    expect(writesCaptions({ viewer: { kind: "guest", gpu: { connected: false } } })).toBe(false);
  });

  it("gives way to Qwen-Image 2.1 without a caption writer; nothing changes while the status loads or in the cloud", () => {
    const d = IMAGE_STUDIO.defaultModels;
    expect(viewerDefaults(d, IMAGE_STUDIO.uncaptioned, false)).toEqual({ cloud: "nano-banana-pro", open: "oss-qwen-image-21" });
    expect(viewerDefaults(d, IMAGE_STUDIO.uncaptioned, true)).toBe(d);
    expect(viewerDefaults(d, IMAGE_STUDIO.uncaptioned, undefined)).toBe(d);
    expect(viewerDefaults(EDIT_STUDIO.defaultModels, EDIT_STUDIO.uncaptioned, false)).toBe(EDIT_STUDIO.defaultModels);
    const studio = { ...IMAGE_STUDIO, defaultModels: viewerDefaults(d, IMAGE_STUDIO.uncaptioned, false) };
    expect(best(studio, "open")).toEqual(["oss-qwen-image-21", "oss-ideogram-4", "oss-krea2-realism", "oss-moss-image"]);
  });
});

describe("skills and docs name the new open defaults", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("the agent skill's studio picks are Ideogram 4 and Qwen-Image 2.1", () => {
    expect(read(".agents/skills/fuobe/SKILL.md")).toMatch(/`oss-ideogram-4` \(open;[^)]*\); edits `nano-banana-pro` \/ `oss-qwen-image-21`/);
  });

  it("skills that edit on your GPU without a LoRA name Qwen-Image 2.1 first", () => {
    for (const skill of ["image-repurposer", "product-photoshoot", "thumbnail-generation", "amazon-listing-images", "ugc-video"]) {
      const text = read(`skills/${skill}/SKILL.md`);
      expect(text.indexOf("oss-qwen-image-21"), skill).toBeGreaterThan(-1);
      expect(text.indexOf("oss-qwen-image-21"), skill).toBeLessThan(text.indexOf("oss-qwen-edit"));
    }
  });
});
