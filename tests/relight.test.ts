import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LightPanel, LooksRow } from "@/components/relight/relight-panel";
import { APPS, getModel, getPreset } from "@/lib/catalog";
import type { Generation } from "@/lib/catalog/types";
import { commandsFor } from "@/lib/gpu/commands";
import { emptyInventory } from "@/lib/gpu/gather";
import { parseIndex } from "@/lib/gpu/requirements";
import type { RequirementIndex } from "@/lib/gpu/types";
import { outputActions } from "@/lib/output-actions";
import { alignFit, mapPx, WORK } from "@/lib/relight/align";
import { blendPlain, blendTransfer, linearToSrgb8 } from "@/lib/relight/blend";
import { DEFAULT_DEMO, RELIGHT_DEMOS } from "@/lib/relight/demo";
import { RELIGHT_MODEL, RELIGHT_SCENE_FEATURE, RELIGHT_SCENE_MODEL, RELIGHT_SETTINGS, RELIGHT_WORKFLOW, relightRequest, relightRunTitle, relightTitle, sceneRequest } from "@/lib/relight/engine";
import { drawGuide } from "@/lib/relight/guide";
import {
  BAND_CENTER,
  COLOR_CHIPS,
  colorWords,
  defaultLight,
  DISTANCES,
  FEATURED_LOOKS,
  getLook,
  heightFromY,
  HEIGHTS,
  isLook,
  lightAt,
  lightsOfLook,
  LOOKS,
  lookFromLegacy,
  MAX_LIGHTS,
  moveLight,
  promptFor,
  relightExtraOf,
  relightPrompt,
  resultKey,
  sanitizeLights,
  seedFor,
  SIDE_CENTER,
  sideOf,
  SOFTNESSES,
  srgbToLinear,
  STRENGTHS,
  xForSide,
  yForHeight,
  type Light,
} from "@/lib/relight/lights";
import { FLAT_SUBJECT, FRAGMENT, LOW_SHORT, packLight, reachAt, subjectDepthOf, subjectOf, uniforms, type StageState, type Subject } from "@/lib/relight/shader";
import { isHelperFeature } from "@/lib/library";
import { recordLocalGeneration } from "@/server/generations";
import { relightToolLive } from "@/server/relight";
import { tempDir } from "./helpers/temp-dir";

const NEGATION = /\b(no|not|never|nothing|none|without|don't|do not|doesn't|avoid|remove|removed)\b/i;
const ROOT = path.join(__dirname, "..");

const light = (o: Partial<Light> = {}): Light => ({ id: "l1", color: "#ff8a2a", x: 0.2, y: 0.55, height: "face", distance: "mid", softness: "soft", strength: "high", ...o });

describe("the words written from the lights", () => {
  it("name only what is wanted, for every look and every chip", () => {
    for (const look of LOOKS) expect(relightPrompt(lightsOfLook(look)), look.id).not.toMatch(NEGATION);
    for (const color of COLOR_CHIPS)
      for (const h of HEIGHTS)
        for (const d of DISTANCES)
          for (const s of SOFTNESSES)
            for (const st of STRENGTHS)
              for (const behind of [false, true])
                for (const x of [0.1, 0.5, 0.9]) {
                  const p = relightPrompt([light({ color: color.hex, height: h, distance: d, softness: s, strength: st, behind, x })]);
                  expect(p).not.toMatch(NEGATION);
                }
  });

  it("say the darkness the lights work in, and what stays the same", () => {
    const p = relightPrompt([light()]);
    expect(p).toMatch(/^Relight the photo with a strong sunset orange light coming from the left, at face height, at a medium distance\. The scene is in darkness, lit only by these lights, with soft light/);
    expect(p).toContain("Keep the person's identity, face, expression, pose, hair, clothing and the background exactly the same");
  });

  it("join one to three lights, and never more", () => {
    const three = [light(), light({ id: "l2", x: 0.9, color: "#2860ff" }), light({ id: "l3", x: 0.5, height: "high", color: "#f028dc" })];
    expect(relightPrompt(three)).toMatch(/sunset orange light coming from the left[^;]*; a strong electric neon blue light coming from the right[^;]*; and a strong vivid neon magenta light coming from the front, high above/);
    expect(relightPrompt([...three, light({ id: "l4", color: "#ffffff" })])).not.toContain("clean white");
    expect(relightPrompt([])).toBe("");
  });

  it("say softness once when the lights agree, per light when they differ, or the softest once when asked", () => {
    const same = relightPrompt([light({ softness: "hard" }), light({ id: "l2", softness: "hard", x: 0.9 })]);
    expect(same).toContain("with hard, crisp light and sharp, defined shadows");
    expect(same).not.toContain("strong hard, crisp");
    const mixed = relightPrompt([light({ softness: "hard" }), light({ id: "l2", softness: "diffuse", x: 0.9 })]);
    expect(mixed).toContain("a strong hard, crisp sunset orange light");
    expect(mixed).toContain("a strong broad, diffused sunset orange light");
    expect(relightPrompt([light({ softness: "hard" }), light({ id: "l2", softness: "diffuse", x: 0.9 })], "shared")).toContain("with soft, diffused light and gentle shadow falloff");
  });

  it("put a behind light on the subject's edge", () => {
    expect(relightPrompt([light({ behind: true, x: 0.85 })])).toContain("behind the subject, rimming the right edge of the silhouette");
    expect(relightPrompt([light({ behind: true, x: 0.5 })])).toContain("rimming the top edge");
  });

  it("use typed words word for word, and back to auto when they are cleared", () => {
    expect(promptFor([light()], "  Make it moody  ")).toBe("Make it moody");
    expect(promptFor([light()], "   ")).toBe(relightPrompt([light()]));
  });
});

