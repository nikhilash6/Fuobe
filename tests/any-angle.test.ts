import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ANGLE_PRESETS,
  ANY_ANGLE,
  anyAngleHref,
  asSubject,
  cameraFor,
  clampCustom,
  closeUpFactor,
  CUSTOM_LIMITS,
  customCamera,
  customLabel,
  fromAnglesApp,
  fromFuobeAngles,
  fromOrbit,
  orbitOf,
  PORTRAIT_MAX_PITCH,
  presetById,
  presetsFor,
  renderSize,
  sheetLayout,
  shotExtra,
  SWEEP,
  viewOf,
  wrapYaw,
  type FrontView,
} from "@/lib/catalog/any-angle";
import { findHead, measureFront, type Picture, type SweepFrame } from "@/lib/any-angle-front";
import { APPS, getModel } from "@/lib/catalog";
import { OWN_ROUTE_APPS } from "@/lib/catalog/preset-recipe-routes";
import { loraEntry } from "@/lib/catalog/loras";
import { graphProblem } from "@/lib/local-comfy";
import { withLoad3dImages, type ComfyWorkflow } from "@/lib/comfy";
import { model3dView } from "@/lib/av/model3d";
import { outputActions } from "@/lib/output-actions";
import type { Generation } from "@/lib/catalog/types";

// Any Angle (app-any-angle): the cameras, the per-photo front view, the graphs, the wiring and the words visitors read.

vi.setConfig({ testTimeout: 30_000 });

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
type Node = { class_type: string; inputs: Record<string, unknown> };
const graph = (id: string) => JSON.parse(read(`workflows/comfyui/${id}.json`)) as Record<string, Node>;
const nodes = (g: Record<string, Node>, cls: string) => Object.values(g).filter((n) => n.class_type === cls);

/** A full-length person photo's front view, as the GPU test measured one (yaw 125). */
const FULL: FrontView = { yaw: 125, pitch: 10, distance: 1.83, fov: 33, faceY: 0.39, person: true, headShare: 0.14, score: 0.8, span: [-0.5, 0.46] };
const PORTRAIT: FrontView = { ...FULL, yaw: 75, distance: 1.73, faceY: 0.22, headShare: 0.5 };
const BAG: FrontView = { ...FULL, yaw: 90, distance: 2.9, faceY: 0, person: false, headShare: 0 };

