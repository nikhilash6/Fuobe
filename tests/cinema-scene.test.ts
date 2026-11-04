import { beforeAll, describe, expect, it } from "vitest";
import type { CinemaGenerateInput } from "@/lib/catalog/cinema";
import { tempDir } from "./helpers/temp-dir";

/** Cinema Studio's 3D scene: "Create 3D scene" on a still, then Capture → recomposition, on both engines. */

const dir = tempDir("fuobe-cinema-scene-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const cinema = await import("@/server/cinema");
const { generateInProject } = await import("@/server/cinema-generate");
const generateRoute = await import("@/app/api/cinema/projects/[id]/generate/route");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const { planCinema, RECOMPOSE_MODELS, SCENE_DECIMATION } = await import("@/lib/catalog/cinema");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});

const STILL = "/api/files/uploads/still.png";
const CAPTURE = "/api/files/uploads/capture.png";
const ctx = { cloudAllowed: true };
const base = { mode: "image" as const, prompt: "", settings: {}, aspectRatio: "16:9" };
const scene = (engine: "cloud" | "open"): CinemaGenerateInput => ({ ...base, engine, action: "scene", source: { url: STILL, kind: "image" } });
const capture = { url: CAPTURE, lens: 85, aperture: 1.4, pose: { horizontal: 45, vertical: 30, zoom: 7 } };
const recompose = (engine: "cloud" | "open", over: Partial<CinemaGenerateInput> = {}): CinemaGenerateInput => ({
  ...base,
  engine,
  action: "recompose",
  source: { url: STILL, kind: "image" },
  capture,
  ...over,
});

describe("planning a 3D scene", () => {
  it("cloud: one Marigold depth map of the still, priced before it runs", () => {
    const plan = planCinema(scene("cloud"), ctx);
    expect(plan.blocker).toBeUndefined();
    expect(plan.model.id).toBe("marigold-depth");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].request).toMatchObject({ feature: "cinema-scene", op: "scene-3d", inputs: { images: [STILL] }, params: { aspectRatio: "16:9", numOutputs: 1 } });
    expect(plan.costUsd).toBe(0.03);
    expect(plan.notes[0]).toMatch(/your browser turns it and the still into a 3D point cloud/);
  });

  it("open: one MoGe 2 mesh, thinned for phones, and free", () => {
    const plan = planCinema(scene("open"), ctx);
    expect(plan.model.id).toBe("oss-scene-moge");
    expect(plan.steps[0].request.params?.extra).toEqual({ decimation: SCENE_DECIMATION });
    expect(plan.costUsd).toBe(0);
    expect(plan.outputs).toBe(1);
  });

  it("needs a still", () => {
    expect(planCinema({ ...scene("cloud"), source: undefined }, ctx).blocker).toBe("Pick a still to build the scene from");
    expect(planCinema({ ...scene("open"), source: { url: "/api/files/x.mp4", kind: "video" } }, ctx).blocker).toBe("Pick a still to build the scene from");
  });
});