describe("colours", () => {
  it("say each chip's own words", () => {
    expect(COLOR_CHIPS.map((c) => c.label)).toEqual(["Warm", "Cool", "Teal", "Magenta", "Sunset", "Neon blue", "White"]);
    for (const c of COLOR_CHIPS) expect(colorWords(c.hex)).toBe(c.words);
    expect(colorWords("#FF8A2A")).toBe("sunset orange");
  });

  it("name a custom colour after the nearest name in Lab", () => {
    expect(colorWords("#ff2a2a")).toBe("red");
    expect(colorWords("#20c0b8")).toBe("teal");
    expect(colorWords("#9a40ff")).toBe("purple");
    expect(colorWords("#f6f6f6")).toBe("clean white");
  });
});

describe("placing lights", () => {
  it("sets the height band from where the photo was tapped", () => {
    expect(heightFromY(0.9)).toBe("high");
    expect(heightFromY(0.5)).toBe("face");
    expect(heightFromY(0.1)).toBe("low");
    expect(yForHeight(0.5, "face")).toBe(0.5);
    expect(yForHeight(0.5, "high")).toBe(BAND_CENTER.high);
    expect(sideOf(0.2)).toBe("left");
    expect(sideOf(0.5)).toBe("front");
    expect(sideOf(0.8)).toBe("right");
  });

  it("moves a light sideways with the side chips, keeping it where it is when it is on that side already", () => {
    expect(xForSide(0.2, "left")).toBe(0.2);
    expect(xForSide(0.2, "right")).toBe(SIDE_CENTER.right);
    expect(xForSide(0.9, "front")).toBe(SIDE_CENTER.front);
    for (const side of ["left", "front", "right"] as const) expect(sideOf(xForSide(0.5, side))).toBe(side);
  });

  it("adds a light where tapped, up to three", () => {
    let ls: Light[] = [];
    for (const [x, y] of [
      [0.1, 0.9],
      [0.8, 0.2],
      [0.5, 0.5],
    ]) {
      const l = lightAt(ls, x, y)!;
      expect(l).toMatchObject({ x, y });
      ls = [...ls, l];
    }
    expect(ls.map((l) => l.height)).toEqual(["high", "low", "face"]);
    expect(new Set(ls.map((l) => l.id)).size).toBe(3);
    expect(new Set(ls.map((l) => l.color)).size).toBe(3);
    expect(lightAt(ls, 0.3, 0.3)).toBeNull();
    expect(defaultLight(ls)).toBeNull();
    expect(MAX_LIGHTS).toBe(3);
  });

  it("puts Add light at the default spots when nobody taps", () => {
    const a = defaultLight([])!;
    const b = defaultLight([a])!;
    const c = defaultLight([a, b])!;
    expect([a.x, b.x, c.x]).toEqual([0.2, 0.8, 0.5]);
    expect([a.height, b.height, c.height]).toEqual(["face", "face", "high"]);
  });

  it("moves a light and keeps it on the photo", () => {
    expect(moveLight(light(), 1.4, -0.2)).toMatchObject({ x: 1, y: 0, height: "low" });
  });

  it("reads only real lights back from a stored run", () => {
    const ls = sanitizeLights([{ color: "#FFF", x: 2, y: 0.5, distance: "huge", behind: "yes" }, { color: "nope", x: 0, y: 0 }, 5]);
    expect(ls).toEqual([{ id: "l1", color: "#ffffff", x: 1, y: 0.5, height: "face", distance: "mid", softness: "soft", strength: "high" }]);
    expect(relightExtraOf({ relight: { lights: [], seed: 1 } })).toBeNull();
    expect(relightExtraOf({ relight: { lights: [light()], seed: 12.7, variant: "viggle-6", guide: true } })).toMatchObject({ seed: 12, variant: "viggle-6", guide: true });
  });
});

describe("looks", () => {
  it("put the four named looks first, then the old app's five", () => {
    expect(FEATURED_LOOKS).toEqual(["golden-hour", "neon-night", "studio-rim", "candlelight"]);
    expect(LOOKS.map((l) => l.label)).toEqual(["Golden hour", "Neon night", "Studio rim", "Candlelight", "Studio softbox", "Dramatic", "Overcast", "Silhouette", "Window"]);
  });

  it("each place a valid rig that reads as that look", () => {
    for (const look of LOOKS) {
      const ls = lightsOfLook(look);
      expect(ls.length).toBeGreaterThan(0);
      expect(ls.length).toBeLessThanOrEqual(MAX_LIGHTS);
      expect(sanitizeLights(ls)).toEqual(ls);
      expect(isLook(ls, look)).toBe(true);
      expect(isLook(ls.map((l, i) => (i ? l : { ...l, x: l.x + 0.01 })), look)).toBe(false);
    }
    expect(lightsOfLook(getLook("neon-night")!).map((l) => [l.color, sideOf(l.x)])).toEqual([
      ["#f028dc", "left"],
      ["#2860ff", "right"],
    ]);
  });

  it("cover every lighting the old Relight app offered, so its runs reopen on a look", () => {
    const old = getPreset("app-relight")!.options!.find((o) => o.key === "light")!;
    for (const c of old.choices) {
      // A run stores the option's value; its label and words read back the same look.
      expect(lookFromLegacy(c.value, old.choices), c.value).toBeDefined();
      expect(lookFromLegacy(c.value, old.choices)).toBe(lookFromLegacy(c.label, old.choices));
      if (c.prompt) expect(lookFromLegacy(c.prompt, old.choices)).toBe(lookFromLegacy(c.label));
    }
    expect(lookFromLegacy("warm golden hour sunlight", old.choices)?.id).toBe("golden-hour");
  });
});