describe("the cameras", () => {
  it("turns from the photo's own front view: left is the front yaw minus the turn, right plus, and they mirror", () => {
    const left = cameraFor(FULL, presetById("left-30")!);
    const right = cameraFor(FULL, presetById("right-30")!);
    expect(left).toMatchObject({ yaw: 95, pitch: 10, distance: 1.83, fov: 33, target: [0, 0, 0] });
    expect(right.yaw).toBe(155);
    expect(left.yaw - FULL.yaw).toBe(-(right.yaw - FULL.yaw));
    expect(cameraFor(FULL, presetById("left-60")!).yaw).toBe(65);
    // A yaw wraps into (-180, 180].
    expect(cameraFor({ ...FULL, yaw: 170 }, presetById("right-60")!).yaw).toBe(-130);
    expect(wrapYaw(540)).toBe(180);
    expect(wrapYaw(-190)).toBe(170);
  });

  it("keeps the high angle at 35° above level on a portrait, and the low angle at 25° under the front", () => {
    expect(cameraFor(FULL, presetById("above")!).pitch).toBe(40);
    expect(cameraFor(PORTRAIT, presetById("above")!).pitch).toBe(PORTRAIT_MAX_PITCH);
    expect(cameraFor(FULL, presetById("below")!).pitch).toBe(-15);
    expect(cameraFor(FULL, presetById("below")!).distance).toBe(1.74);
  });

  it("aims the close-up at the face, nearer for a full-length photo than for a portrait", () => {
    const full = cameraFor(FULL, presetById("close-up")!);
    expect(full.target).toEqual([0, 0.39, 0]);
    expect(full.distance).toBeLessThan(FULL.distance * 0.5);
    expect(closeUpFactor(PORTRAIT)).toBe(0.75);
    expect(closeUpFactor(BAG)).toBe(0.5);
    expect(cameraFor(BAG, presetById("close-up")!).target).toEqual([0, 0, 0]);
  });

  it("offers the view from behind for people only, and the visitor can say what the photo shows", () => {
    expect(presetsFor(FULL).map((p) => p.id)).toContain("behind");
    expect(presetsFor(BAG).map((p) => p.id)).not.toContain("behind");
    expect(presetsFor(asSubject(BAG, true)).map((p) => p.id)).toContain("behind");
    expect(asSubject(BAG, true).faceY).toBeGreaterThan(0.3);
    expect(asSubject(FULL, false)).toMatchObject({ person: false, faceY: 0, headShare: 0 });
    // Every preset has a label a visitor reads and a turn within the tested range.
    for (const p of ANGLE_PRESETS) {
      expect(p.label).toMatch(/^[A-Z]/);
      expect(Math.abs(p.yaw)).toBeLessThanOrEqual(p.people ? 135 : 60);
    }
  });

  it("keeps a camera turned by hand inside what the tests covered", () => {
    expect(clampCustom(FULL, { yaw: 170, pitch: 80, distance: 3 })).toEqual({ yaw: CUSTOM_LIMITS.yawPeople, pitch: CUSTOM_LIMITS.pitchMax, distance: CUSTOM_LIMITS.distanceMax });
    expect(clampCustom(BAG, { yaw: -170, pitch: -60, distance: 0.1 })).toEqual({ yaw: -CUSTOM_LIMITS.yawObjects, pitch: CUSTOM_LIMITS.pitchMin, distance: CUSTOM_LIMITS.distanceMin });
    expect(clampCustom(PORTRAIT, { yaw: 0, pitch: 40, distance: 1 }).pitch).toBe(PORTRAIT_MAX_PITCH - PORTRAIT.pitch);
    expect(customCamera(FULL, { yaw: -40, pitch: 10, distance: 0.8 })).toMatchObject({ yaw: 85, pitch: 20, distance: 1.46 });
    expect(customLabel({ yaw: 40, pitch: 8, distance: 0.7 })).toBe("Custom · 40° right, slightly above, closer");
    expect(customLabel({ yaw: 0, pitch: 0, distance: 1 })).toBe("Custom · front");
  });

  it("reads the desktop 3D view's camera back as the same turn, height and distance", () => {
    expect(orbitOf(FULL)).toBe("125deg 80deg 1.83m");
    expect(fromOrbit(FULL, { theta: 125, phi: 80, radius: 1.83 })).toEqual({ yaw: 0, pitch: 0, distance: 1 });
    expect(fromOrbit(FULL, { theta: 85, phi: 60, radius: 0.915 })).toEqual({ yaw: -40, pitch: 20, distance: 0.5 });
  });

  it("maps Fuobe Angles' and Angles' controls for a later switch", () => {
    expect(fromFuobeAngles({ rotate_right_left: 45, vertical_angle: -1, move_forward: 10 })).toEqual({ yaw: -45, pitch: 40, distance: 0.5 });
    expect(fromFuobeAngles({ vertical_angle: 1, move_forward: 5 })).toEqual({ yaw: -0, pitch: -25, distance: 0.75 });
    expect(fromAnglesApp({ horizontal_angle: 315, vertical_angle: 30, zoom: 0 })).toEqual({ yaw: -45, pitch: 30, distance: 1.6 });
    expect(fromAnglesApp({ horizontal_angle: 90, zoom: 10 })).toEqual({ yaw: 90, pitch: 0, distance: 0.5 });
  });

  it("renders at the photo's shape, at most 2048 px, in steps of 8, and sends the graph its settings", () => {
    expect(renderSize(1536, 1152)).toEqual({ width: 1536, height: 1152 });
    expect(renderSize(4000, 3000)).toEqual({ width: 2048, height: 1536 });
    expect(renderSize(1001, 1999)).toEqual({ width: 1000, height: 1992 });
    const extra = shotExtra(cameraFor(FULL, presetById("close-up")!), { width: 1536, height: 1152 }, "/api/files/a/s.spz");
    expect(extra).toMatchObject({ splatFile: "/api/files/a/s.spz", cameraYaw: 125, targetY: 0.39, width: 1536, height: 1152 });
  });
});

