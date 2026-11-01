import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOTION,
  H3_AZIMUTH_SIGN,
  H3_LIMITS,
  MAX_KEYS,
  PATH_PRESETS,
  PHOTO_KEY,
  addKey,
  cropFov,
  flyPoseOf,
  framePoses,
  fromScenePose,
  isPhotoPose,
  keyAt,
  keyLabel,
  normalizeKeys,
  presetKeys,
  removeKey,
  renderSize,
  simplifyKeys,
  toH3MaxTrajectory,
  toScenePose,
  type CameraKey,
  type Mat4,
} from "@/lib/camera-path";
import { scenePose } from "@/lib/scene3d";

/** The camera-path library (build plan N7-5): presets, editing, the scene pose, H3 Max's trajectory and per-frame cameras. */

const keys = (id: string) => presetKeys(id)!;

describe("presets", () => {
  it("every chip has keys, and every path starts at the photo's own pose", () => {
    for (const p of PATH_PRESETS) {
      const k = keys(p.id);
      expect(k.length, p.id).toBeGreaterThanOrEqual(2);
      expect(k.length, p.id).toBeLessThanOrEqual(MAX_KEYS);
      expect(k[0], p.id).toMatchObject({ t: 0, azimuth: 0, elevation: 0, distance: 1 });
      expect(k[k.length - 1].t, p.id).toBe(1);
      expect(k.map((x) => x.t), p.id).toEqual([...k.map((x) => x.t)].sort((a, b) => a - b));
    }
  });

  it("orbit_360 is 5 keys from 0° to 360°, level and at the photo's distance", () => {
    expect(keys("orbit_360")).toEqual([0, 90, 180, 270, 360].map((azimuth, i) => ({ t: i / 4, azimuth, elevation: 0, distance: 1 })));
  });

  it("arcs are signed: counter-clockwise from above moves right (+), clockwise left (−), a key every 90° at most", () => {
    expect(keys("orbit_90_ccw").map((k) => k.azimuth)).toEqual([0, 90]);
    expect(keys("orbit_90_cw").map((k) => k.azimuth)).toEqual([0, -90]);
    expect(keys("orbit_90").map((k) => k.azimuth)).toEqual([0, 90]);
    expect(keys("orbit_200_cw").map((k) => k.azimuth)).toEqual([0, -66.6667, -133.3333, -200]);
    expect(presetKeys("orbit_0")).toBeNull();
    expect(presetKeys("orbit_400")).toBeNull();
    expect(presetKeys("spiral")).toBeNull();
  });

  it("the tilted ring rises to +20° on one side and dips to −20° on the other, level in front and behind", () => {
    const k = keys("orbit_tilt_20");
    expect(k.map((x) => x.azimuth)).toEqual([0, 45, 90, 135, 180, 225, 270, 315, 360]);
    expect(k[2].elevation).toBeCloseTo(20, 3);
    expect(k[6].elevation).toBeCloseTo(-20, 3);
    for (const i of [0, 4, 8]) expect(Math.abs(k[i].elevation)).toBeLessThan(1e-9);
    expect(Math.max(...k.map((x) => x.elevation))).toBeCloseTo(20, 3);
  });

  it("the push-pull arc turns 180° and moves in by 25% twice: 1, 0.75, 1, 0.75, 1 at the quarters", () => {
    const k = keys("orbit_180_push");
    expect(k[k.length - 1].azimuth).toBe(180);
    expect([0, 2, 4, 6, 8].map((i) => k[i].distance)).toEqual([1, 0.75, 1, 0.75, 1]);
    expect(Math.min(...k.map((x) => x.distance))).toBe(0.75);
  });

  it("the figure-8 crosses at the photo's view twice and swings ±30° round, less than ±9° up and down", () => {
    const k = keys("lemniscate");
    expect(k[4]).toMatchObject({ azimuth: 0, elevation: 0 });
    expect(k[8]).toMatchObject({ azimuth: 0, elevation: 0 });
    expect(Math.max(...k.map((x) => x.azimuth))).toBe(30);
    expect(Math.min(...k.map((x) => x.azimuth))).toBe(-30);
    expect(Math.max(...k.map((x) => Math.abs(x.elevation)))).toBeCloseTo(8.66, 2);
  });

  it("dollies change only the distance: in to 0.6x, out to 1.5x; trucks slide half the subject distance", () => {
    expect(keys("zoom_in").map((k) => k.distance)).toEqual([1, 0.6]);
    expect(keys("zoom_out").map((k) => k.distance)).toEqual([1, 1.5]);
    expect(keys("truck_left").map((k) => k.truck)).toEqual([0, -0.5]);
    expect(keys("truck_right").map((k) => k.truck)).toEqual([0, 0.5]);
  });
});

