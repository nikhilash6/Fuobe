import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Exact orbits and Fly around (build plan N7-7): the orbit's numbers as camera-path keys, the plan on both engines, the
 * server's headless path render (option B) and its chain slot, and /api/fly-around.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-fly-around-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { saveFile, readRef } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const gens = await import("@/server/generations");
const exact = await import("@/lib/exact-orbit");
const fly = await import("@/lib/catalog/fly-around");
const { PHOTO_KEY, PATH_FRAMES, toH3MaxTrajectory, H3_LIMITS, framePoses, renderSize } = await import("@/lib/camera-path");
const { splatFrame } = await import("@/lib/path-splat");
const { buildPointCloud, lensFov, LENS } = await import("@/lib/scene3d");
const { pathScene, renderPathVideo } = await import("@/server/path-render");
const route = await import("@/app/api/fly-around/route");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A 64 × 48 still: a red square in the middle of a blue field, and its depth (the square near, bright). */
function scene() {
  const w = 64;
  const h = 48;
  const photo = Buffer.alloc(w * h * 4);
  const depth = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const inside = x > 20 && x < 44 && y > 12 && y < 36;
      photo.set(inside ? [220, 30, 30, 255] : [30, 60, 200, 255], o);
      const g = inside ? 230 : 40 + Math.round((y / h) * 60);
      depth.set([g, g, g, 255], o);
    }
  const save = (data: Buffer, name: string) => saveFile({ data: encodePng({ width: w, height: h, data }), contentType: "image/png", name, source: "upload" }).url;
  return { photo: save(photo, "still.png"), depth: save(depth, "depth.png") };
}

describe("exact orbit settings → keys", () => {
  it("starts at the photo, turns the asked degrees the asked way, and stays within H3 Max's 12 keys", () => {
    const keys = exact.exactOrbitKeys({ degrees: 360, direction: "ccw", tilt: 0, pulse: 0 });
    expect(keys[0]).toEqual(PHOTO_KEY);
    expect(keys.at(-1)).toMatchObject({ t: 1, azimuth: 360, elevation: 0, distance: 1 });
    expect(keys.length).toBeLessThanOrEqual(exact.EXACT_MAX_KEYS);
    const cam = toH3MaxTrajectory(keys);
    expect("trajectory" in cam && cam.trajectory.length).toBe(keys.length);
    expect(cam.notes).toEqual([]);
    expect(keys.length).toBeLessThanOrEqual(H3_LIMITS.max);
    const cw = exact.exactOrbitKeys({ degrees: 90, direction: "cw" });
    expect(cw.at(-1)!.azimuth).toBe(-90);
    expect(cw.length).toBe(5);
    expect(cw.every((k, i) => i === 0 || k.azimuth < cw[i - 1].azimuth)).toBe(true);
  });

  it("tilts the ring (rising first, either way) and pulses the radius 25% in twice", () => {
    for (const direction of ["cw", "ccw"] as const) {
      const keys = exact.exactOrbitKeys({ degrees: 360, direction, tilt: 20, pulse: 0.25 });
      const top = Math.max(...keys.map((k) => k.elevation));
      expect(top).toBeCloseTo(20, 0);
      expect(keys.find((k) => k.t === 0.25 || Math.abs(k.t - 0.2727) < 0.01)!.elevation).toBeGreaterThan(0);
      expect(Math.min(...keys.map((k) => k.distance))).toBeCloseTo(0.75, 1);
      expect(keys.at(-1)!.distance).toBeCloseTo(1, 3);
    }
  });

  it("keeps the numbers in range and knows which moves take the switch", () => {
    expect(exact.normalizeExact({ degrees: 5, tilt: 99, pulse: 0.2, direction: "x" as never })).toEqual({ degrees: 30, direction: "ccw", tilt: 20, pulse: 0.25 });
    expect(exact.normalizeExact({ degrees: 412 }).degrees).toBe(360);
    for (const id of ["motion-360-orbit", "motion-arc-left", "motion-arc-right", "motion-lazy-orbit", "drone-orbit", "arc-left", "arc-right", "bullet-time"]) expect(exact.takesExact(id), id).toBe(true);
    expect(exact.takesExact("dolly-in")).toBe(false);
    expect(exact.exactDefaults("arc-left")).toMatchObject({ degrees: 90, direction: "cw" });
    expect(exact.exactSummary({ degrees: 180, direction: "cw", tilt: 10, pulse: 0.25 })).toBe("180° clockwise · tilt 10° · pulse 25%");
  });
});