describe("the front view of a photo", () => {
  /** A figure on a turntable: a body whose width, colour and side stripe change with the turn, and a head. */
  function figure(size: number, yaw: number): { rgb: Picture; mask: Picture } {
    const rgb = new Uint8Array(size * size * 3);
    const mask = new Uint8Array(size * size);
    const t = (yaw * Math.PI) / 180;
    const half = (0.12 + 0.1 * Math.abs(Math.cos(t))) * size;
    const stripe = Math.sin(t) * half * 0.7;
    const cx = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const head = (x - cx) ** 2 + (y - 0.2 * size) ** 2 < (0.08 * size) ** 2;
        const neck = y >= 0.27 * size && y < 0.31 * size && Math.abs(x - cx) < 0.03 * size;
        const body = y >= 0.31 * size && y < 0.92 * size && Math.abs(x - cx) < half;
        if (!head && !neck && !body) continue;
        const i = y * size + x;
        mask[i] = 255;
        const onStripe = body && Math.abs(x - cx - stripe) < 0.03 * size;
        const front = Math.cos(t);
        rgb[i * 3] = onStripe ? 250 : head ? 200 : Math.round(140 + 100 * front);
        rgb[i * 3 + 1] = onStripe ? 250 : head ? 150 : 90;
        rgb[i * 3 + 2] = onStripe ? 30 : head ? 120 : Math.round(140 - 100 * front);
      }
    }
    return { rgb: { width: size, height: size, channels: 3, data: rgb }, mask: { width: size, height: size, channels: 1, data: mask } };
  }

  const sweep = (n: number): SweepFrame[] => Array.from({ length: n }, (_, k) => figure(96, (360 * k) / n));

  it("finds the turn the photo was taken from on the turntable, and the distance it fills the frame at", () => {
    const frames = sweep(SWEEP.frames);
    for (const yaw of [60, 135, 255]) {
      const front = measureFront(figure(192, yaw), frames)!;
      expect(Math.abs(wrapYaw(front.yaw - yaw))).toBeLessThanOrEqual(360 / SWEEP.frames);
      expect(front.distance).toBeCloseTo(SWEEP.distance, 1);
      expect(front.person).toBe(true);
      expect(front.faceY).toBeGreaterThan(0);
    }
  });

  it("tells a head on shoulders from an object", () => {
    expect(findHead(figure(192, 0).mask)).toMatchObject({ share: expect.any(Number) });
    const box = new Uint8Array(100 * 100);
    for (let y = 20; y < 90; y++) for (let x = 25; x < 75; x++) box[y * 100 + x] = 255;
    expect(findHead({ width: 100, height: 100, channels: 1, data: box })).toBeNull();
  });

  it("is required before an angle can be made: a build without a measured front view has no view", () => {
    const outputs = [
      { url: "/api/files/a/s.spz", kind: "model3d" as const, meta: { role: "splat" } },
      { url: "/api/files/a/t.mp4", kind: "video" as const, meta: { role: "turntable" } },
    ];
    expect(viewOf({ outputs })).toBeNull();
    outputs[0].meta = { role: "splat", front: FULL, size: { width: 1536, height: 1152 } } as never;
    expect(viewOf({ outputs })).toEqual({ splat: "/api/files/a/s.spz", turntable: "/api/files/a/t.mp4", mesh: undefined, front: FULL, size: { width: 1536, height: 1152 } });
  });
});

