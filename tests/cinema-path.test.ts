import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CinemaGenerateInput } from "@/lib/catalog/cinema";
import type { ModelDef } from "@/lib/catalog/types";

/** Fly path (build plan N7-5): Cinema's "Film this path" on both engines, the H3 Max payload, the Uni3C graph and the API. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-cinema-path-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const cinema = await import("@/server/cinema");
const generateRoute = await import("@/app/api/cinema/projects/[id]/generate/route");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const { getModel, getPreset } = await import("@/lib/catalog");
const { buildPayload } = await import("@/lib/catalog/payload");
const { estimateCost, planGeneration } = await import("@/lib/catalog/plan");
const { getWorkflow, prepareWorkflow } = await import("@/server/providers/comfyui");
const { mockProvider } = await import("@/server/providers/mock");
const { pathTake, planCinema, PATH_MODELS, PATH_RENDER_FIRST } = await import("@/lib/catalog/cinema");
const { DEFAULT_MOTION, PATH_FPS, PATH_FRAMES, PHOTO_KEY, presetKeys } = await import("@/lib/camera-path");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});
afterEach(() => vi.useRealTimers());
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const STILL = "/api/files/uploads/still.png";
const RENDER = "/api/files/uploads/render.webm";
const ctx = { cloudAllowed: true };
const orbit = presetKeys("orbit_360")!;
const film = (engine: "cloud" | "open", over: Partial<CinemaGenerateInput> = {}): CinemaGenerateInput => ({
  engine,
  mode: "video",
  action: "path",
  prompt: "",
  settings: {},
  source: { url: STILL, kind: "image" },
  path: { keys: orbit, duration: 5, ...(engine === "open" ? { render: RENDER } : {}) },
  ...over,
});

/** The research record of fal's camera-controls endpoint (docs/research/paid-model-apis-2.json). */
interface FieldSpec {
  required?: boolean;
  values?: string[];
  minItems?: number;
  maxItems?: number;
  itemRequired?: string[];
  itemSchema?: Record<string, { minimum?: number; maximum?: number }>;
}
const RECORD = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs/research/paid-model-apis-2.json"), "utf8")).endpoints as { endpoint: string; inputs: Record<string, FieldSpec> }[]).find(
  (e) => e.endpoint === "minimax/h3-max/camera-controls",
)!;

