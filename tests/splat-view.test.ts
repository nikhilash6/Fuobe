import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { IDOL_MODELS, model3dView, splatFormatOf } from "@/lib/av/model3d";
import { FALLBACK_TEXT, HOME_ELEVATION_DEG, hazeCutoffFor, homeView, SPLAT_MAX_BYTES, splatFallback, splatPose, splatTooBig, stillFileName, subjectBounds, viewerFor } from "@/lib/av/splat-view";

/**
 * Looking around splats (idol-4): which viewer a 3D output opens in, the haze cut-off each model starts with, when
 * the orbit video stays instead, the demo splats (parsed by Spark itself), and that only the splat viewer's
 * dynamic import brings Spark in.
 */

const samples = path.join(process.cwd(), "public", "samples");

describe("which viewer draws a 3D output", () => {
  it("a splat file goes to the splat viewer, a GLB to model-viewer", () => {
    expect(viewerFor({ url: "/api/files/g/a.spz", kind: "model3d" })).toBe("splat");
    expect(viewerFor({ url: "https://fal.test/x/splat.ply?sig=1", kind: "model3d" })).toBe("splat");
    expect(viewerFor({ url: "/api/files/g/a.bin", kind: "model3d", meta: { format: "ksplat" } })).toBe("splat");
    expect(viewerFor({ url: "/api/files/g/a.glb", kind: "model3d" })).toBe("glb");
    // The demo GLB marked as a splat (older demo results) stays a GLB.
    expect(viewerFor({ url: "sample:demo-model.glb", kind: "model3d", meta: { format: "glb", splat: true } })).toBe("glb");
    expect(viewerFor({ url: "/api/files/g/a.png", kind: "image" })).toBeUndefined();
    expect(viewerFor(undefined)).toBeUndefined();
  });

  it("the demo splats read as splats on the card", () => {
    expect(splatFormatOf({ url: "/api/files/outputs/x.spz", meta: { format: "spz" } })).toBe("spz");
    const view = model3dView({
      outputs: [
        { url: "/api/files/g/demo.spz", kind: "model3d", meta: { demo: true, format: "spz", role: "splat" } },
        { url: "/api/files/g/orbit.mp4", kind: "video", meta: { turntable: true } },
      ],
      request: { feature: "image-to-3d", modelId: "oss-triposplat", op: "splat" },
    } as never);
    expect(view).toMatchObject({ glb: undefined, splat: { url: "/api/files/g/demo.spz", format: "spz" }, turntable: "/api/files/g/orbit.mp4" });
  });
});

describe("the haze cut-off a result starts with", () => {
  it("Idol 3D hides Gaussians under 0.05 on both engines; TripoSplat and others draw them all", () => {
    expect(hazeCutoffFor(IDOL_MODELS.open)).toBe(0.05);
    expect(hazeCutoffFor(IDOL_MODELS.cloud)).toBe(0.05);
    expect(hazeCutoffFor("oss-triposplat")).toBe(0);
    expect(hazeCutoffFor("triposplat")).toBe(0);
    expect(hazeCutoffFor(undefined)).toBe(0);
  });
});

describe("when the orbit video stays instead of the viewer", () => {
  it("no WebGL2, a file too big for the device, reduced motion until asked", () => {
    expect(splatFallback({ webgl2: true, coarse: false, reducedMotion: false })).toBeNull();
    expect(splatFallback({ webgl2: false, coarse: false, reducedMotion: false })).toBe("no-webgl2");
    expect(splatFallback({ webgl2: true, coarse: true, reducedMotion: false, bytes: SPLAT_MAX_BYTES.coarse + 1 })).toBe("too-big");
    expect(splatFallback({ webgl2: true, coarse: false, reducedMotion: false, bytes: SPLAT_MAX_BYTES.coarse + 1 })).toBeNull();
    expect(splatFallback({ webgl2: true, coarse: false, reducedMotion: true })).toBe("reduced-motion");
    expect(splatFallback({ webgl2: true, coarse: false, reducedMotion: true, asked: true })).toBeNull();
    expect(FALLBACK_TEXT["no-webgl2"]).toMatch(/Download/);
  });

  it("a 262,144-Gaussian .ply opens on a phone; a 1,048,576-Gaussian one only on a computer", () => {
    const ply = (n: number) => n * 68 + 1000;
    expect(splatTooBig(ply(262_144), true)).toBe(false);
    expect(splatTooBig(ply(1_048_576), true)).toBe(true);
    expect(splatTooBig(ply(1_048_576), false)).toBe(false);
    expect(splatTooBig(undefined, true)).toBe(false);
  });

  it("a still is saved under the model's name", () => {
    expect(stillFileName("Idol 3D")).toBe("Idol 3D still.png");
    expect(stillFileName("<>")).toBe("splat still.png");
  });
});