describe("the preview shader's values", () => {
  const state = (o: Partial<StageState> = {}): StageState => ({
    lights: [light()],
    intensity: 0.6,
    aspect: 4 / 3,
    scene: { hasScene: false, subjectDepth: 0.5 },
    mode: "preview",
    blend: "transfer",
    glow: true,
    original: false,
    ambient: 0.04,
    width: 1280,
    height: 960,
    ...o,
  });

  it("are clamped", () => {
    const u = uniforms(state({ intensity: 3, ambient: -1, aspect: 99, align: { sx: 3, tx: 9, sy: 0, ty: -9 } }));
    expect(u.scalars.uIntensity).toBe(1);
    expect(u.scalars.uAmbient).toBe(0);
    expect(u.scalars.uAspect).toBe(10);
    expect(u.vec4.uAlign).toEqual([1.25, 0.25, 0.8, -0.25]);
    expect(uniforms(state({ intensity: Number.NaN })).scalars.uIntensity).toBe(0);
  });

  it("pack at most three lights and pass the behind flag", () => {
    const four = [light(), light({ id: "l2" }), light({ id: "l3", behind: true }), light({ id: "l4" })];
    const u = uniforms(state({ lights: four }));
    expect(u.ints.uCount).toBe(3);
    expect(u.arrays.uPos).toHaveLength(9);
    expect(u.arrays.uParams.filter((_, i) => i % 4 === 3)).toEqual([0, 0, 1]);
    expect(FRAGMENT).toContain("uniform vec3 uPos[3]");
  });

  it("read a marker as the direction the light comes from, at a gap its distance sets, with its glow where it was placed", () => {
    const a = 2;
    const c = [FLAT_SUBJECT.x * a, FLAT_SUBJECT.y];
    for (const [x, y] of [
      [0.25, 0.75],
      [0.02, 0.5],
      [0.95, 0.1],
    ]) {
      const p = packLight(light({ x, y }), a, 0.5);
      expect(p.mark[0]).toBeCloseTo(x * a);
      expect(p.mark[1]).toBeCloseTo(1 - y);
      const dm = [p.mark[0] - c[0], p.mark[1] - c[1]];
      const dp = [p.pos[0] - c[0], p.pos[1] - c[1]];
      // Same direction from the subject…
      expect(dm[0] * dp[1] - dm[1] * dp[0]).toBeCloseTo(0);
      expect(dm[0] * dp[0] + dm[1] * dp[1]).toBeGreaterThan(0);
    }
    // …at a gap that grows with distance, whatever spot was tapped.
    const gap = (distance: Light["distance"]) => Math.hypot(packLight(light({ x: 0.02, distance }), a, 0.5).pos[0] - c[0], packLight(light({ x: 0.02, distance }), a, 0.5).pos[1] - c[1]);
    expect(gap("close")).toBeLessThan(gap("mid"));
    expect(gap("mid")).toBeLessThan(gap("far"));
    expect(gap("close")).toBeCloseTo(gap("close"));
    const close = packLight(light({ distance: "close", softness: "hard" }), 1, 0.5).params[1];
    const far = packLight(light({ distance: "far", softness: "diffuse" }), 1, 0.5).params[1];
    expect(far).toBeGreaterThan(close * 3);
    expect(packLight(light({ behind: true }), 1, 0.5).pos[2]).toBeLessThan(packLight(light(), 1, 0.5).pos[2]);
    // A marker on the subject brings its light round to the front, without a jump.
    const front = packLight(light({ x: FLAT_SUBJECT.x, y: 1 - FLAT_SUBJECT.y }), a, 0.5);
    expect(front.pos[0]).toBeCloseTo(c[0]);
    expect(front.pos[1]).toBeCloseTo(c[1]);
  });

  it("let every look's lights reach the subject: a quarter of each front light's power at its centre, flat or with a scene read", () => {
    const subjects: [string, Subject, number][] = [
      ["flat", FLAT_SUBJECT, 4 / 3],
      ["off-centre", { x: 0.62, y: 0.38, r: 0.3 }, 4 / 3],
      ["portrait frame", { x: 0.5, y: 0.5, r: 0.18 }, 3 / 4],
    ];
    for (const [name, subject, aspect] of subjects)
      for (const look of LOOKS)
        for (const l of lightsOfLook(look)) {
          if (l.behind) continue;
          const p = packLight(l, aspect, 0.5, subject);
          const at: [number, number, number] = [subject.x * aspect, subject.y, 0.5 * 0.6];
          expect(reachAt(p, at), `${look.id} ${l.id} ${name}`).toBeGreaterThanOrEqual(0.25);
        }
    // Neon night: the magenta light lights the subject's left side more than its right, the blue the other way.
    const [magenta, blue] = lightsOfLook(getLook("neon-night")!).map((l) => packLight(l, 4 / 3, 0.5));
    const left: [number, number, number] = [(FLAT_SUBJECT.x - 0.1) * (4 / 3), FLAT_SUBJECT.y, 0.3];
    const right: [number, number, number] = [(FLAT_SUBJECT.x + 0.1) * (4 / 3), FLAT_SUBJECT.y, 0.3];
    expect(reachAt(magenta, left)).toBeGreaterThan(reachAt(magenta, right));
    expect(reachAt(blue, right)).toBeGreaterThan(reachAt(blue, left));
  });

  it("find where the subject is from its cut-out", () => {
    const w = 40;
    const h = 30;
    const matte = new Uint8Array(w * h);
    for (let y = 5; y < 25; y++) for (let x = 20; x < 30; x++) matte[y * w + x] = 255;
    const s = subjectOf(matte, w, h)!;
    expect(s.x).toBeCloseTo(25 / 40);
    expect(s.y).toBeCloseTo(15 / 30);
    expect(s.r).toBeCloseTo(Math.sqrt((200 / 1200) * (40 / 30) / Math.PI));
    expect(subjectOf(new Uint8Array(w * h), w, h)).toBeNull();
    expect(uniforms(state({ scene: { hasScene: true, subjectDepth: 0.6, subject: s } })).arrays.uPos).not.toEqual(uniforms(state()).arrays.uPos);
    expect(uniforms(state()).arrays.uMark.slice(0, 2)).toEqual([0.2 * (4 / 3), 1 - 0.55].map((v) => expect.closeTo(v, 6)));
  });

  it("keep the result untouched: the highlight knee is the preview's own", () => {
    expect(FRAGMENT).toContain("outc = mix(P, knee(albedo * (uAmbient + C)), uIntensity);");
    expect(FRAGMENT).toContain("vec3 o = toSrgb(outc);");
    expect(FRAGMENT).not.toContain("toSrgb(knee(outc))");
  });

  it("find the subject's depth from the depth map and its matte", () => {
    const depth = [10, 10, 200, 210, 220, 10];
    const matte = [0, 0, 255, 255, 255, 0];
    expect(subjectDepthOf(depth, matte)).toBeCloseTo(210 / 255);
    expect(subjectDepthOf(depth, [0, 0, 0, 0, 0, 0])).toBe(0.5);
  });
});