describe("editing a path", () => {
  it("adds keys at the end and spaces them evenly; the start always stays", () => {
    let path: CameraKey[] = [];
    path = addKey(path, { azimuth: 45, elevation: 10, distance: 1.2 });
    expect(path).toEqual([PHOTO_KEY, { t: 1, azimuth: 45, elevation: 10, distance: 1.2 }]);
    path = addKey(path, { azimuth: 90, elevation: 0, distance: 1 });
    expect(path.map((k) => k.t)).toEqual([0, 0.5, 1]);
    expect(removeKey(path, 0)).toEqual(path);
    expect(removeKey(path, 1).map((k) => [k.t, k.azimuth])).toEqual([
      [0, 0],
      [1, 90],
    ]);
  });

  it("holds at most 24 keys: your GPU follows them all, the cloud's H3 Max simplifies past 12 and says so", () => {
    let path: CameraKey[] = [];
    for (let i = 1; i <= 30; i++) path = addKey(path, { azimuth: i * 10, elevation: 0, distance: 1 });
    expect(MAX_KEYS).toBe(24);
    expect(path).toHaveLength(MAX_KEYS);
    const cloud = toH3MaxTrajectory(path);
    expect("trajectory" in cloud && cloud.trajectory).toHaveLength(H3_LIMITS.max);
    expect(cloud.notes.join(" ")).toMatch(/H3 Max takes up to 12 keyframes: the path is simplified/);
  });

  it("interpolates angles in a line and distance by ratio, holding before the first key and after the last", () => {
    const path: CameraKey[] = [
      { t: 0.2, azimuth: 0, elevation: 0, distance: 1 },
      { t: 0.6, azimuth: 100, elevation: 20, distance: 4 },
    ];
    expect(keyAt(path, 0)).toMatchObject({ azimuth: 0, distance: 1 });
    const mid = keyAt(path, 0.4);
    expect(mid.azimuth).toBeCloseTo(50);
    expect(mid.elevation).toBeCloseTo(10);
    expect(mid.distance).toBeCloseTo(2);
    expect(keyAt(path, 1)).toMatchObject({ azimuth: 100, distance: 4, t: 1 });
  });

  it("puts keys in order inside 0–1 and starts them at the photo when the first one is later", () => {
    const k = normalizeKeys([
      { t: 1.5, azimuth: 90, elevation: 0, distance: 1 },
      { t: 0.5, azimuth: 30, elevation: 120, distance: 99 },
    ]);
    expect(k.map((x) => x.t)).toEqual([0, 0.5, 1]);
    expect(k[0]).toEqual(PHOTO_KEY);
    expect(k[1]).toMatchObject({ elevation: 90, distance: 4 });
  });

  it("always starts at the photo's pose: a key at time 0 anywhere else is replaced by it", () => {
    const k = normalizeKeys([
      { t: 0, azimuth: 90, elevation: 10, distance: 2 },
      { t: 1, azimuth: 180, elevation: 0, distance: 1 },
    ]);
    expect(k).toEqual([PHOTO_KEY, { t: 1, azimuth: 180, elevation: 0, distance: 1 }]);
    // Two keys at time 0: the photo's pose stays, the other goes.
    const two = normalizeKeys([{ t: 0, azimuth: 45, elevation: 0, distance: 1 }, PHOTO_KEY, { t: 0.5, azimuth: 90, elevation: 0, distance: 1 }]);
    expect(two.map((x) => [x.t, x.azimuth])).toEqual([
      [0, 0],
      [0.5, 90],
    ]);
    // A slide's start (the photo's pose, no slide yet) is kept as it is; a start already slid is not the photo's pose.
    expect(normalizeKeys(keys("truck_left"))).toEqual(keys("truck_left"));
    expect(isPhotoPose({ t: 0, azimuth: 0, elevation: 0, distance: 1, truck: 0.5 })).toBe(false);
    // H3 Max and the per-frame cameras get the corrected start too.
    const cam = toH3MaxTrajectory([{ t: 0, azimuth: 90, elevation: 0, distance: 1 }, { t: 1, azimuth: 180, elevation: 0, distance: 1 }]);
    expect("trajectory" in cam && cam.trajectory[0]).toMatchObject({ time: 0, azimuth: 0, elevation: 0, distance: 1 });
  });

  it("labels a chip with seconds, round, height and distance", () => {
    expect(keyLabel({ t: 0.24, azimuth: 90, elevation: 10, distance: 1.2 }, 5)).toBe("1.2 s · 90° · +10° · 1.2x");
    expect(keyLabel({ t: 1, azimuth: -45.4, elevation: -5, distance: 0.6 }, 5)).toBe("5.0 s · -45° · -5° · 0.6x");
    expect(keyLabel({ t: 1, azimuth: 0, elevation: 0, distance: 1, truck: -0.5 }, 5)).toBe("5.0 s · 0° · 0° · 1.0x · slide left 0.5");
  });
});

