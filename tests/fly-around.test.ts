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