describe("planning a fly path", () => {
  it("cloud: H3 Max camera-controls films the still for 5 s at 768P, with motion words that let the subject move", () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-29T12:00:00Z"), toFake: ["Date"] });
    const plan = planCinema(film("cloud"), ctx);
    expect(plan.blocker).toBeUndefined();
    expect(plan.model.id).toBe(PATH_MODELS.cloud);
    expect(plan.model.id).toBe("minimax-h3-max-camera");
    expect(plan.steps).toHaveLength(1);
    const req = plan.steps[0].request;
    expect(req).toMatchObject({ feature: "cinema-path", op: "camera-path", inputs: { images: [STILL] }, params: { duration: 5, resolution: "768P", cameraPath: orbit } });
    expect(req.prompt).toBe(DEFAULT_MOTION);
    expect(plan.notes[0]).toMatch(/H3 Max follows your 5 keyframes from the still, with prompt expansion off/);
    // fal's launch price until 2026-10-31: $0.052 a second at 768P.
    expect(plan.costUsd).toBe(0.26);
  });

  it("cloud: the price is the one of the run's date — $0.08 a second at 768P from November", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-01T09:00:00Z"), toFake: ["Date"] });
    expect(planCinema(film("cloud"), ctx).costUsd).toBe(0.4);
    expect(planCinema(film("cloud", { resolution: "1080p", path: { keys: orbit, duration: 10 } }), ctx).costUsd).toBe(1.6);
    expect(planCinema(film("cloud", { resolution: "480P", path: { keys: orbit, duration: 3 } }), ctx).costUsd).toBe(0.15);
    vi.useFakeTimers({ now: Date.parse("2026-10-31T23:00:00Z"), toFake: ["Date"] });
    expect(planCinema(film("cloud", { resolution: "1080P" }), ctx).costUsd).toBe(0.52);
  });

  it("cloud: the user's motion words are sent as written, and the length stays inside 1–15 s", () => {
    const plan = planCinema(film("cloud", { prompt: "She turns and smiles.", path: { keys: orbit, duration: 40 } }), ctx);
    expect(plan.steps[0].request.prompt).toBe("She turns and smiles");
    expect(plan.steps[0].request.params?.duration).toBe(15);
  });

  it("cloud: a pure slide says it runs as H3 Max's own truck move", () => {
    const plan = planCinema(film("cloud", { path: { keys: presetKeys("truck_left")!, duration: 5 } }), ctx);
    expect(plan.blocker).toBeUndefined();
    expect(plan.notes[0]).toMatch(/own truck move/);
  });

  it("open: Wan 2.1 + Uni3C on the browser's render, the still as the first frame, free", () => {
    const plan = planCinema(film("open"), ctx);
    expect(plan.model.id).toBe("oss-uni3c-path");
    const req = plan.steps[0].request;
    expect(req).toMatchObject({ feature: "cinema-path", op: "camera-path", inputs: { images: [STILL], video: RENDER }, params: { aspectRatio: "auto", resolution: "480p" } });
    expect(req.prompt).toBe(DEFAULT_MOTION);
    expect(plan.costUsd).toBe(0);
    expect(plan.notes[0]).toMatch(/81 frames at 16 fps \(5.1 s\) on your GPU, which needs about 48 GB/);
  });

  it("waits for the still, a path that moves, and (open) the browser's render", () => {
    expect(planCinema(film("cloud", { source: undefined }), ctx).blocker).toBe("Pick the scene's still");
    expect(planCinema(film("cloud", { path: { keys: [PHOTO_KEY] } }), ctx).blocker).toBe("Add a keyframe or pick a move first");
    expect(planCinema(film("cloud", { path: undefined }), ctx).blocker).toBe("Add a keyframe or pick a move first");
    expect(planCinema(film("open", { path: { keys: orbit } }), ctx).blocker).toBe(PATH_RENDER_FIRST);
  });

  it("shows the price that applies before the path is ready: Film never reads 'Free' for a paid run", () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-29T12:00:00Z"), toFake: ["Date"] });
    const start = planCinema(film("cloud", { path: { keys: [PHOTO_KEY], duration: 5 } }), ctx);
    expect(start.blocker).toBe("Add a keyframe or pick a move first");
    expect(start.costUsd).toBe(0.26);
    expect(planCinema(film("cloud", { resolution: "1080P", path: { keys: [PHOTO_KEY], duration: 10 } }), ctx).costUsd).toBe(1.04);
    expect(planCinema(film("cloud", { source: undefined }), ctx)).toMatchObject({ blocker: "Pick the scene's still", costUsd: 0.26 });
    // The blocked step keeps what was really asked (no stand-ins), and the open engine stays free.
    expect(start.steps[0].request.inputs).toEqual({ images: [STILL] });
    expect(planCinema(film("open", { path: { keys: [PHOTO_KEY] } }), ctx)).toMatchObject({ blocker: "Add a keyframe or pick a move first", costUsd: 0 });
  });

  it("starts every path at the photo's pose, even when a caller sends a different first key", () => {
    const sent = [
      { t: 0, azimuth: 90, elevation: 0, distance: 1 },
      { t: 1, azimuth: 180, elevation: 0, distance: 1 },
    ];
    for (const engine of ["cloud", "open"] as const) {
      const plan = planCinema(film(engine, { path: { keys: sent, ...(engine === "open" ? { render: RENDER } : {}) } }), ctx);
      expect(plan.blocker).toBeUndefined();
      expect(plan.steps[0].request.params?.cameraPath).toEqual([PHOTO_KEY, sent[1]]);
    }
  });

  it("remembers the path it planned and the clip's real length: 81 frames at 16 fps on the open engine", () => {
    const open = film("open", { path: { keys: orbit, duration: 8, render: RENDER, preset: "orbit_360" } });
    expect(pathTake(open, planCinema(open, ctx))).toEqual({ keys: orbit, duration: PATH_FRAMES / PATH_FPS, preset: "orbit_360" });
    const cloud = film("cloud", { path: { keys: orbit, duration: 8 } });
    expect(pathTake(cloud, planCinema(cloud, ctx))).toEqual({ keys: orbit, duration: 8 });
  });

  it("a direct run of either helper is refused up front without its still (and, on the GPU, the render)", () => {
    const run = (modelId: string, inputs: Record<string, unknown> | undefined) => () =>
      planGeneration({ feature: "video", modelId, op: "camera-path", prompt: "x", inputs, params: { cameraPath: orbit } }, getModel, getPreset);
    expect(run("minimax-h3-max-camera", undefined)).toThrow("Add the still to film along the path");
    expect(run("minimax-h3-max-camera", { images: [STILL] })).not.toThrow();
    expect(run("oss-uni3c-path", { images: [STILL] })).toThrow(/render of the path/);
    expect(run("oss-uni3c-path", { images: [STILL], video: RENDER })).not.toThrow();
  });
});