describe("the scene pose", () => {
  it("round-trips: azimuth = horizontal, elevation = vertical, distance = 2^(−(zoom − 5) / 5)", () => {
    for (const p of [
      { horizontal: 0, vertical: 0, zoom: 5 },
      { horizontal: 90, vertical: 30, zoom: 10 },
      { horizontal: 270.5, vertical: -30, zoom: 0 },
      { horizontal: 359.9, vertical: 12.3, zoom: 6.4 },
    ]) {
      const k = fromScenePose(p);
      expect(toScenePose(k)).toEqual(p);
    }
    expect(fromScenePose({ horizontal: 0, vertical: 0, zoom: 10 }).distance).toBe(0.5);
    expect(fromScenePose({ horizontal: 0, vertical: 0, zoom: 0 }).distance).toBe(2);
  });

  it("unwraps the angle to the turn nearest the previous key", () => {
    expect(fromScenePose({ horizontal: 350, vertical: 0, zoom: 5 }, 1, 10).azimuth).toBe(-10);
    expect(fromScenePose({ horizontal: 10, vertical: 0, zoom: 5 }, 1, 350).azimuth).toBe(370);
    expect(fromScenePose({ horizontal: 180, vertical: 0, zoom: 5 }, 1, 700).azimuth).toBe(540);
  });

  it("a key flown to in the viewer reads back as the same key through scenePose", () => {
    const depth = 3.2;
    for (const k of [
      { t: 1, azimuth: 60, elevation: 15, distance: 1.4 },
      { t: 1, azimuth: -120, elevation: -10, distance: 0.7 },
      { t: 1, azimuth: 180, elevation: 40, distance: 1 },
    ]) {
      const fly = flyPoseOf(framePoses([PHOTO_KEY, k], 2, depth, 60).poses[1]);
      const back = fromScenePose(scenePose(fly, 24, 24, depth), 1, k.azimuth);
      expect(back.azimuth).toBeCloseTo(k.azimuth, 0);
      expect(back.elevation).toBeCloseTo(k.elevation, 0);
      expect(back.distance).toBeCloseTo(k.distance, 1);
    }
  });
});