describe("the fly-around plan", () => {
  const image = "/api/files/uploads/still.png";
  const orbit = { degrees: 360, direction: "ccw" as const, tilt: 0, pulse: 0 };

  it("on your GPU: MoGe's depth, then Uni3C along the server's render of the path, free", () => {
    const p = fly.planFlyAround({ engine: "open", image, orbit });
    expect(p.blocker).toBeUndefined();
    expect(p.steps.map((s) => [s.key, s.request.modelId, s.request.op])).toEqual([
      ["depth", "oss-scene-moge", "scene-3d"],
      ["main", "oss-uni3c-path", "camera-path"],
    ]);
    expect(p.steps[1].after).toEqual(["depth"]);
    expect(p.steps[1].request.chain).toEqual([{ slot: "video", render: "path" }]);
    expect(p.steps[1].request.params?.cameraPath).toEqual(exact.exactOrbitKeys(orbit));
    expect(p.costUsd).toBe(0);
    expect(p.duration).toBeCloseTo(5.1, 1);
  });

  it("with a render already made (Image to 3D), skips the depth", () => {
    const p = fly.planFlyAround({ engine: "open", image, preset: "orbit_360", render: "/api/files/uploads/r.webm" });
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0].request.inputs).toEqual({ images: [image], video: "/api/files/uploads/r.webm" });
  });

  it("in the cloud: H3 Max camera-controls with the keys, 5 s at 768P = $0.40 at list", () => {
    const p = fly.planFlyAround({ engine: "cloud", image, orbit, duration: 5 });
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0].request).toMatchObject({ modelId: "minimax-h3-max-camera", op: "camera-path", params: { duration: 5, resolution: "768P" } });
    expect(p.costUsd).toBeCloseTo(0.4, 3);
  });

  it("in the cloud with views: H3 Max reference-to-video with the still first and the path in words", () => {
    const p = fly.planFlyAround({ engine: "cloud", image, views: ["/api/files/uploads/back.png"], orbit: { ...orbit, direction: "cw", degrees: 180 } });
    expect(p.steps[0].request).toMatchObject({ modelId: "minimax-h3-max", op: "ref2v", inputs: { images: [image, "/api/files/uploads/back.png"] } });
    expect(p.steps[0].request.prompt).toMatch(/180-degree arc around the subject, moving to the left/);
  });

  it("asks for the still and a path", () => {
    expect(fly.planFlyAround({ engine: "cloud", orbit }).blocker).toBe("Add the still to film");
    expect(fly.planFlyAround({ engine: "open", image }).blocker).toBe("Pick a path first");
  });
});

describe("the server's path render (option B)", () => {
  it("draws the photo's own view on frame 0 and turns away from it later", () => {
    const w = 32;
    const h = 24;
    const photo = { width: w, height: h, data: new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 0 ? 200 : i % 4 === 3 ? 255 : 40)) };
    const depth = { width: w, height: h, data: new Uint8Array(w * h * 4).fill(128) };
    const hFov = lensFov(LENS.default, w / h).h;
    const cloud = buildPointCloud(photo, depth, { hFov });
    const size = { width: w, height: h };
    const poses = framePoses(exact.exactOrbitKeys({ degrees: 90, direction: "ccw" }), 3, cloud.depth, hFov, size);
    const first = splatFrame(cloud, poses.poses[0], poses.intrinsic, w, h);
    const lit = (f: Uint8Array) => f.filter((_, i) => i % 3 === 0 && f[i] > 100).length;
    expect(lit(first)).toBe(w * h);
    // A quarter turn round a flat picture sees it edge-on: most of the frame is a hole (black).
    expect(lit(splatFrame(cloud, poses.poses[2], poses.intrinsic, w, h))).toBeLessThan(w * h * 0.5);
  });

  it("reads the still and its depth, renders 81 frames of the still's shape and stores an MP4", async () => {
    const { photo, depth } = scene();
    const s = await pathScene({ photo, depth, keys: exact.exactOrbitKeys({ degrees: 60, direction: "cw" }) });
    expect(s.count).toBe(PATH_FRAMES);
    expect({ width: s.width, height: s.height }).toEqual(renderSize(64 / 48));
    const f0 = s.frame(0);
    const mid = ((s.height / 2) * s.width + s.width / 2) * 3;
    expect(f0[mid]).toBeGreaterThan(150); // the red square in the middle
    if (spawnSync("ffmpeg", ["-version"]).status !== 0) return;
    const url = await renderPathVideo({ photo, depth, keys: exact.exactOrbitKeys({ degrees: 60, direction: "cw" }) });
    const file = await readRef(url);
    expect(file.contentType).toBe("video/mp4");
    expect(file.data.subarray(4, 8).toString()).toBe("ftyp");
  }, 60_000);

  it("takes the depth picture of the scene step for a path slot", () => {
    const outputs = [
      { url: "/api/files/outputs/scene.glb", kind: "model3d" as const },
      { url: "/api/files/outputs/depth.png", kind: "image" as const },
    ];
    expect(gens.pickOutput(outputs, { slot: "video", render: "path" })?.url).toBe("/api/files/outputs/depth.png");
  });
});