/** A textured picture (smoothed noise), for the alignment tests. */
function texture(size: number, seed = 7): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const raw = new Float32Array(size * size).map(rnd);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let a = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const yy = Math.min(size - 1, Math.max(0, y + dy));
          const xx = Math.min(size - 1, Math.max(0, x + dx));
          a += raw[yy * size + xx];
          n++;
        }
      out[y * size + x] = a / n;
    }
  return out;
}

/** b(x, y) = a(sx·x + tx, sy·y + ty), bilinear, with a different brightness (the light changed). */
function warp(a: Float32Array, size: number, f: { sx: number; tx: number; sy: number; ty: number }): Float32Array {
  const out = new Float32Array(size * size);
  const at = (x: number, y: number) => a[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = f.sx * x + f.tx;
      const v = f.sy * y + f.ty;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = u - x0;
      const fy = v - y0;
      const val = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
      out[y * size + x] = val * 0.7 + 0.1;
    }
  return out;
}

describe("lining the relit picture up with the photo", () => {
  const photo = texture(WORK);

  it("recovers shifts of 3, 12 and 30 px and a 1 % scale within half a pixel", () => {
    for (const [sx, tx, sy, ty] of [
      [1, 3, 1, -3],
      [1, -12, 1, 12],
      [1, 30, 1, -30],
      [1.01, -2.5, 0.99, 2.6],
    ]) {
      // The relit picture shows photo content at photo(x) = relit(x'), where x = sx·x' + tx: content at photo x sits at
      // relit (x − tx) / sx.
      const relit = warp(photo, WORK, { sx, tx, sy, ty });
      const got = alignFit(photo, relit)!;
      expect(got, `${sx} ${tx}`).not.toBeNull();
      for (const px of [64, 256, 448]) {
        expect(Math.abs(mapPx(got.fit, "x", px) - (px - tx) / sx), `x ${tx} at ${px}`).toBeLessThan(0.5);
        expect(Math.abs(mapPx(got.fit, "y", px) - (px - ty) / sy), `y ${ty} at ${px}`).toBeLessThan(0.5);
      }
    }
    // Four full fits on 512 px pictures: a few seconds on a busy machine.
  }, 30_000);

  it("gives up on a featureless picture (the blend then uses the pictures as they are)", () => {
    const flat = new Float32Array(WORK * WORK).fill(0.5);
    expect(alignFit(flat, flat)).toBeNull();
  });
});