describe("the graphs", () => {
  it("paints each angle with one model loader and the AnyAngle LoRA loaded once, as the GPU test settled", () => {
    const g = graph(ANY_ANGLE.shotGraph);
    expect(nodes(g, "UNETLoader")).toHaveLength(1);
    expect(nodes(g, "UNETLoader")[0].inputs.unet_name).toBe("qwen_image_2.1_int8_convrot.safetensors");
    const loras = nodes(g, "LoraLoaderModelOnly");
    expect(loras).toHaveLength(1);
    expect(loras[0].inputs).toMatchObject({ lora_name: ANY_ANGLE.loraFile, strength_model: 1 });
    const enc = nodes(g, "TextEncodeQwenImage21")[0];
    expect(enc.inputs.prompt).toBe(ANY_ANGLE.prompt);
    // The original is image 1, the render image 2.
    const load = Object.entries(g).find(([, n]) => n.class_type === "LoadImage")![0];
    const render = Object.entries(g).find(([, n]) => n.class_type === "RenderSplat")![0];
    expect(enc.inputs["images.image_1"]).toEqual([load, 0]);
    expect(enc.inputs["images.image_2"]).toEqual([render, 0]);
    expect(nodes(g, "KSampler")[0].inputs).toMatchObject({ steps: 25, cfg: 1, sampler_name: "euler", scheduler: "simple" });
    expect(nodes(g, "RenderSplat")[0].inputs.background).toBe("#000000");
    expect(nodes(g, "Load3D")).toHaveLength(1);
  });

  it("builds the 3D view from the cut-out with fixed seeds, and saves the splat, the turntable, the sweep and a GLB", () => {
    const g = graph(ANY_ANGLE.buildGraph);
    const pre = nodes(g, "TripoSplatPreprocessImage")[0];
    expect(g[(pre.inputs.mask as [string, number])[0]].class_type).toBe("RemoveBackground");
    expect(nodes(g, "KSampler")[0].inputs.seed).toBe(ANY_ANGLE.buildSeed);
    expect(nodes(g, "VAEDecodeTripoSplat")[0].inputs.seed).toBe(ANY_ANGLE.buildSeed);
    expect(nodes(g, "RenderSplat")[0].inputs).toMatchObject({ frames: SWEEP.frames });
    expect(nodes(g, "CreateCameraInfo")[0].inputs).toMatchObject({ "mode.yaw": SWEEP.yaw, "mode.pitch": SWEEP.pitch, "mode.distance": SWEEP.distance, fov: SWEEP.fov });
    expect(nodes(g, "SplatToMesh")).toHaveLength(1);
    const manifest = JSON.parse(read("workflows/comfyui/manifest.json")) as { workflows: { id: string; outputs: { role?: string }[]; bindings: Record<string, unknown> }[] };
    const roles = manifest.workflows.find((w) => w.id === ANY_ANGLE.buildGraph)!.outputs.map((o) => o.role);
    expect(roles).toEqual(expect.arrayContaining(["splat", "turntable", "sweep", "sweep-mask", "matte", "mesh"]));
    const shot = manifest.workflows.find((w) => w.id === ANY_ANGLE.shotGraph)!;
    for (const k of Object.keys(shotExtra(cameraFor(FULL, ANGLE_PRESETS[0]), { width: 8, height: 8 }, "x"))) expect(shot.bindings).toHaveProperty(k);
  });

  it("reads the saved 3D view on a GPU of one's own only from files the run sent", () => {
    const wf = { "2": { class_type: "Load3D", inputs: { model_file: "x.spz", image: { image: "a.png", mask: "a.png", normal: "a.png", recording: "", camera_info: null }, width: 1, height: 1 } } } as unknown as ComfyWorkflow;
    const bound = withLoad3dImages(wf, "fuobe_photo.png") as unknown as Record<string, Node>;
    expect(bound["2"].inputs.image).toMatchObject({ image: "fuobe_photo.png", mask: "fuobe_photo.png", normal: "fuobe_photo.png" });
    const staged = ["fuobe_photo.png", "fuobe_view.spz"];
    expect(graphProblem({ "2": { class_type: "Load3D", inputs: { ...bound["2"].inputs, model_file: "fuobe_view.spz" } } }, staged)).toBeNull();
    expect(graphProblem({ "2": { class_type: "Load3D", inputs: { ...bound["2"].inputs, model_file: "3d/someone_else.spz" } } }, staged)).toMatch(/didn't send/);
    expect(graphProblem({ "2": { class_type: "Load3D", inputs: { model_file: "fuobe_view.spz", image: { image: "private.png", mask: "", normal: "", recording: "" } } } }, staged)).toMatch(/didn't send/);
  });
});

describe("the LoRA pin", () => {
  it("is pinned to the measured revision, size and sha256, and listed for the GPU check", () => {
    const pins = JSON.parse(read("workflows/comfyui/model-pins.json")) as Record<string, { revision: string; sizeBytes: number; sha256: string }>;
    const url = "https://huggingface.co/lilylilith/QI_2.1_AnyAngle/resolve/5c8b4c8e05ba6328d54bf8d34ec724fef5a414ae/QI2.1_AnyAngle.safetensors";
    expect(pins[url]).toEqual({ revision: "5c8b4c8e05ba6328d54bf8d34ec724fef5a414ae", sizeBytes: 119590312, sha256: "e4d7a0d44a45ed62daabd0f2484a1a59046618a4c47e76b1eab5e386a7a35d8a" });
    const req = JSON.parse(read("workflows/comfyui/requirements.json")) as { files: Record<string, { pinnedUrl: string }>; workflows: Record<string, { files: string[] }> };
    expect(req.files["loras/QI2.1_AnyAngle.safetensors"].pinnedUrl).toBe(url);
    expect(req.workflows[ANY_ANGLE.shotGraph].files).toContain("loras/QI2.1_AnyAngle.safetensors");
    expect(loraEntry(ANY_ANGLE.loraKey)).toMatchObject({ file: ANY_ANGLE.loraFile, sha256: "e4d7a0d44a45ed62daabd0f2484a1a59046618a4c47e76b1eab5e386a7a35d8a", sizeBytes: 119590312 });
  });
});

describe("the app", () => {
  const app = APPS.find((a) => a.id === ANY_ANGLE.appId)!;

  it("is a Camera app of its own, after Fuobe Angles, on the GPU only", () => {
    expect(app).toMatchObject({ name: "Any Angle", category: "Camera", tool: "any-angle", cloud: null, look: { icon: "Rotate3d" } });
    expect(app.badges).toContain("new");
    expect(app.open).toMatchObject({ modelId: ANY_ANGLE.shotModel });
    const camera = APPS.filter((a) => a.category === "Camera").map((a) => a.id);
    expect(camera.indexOf(ANY_ANGLE.appId)).toBe(camera.indexOf("app-fuobe-angles") + 1);
    expect(OWN_ROUTE_APPS.has(ANY_ANGLE.appId)).toBe(true);
    for (const id of [ANY_ANGLE.shotModel, ANY_ANGLE.buildModel]) {
      const m = getModel(id)!;
      expect(m.hidden).toBe(true);
      expect(m.routes.every((r) => r.provider === "comfyui")).toBe(true);
    }
    expect(getModel(ANY_ANGLE.shotModel)!.routes[0].endpoint).toBe(ANY_ANGLE.shotGraph);
    expect(getModel(ANY_ANGLE.buildModel)!.routes[0].endpoint).toBe(ANY_ANGLE.buildGraph);
  });

  it("is a step away from any picture in Library, and from a 3D splat result", () => {
    const g = { id: "g1", status: "succeeded", feature: "image", op: "t2i", outputs: [{ url: "/api/files/out/p.png", kind: "image" }], request: {}, createdAt: "" } as unknown as Generation;
    expect(outputActions(g, 0).find((a) => a.id === "new-angle")).toMatchObject({ label: "New angle", href: anyAngleHref("/api/files/out/p.png") });
    expect(anyAngleHref("/api/files/out/p.png")).toBe("/apps/app-any-angle?image=%2Fapi%2Ffiles%2Fout%2Fp.png");
  });

  it("shows a splat's GLB in the 3D viewer and offers both downloads", () => {
    const g = {
      outputs: [
        { url: "/api/files/a/s.spz", kind: "model3d", meta: { role: "splat", format: "spz" } },
        { url: "/api/files/a/t.mp4", kind: "video", meta: { role: "turntable" } },
        { url: "/api/files/a/m.glb", kind: "model3d", meta: { role: "mesh" } },
      ],
      request: { inputs: { images: ["/api/files/a/p.png"] } },
    } as unknown as Generation;
    const view = model3dView(g);
    expect(view.splat?.url).toBe("/api/files/a/s.spz");
    expect(view.glb).toBe("/api/files/a/m.glb");
    expect(view.web).toBe("/api/files/a/m.glb");
    expect(model3dView({ ...g, outputs: g.outputs.slice(0, 2) }).glb).toBeUndefined();
  });

  it("speaks plainly to visitors: no model or file names, no beta, no internal status", () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
    const page = strip(read("src/components/any-angle/any-angle-tool.tsx"));
    // What a visitor reads: text between tags, and strings and templates that start with a capital (class names and ids don't).
    const shown = [...page.matchAll(/>\s*([A-Z][^<>{}=;]*)/g), ...page.matchAll(/"([A-Z][^"]*)"/g), ...page.matchAll(/`([A-Z][^`]*)`/g)].map((m) => m[1]);
    expect(shown.length).toBeGreaterThan(20);
    // The 3D view's image encoder's notice is on Thanks & licences, not here.
    const words = [...shown, app.description, app.parity ?? "", ...ANGLE_PRESETS.map((p) => p.label)].join(" \n ");
    expect(page).not.toContain("Built with DINOv3");
    for (const banned of [/qwen/i, /tripo/i, /lora/i, /splat/i, /\.spz/i, /comfy/i, /\bbeta\b/i, /\bdino/i, /birefnet/i, /unverified|not checked|placeholder/i]) expect(words).not.toMatch(banned);
    expect(words).toContain("Build 3D view");
    expect(words).toContain("Use this view");
    expect(words).toContain("Drag to turn. Scroll to move closer.");
  });

  it("works by taps at phone width: the angles are buttons in a two-column grid, the drag view a desktop extra", () => {
    const page = read("src/components/any-angle/any-angle-tool.tsx");
    expect(page).toMatch(/grid grid-cols-2 gap-2/);
    expect(page).toMatch(/aria-pressed=\{on\.has\(p\.key\)\}/);
    expect(page).toMatch(/title="Turn it yourself"[^\n]*className="hidden md:block"/);
  });
});

describe("the contact sheet", () => {
  it("puts the original large on the left and the angles in two rows, leaving out the ones that failed", () => {
    const ten = sheetLayout({ width: 1184, height: 896 }, ANGLE_PRESETS.map((p) => p.label).concat("A", "B"));
    expect(ten.tiles[0]).toMatchObject({ label: "Original", index: -1, x: 16, y: 16 });
    const angles = ten.tiles.slice(1);
    expect(angles).toHaveLength(10);
    expect(new Set(angles.map((t) => t.y)).size).toBe(2);
    expect(new Set(angles.map((t) => t.x)).size).toBe(5);
    expect(ten.tiles[0].h).toBeGreaterThan(angles[0].h);
    for (const t of ten.tiles) {
      expect(t.x + t.w).toBeLessThanOrEqual(ten.width);
      expect(t.y + t.h).toBeLessThanOrEqual(ten.height);
    }
    const seven = sheetLayout({ width: 1184, height: 896 }, ["a", "b", "c", "d", "e", "f", "g"]);
    expect(seven.tiles.slice(1)).toHaveLength(7);
    expect(seven.width).toBeLessThan(ten.width);
  });
});
