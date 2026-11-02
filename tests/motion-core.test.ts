import { describe, expect, it } from "vitest";
import { bezier, CURVES, back, bounce, circ, cubic, elastic, expo, linear, quad, quart, quint, sine, spring, springAt, springDuration, SPRINGS, steps } from "@/lib/motion/ease";
import { noise1, rng } from "@/lib/motion/random";
import { clamp, frameCount, frameTime, local, quantize } from "@/lib/motion/time";
import { sample, scaleCues, stagger } from "@/lib/motion/tween";
import { designSize, exportBitrate, exportSize, previewSize } from "@/lib/motion/sizes";
import { normalizeRecipe, recipeKey, RECIPE_MAX_BYTES } from "@/lib/motion/recipe";
import { about, multiply, roundRectPath } from "@/lib/motion/display";
import { cameraAt, layerMatrix, REST_CAMERA } from "@/lib/motion/camera2d";
import { recipe } from "./helpers/motion";

// Kinetic Motion's pure core: the frame clock, the easing library, seeded randomness, keys, sizes and recipes.

describe("the frame clock (motion-time)", () => {
  it("counts frames as round(duration × fps)", () => {
    expect(frameCount(2.5, 24)).toBe(60);
    expect(frameCount(2.5, 25)).toBe(63);
    expect(frameCount(5, 30)).toBe(150);
    expect(frameCount(0, 30)).toBe(1);
    expect(frameTime(30, 30)).toBe(1);
  });

  it("quantises to the frame a time falls in, stable on frame boundaries", () => {
    for (const fps of [24, 25, 30]) {
      for (let i = 0; i < 200; i++) {
        const t = frameTime(i, fps);
        expect(quantize(t, fps)).toBeCloseTo(t, 12);
        expect(quantize(quantize(t, fps), fps)).toBe(quantize(t, fps));
        expect(quantize(t + 0.5 / fps, fps)).toBeCloseTo(t, 12);
      }
    }
  });

  it("clamps local progress to 0..1", () => {
    expect(local(-1, 0, 1)).toBe(0);
    expect(local(0.25, 0, 1)).toBe(0.25);
    expect(local(9, 0, 1)).toBe(1);
    expect(local(1, 1, 1)).toBe(1);
    expect(local(0.5, 1, 1)).toBe(0);
    expect(clamp(2)).toBe(1);
  });
});