describe("the Intensity blend", () => {
  const W = 32;
  const H = 32;
  const pic = (f: (x: number, y: number) => [number, number, number]) => {
    const a = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const [r, g, b] = f(x, y);
        a.set([r, g, b, 255], (y * W + x) * 4);
      }
    return a;
  };
  // The original has fine detail (a checker); the relit picture is the same scene, smoother and lit warm from the left.
  const O = pic((x, y) => ((x + y) % 2 ? [150, 120, 100] : [110, 90, 70]));
  const R = pic((x) => [Math.max(30, 220 - x * 5), Math.max(20, 150 - x * 4), 40]);

  it("returns the original at 0 and, plain, the relit picture at 100 %", () => {
    expect([...blendPlain(O, R, 0)]).toEqual([...O]);
    expect([...blendTransfer(O, R, W, H, 0)]).toEqual([...O]);
    expect([...blendPlain(O, R, 1)]).toEqual([...R]);
  });

  it("keeps the original's detail in light transfer", () => {
    const out = blendTransfer(O, R, W, H, 1, 2);
    // Detail relative to its surroundings, in linear light: what the eye reads as texture whatever the light level.
    const hp = (a: ArrayLike<number>) => {
      const lin = (i: number) => srgbToLinear(a[i * 4 + 1]);
      const v: number[] = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) v.push(lin(y * W + x) / ((lin(y * W + x - 1) + lin(y * W + x + 1)) / 2) - 1);
      return v;
    };
    const a = hp(O);
    const b = hp(out);
    const ma = a.reduce((s, x) => s + x, 0) / a.length;
    const mb = b.reduce((s, x) => s + x, 0) / b.length;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < a.length; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    expect(num / Math.sqrt(da * db)).toBeGreaterThanOrEqual(0.98);
    // And the light moved: the left side is brighter than the right.
    expect(out[(16 * W + 2) * 4]).toBeGreaterThan(out[(16 * W + 29) * 4]);
  });
});

describe("the light transfer on the GPU", () => {
  // The shader's maths on the CPU: each picture halved (2 × 2 averages, in sRGB as a canvas does) to LOW_SHORT on its
  // short side, then nine bilinear taps σ apart (the blur uniform), the ratio of the two blurs times the original.
  const W = 240;
  const H = 180;
  type Img = Float32Array; // sRGB 0..1, 3 per pixel
  const halve = (a: Img, w: number, h: number): [Img, number, number] => {
    const nw = Math.round(w / 2);
    const nh = Math.round(h / 2);
    const out = new Float32Array(nw * nh * 3);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++)
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (const [dx, dy] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ])
            s += a[(Math.min(h - 1, y * 2 + dy) * w + Math.min(w - 1, x * 2 + dx)) * 3 + c];
          out[(y * nw + x) * 3 + c] = s / 4;
        }
    return [out, nw, nh];
  };
  const resize = (a: Img, w: number, h: number, nw: number, nh: number): Img => {
    const out = new Float32Array(nw * nh * 3);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        const v = sample(a, w, h, (x + 0.5) / nw, (y + 0.5) / nh);
        out.set(v, (y * nw + x) * 3);
      }
    return out;
  };
  const sample = (a: Img, w: number, h: number, u: number, v: number): [number, number, number] => {
    const fx = Math.min(w - 1, Math.max(0, u * w - 0.5));
    const fy = Math.min(h - 1, Math.max(0, v * h - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(w - 1, x0 + 1);
    const y1 = Math.min(h - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (x: number, y: number, c: number) => a[(y * w + x) * 3 + c];
    return [0, 1, 2].map((c) => at(x0, y0, c) * (1 - tx) * (1 - ty) + at(x1, y0, c) * tx * (1 - ty) + at(x0, y1, c) * (1 - tx) * ty + at(x1, y1, c) * tx * ty) as [number, number, number];
  };
  const low = (a: Img): [Img, number, number] => {
    let [img, w, h] = [a, W, H];
    while (Math.min(w, h) >= LOW_SHORT * 2) [img, w, h] = halve(img, w, h);
    const s = LOW_SHORT / Math.min(w, h);
    if (s < 1) {
      const nw = Math.round(w * s);
      const nh = Math.round(h * s);
      return [resize(img, w, h, nw, nh), nw, nh];
    }
    return [img, w, h];
  };
  const toLin = (v: number) => srgbToLinear(v * 255);
  const shaderTransfer = (o: Img, r: Img, t: number): Uint8ClampedArray => {
    const [lo, lw, lh] = low(o);
    const [lr] = low(r);
    const blurS = (0.012 * Math.min(W, H)) / H;
    const ry = blurS;
    const rx = blurS / (W / H);
    const taps: [number, number, number][] = [
      [0, 0, 0.25],
      [rx, 0, 0.125],
      [-rx, 0, 0.125],
      [0, ry, 0.125],
      [0, -ry, 0.125],
      [rx, ry, 0.0625],
      [-rx, -ry, 0.0625],
      [rx, -ry, 0.0625],
      [-rx, ry, 0.0625],
    ];
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        const v = (y + 0.5) / H;
        const bo = [0, 0, 0];
        const br = [0, 0, 0];
        for (const [dx, dy, k] of taps) {
          const so = sample(lo, lw, lh, u + dx, v + dy);
          const sr = sample(lr, lw, lh, u + dx, v + dy);
          for (let c = 0; c < 3; c++) {
            bo[c] += toLin(so[c]) * k;
            br[c] += toLin(sr[c]) * k;
          }
        }
        for (let c = 0; c < 3; c++) {
          const ratio = Math.min(8, Math.max(0, br[c] / Math.max(bo[c], 0.004)));
          out[(y * W + x) * 4 + c] = linearToSrgb8(Math.min(1, toLin(o[(y * W + x) * 3 + c]) * (1 + (ratio - 1) * t)));
        }
        out[(y * W + x) * 4 + 3] = 255;
      }
    return out;
  };

  it("matches the CPU reference across a strong contour (a face against the sky), with no echo of the edge", () => {
    // The original: bright sky left of a dark face with fine texture. The relit picture: the same contour, warmer and
    // brighter on the face, and its edge a pixel softer (as a generated picture's is).
    const O = new Float32Array(W * H * 3);
    const R = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const face = x >= W / 2;
        const grain = ((x * 7 + y * 13) % 5) / 100;
        O.set(face ? [0.32 + grain, 0.24 + grain, 0.2 + grain] : [0.86, 0.9, 0.95], (y * W + x) * 3);
        const soft = Math.min(1, Math.max(0, (x - W / 2 + 1.5) / 3));
        const sky = [0.8, 0.82, 0.9];
        const lit = [0.62, 0.4, 0.26];
        R.set(sky.map((s, c) => s * (1 - soft) + lit[c] * soft), (y * W + x) * 3);
      }
    const to8 = (a: Img) => {
      const out = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i++) out.set([a[i * 3] * 255, a[i * 3 + 1] * 255, a[i * 3 + 2] * 255, 255], i * 4);
      return out;
    };
    const ref = blendTransfer(to8(O), to8(R), W, H, 0.6);
    const gpu = shaderTransfer(O, R, 0.6);
    let sum = 0;
    let worst = 0;
    for (let i = 0; i < W * H; i++)
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(ref[i * 4 + c] - gpu[i * 4 + c]);
        sum += d;
        worst = Math.max(worst, d);
      }
    expect(sum / (W * H * 3)).toBeLessThan(1.5);
    expect(worst).toBeLessThan(24);
    // Along a row on the face, the light the blend adds (result over original, in linear light) changes smoothly:
    // no copy of the contour a tap's width away from it.
    const row = H / 2;
    const light = (x: number) => srgbToLinear(gpu[(row * W + x) * 4]) / toLin(O[(row * W + x) * 3]);
    let step = 0;
    // (The blend's own transition across the contour spans a couple of blurs; past that the light is even.)
    for (let x = W / 2 + 4 * Math.ceil(0.012 * Math.min(W, H)); x < W - 2; x++) step = Math.max(step, Math.abs(light(x + 1) - light(x)));
    expect(step).toBeLessThan(0.06);
  });
});