describe("cloud: MiniMax H3 Max camera controls (minimax/h3-max/camera-controls)", () => {
  const m = getModel("minimax-h3-max-camera") as ModelDef;
  const route = m.routes[0];

  it("is a hidden helper on the camera-controls endpoint (not the legacy multi-angle alias), priced by resolution", () => {
    expect(m.hidden).toBe(true);
    expect(route).toMatchObject({ op: "camera-path", provider: "fal", endpoint: "minimax/h3-max/camera-controls" });
    expect(m.routes.some((r) => r.endpoint.includes("multi-angle"))).toBe(false);
    expect(m.options.resolutions).toEqual(["480P", "768P", "1080P"]);
    expect(m.defaults).toMatchObject({ duration: 5, resolution: "768P" });
    vi.useFakeTimers({ now: Date.parse("2026-10-30T00:00:00Z"), toFake: ["Date"] });
    expect(estimateCost(m, { duration: 5, resolution: "480P" }, 1, "camera-path")).toBe(0.163);
    vi.useFakeTimers({ now: Date.parse("2026-12-01T00:00:00Z"), toFake: ["Date"] });
    expect(estimateCost(m, { duration: 5, resolution: "480P" }, 1, "camera-path")).toBe(0.25);
  });

  it("sends a payload the endpoint's schema takes: the still, the trajectory, prompt expansion off, the prompt, length, size and seed", () => {
    const body = buildPayload(route.map!, { prompt: DEFAULT_MOTION, images: ["https://fal.test/still.png"], duration: 5, resolution: "768P", seed: 7, cameraPath: orbit });
    expect(body).toEqual({
      prompt: DEFAULT_MOTION,
      image_url: "https://fal.test/still.png",
      camera_trajectory: [0, 90, 180, 270, 360].map((azimuth, i) => ({ time: i / 4, azimuth, elevation: 0, distance: 1 })),
      prompt_expansion_mode: "disabled",
      duration: 5,
      resolution: "768P",
      seed: 7,
    });
    // Every field is one the schema has, the required ones are there, and every value is inside its limits.
    for (const k of Object.keys(body)) expect(RECORD.inputs, k).toHaveProperty(k);
    for (const [k, spec] of Object.entries(RECORD.inputs)) if (spec.required) expect(body, k).toHaveProperty(k);
    expect(RECORD.inputs.resolution.values).toContain(body.resolution);
    const traj = body.camera_trajectory as Record<string, number>[];
    const item = RECORD.inputs.camera_trajectory;
    expect(traj.length).toBeGreaterThanOrEqual(item.minItems!);
    expect(traj.length).toBeLessThanOrEqual(item.maxItems!);
    const limits = item.itemSchema!;
    for (const k of traj) {
      expect(Object.keys(k).sort()).toEqual([...item.itemRequired!].sort());
      expect(k.time).toBeGreaterThanOrEqual(limits.time.minimum!);
      expect(k.time).toBeLessThanOrEqual(limits.time.maximum!);
      expect(k.elevation).toBeGreaterThanOrEqual(limits.elevation.minimum!);
      expect(k.elevation).toBeLessThanOrEqual(limits.elevation.maximum!);
      expect(k.distance).toBeGreaterThan(0);
    }
  });

  it("sends a slide as the endpoint's own truck move instead of the trajectory", () => {
    const body = buildPayload(route.map!, { prompt: "x", images: ["https://fal.test/still.png"], cameraPath: presetKeys("truck_right")! });
    expect(body.free_camera_preset).toBe("truck_right");
    expect(RECORD.inputs.free_camera_preset.values).toContain("truck_right");
    expect(body).not.toHaveProperty("camera_trajectory");
  });

  it("keeps a long path to 12 keyframes and the length inside the schema's 0.92–15 s", () => {
    const keys = Array.from({ length: 30 }, (_, i) => ({ t: i / 29, azimuth: i * 12, elevation: (i % 4) * 5, distance: 1 }));
    const body = buildPayload(route.map!, { prompt: "x", images: ["https://fal.test/still.png"], cameraPath: keys, duration: 40 });
    expect((body.camera_trajectory as unknown[]).length).toBe(12);
    expect(body.duration).toBe(15);
  });
});