describe("planning a recomposition", () => {
  it("cloud default: Nano Banana Pro gets the capture first and the still second, with the re-render prompt", () => {
    const plan = planCinema(recompose("cloud", { prompt: "make it dusk" }), ctx);
    expect(RECOMPOSE_MODELS.cloud[0]).toBe("nano-banana-pro");
    expect(plan.model.id).toBe("nano-banana-pro");
    const req = plan.steps[0].request;
    expect(req).toMatchObject({ feature: "cinema-recompose", op: "edit", inputs: { images: [CAPTURE, STILL] }, params: { aspectRatio: "16:9", resolution: "1K", numOutputs: 1 } });
    expect(req.prompt).toMatch(/^Re-render this exact camera view of the scene photorealistically\./);
    expect(req.prompt).toContain("85 mm portrait telephoto lens at f/1.4");
    expect(req.prompt).toMatch(/make it dusk\.$/);
    expect(req.loras).toBeUndefined();
    expect(plan.costUsd).toBe(0.15);
  });

  it("cloud Qwen Multiple Angles: the still and the flown angles, said in a note", () => {
    const plan = planCinema(recompose("cloud", { modelId: "qwen-multiple-angles" }), ctx);
    const req = plan.steps[0].request;
    expect(req.inputs?.images).toEqual([STILL]);
    expect(req.params?.extra).toEqual({ horizontal_angle: 45, vertical_angle: 30, zoom: 7 });
    expect(req.prompt).toMatch(/^Keep the same subjects/);
    expect(plan.notes.join(" ")).toMatch(/\(45° round, 30° up, zoom 7\) — the capture itself isn't sent/);
    expect(plan.costUsd).toBe(0.035);
  });

  it("open: Qwen-Image-Edit 2511 with the Multiple-Angles LoRA at its reference pose (the capture is the view), free", () => {
    const plan = planCinema(recompose("open", { modelId: "nano-banana-pro" }), ctx);
    expect(plan.model.id).toBe("oss-qwen-edit");
    const req = plan.steps[0].request;
    expect(req.inputs?.images).toEqual([CAPTURE, STILL]);
    expect(req.loras?.[0].file).toBe("qwen-image-edit-2511-multiple-angles-lora.safetensors");
    // The capture is already 45° round and 30° up: the LoRA keeps its camera instead of turning it again.
    expect(req.prompt).toMatch(/^<sks> front view eye-level shot medium shot\. Re-render this exact camera view/);
    expect(plan.notes.join(" ")).toMatch(/re-renders your capture from its own camera/);
    expect(plan.costUsd).toBe(0);
  });

  it("waits for a capture", () => {
    expect(planCinema(recompose("cloud", { capture: undefined }), ctx).blocker).toBe("Capture a view first");
    expect(planCinema(recompose("open", { source: undefined }), ctx).blocker).toBe("Pick the scene's still");
  });
});

const json = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function settle(id: string, ms = 30_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** A small grey PNG saved as an upload (the still, or a capture). */
const upload = (name: string) => saveFile({ data: encodePng({ width: 32, height: 18, data: Buffer.alloc(32 * 18 * 4, 128) }), contentType: "image/png", name, source: "upload" }).url;

describe("Cinema API: scene and recomposition in demo mode", () => {
  it("builds a cloud scene as a depth map and an open one as a mesh, filed where asked", async () => {
    const still = upload("still.png");
    const scene = (engine: "cloud" | "open"): CinemaGenerateInput => ({ ...base, engine, action: "scene", source: { url: still, kind: "image" } });
    const p = cinema.createProject({ name: "Scenes" });
    const folder = cinema.createFolder(p.id, { name: "Rooftop" });
    const res = await generateRoute.POST(json({ input: scene("cloud"), folderId: folder.id }), params(p.id));
    expect(res.status).toBe(201);
    const { items, plan } = await res.json();
    expect(plan.modelId).toBe("marigold-depth");
    const depth = await settle(items[0].id);
    expect(depth.error).toBeNull();
    expect(depth).toMatchObject({ status: "succeeded", kind: "image", feature: "cinema-scene", op: "scene-3d" });
    expect(depth.outputs[0].meta?.role).toBe("depth");
    const listed = cinema.listItems(p.id, { folderId: folder.id });
    expect(listed.map((g) => g.id)).toEqual([depth.id]);
    expect(listed[0].take).toMatchObject({ mode: "image", action: "scene" });

    const open = generateInProject(p.id, scene("open"), folder.id);
    const mesh = await settle(open.items[0].id);
    expect(mesh.kind).toBe("model3d");
    expect(mesh.outputs.map((o) => [o.kind, o.meta?.role])).toEqual([
      ["model3d", "scene"],
      ["image", "depth"],
    ]);
  }, 60_000);

  it("keeps the still as the project's cover, not the scene's depth map", async () => {
    const p = cinema.createProject({ name: "Cover" });
    const made = generateInProject(p.id, { ...base, engine: "cloud", mode: "image", action: "generate", prompt: "A lighthouse at dusk", settings: { camera: "modern", lens: "clean-sharp", focal: "24mm" } }, null);
    const still = await settle(made.items[0].id);
    const cover = () => cinema.listProjects().find((x) => x.id === p.id)!.stats!.cover;
    expect(cover()).toBe(still.outputs[0].url);
    for (const engine of ["cloud", "open"] as const) {
      const s = generateInProject(p.id, { ...base, engine, action: "scene", source: { url: still.outputs[0].url, kind: "image" } }, null);
      expect((await settle(s.items[0].id)).status).toBe("succeeded");
      expect(cover()).toBe(still.outputs[0].url);
    }
  }, 60_000);

  it("re-renders a capture into a new take that remembers the camera", async () => {
    const p = cinema.createProject({ name: "Recompose" });
    const still = upload("still.png");
    const shot = { ...capture, url: upload("capture.png") };
    const res = await generateRoute.POST(json({ input: recompose("cloud", { prompt: "golden hour", source: { url: still, kind: "image" }, capture: shot }), folderId: null }), params(p.id));
    expect(res.status).toBe(201);
    const { items } = await res.json();
    expect(items[0].request.inputs.images).toEqual([shot.url, still]);
    const take = cinema.listItems(p.id).find((g) => g.id === items[0].id)!.take!;
    expect(take).toMatchObject({ action: "recompose", prompt: "golden hour", camera: { lens: 85, aperture: 1.4, pose: capture.pose } });
    expect((await settle(items[0].id)).status).toBe("succeeded");
  }, 40_000);

  it("refuses a capture outside the lens and aperture ranges, or not uploaded here", async () => {
    const p = cinema.createProject({ name: "Bad capture" });
    for (const bad of [{ ...capture, lens: 10 }, { ...capture, aperture: 22 }, { ...capture, url: "https://elsewhere.test/c.png" }, { ...capture, pose: { horizontal: 400, vertical: 0, zoom: 5 } }]) {
      const res = await generateRoute.POST(json({ input: recompose("cloud", { capture: bad }) }), params(p.id));
      expect(res.status).toBe(400);
    }
    const none = await generateRoute.POST(json({ input: recompose("cloud", { capture: undefined }) }), params(p.id));
    expect(none.status).toBe(422);
    expect((await none.json()).error).toBe("Capture a view first");
  });
});