describe("the light-guide picture", () => {
  it("is the same pixels for the same rig and photo, and shows each light in its colour", () => {
    const W = 64;
    const H = 48;
    const photo = new Uint8ClampedArray(W * H * 4).fill(128);
    const rig = lightsOfLook(getLook("neon-night")!);
    const a = drawGuide(photo, W, H, rig);
    const b = drawGuide(photo, W, H, rig);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const at = (x: number, y: number) => [...a.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
    const left = at(4, 22);
    const right = at(60, 22);
    expect(left[0]).toBeGreaterThan(left[1]); // magenta
    expect(right[2]).toBeGreaterThan(right[0]); // blue
    expect(at(32, 2)[0]).toBeLessThan(128); // darkened where no light reaches
  });
});

describe("the runs", () => {
  it("Generate lighting runs the hidden Qwen-Image 2.1 relight model with the photo, the words and a seed from the photo", () => {
    const lights = lightsOfLook(getLook("neon-night")!);
    const req = relightRequest({ photo: "/api/files/uploads/me.jpg", guide: "/api/files/uploads/g.png", lights, look: "neon-night", seed: seedFor("/api/files/uploads/me.jpg") });
    expect(req).toMatchObject({ feature: "relight", modelId: RELIGHT_MODEL, op: "edit", inputs: { images: ["/api/files/uploads/me.jpg"] } });
    expect(req.prompt).toBe(relightPrompt(lights));
    // No preset id: a preset run would put the old app's words in front of the lights' own (planGeneration).
    expect(req.presetId).toBeUndefined();
    expect(sceneRequest("/api/files/x.png").presetId).toBeUndefined();
    expect(req.params?.seed).toBe(seedFor("/api/files/uploads/me.jpg"));
    expect(relightExtraOf(req.params?.extra)).toMatchObject({ lights, look: "neon-night", variant: RELIGHT_SETTINGS.variant, guide: false });
    expect(seedFor("a")).toBe(seedFor("a"));
    expect(seedFor("a")).not.toBe(seedFor("b"));
    // The Library names it by its look, else by its lights: the server sets it (the API takes no title from a client).
    expect(req.title).toBeUndefined();
    expect(relightRunTitle(req)).toBe("Relight · Neon night");
    expect(relightRunTitle({ ...req, modelId: "oss-qwen-relight" })).toBeUndefined();
    expect(relightRunTitle({ ...req, params: {} })).toBeUndefined();
    expect(relightTitle([lights[0]])).toBe("Relight · 1 light");
    expect(relightTitle(lights)).toBe("Relight · 2 lights");
  });

  it("a result is found again by its words, whichever seed made it", () => {
    const k = (seed: number) => resultKey({ prompt: "p", variant: "viggle-6", guide: false, ...({ seed } as object) });
    expect(k(1)).toBe(k(2));
    expect(resultKey({ prompt: "p", variant: "viggle-6" })).not.toBe(resultKey({ prompt: "q", variant: "viggle-6" }));
  });

  it("the scene read is a helper step the Library leaves out", () => {
    expect(sceneRequest("/api/files/x.png")).toMatchObject({ modelId: RELIGHT_SCENE_MODEL, inputs: { images: ["/api/files/x.png"] } });
    expect(isHelperFeature(RELIGHT_SCENE_FEATURE)).toBe(true);
  });

  it("the models are hidden and run their workflows", () => {
    expect(getModel(RELIGHT_MODEL)).toMatchObject({ hidden: true, routes: [expect.objectContaining({ op: "edit", provider: "comfyui", endpoint: "qwen-image-21-relight" })] });
    expect(getModel(RELIGHT_SCENE_MODEL)).toMatchObject({ hidden: true, routes: [expect.objectContaining({ provider: "comfyui", endpoint: "relight-scene-read" })] });
    expect(getModel("local-relight")?.routes).toEqual([{ op: "relight", provider: "local", endpoint: "webgl" }]);
  });

  it("the workflows are in the library, with Viggle's loader at 1.0 and its 6-step schedule", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/manifest.json"), "utf8")) as { workflows: { id: string; bindings: Record<string, unknown>; outputs: { role?: string }[]; customNodes: { name: string }[] }[] };
    const wf = manifest.workflows.find((w) => w.id === "qwen-image-21-relight")!;
    expect(Object.keys(wf.bindings)).toEqual(expect.arrayContaining(["image", "image2", "prompt", "seed"]));
    expect(wf.customNodes.map((c) => c.name)).toEqual(["viggle_turbo"]);
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/qwen-image-21-relight.json"), "utf8")) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    const lora = Object.values(graph).find((n) => n.class_type === "ViggleTurboLora")!;
    expect(lora.inputs).toMatchObject({ lora_name: "Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors", strength: 1 });
    expect(Object.values(graph).find((n) => n.class_type === "ViggleTurboSigmas")?.inputs.nodes).toBe("1.0, 0.9375, 0.875, 0.75, 0.5, 0.25");
    expect(Object.values(graph).some((n) => n.class_type === "CFGGuider")).toBe(false);
    const scene = manifest.workflows.find((w) => w.id === "relight-scene-read")!;
    expect(scene.outputs.map((o) => o.role)).toEqual(["depth", "matte"]);
  });

  it("the requirement index installs Viggle's node file by downloading it at its pinned revision", () => {
    const idx: RequirementIndex = parseIndex(JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/requirements.json"), "utf8")));
    expect(idx.workflows["qwen-image-21-relight"].packs).toEqual({ viggle_turbo: ["ViggleTurboLora", "ViggleTurboSigmas"] });
    expect(idx.workflows["qwen-image-21-relight"].files).toContain("loras/Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors");
    expect(idx.packs.viggle_turbo).toMatchObject({ file: "comfyui/viggle_turbo.py", commit: "009a44a895ef85f7e643c80fdca9543795248867" });
    const c = commandsFor([{ kind: "pack-install", pack: "viggle_turbo" }], { inv: emptyInventory("server", 1), idx });
    expect(c.bash).toContain(
      'curl -L -C - --fail -o "$COMFY/custom_nodes/viggle_turbo/__init__.py" "https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo/resolve/009a44a895ef85f7e643c80fdca9543795248867/comfyui/viggle_turbo.py"',
    );
    expect(c.bash).not.toContain("git clone");
  });

  it("the browser's own results are recorded only for their own step", () => {
    const blend = { feature: "relight", modelId: "local-relight", prompt: "p", inputs: { images: ["/api/files/x.png"] }, output: { url: "/api/files/y.png", kind: "image" as const } };
    expect(() => recordLocalGeneration({ ...blend, op: "grade" })).toThrow("Not a browser tool");
    expect(() => recordLocalGeneration({ ...blend, modelId: "local-color-grade", op: "relight" })).toThrow("Not a browser tool");
  });
});

describe("where Relight lives", () => {
  it("keeps the app's id, its composer routes and words, and renders its own tool", () => {
    const app = APPS.find((a) => a.id === "app-relight")!;
    expect(app).toMatchObject({ tool: "relight", name: "Relight", open: { modelId: "oss-qwen-relight", op: "edit" } });
    expect(app.options?.map((o) => o.key)).toEqual(["light", "dir"]);
    const page = fs.readFileSync(path.join(ROOT, "src/app/(studio)/apps/[id]/page.tsx"), "utf8");
    expect(page).toMatch(/preset\.tool === "relight"\)\s*return \(\s*<RelightGate live=\{relightToolLive\(\)\}/);
  });

  it("opens the tool to everyone once its workflow has passed its check, and keeps the composer until then", () => {
    const dir = tempDir("fuobe-relight-live-");
    const write = (validated: boolean) => {
      const f = path.join(dir, `m-${validated}.json`);
      fs.writeFileSync(f, JSON.stringify({ workflows: [{ id: RELIGHT_WORKFLOW, validated }, { id: "relight-scene-read", validated: true }] }));
      return f;
    };
    expect(relightToolLive(write(false))).toBe(false);
    expect(relightToolLive(write(true))).toBe(true);
    expect(relightToolLive(path.join(dir, "missing.json"))).toBe(false);
    expect(getModel(RELIGHT_MODEL)?.routes[0].endpoint).toBe(RELIGHT_WORKFLOW);
    const gate = fs.readFileSync(path.join(ROOT, "src/components/relight/relight-gate.tsx"), "utf8");
    expect(gate).toContain("return live || owner ? <RelightTool app={app} /> : <>{children}</>;");
  });

  it("opens on a demo with its result shipped", () => {
    expect(RELIGHT_DEMOS.length).toBeGreaterThan(0);
    for (const d of RELIGHT_DEMOS) {
      for (const f of [d.photo, d.relit, d.depth, d.matte].filter(Boolean) as string[]) expect(fs.existsSync(path.join(ROOT, "public", f.split("?")[0])), f).toBe(true);
      expect(getLook(d.look)).toBeDefined();
    }
    // The cover pair's content version, as Home's slider uses: a new pair gets new addresses.
    expect(DEFAULT_DEMO.photo).toMatch(/app-relight-before\.jpg\?v=[0-9a-f]{8}$/);
    expect(DEFAULT_DEMO.relit).toMatch(/app-relight-after\.jpg\?v=[0-9a-f]{8}$/);
    expect(DEFAULT_DEMO.look).toBe("golden-hour");
  });

  it("is a Relight link on image results, after Edit", () => {
    const g = { id: "gen_1", feature: "image", op: "t2i", kind: "image", outputs: [{ url: "/api/files/o/a.png", kind: "image" }], request: {}, favorite: false } as unknown as Generation;
    const acts = outputActions(g, 0);
    const i = acts.findIndex((a) => a.id === "relight");
    expect(acts[i]).toEqual({ id: "relight", label: "Relight", placement: "menu", href: "/apps/app-relight?image=%2Fapi%2Ffiles%2Fo%2Fa.png&gen=gen_1" });
    expect(i).toBe(acts.findIndex((a) => a.id === "edit") + 1);
    expect(acts[i + 1].id).toBe("live-edit");
  });

  it("the local result route takes a Relight blend (and Kinetic Motion clips)", () => {
    const route = fs.readFileSync(path.join(ROOT, "src/app/api/generations/local/route.ts"), "utf8");
    expect(route).toContain('op: z.enum(["grade", "relight", "motion"])');
  });
});

describe("the panel", () => {
  it("shows the looks and the selected light's chips with 44 px phone targets", () => {
    const looks = renderToStaticMarkup(createElement(LooksRow, { look: "neon-night", onLook: () => {} }));
    expect(looks.indexOf("Golden hour")).toBeLessThan(looks.indexOf("Studio softbox"));
    expect(looks).toMatch(/aria-checked="true"[^>]*>.*Neon night/);
    const panel = renderToStaticMarkup(
      createElement(LightPanel, { lights: lightsOfLook(getLook("neon-night")!), selected: "l1", onSelect: () => {}, onChange: () => {}, onRemove: () => {}, onAdd: () => {}, fine: false }),
    );
    for (const label of ["Colour", "Side", "Left", "Front", "Right", "Height", "Distance", "Softness", "Strength", "Behind the subject", "Remove light", "Add light", "Custom"]) expect(panel).toContain(label);
    // Neon night's left light: the Left chip is on.
    expect(panel).toMatch(/role="radiogroup" aria-label="Side".*?aria-checked="true"[^>]*>Left</);
    // A look's own colour (off the chips) shows on the Custom chip without marking it picked.
    const candle = renderToStaticMarkup(
      createElement(LightPanel, { lights: lightsOfLook(getLook("candlelight")!), selected: "l1", onSelect: () => {}, onChange: () => {}, onRemove: () => {}, onAdd: () => {}, fine: false }),
    );
    expect(candle).toContain("background:#ffa040");
    expect(candle).not.toContain("bg-foreground text-background\">Custom");
    expect(panel).toContain("h-11");
    expect(panel).not.toMatch(/Viggle|Qwen|LoRA|seed|steps/i);
  });
});

describe("Workflows → Copy install commands for Relight", () => {
  it("download Viggle's node file as a package, never clone the model repo", async () => {
    const { hfNodeFile, nodeInstall } = await import("@/lib/comfy-install");
    const url = "https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo/resolve/009a44a895ef85f7e643c80fdca9543795248867/comfyui/viggle_turbo.py";
    expect(hfNodeFile(url)).toEqual({ repo: "https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo", ref: "009a44a895ef85f7e643c80fdca9543795248867", file: "comfyui/viggle_turbo.py" });
    expect(nodeInstall({ name: "viggle_turbo", repo: url })).toBe(`mkdir -p "$COMFYUI/custom_nodes/viggle_turbo" && wget -q -O "$COMFYUI/custom_nodes/viggle_turbo/__init__.py" "${url}"`);
    expect(hfNodeFile("https://huggingface.co/Viggle/x/resolve/main/a.py")).toBeUndefined();
  });
});

describe("Relight from Edit", () => {
  it("is a next step under a picture made in Edit, in place of Edit", async () => {
    const { nextSteps } = await import("@/lib/output-actions");
    const g = (feature: string) => ({ id: "gen_2", feature, op: "edit", kind: "image", status: "succeeded", outputs: [{ url: "/api/files/o/b.png", kind: "image" }], request: {}, favorite: false }) as unknown as Generation;
    expect(nextSteps(g("edit"), 0).map((a) => a.id)).toEqual(["animate", "relight", "upscale"]);
    expect(nextSteps(g("edit"), 0)[1].href).toBe("/apps/app-relight?image=%2Fapi%2Ffiles%2Fo%2Fb.png&gen=gen_2");
    expect(nextSteps(g("image"), 0).map((a) => a.id)).toEqual(["animate", "upscale", "edit"]);
  });
});