describe("H3 Max camera-controls trajectory", () => {
  it("keeps the keys, signed and unwrapped, as {time, azimuth, elevation, distance}", () => {
    const out = toH3MaxTrajectory(keys("orbit_360"));
    expect(out).toEqual({
      trajectory: [0, 90, 180, 270, 360].map((a, i) => ({ time: i / 4, azimuth: H3_AZIMUTH_SIGN * a, elevation: 0, distance: 1 })),
      notes: [],
    });
    const cw = toH3MaxTrajectory(keys("orbit_90_cw"));
    expect("trajectory" in cw && cw.trajectory.map((k) => k.azimuth)).toEqual([0, -90 * H3_AZIMUTH_SIGN]);
  });

  it("has 2–12 keys: one key is held to the end, more than 12 are simplified with the start and end kept", () => {
    const one = toH3MaxTrajectory([PHOTO_KEY]);
    expect("trajectory" in one && one.trajectory).toEqual([
      { time: 0, azimuth: 0, elevation: 0, distance: 1 },
      { time: 1, azimuth: 0, elevation: 0, distance: 1 },
    ]);
    const many: CameraKey[] = Array.from({ length: 20 }, (_, i) => ({ t: i / 19, azimuth: i * 20 + (i > 0 && i < 19 && i % 3 === 0 ? 15 : 0), elevation: 0, distance: 1 }));
    const out = toH3MaxTrajectory(many);
    expect("trajectory" in out && out.trajectory).toHaveLength(12);
    if (!("trajectory" in out)) throw new Error("expected a trajectory");
    expect(out.trajectory[0]).toMatchObject({ time: 0, azimuth: 0 });
    expect(out.trajectory[11]).toMatchObject({ time: 1, azimuth: 380 * H3_AZIMUTH_SIGN });
    expect(out.notes.join(" ")).toMatch(/up to 12 keyframes/);
  });

  it("clamps the height to ±90, keeps distances above 0 and the turns within 32", () => {
    const steep = toH3MaxTrajectory([PHOTO_KEY, { t: 1, azimuth: 0, elevation: 95, distance: 1 }], { min: 2, max: 12, elevation: [-60, 60], maxTurns: 32 });
    expect("trajectory" in steep && steep.trajectory[1].elevation).toBe(60);
    expect(steep.notes.join(" ")).toMatch(/clamped/);
    const spin = toH3MaxTrajectory([PHOTO_KEY, { t: 1, azimuth: 360 * 40, elevation: 0, distance: 1 }]);
    if (!("trajectory" in spin)) throw new Error("expected a trajectory");
    expect(Math.abs(spin.trajectory[1].azimuth)).toBe(360 * 32);
    expect(spin.notes.join(" ")).toMatch(/at most 32 times/);
    for (const k of spin.trajectory) expect(k.distance).toBeGreaterThan(0);
  });

  it("a pure slide becomes the endpoint's own truck move; a slide inside an orbit is left out with a note", () => {
    expect(toH3MaxTrajectory(keys("truck_left"))).toMatchObject({ freeCamera: "truck_left" });
    expect(toH3MaxTrajectory(keys("truck_right"))).toMatchObject({ freeCamera: "truck_right" });
    const mixed = toH3MaxTrajectory([PHOTO_KEY, { t: 1, azimuth: 45, elevation: 0, distance: 1, truck: 0.5 }]);
    expect("trajectory" in mixed && mixed.trajectory[1].azimuth).toBe(45 * H3_AZIMUTH_SIGN);
    expect(mixed.notes.join(" ")).toMatch(/sideways slide is left out/);
  });

  it("simplifying drops the keys that change the path least", () => {
    const line: CameraKey[] = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, azimuth: t * 100, elevation: t === 0.5 ? 30 : 0, distance: 1 }));
    expect(simplifyKeys(line, 3).map((k) => k.t)).toEqual([0, 0.5, 1]);
  });

  it("has a motion prompt to send when the user writes none (the endpoint's own freezes the scene)", () => {
    expect(DEFAULT_MOTION).toMatch(/keeps moving naturally/);
  });
});

