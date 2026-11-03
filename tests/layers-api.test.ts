import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { elementDraft, initialDoc, nodesFromOutputs, placeOutput, placeTextBlocks, textBlocksFrom, type LayerDoc, type LayerJob, type LayerJobInput, type LayerProject, type LayerProjectView } from "@/lib/layers";
import { tempDir } from "./helpers/temp-dir";

// Route handlers are called directly, outside a Next request: connection() has nothing to wait for.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-layers-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const layers = await import("@/server/layers");
const list = await import("@/app/api/layers/route");
const one = await import("@/app/api/layers/[id]/route");
const versions = await import("@/app/api/layers/[id]/versions/route");
const jobs = await import("@/app/api/layers/[id]/jobs/route");
const job = await import("@/app/api/layers/[id]/jobs/[jobId]/route");
const renders = await import("@/app/api/layers/renders/route");

beforeAll(() => setSetting("demoMode", "auto"));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as any;
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/layers", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function settle(id: string, ms = 40_000): Promise<Generation> {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id, { includeDeleted: true })!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** A tiny real PNG (1×1) saved as an upload. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const upload = () => saveFile({ data: PNG, contentType: "image/png", name: "poster.png", source: "upload" }).url;

describe("job steps", () => {
  const frame: [number, number, number, number] = [0, 0, 1920, 1080];
  const steps = (i: Partial<LayerJobInput>) => layers.jobSteps({ tool: "decompose", engine: "cloud", frame, image: "/api/files/a.png", ...i } as LayerJobInput);

  it("decomposes with Seedream on cloud: resolution tier, mode and the layer count in the instruction", () => {
    const [s] = steps({ settings: { resolution: "2K", mode: "fast", layers: 8, aspect: "16:9" } });
    expect(s.request).toMatchObject({
      feature: "layers",
      modelId: "seedream-5-layers",
      op: "layers",
      inputs: { images: ["/api/files/a.png"] },
      params: { resolution: "auto_2K", extra: { enhance_prompt_mode: "fast" }, aspectRatio: "16:9" },
      step: { label: "Layers · Layer decomposition", index: 0, of: 1 },
    });
    expect(s.request.prompt).toContain("up to 8 layers");
    // Flash has no mode field; Qwen takes the count itself (8 at most across its hosts).
    expect(steps({ modelId: "seedream-5-flash-layers", settings: { mode: "fast" } })[0].request.params?.extra).toBeUndefined();
    expect(steps({ modelId: "qwen-image-layered-cloud", settings: { layers: 16 } })[0].request.params).toMatchObject({ numLayers: 8 });
  });

  it("decomposes with Qwen-Image-Layered on the open engine", () => {
    const [s] = steps({ engine: "open", settings: { resolution: "1.5K", mode: "fast", layers: 12 } });
    expect(s.request).toMatchObject({ modelId: "oss-qwen-layered", params: { numLayers: 10, extra: { steps: 10, maxSize: 832 } } });
    expect(s.request.prompt).toBeUndefined();
  });

  it("separates a layer by name with Layered-Control on the open engine", () => {
    const [s] = steps({ tool: "split", engine: "open", prompt: "the guitar" });
    expect(s.request).toMatchObject({ modelId: "oss-qwen-layered-control", prompt: "the guitar", params: { numLayers: 2 } });
    expect(steps({ tool: "split", engine: "open" })[0].request.modelId).toBe("oss-qwen-layered");
    expect(steps({ tool: "split", prompt: "the guitar" })[0].request.prompt).toMatch(/^Separate the guitar onto its own layer/);
  });

  it("routes what the Separate layer form sends: a named element on the open engine runs on Layered-Control", () => {
    // The form always sends the model it shows; the default is plain Qwen-Image-Layered.
    const [s] = steps({ tool: "split", engine: "open", modelId: "oss-qwen-layered", prompt: "the guitar", nodeId: "n1", settings: { resolution: "1K", mode: "standard", layers: 2 } });
    expect(s.request).toMatchObject({ modelId: "oss-qwen-layered-control", prompt: "the guitar", params: { numLayers: 2 } });
    expect(steps({ tool: "split", engine: "open", modelId: "oss-qwen-layered-control", prompt: "the face", settings: { layers: 3 } })[0].request).toMatchObject({ modelId: "oss-qwen-layered-control", params: { numLayers: 3 } });
    // Control needs a name: without one the plain model splits.
    expect(steps({ tool: "split", engine: "open", modelId: "oss-qwen-layered-control", settings: { layers: 4 } })[0].request).toMatchObject({ modelId: "oss-qwen-layered", params: { numLayers: 4 } });
    // A named element without a layer count: the element and the rest.
    expect(steps({ tool: "split", engine: "open", prompt: "the hat" })[0].request.params).toMatchObject({ numLayers: 2 });
  });

  it("sends Angles the camera the form shows for its model", () => {
    // Nano Banana Pro: a camera chip, no sliders.
    const nbp = steps({ tool: "angles", modelId: "nano-banana-pro", settings: { angle: "Back", keepAlpha: false } })[0].request;
    expect(nbp).toMatchObject({ modelId: "nano-banana-pro", op: "edit" });
    expect(nbp.prompt).toMatch(/^Show the exact same subject from a view from directly behind/);
    expect(nbp.params?.extra).toBeUndefined();
    // Qwen Multiple Angles: the sliders.
    const qwen = steps({ tool: "angles", modelId: "qwen-multiple-angles", settings: { rotate: 120, tilt: -10, zoom: 2 } })[0].request;
    expect(qwen.params?.extra).toEqual({ horizontal_angle: 120, vertical_angle: -10, zoom: 2 });
  });

  it("cuts the background back out after editing a transparent layer", () => {
    const s = steps({ tool: "regenerate", prompt: "Make it gold", refs: ["/api/files/ref.png"], settings: { keepAlpha: true } });
    expect(s.map((x) => [x.key, x.request.modelId, x.request.op, x.after])).toEqual([
      ["edit", "nano-banana-pro", "edit", undefined],
      ["cutout", "birefnet-cloud", "bg-remove", "edit"],
    ]);
    expect(s[0].request.inputs?.images).toEqual(["/api/files/a.png", "/api/files/ref.png"]);
    expect(s[0].request.prompt).toMatch(/^Make it gold Use image 2 as the reference\. Keep the subject/);
    expect(s[1].chain).toEqual([{ slot: "images" }]);
    expect(s.map((x) => x.request.step)).toEqual([
      { label: "Layers · Layer edit", index: 0, of: 2 },
      { label: "Layers · Layer edit · cut-out", index: 1, of: 2 },
    ]);
    const open = steps({ tool: "regenerate", engine: "open", prompt: "Make it gold", settings: { keepAlpha: true } });
    expect(open.map((x) => x.request.modelId)).toEqual(["oss-qwen-image-21", "oss-rmbg"]);
    expect(() => steps({ tool: "regenerate" })).toThrow(/layer edit prompt/);
  });

  it("generates a new transparent layer from text or a reference", () => {
    const t = steps({ tool: "generate-layer", engine: "open", image: undefined, prompt: "a red balloon" });
    // Qwen-Image 2.1 first: Ideogram 4's safety filter answers most lone objects on a plain background with a grey card.
    expect(t.map((x) => [x.request.modelId, x.request.op])).toEqual([
      ["oss-qwen-image-21", "t2i"],
      ["oss-rmbg", "bg-remove"],
    ]);
    expect(t[0].request.prompt).toMatch(/^a red balloon\. A single element, isolated/);
    const r = steps({ tool: "generate-layer", image: undefined, prompt: "this mug in blue", refs: ["/api/files/mug.png"] });
    expect(r[0].request).toMatchObject({ modelId: "nano-banana-pro", op: "edit", inputs: { images: ["/api/files/mug.png"] } });
  });

  it("edits text with the fixed instruction on both engines; detection reads the lines on either", () => {
    const rows = [{ from: "SALE", to: "OPEN" }];
    expect(steps({ tool: "text-edit", settings: { rows } })[0].request).toMatchObject({
      modelId: "nano-banana-pro",
      op: "edit",
      prompt: "Preserve the original design and change only the requested text. Change “SALE” to “OPEN”.",
    });
    expect(steps({ tool: "text-edit", engine: "open", settings: { rows } })[0].request.modelId).toBe("oss-qwen-image-21");
    expect(() => steps({ tool: "text-edit", settings: { rows: [{ from: "SALE", to: "SALE" }] } })).toThrow(/Change a line/);
    expect(steps({ tool: "text-detect", settings: { aspect: "16:9" } })[0].request).toMatchObject({ modelId: "ideogram-3-text-layers", op: "text-layers", params: { aspectRatio: "16:9" } });
    // OCR models read the lines (no shape to send): Florence-2 on the cloud, OvisOCR3 on ComfyUI.
    const florence = steps({ tool: "text-detect", modelId: "florence-2-ocr", settings: { aspect: "16:9" } })[0].request;
    expect(florence).toMatchObject({ modelId: "florence-2-ocr", op: "ocr", inputs: { images: ["/api/files/a.png"] } });
    expect(florence.params).toBeUndefined();
    expect(steps({ tool: "text-detect", engine: "open" })[0].request).toMatchObject({ modelId: "oss-ocr-lines", op: "ocr" });
    expect(() => steps({ tool: "text-detect", engine: "open", modelId: "ideogram-3-text-layers" })).toThrow(/can't run this tool/);
  });

  it("inpaints the painted area: the mask for mask models, the red-tinted copy for edit models", () => {
    const paint = { tool: "inpaint" as const, prompt: "a vase of tulips", mask: "/api/files/m.png", sketch: "/api/files/s.png" };
    const cloud = steps(paint)[0].request;
    expect(cloud).toMatchObject({
      modelId: "nano-banana-pro",
      op: "inpaint",
      prompt: "a vase of tulips. Blend it into the surroundings with matching light, perspective and grain.",
      inputs: { images: ["/api/files/a.png"], mask: "/api/files/m.png", sketch: "/api/files/s.png" },
    });
    expect(steps({ ...paint, modelId: "bria-fibo-2" })[0].request).toMatchObject({ modelId: "bria-fibo-2", op: "inpaint", inputs: { mask: "/api/files/m.png" } });
    expect(steps({ ...paint, engine: "open", modelId: "oss-flux-fill" })[0].request).toMatchObject({ modelId: "oss-flux-fill", op: "inpaint", inputs: { mask: "/api/files/m.png" } });
    const open = steps({ ...paint, engine: "open", settings: { keepAlpha: true } });
    expect(open.map((x) => [x.key, x.request.modelId, x.request.op])).toEqual([
      ["inpaint", "oss-qwen-image-21", "inpaint"],
      ["cutout", "oss-rmbg", "bg-remove"],
    ]);
    // Only the painted area changes: no plain-background ask, the cut-out restores the transparency.
    expect(open[0].request.prompt).toBe("a vase of tulips. Blend it into the surroundings with matching light, perspective and grain.");
    expect(open[1]).toMatchObject({ after: "inpaint", chain: [{ slot: "images" }] });
    expect(() => steps({ ...paint, mask: undefined })).toThrow(/Paint over the area/);
    expect(() => steps({ ...paint, prompt: " " })).toThrow(/fill the painted area/);
  });

  it("enhances with a retouch instruction, or restores detail with an upscaler", () => {
    const skin = steps({ tool: "enhance", settings: { look: "skin" } })[0].request;
    expect(skin).toMatchObject({ modelId: "nano-banana-pro", op: "edit", inputs: { images: ["/api/files/a.png"] } });
    expect(skin.prompt).toMatch(/^Give the portrait a subtle natural retouch.*Keep the face shape, identity/);
    expect(steps({ tool: "enhance", engine: "open", settings: { look: "sharpen" } })[0].request).toMatchObject({ modelId: "oss-qwen-image-21", op: "edit" });
    expect(steps({ tool: "enhance", engine: "open", settings: { look: "sharpen" } })[0].request.prompt).toMatch(/^Sharpen the image.*colours and lighting exactly the same\.$/);
    expect(steps({ tool: "enhance", prompt: "keep the freckles", settings: { look: "glow" } })[0].request.prompt).toMatch(/keep the freckles$/);
    // Detail: the Upscale tool's models (Topaz first, with its face pass), no instruction.
    const detail = steps({ tool: "enhance", settings: { look: "detail" } })[0].request;
    expect(detail).toMatchObject({ modelId: "topaz-image", op: "upscale-image" });
    expect(detail.prompt).toBeUndefined();
    // 2× on every engine: Topaz and SeedVR are 2× as listed, the open graphs (4× by default) get a scale.
    expect(detail.params?.extra).toBeUndefined();
    expect(steps({ tool: "enhance", engine: "open", settings: { look: "detail" } })[0].request).toMatchObject({ modelId: "oss-seedvr2-image", params: { extra: { scale: 2 } } });
    expect(steps({ tool: "enhance", engine: "open", modelId: "oss-upscale-image", settings: { look: "detail" } })[0].request.params).toMatchObject({ extra: { scale: 0.5 } });
    expect(() => steps({ tool: "enhance", modelId: "topaz-image", settings: { look: "skin" } })).toThrow(/can't run this tool/);
    // A transparent layer gets its cut-out back after a retouch.
    expect(steps({ tool: "enhance", settings: { look: "skin", keepAlpha: true } }).map((x) => x.key)).toEqual(["enhance", "cutout"]);
  });

  it("hands layers to the existing upscale, relight, angles, background and expand models", () => {
    // SeedVR2 restores detail as it enlarges (4x ESRGAN stays a choice).
    expect(steps({ tool: "upscale", engine: "open" })[0].request).toMatchObject({ modelId: "oss-seedvr2-image", op: "upscale-image" });
    expect(steps({ tool: "upscale", engine: "open", modelId: "oss-upscale-image" })[0].request).toMatchObject({ modelId: "oss-upscale-image", op: "upscale-image" });
    expect(steps({ tool: "bg-remove" })[0].request).toMatchObject({ modelId: "birefnet-cloud", op: "bg-remove" });
    // Relight: Qwen-Image 2.1 Turbo in its own picture tags; the Relight LoRA graph (a choice) gets the light alone.
    const relight = steps({ tool: "relight", engine: "open", settings: { light: "Neon night", direction: "Left" } })[0].request;
    expect(relight).toMatchObject({ modelId: "oss-qwen-image-21-turbo", op: "edit" });
    expect(relight.prompt).toMatch(/^Relight <image1> with pink and blue neon lights at night coming from the left\. Keep /);
    const lora = steps({ tool: "relight", engine: "open", modelId: "oss-qwen-relight", settings: { light: "Neon night", direction: "Left" } })[0].request;
    expect(lora).toMatchObject({ modelId: "oss-qwen-relight", op: "edit", prompt: "pink and blue neon lights at night, coming from the left" });
    const krea = steps({ tool: "relight", engine: "open", modelId: "oss-krea2-edit", settings: { light: "Neon night" } })[0].request;
    expect(krea.prompt).toMatch(/^Relight the image with pink and blue neon lights at night\. Keep the subject/);
    expect(steps({ tool: "relight", modelId: "nano-banana-2-1", settings: { light: "Neon night" } })[0].request).toMatchObject({ modelId: "nano-banana-2-1", op: "edit" });
    const angles = steps({ tool: "angles", settings: { rotate: 90, tilt: 10, zoom: 4 } })[0].request;
    expect(angles).toMatchObject({ modelId: "qwen-multiple-angles", params: { extra: { horizontal_angle: 90, vertical_angle: 10, zoom: 4 } } });
    // On your GPU: Qwen-Image 2.1 (25 steps) on the same plain camera words, no LoRA.
    const turned = steps({ tool: "angles", engine: "open", settings: { angle: "Back" } })[0].request;
    expect(turned).toMatchObject({ modelId: "oss-qwen-image-21", op: "edit" });
    expect(turned.prompt).toMatch(/^Show the exact same subject from a view from directly behind, as if the camera physically moved\./);
    expect(turned.loras).toBeUndefined();
    const expand = steps({ tool: "expand", engine: "open", settings: { pads: { left: 64, top: 0, right: 64, bottom: 8 } } })[0].request;
    expect(expand).toMatchObject({ modelId: "oss-qwen-image-21", op: "outpaint", params: { extra: { padLeft: 64, padTop: 0, padRight: 64, padBottom: 8 } } });
    // FLUX.1 Fill grows the canvas from the same pads.
    expect(steps({ tool: "expand", engine: "open", modelId: "oss-flux-fill", settings: { pads: { left: 64, top: 0, right: 64, bottom: 8 } } })[0].request).toMatchObject({
      modelId: "oss-flux-fill",
      op: "outpaint",
      params: { extra: { padLeft: 64 } },
    });
    expect(() => steps({ tool: "expand", engine: "open", settings: { pads: { left: 0, top: 0, right: 0, bottom: 0 } } })).toThrow(/Drag an edge/);
    expect(steps({ tool: "expand" })[0].request.prompt).toMatch(/^Fill the empty grey margins/);
    expect(steps({ tool: "expand" })[0].request.prompt).toMatch(/fill the margins with more of the same surroundings\.$/);
    expect(steps({ tool: "regional", prompt: "add a hat" })[0].request).toMatchObject({ modelId: "seedream-5-pro", op: "edit" });
    // Regional edit on your GPU: Qwen-Image 2.1 first, then Krea 2 Edit and FIBO 2 Edit Turbo, one picture each. Layer edit
    // takes FIBO 2 Edit Turbo too, with its references.
    expect(steps({ tool: "regional", engine: "open", prompt: "add a hat" })[0].request).toMatchObject({ modelId: "oss-qwen-image-21", op: "edit" });
    for (const modelId of ["oss-krea2-edit", "oss-fibo2-edit-turbo"]) {
      expect(steps({ tool: "regional", engine: "open", modelId, prompt: "add a hat" })[0].request).toMatchObject({ modelId, op: "edit", inputs: { images: ["/api/files/a.png"] } });
    }
    expect(steps({ tool: "regenerate", engine: "open", modelId: "oss-fibo2-edit-turbo", prompt: "a red coat" })[0].request).toMatchObject({ modelId: "oss-fibo2-edit-turbo", op: "edit" });
    expect(() => steps({ tool: "regenerate", engine: "open", modelId: "oss-krea2-edit", prompt: "a red coat" })).toThrow(/can't run this tool/);
    expect(() => steps({ tool: "regional", engine: "open", modelId: "oss-qwen-edit", prompt: "add a hat" })).toThrow(/can't run this tool/);
    expect(steps({ tool: "generate-layer", engine: "open", modelId: "oss-moss-image", prompt: "a lamp" })[0].request).toMatchObject({ modelId: "oss-moss-image", op: "t2i" });
  });

  it("only sends a shape the model accepts", () => {
    // Nano Banana Pro lists 16:9 but not an odd crop's shape.
    expect(steps({ tool: "regional", modelId: "nano-banana-pro", prompt: "x", settings: { aspect: "16:9" } })[0].request.params?.aspectRatio).toBe("16:9");
    expect(steps({ tool: "regional", modelId: "nano-banana-pro", prompt: "x", settings: { aspect: "317:211" } })[0].request.params?.aspectRatio).toBeUndefined();
    expect(() => steps({ modelId: "nano-banana-pro" })).toThrow(/can't run this tool/);
  });
});

describe("layers API", () => {
  let source = "";
  let id = "";
  let view: LayerProjectView;

  it("opens an image as a project and lists it", async () => {
    source = upload();
    let res = await list.POST(req("POST", { source, width: 1920, height: 1080, name: "Summer poster" }));
    expect(res.status).toBe(201);
    view = (await res.json()) as LayerProjectView;
    id = view.project.id;
    expect(view.project).toMatchObject({ name: "Summer poster", sourceUrl: source, coverUrl: source, width: 1920, height: 1080, layers: 1, status: "ready" });
    expect(view.versions.map((v) => v.label)).toEqual(["Original"]);
    expect(view.doc).toMatchObject({ width: 1920, height: 1080, decomposed: false, source });
    expect(view.jobs).toEqual([]);

    res = await list.GET();
    const items = ((await res.json()) as { items: LayerProject[] }).items;
    expect(items.map((p) => p.id)).toEqual([id]);

    // Only stored images open here.
    res = await list.POST(req("POST", { source: "http://example.com/a.png", width: 10, height: 10 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Only images can be edited here/);
  });

  it("decomposes in demo mode, then the editor's version marks the job applied", async () => {
    let res = await jobs.POST(req("POST", { tool: "decompose", engine: "cloud", image: source, frame: [0, 0, 1920, 1080], settings: { layers: 4, aspect: "16:9" } }), ctx({ id }));
    expect(res.status).toBe(201);
    const started = (await res.json()) as LayerJob;
    expect(started).toMatchObject({ tool: "decompose", state: "pending", label: "Layer decomposition" });
    expect(started.generationIds).toHaveLength(1);

    // The card says it's processing; a second decomposition is refused while it runs.
    res = await list.GET();
    expect(((await res.json()) as { items: LayerProject[] }).items[0].status).toBe("processing");
    res = await jobs.POST(req("POST", { tool: "decompose", engine: "cloud", image: source, frame: [0, 0, 1920, 1080] }), ctx({ id }));
    expect(res.status).toBe(409);

    const g = await settle(started.generationIds[0]);
    expect(g.status).toBe("succeeded");
    expect(g.feature).toBe("layers");
    expect(g.batchId).toBe(`layers-${id}`);
    res = await one.GET(req("GET"), ctx({ id }));
    view = (await res.json()) as LayerProjectView;
    const j = view.jobs[0];
    expect(j.result?.status).toBe("succeeded");
    expect(j.result?.outputs.length).toBeGreaterThanOrEqual(3);
    expect(j.result?.outputs[1].meta).toMatchObject({ name: "Subject", z: 1 });

    // What the editor does: place each layer (demo layers are 1024×576 full canvases with pixel boxes).
    let n = 0;
    const nodes = nodesFromOutputs(
      j.result!.outputs.map((o) => ({ url: o.url, meta: o.meta, natural: [1024, 576] as [number, number], placement: placeOutput(j.frame, [1024, 576], o.meta) })),
      { id: () => `L${++n}`, label: "Decomposed", at: Date.now() },
    );
    const doc: LayerDoc = { ...view.doc, decomposed: true, nodes };
    res = await versions.POST(req("POST", { doc, label: "Decomposed", jobId: j.id }), ctx({ id }));
    expect(res.status).toBe(201);
    view = (await res.json()) as LayerProjectView;
    expect(view.versions.map((v) => v.label)).toEqual(["Decomposed", "Original"]);
    expect(view.headVersionId).toBe(view.versions[0].id);
    expect(view.doc.nodes.map((x) => x.name)).toEqual(nodes.map((x) => x.name));
    expect(view.jobs[0].state).toBe("applied");
    expect(view.project).toMatchObject({ status: "ready", layers: nodes.length });

    // Applying twice is refused; decomposing again too.
    res = await versions.POST(req("POST", { doc, label: "Decomposed", jobId: j.id }), ctx({ id }));
    expect(res.status).toBe(409);
    res = await jobs.POST(req("POST", { tool: "decompose", engine: "cloud", image: source, frame: [0, 0, 1920, 1080] }), ctx({ id }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/can only be decomposed once/);
  });

  it("reads the text on the open engine and inpaints with either kind of model, in demo mode", async () => {
    const frame = [0, 0, 1920, 1080];
    let res = await jobs.POST(req("POST", { tool: "text-detect", engine: "open", image: source, frame, label: "Detect text" }), ctx({ id }));
    expect(res.status).toBe(201);
    const detect = (await res.json()) as LayerJob;
    const g = await settle(detect.generationIds[0]);
    expect(g).toMatchObject({ modelId: "oss-ocr-lines", op: "ocr", status: "succeeded" });
    // What Edit text lists: the lines with their boxes, laid out in the frame the detector read.
    const rows = placeTextBlocks(textBlocksFrom(g.outputs[0].meta), detect.frame);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].box).toEqual([expect.closeTo(153.6, 1), expect.closeTo(108, 1), expect.closeTo(998.4, 1), expect.closeTo(97.2, 1)]);

    // Inpaint: Nano Banana Pro is shown the painted area tinted red; Bria FIBO 2 takes the mask itself.
    const mask = upload();
    const sketch = upload();
    const paint = { tool: "inpaint", engine: "cloud", image: source, mask, sketch, prompt: "a vase of tulips", frame, settings: { aspect: "16:9" } };
    res = await jobs.POST(req("POST", paint), ctx({ id }));
    expect(res.status).toBe(201);
    const nano = gens.getGeneration(((await res.json()) as LayerJob).generationIds[0])!;
    expect(nano).toMatchObject({ modelId: "nano-banana-pro", op: "edit" });
    expect(nano.request.inputs).toMatchObject({ images: [source], sketch });
    expect(nano.prompt).toMatch(/Only change the region tinted red in image 2/);
    res = await jobs.POST(req("POST", { ...paint, modelId: "bria-fibo-2" }), ctx({ id }));
    const fill = gens.getGeneration(((await res.json()) as LayerJob).generationIds[0])!;
    expect(fill).toMatchObject({ modelId: "bria-fibo-2", op: "inpaint" });
    expect(fill.request.inputs).toMatchObject({ images: [source], mask });
    // Only stored files can be painted with.
    res = await jobs.POST(req("POST", { ...paint, mask: "http://evil.example/m.png" }), ctx({ id }));
    expect(res.status).toBe(400);
  });

  it("saves a layer's PNG as an element", async () => {
    const elements = await import("@/app/api/elements/route");
    const png = upload();
    const draft = elementDraft({ name: "Woman in red coat · part 1", z: 2 });
    const res = await elements.POST(new Request("http://localhost/api/elements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, references: [png] }) }));
    expect(res.status).toBe(201);
    const el = (await res.json()) as { id: string; handle: string; kind: string; references: string[] };
    expect(el).toMatchObject({ handle: "Woman_in_red_coat", kind: "character", references: [png] });
    // The element keeps its PNG: the file counts as in use.
    expect(gens.assetInUse(png.split("/").pop()!.replace(/\.png$/, ""))).toBeTruthy();
  });

  it("autosaves into the head version and refuses stale or foreign documents", async () => {
    const moved: LayerDoc = { ...view.doc, nodes: view.doc.nodes.map((x, i) => (i === 1 ? { ...x, x: x.x + 40, name: "Hero" } : x)) };
    let res = await one.PATCH(req("PATCH", { doc: moved, versionId: view.headVersionId, name: "Summer poster v2" }), ctx({ id }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as LayerProject).name).toBe("Summer poster v2");
    res = await one.GET(req("GET"), ctx({ id }));
    const after = (await res.json()) as LayerProjectView;
    expect(after.doc.nodes[1].name).toBe("Hero");
    expect(after.versions).toHaveLength(2);

    // Another tab saved a version since: this one's head is stale.
    res = await one.PATCH(req("PATCH", { doc: moved, versionId: after.versions[1].id }), ctx({ id }));
    expect(res.status).toBe(409);
    // Files from elsewhere are refused.
    res = await one.PATCH(req("PATCH", { doc: { ...moved, nodes: [{ ...moved.nodes[0], src: "http://evil.example/x.png" }] } }), ctx({ id }));
    expect(res.status).toBe(400);
    // A stored-file path can't smuggle quotes or brackets into the thumbnails' CSS url().
    res = await one.PATCH(req("PATCH", { doc: { ...moved, nodes: [{ ...moved.nodes[0], src: '/api/files/x.png"),url(http://evil.example/' }] } }), ctx({ id }));
    expect(res.status).toBe(400);
    res = await one.PATCH(req("PATCH", { doc: { ...initialDoc("/api/files/other.png", 10, 10) } }), ctx({ id }));
    expect(res.status).toBe(400);
  });

  it("runs one job per layer at a time, and cancels on request", async () => {
    const layer = view.doc.nodes[1];
    const body = { tool: "regenerate", engine: "open", image: source, nodeId: layer.id, frame: [layer.x, layer.y, layer.w, layer.h], prompt: "Make it gold", settings: { keepAlpha: true } };
    let res = await jobs.POST(req("POST", body), ctx({ id }));
    expect(res.status).toBe(201);
    const started = (await res.json()) as LayerJob;
    expect(started.generationIds).toHaveLength(2);
    res = await jobs.POST(req("POST", body), ctx({ id }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("A generation is already running on this layer");

    res = await job.DELETE(req("DELETE"), ctx({ id, jobId: started.id }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as LayerJob).state).toBe("dismissed");
    for (const g of started.generationIds) expect(gens.getGeneration(g)?.status).toBe("canceled");
    // Free again.
    res = await jobs.POST(req("POST", { ...body, settings: {} }), ctx({ id }));
    expect(res.status).toBe(201);
    const second = (await res.json()) as LayerJob;
    res = await job.PATCH(req("PATCH", { state: "dismissed" }), ctx({ id, jobId: second.id }));
    expect(((await res.json()) as LayerJob).state).toBe("dismissed");
    // A run that failed or was canceled elsewhere is retired when the tool runs again on that layer.
    const third = (await (await jobs.POST(req("POST", { ...body, settings: {} }), ctx({ id }))).json()) as LayerJob;
    await gens.cancelGeneration(third.generationIds[0]);
    res = await jobs.POST(req("POST", { ...body, settings: {} }), ctx({ id }));
    expect(res.status).toBe(201);
    const after = (await (await one.GET(req("GET"), ctx({ id }))).json()) as LayerProjectView;
    expect(after.jobs.find((j) => j.id === third.id)?.state).toBe("dismissed");
    for (const j of after.jobs.filter((x) => x.state === "pending")) await job.DELETE(req("DELETE"), ctx({ id, jobId: j.id }));
    // Validation errors come back as 400 with a reason.
    res = await jobs.POST(req("POST", { tool: "regional", engine: "cloud", image: source, frame: [0, 0, 10, 10] }), ctx({ id }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Describe your changes/);
  });

  it("keeps a small cover of the composite for the card, and names projects after their image", async () => {
    const cover = `data:image/jpeg;base64,${Buffer.from("not really a jpeg").toString("base64")}`;
    let res = await one.PATCH(req("PATCH", { cover }), ctx({ id }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as LayerProject).coverUrl).toBe(cover);
    res = await one.PATCH(req("PATCH", { cover: "javascript:alert(1)" }), ctx({ id }));
    expect(res.status).toBe(400);
    // No name given: the uploaded file's name ("poster.png").
    res = await list.POST(req("POST", { source: upload(), width: 10, height: 10 }));
    expect(((await res.json()) as LayerProjectView).project.name).toBe("Poster");
  });

  it("restores an older version as a new head", async () => {
    const original = view.versions[view.versions.length - 1];
    const res = await versions.POST(req("POST", { from: original.id }), ctx({ id }));
    expect(res.status).toBe(201);
    const v = (await res.json()) as LayerProjectView;
    expect(v.versions[0].label).toBe("Restored “Original”");
    expect(v.doc.nodes).toHaveLength(1);
    expect(v.doc.decomposed).toBe(false);
    // The image was decomposed all the same: that's the project's, not the version's.
    expect(v.project.decomposed).toBe(true);
    const again = await jobs.POST(req("POST", { tool: "decompose", engine: "cloud", image: source, frame: [0, 0, 1920, 1080] }), ctx({ id }));
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toMatch(/can only be decomposed once/);
  });

  it("counts separating the original picture as its decomposition", async () => {
    const src = upload();
    let res = await list.POST(req("POST", { source: src, width: 64, height: 48 }));
    const v0 = (await res.json()) as LayerProjectView;
    const pid = v0.project.id;
    expect(v0.project.decomposed).toBe(false);
    res = await jobs.POST(req("POST", { tool: "split", engine: "cloud", image: src, nodeId: "original", frame: [0, 0, 64, 48], prompt: "the cup" }), ctx({ id: pid }));
    expect(res.status).toBe(201);
    const split = (await res.json()) as LayerJob;
    await settle(split.generationIds[0]);
    res = await versions.POST(req("POST", { doc: { ...v0.doc, decomposed: true }, label: split.label, jobId: split.id }), ctx({ id: pid }));
    expect(((await res.json()) as LayerProjectView).project.decomposed).toBe(true);
    // Restoring the original version doesn't make it decomposable again.
    res = await versions.POST(req("POST", { from: v0.headVersionId }), ctx({ id: pid }));
    expect(((await res.json()) as LayerProjectView).doc.decomposed).toBe(false);
    res = await jobs.POST(req("POST", { tool: "decompose", engine: "cloud", image: src, frame: [0, 0, 64, 48] }), ctx({ id: pid }));
    expect(res.status).toBe(409);
    await one.DELETE(req("DELETE"), ctx({ id: pid }));
  });

  it("saves where the original sits in the document", async () => {
    const src = upload();
    const v0 = (await (await list.POST(req("POST", { source: src, width: 64, height: 48 }))).json()) as LayerProjectView;
    expect(v0.doc.sourceBox).toEqual([0, 0, 64, 48]);
    const grown: LayerDoc = { ...v0.doc, width: 96, sourceBox: [16, 0, 64, 48], nodes: v0.doc.nodes.map((x) => ({ ...x, x: 16 })) };
    const res = await one.PATCH(req("PATCH", { doc: grown, versionId: v0.headVersionId }), ctx({ id: v0.project.id }));
    expect(res.status).toBe(200);
    const after = (await (await one.GET(req("GET"), ctx({ id: v0.project.id }))).json()) as LayerProjectView;
    expect(after.doc.sourceBox).toEqual([16, 0, 64, 48]);
    await one.DELETE(req("DELETE"), ctx({ id: v0.project.id }));
  });

  it("opens a finished layers result as a project", async () => {
    const g = gens.createGenerations({ feature: "image", modelId: "seedream-5-layers", op: "layers", inputs: { images: [source] }, params: { aspectRatio: "1:1" } })[0];
    await settle(g.id);
    const res = await list.POST(req("POST", { source, width: 512, height: 512, generationId: g.id }));
    expect(res.status).toBe(201);
    const v = (await res.json()) as LayerProjectView;
    expect(v.jobs).toHaveLength(1);
    expect(v.jobs[0]).toMatchObject({ tool: "decompose", state: "pending", generationIds: [g.id], frame: [0, 0, 512, 512] });
    expect(v.jobs[0].result?.status).toBe("succeeded");
    // Until the editor lays the layers out, the card says they're ready to see (not “Processing…” for good).
    expect(v.project).toMatchObject({ status: "unopened", layers: 1 });
    expect(v.project.pendingLayers).toBe(v.jobs[0].result?.outputs.filter((o) => o.kind === "image").length);
    const card = ((await (await list.GET()).json()) as { items: LayerProject[] }).items.find((p) => p.id === v.project.id);
    expect(card?.status).toBe("unopened");
    const bad = await list.POST(req("POST", { source, width: 512, height: 512, generationId: "nope" }));
    expect(bad.status).toBe(400);
  });

  it("keeps the files a project uses, and deletes only the project", async () => {
    const asset = source.split("/").pop()!.split(".")[0];
    expect(gens.assetInUse(asset)).toBe(true);
    const made = view.jobs[0].generationIds[0];
    let res = await one.DELETE(req("DELETE"), ctx({ id }));
    expect(res.status).toBe(204);
    res = await one.GET(req("GET"), ctx({ id }));
    expect(res.status).toBe(404);
    // The generations it made stay in the library.
    expect(gens.getGeneration(made)?.status).toBe("succeeded");
    res = await one.DELETE(req("DELETE"), ctx({ id }));
    expect(res.status).toBe(404);
  });
});

describe("pictures the editor renders for models", () => {
  const post = (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return renders.POST(new Request("http://localhost/api/layers/renders", { method: "POST", body: form }));
  };

  it("are stored as derived files: kept out of Uploads and the pickers, still served", async () => {
    const res = await post(new File([PNG], "layers-subject.png", { type: "image/png" }));
    expect(res.status).toBe(201);
    const a = (await res.json()) as { id: string; url: string; source: string };
    expect(a).toMatchObject({ source: "derived" });
    expect(a.url).toMatch(/^\/api\/files\/uploads\/.+\.png$/);
    const { listAssets, getAsset } = await import("@/server/storage");
    expect(getAsset(a.id)?.source).toBe("derived");
    // The Library's Uploads tab (source=upload) and the pickers (every source) don't list it.
    expect(listAssets({ source: "upload" }).some((x) => x.id === a.id)).toBe(false);
    expect(listAssets({}).some((x) => x.id === a.id)).toBe(false);
    expect(listAssets({ source: "derived" }).some((x) => x.id === a.id)).toBe(true);
    // Uploads still list.
    const up = upload();
    expect(listAssets({ source: "upload" }).some((x) => x.url === up)).toBe(true);
  });

  it("only takes PNGs", async () => {
    expect((await post(new File([Buffer.from("<svg/>")], "x.png", { type: "image/png" }))).status).toBe(415);
    expect((await post(new File([PNG], "x.jpg", { type: "image/jpeg" }))).status).toBe(415);
  });
});