describe("open: the Uni3C path graph (wan21-i2v-uni3c-path)", () => {
  const manifest = () => getWorkflow("wan21-i2v-uni3c-path").manifest;

  it("is validated, core nodes only, with Uni3C pinned in model_patches and the 720P base", () => {
    const w = manifest();
    expect(w.validated).toBe(true);
    expect(w.capability).toBe("camera-path");
    expect(w.customNodes).toEqual([]);
    const files = Object.fromEntries(w.models.map((m) => [m.file, m]));
    expect(files["Wan21_Uni3C_controlnet_fp16.safetensors"]).toMatchObject({ folder: "model_patches", url: expect.stringContaining("Kijai/WanVideo_comfy/resolve/8260d429d19fd7a72304cad059160b95d843913f/") });
    expect(files["wan2.1_i2v_720p_14B_fp8_scaled.safetensors"]).toMatchObject({ folder: "diffusion_models", url: expect.stringContaining("Comfy-Org/Wan-2.1/resolve/123acf1cc74bccbb9bfff8ac1ee72edc08c2341d/") });
    expect(files["Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors"]).toMatchObject({ optional: true });
    for (const m of w.models) expect(m.sizeGb, m.file).toBeGreaterThan(0);
    expect(Object.keys(w.bindings).sort()).toEqual(
      ["image", "video", "prompt", "negativePrompt", "width", "height", "seed", "steps", "cfg", "shift", "strength", "checkpoint", "filenamePrefix"].sort(),
    );
    expect(w.license).toMatch(/Apache-2.0/);
    const m = getModel("oss-uni3c-path")!;
    expect(m.routes).toEqual([expect.objectContaining({ op: "camera-path", provider: "comfyui", endpoint: "wan21-i2v-uni3c-path" })]);
  });

  it("binds the still, the render, the words, the size of the still's shape, the strength and the file prefix", async () => {
    const { workflow } = await prepareWorkflow(
      "wan21-i2v-uni3c-path",
      { prompt: "She walks on", images: ["still.png"], video: "render.webm", aspectRatio: "auto", resolution: "480p", seed: 11, extra: { strength: 0.8 } },
      { generationId: "gen-path", op: "camera-path", upload: async (_d, _t, name) => name, media: (name) => (name === "still.png" ? { width: 1080, height: 1920 } : undefined) as never },
    );
    expect(workflow["5"].inputs.image).toBe("still.png");
    expect(workflow["7"].inputs.file).toBe("render.webm");
    expect(workflow["10"].inputs.text).toBe("She walks on");
    expect(String(workflow["11"].inputs.text)).toMatch(/^色调艳丽/);
    expect([workflow["12"].inputs.width, workflow["12"].inputs.height]).toEqual([480, 848]);
    expect(workflow["12"].inputs.length).toBe(81);
    expect(workflow["13"].inputs.seed).toBe(11);
    expect(workflow["9"].inputs).toMatchObject({ strength: 0.8, start_percent: 0, end_percent: 1, render_video: ["17", 0], model: ["18", 0] });
    expect(workflow["15"].inputs.fps).toBe(16);
    expect(workflow["16"].inputs.filename_prefix).toBe("fuobe/gen-path");
    expect(workflow["1"].inputs.unet_name).toBe("wan2.1_i2v_720p_14B_fp8_scaled.safetensors");
  });

  it("asks for the render when there is none", async () => {
    await expect(prepareWorkflow("wan21-i2v-uni3c-path", { prompt: "", images: ["still.png"] }, { generationId: "g", op: "camera-path", upload: async () => "x" })).rejects.toThrow(/Add a video/);
  });
});

