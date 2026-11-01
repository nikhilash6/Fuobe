import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation, GenInput } from "@/lib/catalog/types";

/*
 * The Vectorize app: Recraft Vectorize on the cloud, VTracer through ComfyUI (image-vectorize-vtracer)
 * on the open engine; SVG results are stored, served, listed and downloaded as .svg.
 */

vi.setConfig({ testTimeout: 60_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-vectorize-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile, readRef } = await import("@/server/storage");
const { collectOutputs, loadManifest, prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel, getPreset } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { buildPayload, extractOutputs } = await import("@/lib/catalog/payload");
const { outputActions } = await import("@/lib/output-actions");
const { appStudio } = await import("@/lib/studios");
const { withRecipe } = await import("@/lib/catalog/preset-recipes");
const { studioCatalog } = await import("@/lib/studio-catalog");
const files = await import("@/app/api/files/[...path]/route");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function settle(id: string, ms = 40_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201a2e2b6a40000000049454e44ae426082", "hex");

describe("Vectorize app", () => {
  const app = getPreset("app-vectorize")!;

  it("runs Recraft Vectorize on the cloud and VTracer on the open engine, with no prompt", () => {
    expect(app).toMatchObject({ type: "app", name: "Vectorize", userPrompt: "none", cloud: { modelId: "recraft-vectorize", op: "vectorize" }, open: { modelId: "oss-vtracer", op: "vectorize" } });
    expect(app.inputs).toEqual([{ key: "image", label: "Image", hint: "A logo, icon or flat illustration works best", accept: "image", required: true }]);
    for (const modelId of ["recraft-vectorize", "oss-vtracer"]) {
      const plan = planGeneration({ feature: "app:app-vectorize", presetId: app.id, modelId, inputs: { images: ["/a.png"] } }, getModel, getPreset);
      expect(plan.op, modelId).toBe("vectorize");
      expect(plan.jobs).toBe(1);
    }
    expect(() => planGeneration({ feature: "app:app-vectorize", presetId: app.id, modelId: "oss-vtracer" }, getModel, getPreset)).toThrow(/Add the image to turn into an SVG/);
    // The app page knows both models (the studio slice carries them), and VTracer is an open model of its own. A tool keeps
    // its own models: no other model is listed first.
    const config = withRecipe(appStudio(app), (id) => !!getModel(id));
    expect(config.defaultModels).toEqual({ cloud: "recraft-vectorize", open: "oss-vtracer" });
    expect(config.appModels).toEqual({ cloud: ["recraft-vectorize"], open: ["oss-vtracer"] });
    expect(studioCatalog(config).models.map((m) => m.id)).toEqual(expect.arrayContaining(["recraft-vectorize", "oss-vtracer"]));
    expect(getModel("oss-vtracer")).toMatchObject({ engine: "open", kind: "image" });
    expect(getModel("oss-vtracer")!.hidden).toBeFalsy();
  });

  it("the open workflow is validated and binds the image, curves, colours and specks", async () => {
    const wf = loadManifest().workflows.find((w) => w.id === "image-vectorize-vtracer")!;
    expect(wf).toMatchObject({ validated: true, capability: "vectorize", vramGb: 0, customNodes: [{ name: "ComfyUI-ToSVG", repo: "https://github.com/Yanick112/ComfyUI-ToSVG" }] });
    expect(wf.models).toEqual([]);
    const uploads: string[] = [];
    const input = { images: ["logo.png"], extra: { curveMode: "polygon", colorPrecision: 3, filterSpeckle: 8 } } as GenInput;
    const { workflow } = await prepareWorkflow("image-vectorize-vtracer", input, {
      generationId: "gen1",
      op: "vectorize",
      upload: async (_d, _t, name) => {
        uploads.push(name);
        return name;
      },
    });
    expect(workflow["1"].inputs.image).toBe("logo.png");
    expect(workflow["2"].class_type).toBe("TS_ImageToSVGStringColor_Vtracer");
    expect(workflow["2"].inputs).toMatchObject({ mode: "polygon", color_precision: 3, filter_speckle: 8, hierarchical: "stacked" });
    expect(workflow["4"]).toMatchObject({ class_type: "SaveSVGNode", inputs: { filename_prefix: "fuobe/gen1", svg: ["3", 0] } });
    expect(uploads).toEqual([]);
    await expect(prepareWorkflow("image-vectorize-vtracer", {} as GenInput, { generationId: "g", op: "vectorize", upload: async () => "x" })).rejects.toThrow(/Add an image/);
  });

  it("collects the saved SVG as an image (SaveSVGNode reports it under images); fal's SVG too", () => {
    const wf = loadManifest().workflows.find((w) => w.id === "image-vectorize-vtracer")!;
    const outs = collectOutputs({ status: { status_str: "success", completed: true }, outputs: { "4": { images: [{ filename: "gen1_00001_.svg", subfolder: "fuobe", type: "output" }] } } }, wf, "http://comfy.test:8188");
    expect(outs).toEqual([{ url: "http://comfy.test:8188/view?filename=gen1_00001_.svg&subfolder=fuobe&type=output", kind: "image", headers: {} }]);
    expect(buildPayload(getModel("recraft-vectorize")!.routes[0].map!, { images: ["https://x/logo.png"] })).toEqual({ image_url: "https://x/logo.png" });
    expect(extractOutputs({ image: { url: "https://v3.fal.media/files/logo.svg", content_type: "image/svg+xml" } }, "vectorize")[0]).toMatchObject({ kind: "image", url: "https://v3.fal.media/files/logo.svg" });
  });

  it("a demo run stores an SVG that is served safely and downloads as .svg", async () => {
    const img = saveFile({ data: png, contentType: "image/png", name: "logo.png", source: "upload" }).url;
    const [g] = gens.createGenerations({ feature: "app:app-vectorize", presetId: "app-vectorize", modelId: "oss-vtracer", inputs: { images: [img] } });
    expect(g.costUsd).toBe(0);
    const done = await settle(g.id);
    expect(done.status, done.error ?? "").toBe("succeeded");
    const out = done.outputs[0];
    expect(out).toMatchObject({ kind: "image", contentType: "image/svg+xml" });
    expect(out.url).toMatch(/^\/api\/files\/outputs\/.+\.svg$/);
    expect((await readRef(out.url)).data.toString("utf8")).toMatch(/^<svg/);
    // Served as an SVG that can't run scripts when opened on its own.
    const parts = out.url.replace(/^\/api\/files\//, "").split("/");
    const res = await files.GET(new Request(`http://localhost${out.url}`), { params: Promise.resolve({ path: parts }) } as never);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toMatch(/^<svg/);
    // The viewer's and the Library's download names it .svg.
    const download = outputActions(done, 0).find((a) => a.id === "download")!;
    expect(download.download).toMatch(/\.svg$/);
    expect(download.href).toContain(`${out.url}?download=`);
    // No raster hand-offs (Animate, Edit, Upscale…): those models can't read an SVG. A skill can be made from it (W2).
    expect(outputActions(done, 0).map((a) => `${a.placement}:${a.id}`)).toEqual(["bar:download", "bar:favorite", "menu:make-skill", "menu:copy-prompt", "menu:share", "menu:pin", "menu:review", "menu:delete"]);
    expect(download.label).toBe("Download .svg");
  });
});