describe("the easing library (motion-ease)", () => {
  const families = { quad, cubic, quart, quint, sine, expo, circ, back: back(), elastic: elastic(), bounce };
  const all: [string, (p: number) => number][] = [
    ["linear", linear],
    ...Object.entries(families).flatMap(([n, f]) => [[`${n}.in`, f.in], [`${n}.out`, f.out], [`${n}.inOut`, f.inOut]] as [string, (p: number) => number][]),
    ...Object.entries(CURVES),
    ["steps(4)", steps(4)],
  ];

  it("every curve starts at 0, ends at 1 and never gives NaN", () => {
    for (const [name, f] of all) {
      expect(f(0), name).toBe(0);
      expect(f(1), name).toBe(1);
      for (let i = 0; i <= 1000; i++) expect(Number.isFinite(f(i / 1000)), `${name} at ${i}`).toBe(true);
      expect(f(-1), name).toBe(0);
      expect(f(2), name).toBe(1);
    }
  });

  it("bezier matches CSS's named timing functions", () => {
    // Reference values from the CSS cubic-bezier definition, solved independently by bisection at high precision.
    const ref = (x1: number, y1: number, x2: number, y2: number, x: number) => {
      const bx = (u: number) => 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u * u * (1 - u) + u ** 3;
      const by = (u: number) => 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u * u * (1 - u) + u ** 3;
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2;
        if (bx(mid) < x) lo = mid;
        else hi = mid;
      }
      return by((lo + hi) / 2);
    };
    const named: [number, number, number, number][] = [
      [0.25, 0.1, 0.25, 1],
      [0.42, 0, 1, 1],
      [0, 0, 0.58, 1],
      [0.42, 0, 0.58, 1],
      [0.16, 1, 0.3, 1],
      [0.7, 0, 0.84, 0],
      [0.65, 0, 0.35, 1],
    ];
    for (const c of named) {
      const f = bezier(...c);
      for (let i = 1; i < 50; i++) expect(Math.abs(f(i / 50) - ref(...c, i / 50)), `${c} at ${i / 50}`).toBeLessThan(1e-4);
    }
    // ease at 0.5 (a value browsers agree on).
    expect(bezier(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
  });

  it("springs settle within their own settle time, and pop overshoots about 6 %", () => {
    for (const o of Object.values(SPRINGS)) {
      const d = springDuration(o);
      expect(d).toBeGreaterThan(0.2);
      expect(d).toBeLessThan(1);
      for (let t = d; t < d + 2; t += 0.01) expect(Math.abs(springAt(o, t) - 1)).toBeLessThanOrEqual(0.001);
    }
    let peak = 0;
    for (let i = 0; i <= 1000; i++) peak = Math.max(peak, CURVES.pop(i / 1000));
    expect(peak - 1).toBeGreaterThan(0.04);
    expect(peak - 1).toBeLessThan(0.08);
    // Critically and over-damped springs never overshoot.
    for (const o of [{ stiffness: 100, damping: 20 }, { stiffness: 100, damping: 60 }]) {
      const f = spring(o);
      for (let i = 0; i <= 200; i++) expect(f(i / 200)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("seeded randomness (motion-random)", () => {
  it("gives the same value for the same seed and key, in [0, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const v = rng(42, "particle", i);
      expect(v).toBe(rng(42, "particle", i));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(rng(42, "particle", 1)).not.toBe(rng(43, "particle", 1));
    expect(rng(42, "particle", 1)).not.toBe(rng(42, "particle", 2));
    expect(rng(42, "a", "b")).not.toBe(rng(42, "ab"));
  });

  it("is order-free: asking in another order gives the same values", () => {
    const keys = Array.from({ length: 300 }, (_, i) => i);
    const forward = new Map(keys.map((k) => [k, rng(9, "p", k)]));
    const shuffled = [...keys].sort((a, b) => rng(1, "shuffle", a) - rng(1, "shuffle", b));
    for (const k of shuffled) expect(rng(9, "p", k)).toBe(forward.get(k));
    // Spread: no bucket of ten is empty or crowded.
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 5000; i++) buckets[Math.floor(rng(3, i) * 10)]++;
    for (const b of buckets) expect(b).toBeGreaterThan(400);
    expect(Math.abs(noise1(1, "x", 2.5))).toBeLessThanOrEqual(1);
  });
});

describe("keys, tracks and staggers", () => {
  it("samples a track before, between and after its keys", () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 1, v: 10, ease: "linear" as const },
      { t: 2, v: 0 },
    ];
    expect(sample(keys, -1)).toBe(0);
    expect(sample(keys, 0.5)).toBe(5);
    expect(sample(keys, 3)).toBe(0);
    expect(stagger(3, 10, 0.06)).toBeCloseTo(0.18);
    expect(stagger(9, 10, 0.1, 0.45)).toBeCloseTo(0.45);
  });

  it("scales a card's cues within each kind's limits", () => {
    const cues = [
      { id: "a", kind: "enter" as const, at: 0.3, dur: 0.55, curve: "enter" as const },
      { id: "w1", kind: "enter" as const, at: 0.5, dur: 0.45, curve: "enter" as const, stagger: { group: "w", unit: "words" as const, index: 1, each: 0.065 } },
    ];
    const short = scaleCues(cues, 2 / 3);
    expect(short[0].dur).toBeCloseTo(0.367, 3);
    expect(short[0].start).toBeCloseTo(0.2, 6);
    // The stagger keeps at least 40 ms between words.
    expect(short[1].start - (0.5 - 0.065) * (2 / 3)).toBeCloseTo(0.0433, 3);
    const long = scaleCues(cues, 4 / 3);
    expect(long[0].dur).toBe(0.7);
  });
});

describe("sizes and recipes", () => {
  it("lays out in design units with 1080 on the short side", () => {
    expect(designSize({ w: 720, h: 1280 })).toEqual({ w: 1080, h: 1920 });
    expect(designSize("16:9")).toEqual({ w: 1920, h: 1080 });
    expect(exportSize("9:16")).toEqual({ w: 1080, h: 1920 });
    expect(previewSize("9:16")).toEqual({ w: 540, h: 960 });
    expect(previewSize({ w: 720, h: 1280 })).toEqual({ w: 405, h: 720 });
  });

  it("keeps a long clip's bit rate under the account's clip limit", () => {
    expect(exportBitrate("9:16", 5)).toBe(10_000_000);
    expect(exportBitrate({ w: 720, h: 1280 }, 2.5)).toBe(6_000_000);
    expect((exportBitrate("9:16", 60) * 60) / 8).toBeLessThanOrEqual(0.6 * 95 * 1024 * 1024);
  });

  it("checks a recipe, holds it to the scene's lengths, and keys equal looks alike", () => {
    const r = recipe("end-card/draw-on");
    expect(normalizeRecipe({ ...r, duration: 9 }, { min: 2, max: 3 }).duration).toBe(3);
    expect(() => normalizeRecipe({ ...r, scene: "../x" })).toThrow();
    expect(() => normalizeRecipe({ ...r, brand: { ...r.brand, colors: ["red"] } })).toThrow();
    expect(() => normalizeRecipe({ ...r, fields: { headline: "x".repeat(601) } })).toThrow();
    const big = { ...r, controls: Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`k${i}`, "y".repeat(78)])) };
    expect(JSON.stringify(big).length).toBeGreaterThan(RECIPE_MAX_BYTES);
    expect(() => normalizeRecipe(big)).toThrow(/too big/);
    expect(recipeKey(r)).toBe(recipeKey(JSON.parse(JSON.stringify({ ...r, fields: { website: r.fields.website, cta: r.fields.cta, product: r.fields.product, brand: r.fields.brand } }))));
    expect(recipeKey(r)).not.toBe(recipeKey({ ...r, seed: 8 }));
    expect(recipeKey(r)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("matrices and the 2.5D camera", () => {
  it("scales about a point and composes", () => {
    const m = about(10, 20, 2);
    expect(m[0] * 10 + m[2] * 20 + m[4]).toBeCloseTo(10);
    expect(m[1] * 10 + m[3] * 20 + m[5]).toBeCloseTo(20);
    const n = multiply(about(0, 0, 2), [1, 0, 0, 1, 5, 0]);
    expect(n[4]).toBe(10);
    const pill = roundRectPath(0, 0, 200, 60, 30);
    expect(pill.length).toBeCloseTo(2 * 140 + Math.PI * 60, 6);
    expect(pill.d.startsWith("M100 0")).toBe(true);
  });

  it("moves near layers more than far ones and keeps a full-frame layer covering", () => {
    const cam = cameraAt({ preset: "drift", from: 0, to: 2 }, 0, 1080);
    expect(cam.x).toBeCloseTo(-0.01 * 1080);
    const near = layerMatrix(cam, -200, 1080, 1920);
    const far = layerMatrix(cam, 800, 1080, 1920);
    expect(Math.abs(near[4] - 540 * (1 - near[0]))).toBeGreaterThan(Math.abs(far[4] - 540 * (1 - far[0])));
    const cover = layerMatrix(cam, 0, 1080, 1920, true);
    expect(cover[0]).toBeGreaterThan(1);
    expect(cameraAt({}, 1, 1080)).toEqual(REST_CAMERA);
    const shake = cameraAt({ shake: { amplitude: 10, frequency: 12, from: 0, to: 1, seed: 3 } }, 0.3, 1080);
    expect(shake).toEqual(cameraAt({ shake: { amplitude: 10, frequency: 12, from: 0, to: 1, seed: 3 } }, 0.3, 1080));
    expect(Math.abs(shake.x)).toBeLessThanOrEqual(10);
  });
});