describe("demo mode", () => {
  it("films a sample clip on both engines", async () => {
    for (const id of ["minimax-h3-max-camera", "oss-uni3c-path"]) {
      const model = getModel(id)!;
      const route = model.routes[0];
      const sub = await mockProvider.submit({ generationId: "g", model, route, input: { prompt: "", images: ["still.png"], video: "render.webm", cameraPath: orbit } });
      const res = await mockProvider.poll({ externalId: sub.externalId, meta: { ...sub.meta, startedAt: 0 }, route, model, createdAt: 0 });
      if (res.state !== "succeeded") throw new Error(res.state);
      expect(res.outputs[0].kind).toBe("video");
    }
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

const upload = (name: string) => saveFile({ data: encodePng({ width: 32, height: 18, data: Buffer.alloc(32 * 18 * 4, 128) }), contentType: "image/png", name, source: "upload" }).url;

describe("Cinema API: Film this path in demo mode", () => {
  it("files the filmed path next to the scene as a new take that remembers the path", async () => {
    const p = cinema.createProject({ name: "Paths" });
    const folder = cinema.createFolder(p.id, { name: "Rooftop" });
    const still = upload("still.png");
    const input = film("cloud", { prompt: "the dancer spins", source: { url: still, kind: "image" }, path: { keys: orbit, duration: 8, preset: "orbit_360" } });
    const res = await generateRoute.POST(json({ input, folderId: folder.id }), params(p.id));
    expect(res.status).toBe(201);
    const { items, plan } = await res.json();
    expect(plan.modelId).toBe("minimax-h3-max-camera");
    expect(items[0]).toMatchObject({ feature: "cinema-path", op: "camera-path" });
    expect(items[0].request.params.cameraPath).toEqual(orbit);
    const take = cinema.listItems(p.id, { folderId: folder.id }).find((g) => g.id === items[0].id)!.take!;
    expect(take).toMatchObject({ action: "path", prompt: "the dancer spins", path: { keys: orbit, duration: 8, preset: "orbit_360" } });
    const done = await settle(items[0].id);
    expect(done).toMatchObject({ status: "succeeded", kind: "video" });
  }, 40_000);

  it("an API caller's path that starts away from the photo is filmed (and remembered) from the photo's pose", async () => {
    const p = cinema.createProject({ name: "API path" });
    const still = upload("still-api.png");
    const sent = [
      { t: 0, azimuth: 90, elevation: 0, distance: 1 },
      { t: 1, azimuth: 180, elevation: 0, distance: 1 },
    ];
    const res = await generateRoute.POST(json({ input: film("cloud", { source: { url: still, kind: "image" }, path: { keys: sent, duration: 5 } }) }), params(p.id));
    expect(res.status).toBe(201);
    const { items } = await res.json();
    expect(items[0].request.params.cameraPath).toEqual([PHOTO_KEY, sent[1]]);
    const take = cinema.listItems(p.id).find((g) => g.id === items[0].id)!.take!;
    expect(take.path?.keys).toEqual([PHOTO_KEY, sent[1]]);
    await settle(items[0].id);
  }, 40_000);

  it("refuses a path out of range, a render not uploaded here, and an open run without its render", async () => {
    const p = cinema.createProject({ name: "Bad paths" });
    for (const bad of [
      { keys: [{ t: 2, azimuth: 0, elevation: 0, distance: 1 }] },
      { keys: [{ t: 0, azimuth: 0, elevation: 120, distance: 1 }] },
      { keys: [{ t: 0, azimuth: 0, elevation: 0, distance: 0 }] },
      // Past 24 keys (your GPU follows up to 24; the cloud simplifies a longer path to H3 Max's 12, and says so).
      { keys: Array.from({ length: 25 }, (_, i) => ({ t: i / 24, azimuth: i, elevation: 0, distance: 1 })) },
      { keys: orbit, render: "https://elsewhere.test/r.webm" },
      { keys: orbit, duration: 30 },
    ]) {
      const res = await generateRoute.POST(json({ input: film("cloud", { path: bad }) }), params(p.id));
      expect(res.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
    const none = await generateRoute.POST(json({ input: film("open", { path: { keys: orbit } }) }), params(p.id));
    expect(none.status).toBe(422);
    expect((await none.json()).error).toBe(PATH_RENDER_FIRST);
  });
});