describe("the demo splats", () => {
  const ply = fs.readFileSync(path.join(samples, "demo-splat.ply"));
  const spz = fs.readFileSync(path.join(samples, "demo-splat.spz"));

  it("are a standard 3DGS .ply (17 floats per Gaussian, as Idol writes) and a gzipped .spz v2", () => {
    const header = ply.subarray(0, ply.indexOf("end_header\n") + 11).toString("ascii");
    expect(header).toMatch(/^ply\nformat binary_little_endian 1\.0\nelement vertex 4096\n/);
    expect(header.match(/^property float /gm)).toHaveLength(17);
    expect(ply.length).toBe(header.length + 4096 * 17 * 4);
    const raw = zlib.gunzipSync(spz);
    expect(raw.readUInt32LE(0)).toBe(0x5053474e);
    expect(raw.readUInt32LE(4)).toBe(2);
    expect(raw.readUInt32LE(8)).toBe(4096);
    // Small enough for the repo: under 300 KB and 60 KB.
    expect(ply.length).toBeLessThan(300_000);
    expect(spz.length).toBeLessThan(60_000);
  });

  it("Spark reads both, and a 0.05 cut-off leaves the 2,816 solid Gaussians of 4,096", async () => {
    const spark = await import("@sparkjsdev/spark");
    expect(spark.getSplatFileType(new Uint8Array(ply))).toBe("ply");
    expect(spark.getSplatFileType(new Uint8Array(spz))).toBe("spz");
    for (const [bytes, fileType] of [
      [ply, spark.SplatFileType.PLY],
      [spz, spark.SplatFileType.SPZ],
    ] as const) {
      for (const [threshold, count] of [
        [undefined, 4096],
        [0.05, 2816],
      ] as const) {
        const { fileBytes } = await spark.transcodeSpz({ inputs: [{ fileBytes: new Uint8Array(bytes), fileType }], opacityThreshold: threshold });
        expect(zlib.gunzipSync(Buffer.from(fileBytes)).readUInt32LE(8), `${fileType} ${threshold}`).toBe(count);
      }
    }
  }, 30_000);
});

describe("Spark loads only with the splat viewer", () => {
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []));
  const src = files(path.join(process.cwd(), "src"));

  it("only splat-engine.ts imports it, and only through a dynamic import", () => {
    const importers = src.filter((f) => fs.readFileSync(f, "utf8").includes("@sparkjsdev/spark"));
    expect(importers.map((f) => path.relative(process.cwd(), f).split(path.sep).join("/"))).toEqual(["src/components/model3d/splat-engine.ts"]);
    const engineUsers = src.filter((f) => /["']\.\/splat-engine["']|model3d\/splat-engine["']/.test(fs.readFileSync(f, "utf8")));
    for (const f of engineUsers) {
      const text = fs.readFileSync(f, "utf8");
      // Type imports vanish from the bundle; anything else must be import("./splat-engine").
      expect(text.replace(/import type [^;]+;/g, "").replace(/import\("(\.\/|\.\.\/model3d\/)splat-engine"\)/g, ""), path.relative(process.cwd(), f)).not.toMatch(/splat-engine/);
    }
    // The splat viewer, and Cinema's 3D scene for its props (idol-9; itself loaded only when a scene opens).
    expect(engineUsers.map((f) => path.relative(process.cwd(), f).split(path.sep).join("/")).sort()).toEqual(["src/components/cinema/scene-engine.ts", "src/components/model3d/splat-viewer.tsx"]);
  });
});