describe("per-frame cameras", () => {
  const mul = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const col = (m: Mat4, j: number) => [m[0][j], m[1][j], m[2][j]];
  const near = (a: number[], b: number[], d = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

  it("frame 0 is the photo's own camera: the identity", () => {
    const { poses } = framePoses(keys("orbit_360"), 81, 2.5, 60);
    expect(poses).toHaveLength(81);
    expect(poses[0]).toEqual([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]);
  });

  it("every frame is a rotation (orthonormal, right-handed) looking at the pivot from the key's distance", () => {
    const depth = 2.5;
    for (const id of ["orbit_360", "orbit_tilt_20", "orbit_180_push", "lemniscate", "zoom_in"]) {
      const { poses } = framePoses(keys(id), 33, depth, 60);
      poses.forEach((m, i) => {
        const [r, d, f] = [col(m, 0), col(m, 1), col(m, 2)];
        for (const v of [r, d, f]) expect(Math.hypot(...v)).toBeCloseTo(1, 5);
        expect(mul(r, d)).toBeCloseTo(0, 5);
        expect(mul(r, f)).toBeCloseTo(0, 5);
        expect(mul(d, f)).toBeCloseTo(0, 5);
        // x × y = z: right × down = forward.
        near([r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]], f, 5);
        const eye = col(m, 3);
        const toPivot = [0 - eye[0], 0 - eye[1], depth - eye[2]];
        const dist = Math.hypot(...toPivot);
        near(toPivot.map((v) => v / dist), f, 5);
        expect(dist / depth).toBeCloseTo(keyAt(keys(id), i / 32).distance, 4);
        // The camera never rolls: its right axis stays level.
        expect(r[1]).toBeCloseTo(0, 6);
      });
    }
  });

  it("a quarter orbit to the right ends at the pivot's right, looking left at it", () => {
    const { poses } = framePoses(keys("orbit_90_ccw"), 2, 2, 60);
    near(col(poses[1], 3), [2, 0, 2]);
    near(col(poses[1], 2), [-1, 0, 0]);
  });

  it("a truck slides the camera without turning it", () => {
    const { poses } = framePoses(keys("truck_right"), 2, 2, 60);
    near(col(poses[1], 3), [1, 0, 0]);
    near(col(poses[1], 2), [0, 0, 1]);
  });

  it("gives a pixel intrinsic for the frame's size and horizontal field of view", () => {
    const { intrinsic, width, height } = framePoses(keys("orbit_360"), 2, 2, 90, { width: 832, height: 480 });
    expect([width, height]).toEqual([832, 480]);
    expect(intrinsic).toEqual([
      [416, 0, 416],
      [0, 416, 240],
      [0, 0, 1],
    ]);
  });

  it("turns a pose into the viewer's fly camera (glTF axes): the photo is the origin looking down −Z", () => {
    const { poses } = framePoses(keys("orbit_90_ccw"), 2, 2, 60);
    expect(flyPoseOf(poses[0])).toEqual({ position: [0, 0, 0], yaw: 0, pitch: 0 });
    const end = flyPoseOf(poses[1]);
    near(end.position, [2, 0, -2]);
    expect(end.yaw).toBeCloseTo(Math.PI / 2, 6);
    expect(end.pitch).toBeCloseTo(0, 6);
  });

  it("crops the photo's field of view to the video's shape, and sizes frames on Wan's 16 px grid", () => {
    expect(cropFov(60, 16 / 9, 16 / 9)).toBe(60);
    expect(cropFov(60, 16 / 9, 21 / 9)).toBe(60);
    expect(cropFov(60, 16 / 9, 9 / 16)).toBeCloseTo(20.7, 1);
    expect(renderSize(16 / 9)).toEqual({ width: 832, height: 464 });
    expect(renderSize(9 / 16)).toEqual({ width: 464, height: 832 });
    expect(renderSize(1)).toEqual({ width: 832, height: 832 });
  });
});