describe("/api/fly-around", () => {
  const post = (url: string, body: unknown) => route.POST(new Request(`http://localhost:3000${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

  it("prices a preview on both engines and refuses a body without a path's numbers in range", async () => {
    const { photo } = scene();
    const open = await post("/api/fly-around?preview=1", { engine: "open", image: photo, orbit: { degrees: 180, direction: "cw" } });
    expect(open.status).toBe(200);
    expect(await open.json()).toMatchObject({ engine: "open", steps: 2, costUsd: 0, label: "180° clockwise · level" });
    const cloud = await post("/api/fly-around?preview=1", { engine: "cloud", image: photo, preset: "orbit_90_cw" });
    expect(await cloud.json()).toMatchObject({ engine: "cloud", model: { id: "minimax-h3-max-camera" }, steps: 1 });
    expect((await post("/api/fly-around?preview=1", { engine: "open", image: photo, orbit: { degrees: 720, direction: "cw" } })).status).toBe(400);
  });

  it("runs a demo on the open engine as two chained steps, the film waiting for the depth with a path slot", async () => {
    const { photo } = scene();
    setSetting("demoMode", "on");
    try {
      const r = await post("/api/fly-around", { engine: "open", image: photo, orbit: { degrees: 90, direction: "ccw" } });
      expect(r.status).toBe(201);
      const out = await r.json();
      expect(out.items).toHaveLength(2);
      expect(out.final.modelId).toBe("oss-uni3c-path");
      expect(out.final.request.chain).toEqual([{ slot: "video", render: "path" }]);
    } finally {
      setSetting("demoMode", "auto");
    }
  });
});

describe("Cinema's Director: an orbit move with the Exact switch", () => {
  const still = "/api/files/uploads/still.png";
  const base = (engine: "cloud" | "open", over: Record<string, unknown> = {}) => ({ engine, mode: "video" as const, action: "generate" as const, prompt: "She smiles", settings: {}, moves: ["drone-orbit", "slow-zoom-in"], images: [still], ...over });

  it("films the numbers on both engines, the other moves stay words", async () => {
    const { planCinema } = await import("@/lib/catalog/cinema");
    const exactOrbit = { degrees: 180, direction: "cw" as const, tilt: 10, pulse: 0 };
    const cloud = planCinema(base("cloud", { exact: exactOrbit }), { cloudAllowed: true });
    expect(cloud.blocker).toBeUndefined();
    expect(cloud.steps.map((s) => s.request.modelId)).toEqual(["minimax-h3-max-camera"]);
    expect(cloud.steps[0].request.params?.cameraPath).toEqual(exact.exactOrbitKeys(exactOrbit));
    expect(cloud.steps[0].request.prompt).toMatch(/She smiles/);
    expect(cloud.notes[0]).toBe("Drone Orbit follows your numbers exactly: 180° clockwise · tilt 10°");
    const open = planCinema(base("open", { exact: exactOrbit }), { cloudAllowed: true });
    expect(open.steps.map((s) => [s.key, s.request.modelId, s.after])).toEqual([
      ["depth", "oss-scene-moge", undefined],
      ["main", "oss-uni3c-path", ["depth"]],
    ]);
    expect(open.costUsd).toBe(0);
  });

  it("keeps the LoRA's or the prompt's orbit with the switch off, and asks for a start frame with it on", async () => {
    const { planCinema } = await import("@/lib/catalog/cinema");
    const loose = planCinema(base("cloud"), { cloudAllowed: true });
    expect(loose.steps[0].request.modelId).not.toBe("minimax-h3-max-camera");
    expect(planCinema(base("cloud", { exact: { degrees: 90, direction: "ccw" }, images: [] }), { cloudAllowed: true }).blocker).toBe("Add a start frame to film an exact orbit");
    // A move that isn't an orbit ignores the numbers.
    expect(planCinema(base("cloud", { moves: ["dolly-in"], exact: { degrees: 90, direction: "ccw" } }), { cloudAllowed: true }).steps[0].request.modelId).not.toBe("minimax-h3-max-camera");
  });
});

describe("Image to 3D: Film it photoreal", () => {
  it("films the photo round the model: the model's render on your GPU, H3 Max's keyframes in the cloud", async () => {
    const m3d = await import("@/lib/av/model3d");
    const open = m3d.photorealBody({ photo: "/api/files/uploads/mug.png" }, "open", "/api/files/uploads/orbit.webm")!;
    expect(open).toMatchObject({ engine: "open", image: "/api/files/uploads/mug.png", render: "/api/files/uploads/orbit.webm", feature: m3d.MODEL3D_FILM_FEATURE, orbit: m3d.PHOTOREAL_ORBIT });
    const plan = fly.planFlyAround(open);
    expect(plan.steps.map((s) => s.request.modelId)).toEqual(["oss-uni3c-path"]);
    const cloud = m3d.photorealBody({ photo: "/api/files/uploads/mug.png" }, "cloud", "/api/files/uploads/orbit.webm")!;
    expect(cloud).not.toHaveProperty("render");
    expect(fly.planFlyAround(cloud).steps[0].request.modelId).toBe("minimax-h3-max-camera");
    expect(m3d.photorealBody({}, "cloud")).toBeNull();
    expect(m3d.photorealBody({}, "cloud", undefined, "/api/files/outputs/drawn.png")!.image).toBe("/api/files/outputs/drawn.png");
    // The model turns the other way to the camera: a full turn over the 81 frames, starting at the front.
    expect(m3d.photorealAngle(0)).toBe(0);
    expect(m3d.photorealAngle(PATH_FRAMES - 1)).toBeCloseTo(-2 * Math.PI, 5);
  });
});

describe("Canvas: the Camera path and Fly around nodes", () => {
  const node = (id: string, type: string, x: number, y: number, data: Record<string, unknown> = {}) => ({ id, type, position: { x, y }, data }) as never;
  const edge = (source: string, target: string, targetHandle: string) => ({ id: `${source}>${target}:${targetHandle}`, source, sourceHandle: "out", target, targetHandle });

  it("has the node types, ports and outputs", async () => {
    const c = await import("@/lib/catalog/canvas");
    expect(c.NODE_SPECS["camera-path"].group).toBe("Inputs");
    expect(c.NODE_SPECS["fly-around"]).toMatchObject({ group: "Generate", ops: ["camera-path"] });
    expect(c.isGenerator({ type: "fly-around" })).toBe(true);
    expect(c.isGenerator({ type: "camera-path" })).toBe(false);
    expect(c.inputPorts({ type: "fly-around", data: {} }).map((p) => [p.id, p.type, p.multiple])).toEqual([
      ["prompt", "text", true],
      ["images", "image", true],
      ["path", "path", false],
    ]);
    const g = { nodes: [], edges: [] };
    expect(c.outputType(g, node("p", "camera-path", 0, 0))).toBe("path");
    expect(c.outputType(g, node("f", "fly-around", 0, 0))).toBe("video");
    expect(c.acceptsType("preview", "path")).toBe(false);
    expect(c.defaultModelForNode({ type: "fly-around", data: {} }, "open")?.id).toBe("oss-uni3c-path");
    expect(c.defaultModelForNode({ type: "fly-around", data: {} }, "cloud")?.id).toBe("minimax-h3-max-camera");
    expect(c.paletteItems().some((p) => p.id === "camera-path")).toBe(true);
    expect(c.cameraPathOf({ data: { orbit: { degrees: 90, direction: "cw", tilt: 0, pulse: 0 } } }).keys.at(-1)!.azimuth).toBe(-90);
  });

  it("compiles a still, a view and a path into the engine's steps, a generated still chained in", async () => {
    const c = await import("@/lib/catalog/canvas");
    const graph = (modelId: string, still: Record<string, unknown>) => ({
      nodes: [
        still.type === "model" ? node("img", "model", 0, 0, { modelId: "nano-banana-pro", mediaKind: "image" }) : node("img", "image-input", 0, 0, { url: "/api/files/uploads/still.png" }),
        node("view", "image-input", 0, 100, { url: "/api/files/uploads/back.png" }),
        node("path", "camera-path", 0, 200, { orbit: { degrees: 180, direction: "ccw", tilt: 0, pulse: 0 } }),
        node("fly", "fly-around", 300, 0, { modelId }),
      ],
      edges: [edge("img", "fly", "images"), edge("view", "fly", "images"), edge("path", "fly", "path")],
    });
    const cloud = c.describeNode(graph("minimax-h3-max-camera", {}) as never, graph("minimax-h3-max-camera", {}).nodes[3] as never);
    expect(cloud.error).toBeUndefined();
    expect(cloud.steps!.map((s) => [s.request.modelId, s.request.op])).toEqual([["minimax-h3-max", "ref2v"]]);
    expect(cloud.steps![0].request.inputs?.images).toEqual(["/api/files/uploads/still.png", "/api/files/uploads/back.png"]);
    const g = graph("oss-uni3c-path", { type: "model" });
    const open = c.describeNode(g as never, g.nodes[3] as never);
    expect(open.error).toBeUndefined();
    expect(open.deps).toEqual(["img"]);
    expect(open.costUsd).toBe(0);
    const [depth, main] = open.steps!;
    expect(depth).toMatchObject({ key: "depth", request: { modelId: "oss-scene-moge", chain: [{ slot: "images", position: "first" }] }, from: [{ node: "img" }] });
    expect(main).toMatchObject({ key: "main", request: { modelId: "oss-uni3c-path", chain: [{ slot: "images", position: "first" }, { slot: "video", render: "path" }] }, from: [{ node: "img" }, { step: "depth" }] });
    expect(depth.request.feature).toBe(c.CANVAS_STEP_FEATURE);
    // Nothing on the path: said on the node.
    const bare = { ...g, edges: g.edges.filter((e) => e.targetHandle !== "path") };
    expect(c.describeNode(bare as never, g.nodes[3] as never).error).toBe("Connect a Camera path");
  });
});

describe("Assist / MCP: fly_around", () => {
  it("takes a still and an orbit's numbers or a preset, and plans the engine's steps", async () => {
    const tools = await import("@/server/assist/studio-tools");
    const tool = tools.STUDIO_TOOLS.find((t) => t.name === "fly_around")!;
    expect(tool).toBeDefined();
    expect(tools.FlyAroundToolInput.safeParse({ image: "/api/files/uploads/a.png", degrees: 720 }).success).toBe(false);
    expect(tools.FlyAroundToolInput.safeParse({ image: "/api/files/uploads/a.png", preset: "orbit_90_cw" }).success).toBe(true);
    expect(tools.FlyAroundToolInput.safeParse({ image: "/api/files/uploads/a.png", preset: "spin" }).success).toBe(false);
    const ctx = { engine: "open" } as never;
    const open = tools.fallbackSteps.flyAround({ image: "/api/files/uploads/a.png", degrees: 90, direction: "cw" }, ctx);
    expect(open.map((s) => [s.key, s.request.modelId, s.after])).toEqual([
      ["depth", "oss-scene-moge", undefined],
      ["main", "oss-uni3c-path", ["depth"]],
    ]);
    const cloud = tools.fallbackSteps.flyAround({ image: "/api/files/uploads/a.png", preset: "orbit_tilt_20" }, { engine: "cloud" } as never);
    expect(cloud[0].request).toMatchObject({ modelId: "minimax-h3-max-camera", op: "camera-path" });
  });
});

describe("the GPU pre-flight board", () => {
  it("lists exact orbits on the depth and Uni3C graphs", async () => {
    const { STUDIO_ROWS, studioTool } = await import("@/server/gpu/tools");
    const row = STUDIO_ROWS.find((r) => r.href === "/motions")!;
    expect(row.label).toBe("Exact orbits and Fly around");
    const t = studioTool(row)!;
    expect(t.workflows).toEqual(expect.arrayContaining(["scene-mesh-moge", "wan21-i2v-uni3c-path"]));
  });
});

describe("an account's path render reads only its own files", () => {
  it("refuses the owner's still and depth inside an account's run, and renders the account's own", async () => {
    const auth = await import("@/server/auth");
    const { runAsTenant } = await import("@/server/tenant");
    const { RefError } = await import("@/server/storage");
    const a = auth.createAccount("fly-tenant@example.com", "long enough").id;
    const owners = scene();
    const keys = exact.exactOrbitKeys({ degrees: 60, direction: "ccw" });
    await runAsTenant({ kind: "account", id: a }, async () => {
      await expect(pathScene({ ...owners, keys })).rejects.toBeInstanceOf(RefError);
      const mine = scene();
      expect((await pathScene({ ...mine, keys })).count).toBe(PATH_FRAMES);
    });
  });
});