describe("the viewer leaves the page as it found it", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

  it("gives its WebGL context back when it closes, and falls back when the browser takes it", () => {
    const engine = read("src/components/model3d/splat-engine.ts");
    const dispose = engine.slice(engine.indexOf("  dispose() {"));
    expect(dispose.slice(0, dispose.indexOf("\n  }\n"))).toMatch(/this\.renderer\.forceContextLoss\(\)/);
    expect(engine).toMatch(/addEventListener\("webglcontextlost"/);
  });

  it("the full-screen panel takes focus only when the user chose 'Look around in 3D', so the arrow keys keep browsing", () => {
    const panel = read("src/components/studio/result-media.tsx");
    const tag = panel.match(/<SplatViewer[^>]*\/>/)![0];
    expect(tag).toMatch(/autoFocus=\{asked\}/);
    // A dialog that focuses the stage on opening doesn't hand it ArrowLeft / ArrowRight (tests/e2e/splat-viewer.mjs checks it in a browser).
    const viewer = read("src/components/model3d/splat-viewer.tsx");
    expect(viewer).toMatch(/if \(!engaged\.current && \(e\.key === "ArrowLeft" \|\| e\.key === "ArrowRight"\)\) return;/);
  });
});

describe("how a splat stands and where the camera starts", () => {
  /**
   * A standing figure as ComfyUI's TripoSplat decoder saves it (Idol 3D): the 3DGS frame, y down, so the head is at
   * -y and the feet at +y, its front towards +x once stood up. Solid body Gaussians plus faint haze and a few floaters.
   */
  function comfyFigure() {
    const centers: number[] = [];
    const opacities: number[] = [];
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 4000; i++) {
      const y = -0.5 + (i / 3999) * 1; // head (-0.5) to feet (+0.5)
      centers.push(rand() * 0.12, y, rand() * 0.1);
      opacities.push(0.9);
    }
    for (let i = 0; i < 4000; i++) {
      centers.push(rand() * 0.3, rand() * 0.6, rand() * 0.3);
      opacities.push(0.02); // haze
    }
    for (let i = 0; i < 10; i++) {
      centers.push(3 + i, -4, 5); // floaters far off
      opacities.push(0.5);
    }
    return { centers, opacities };
  }
  /** The viewer's half turn about x for a y-down file: (x, y, z) to (x, -y, -z). */
  const turn = (c: number[]) => c.map((v, i) => (i % 3 === 0 ? v : -v));

  it("a ComfyUI splat (Idol 3D on your GPU or ours) is y-down and faces +x; cloud, demo and other files stand as they are", () => {
    expect(splatPose({ provider: "comfyui" }, { url: "/api/files/outputs/2026-11-07/a.spz", meta: { role: "splat", format: "spz" } })).toEqual({ yDown: true, frontYaw: 90 });
    expect(splatPose({ provider: "fal" }, { url: "https://fal.test/splat.ply" })).toEqual({ yDown: false, frontYaw: 0 });
    // Demo mode's splats are y-up wherever they show (scripts/gen-demo-splat.mjs).
    expect(splatPose({ provider: "mock" }, { url: "sample:demo-splat.spz", meta: { demo: true } })).toEqual({ yDown: false, frontYaw: 0 });
    expect(splatPose({ provider: "comfyui" }, { url: "sample:demo-splat.spz" })).toEqual({ yDown: false, frontYaw: 0 });
    expect(splatPose(undefined)).toEqual({ yDown: false, frontYaw: 0 });
  });

  it("the half turn stands the figure upright: its head ends up at the top", () => {
    const { centers, opacities } = comfyFigure();
    const head = (c: number[]) => c[1]; // the first Gaussian is the top of the head
    expect(head(centers)).toBeLessThan(0); // as saved: upside down in three.js (y up)
    const upright = turn(centers);
    expect(head(upright)).toBeGreaterThan(0);
    const b = subjectBounds(upright, opacities)!;
    expect(b.max[1]).toBeGreaterThan(0.45);
    expect(b.min[1]).toBeLessThan(-0.45);
  });

  it("the subject's box leaves out faint haze and stray floaters, so the figure isn't small in the middle", () => {
    const { centers, opacities } = comfyFigure();
    const b = subjectBounds(turn(centers), opacities)!;
    for (let k = 0; k < 3; k++) {
      expect(b.max[k] - b.min[k]).toBeLessThan(1.1);
      expect(Math.abs((b.max[k] + b.min[k]) / 2)).toBeLessThan(0.05);
    }
    // Without the opacity filter the floaters stretch it.
    const all = subjectBounds(turn(centers), opacities, { minOpacity: 0, trim: 0 })!;
    expect(all.max[0]).toBeGreaterThan(10);
    expect(subjectBounds([], [])).toBeNull();
  });

  it("home is in front of the subject, a little above, turning about its centre, filling the stage", () => {
    const b = { min: [-0.15, -0.5, -0.12] as [number, number, number], max: [0.15, 0.5, 0.12] as [number, number, number] };
    const fov = 40;
    const tan = Math.tan((fov / 2) * (Math.PI / 180));
    for (const aspect of [1440 / 900, 390 / 747, 844 / 300]) {
      const v = homeView(b, fov, aspect, { frontYaw: 90 });
      expect(v.target).toEqual([0, 0, 0]);
      const [dx, dy, dz] = v.position.map((p, i) => p - v.target[i]);
      // Faces +x (the decoder's front), barely above: no view from overhead.
      expect(dx).toBeGreaterThan(0);
      expect(Math.abs(dz)).toBeLessThan(1e-9);
      expect(dy / v.distance).toBeCloseTo(Math.sin((HOME_ELEVATION_DEG * Math.PI) / 180), 6);
      // The 1.0-tall figure takes 90% of the stage's height (its near face at distance - depth / 2).
      const near = v.distance - 0.15;
      expect(1 / (2 * near * tan)).toBeCloseTo(0.9, 2);
    }
    // A wide subject on a phone's tall stage fits its width instead.
    const wide = { min: [-1, -0.2, -0.2] as [number, number, number], max: [1, 0.2, 0.2] as [number, number, number] };
    const phone = homeView(wide, fov, 390 / 747);
    expect(2 / (2 * (phone.distance - 0.2) * tan * (390 / 747))).toBeCloseTo(0.9, 2);
    // The controls bar over the stage's foot: the subject keeps to the space above it.
    expect(homeView(b, fov, 1.5, { room: 0.8 }).distance).toBeGreaterThan(homeView(b, fov, 1.5).distance);
  });

  it("every viewer of a result passes how its file stands", () => {
    for (const f of ["src/components/studio/result-media.tsx", "src/components/model3d/model-card.tsx"]) {
      const text = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      for (const tag of text.match(/<SplatViewer[\s\S]*?\/>/g) ?? []) expect(tag, f).toMatch(/pose=\{splatPose\(g, /);
    }
  });

  it("on a phone the stage keeps every touch: no page scroll, pull to refresh, back swipe or page zoom", () => {
    const viewer = fs.readFileSync(path.join(process.cwd(), "src/components/model3d/splat-viewer.tsx"), "utf8");
    expect(viewer).toMatch(/touch-none overflow-hidden overscroll-none/);
    expect(viewer).toMatch(/"gesturestart", "gesturechange", "gestureend"/);
    expect(viewer).toMatch(/onTouchMove=\{\(e\) => e\.stopPropagation\(\)\}/);
    // 44 px targets for a finger.
    expect(viewer.match(/pointer-coarse:size-11/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
