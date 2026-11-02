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
import { blendPlain, blendTransfer } from "@/lib/relight/blend";
import { DEFAULT_DEMO, RELIGHT_DEMOS } from "@/lib/relight/demo";
import { RELIGHT_MODEL, RELIGHT_SCENE_FEATURE, RELIGHT_SCENE_MODEL, RELIGHT_SETTINGS, relightRequest, sceneRequest } from "@/lib/relight/engine";
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
  sanitizeLights,
  seedFor,
  sideOf,
  SOFTNESSES,
  srgbToLinear,
  STRENGTHS,
  yForHeight,
  type Light,
} from "@/lib/relight/lights";
import { FRAGMENT, packLight, subjectDepthOf, uniforms, type StageState } from "@/lib/relight/shader";
import { isHelperFeature } from "@/lib/library";

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
    for (const c of old.choices) expect(lookFromLegacy(c.label), c.label).toBeDefined();
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

  it("put the light where it sits on the photo, with a reach that follows distance and softness", () => {
    const p = packLight(light({ x: 0.25, y: 0.75 }), 2, 0.5);
    expect(p.pos[0]).toBeCloseTo(0.5);
    expect(p.pos[1]).toBeCloseTo(0.25);
    const close = packLight(light({ distance: "close", softness: "hard" }), 1, 0.5).params[1];
    const far = packLight(light({ distance: "far", softness: "diffuse" }), 1, 0.5).params[1];
    expect(far).toBeGreaterThan(close * 3);
    expect(packLight(light({ behind: true }), 1, 0.5).pos[2]).toBeLessThan(packLight(light(), 1, 0.5).pos[2]);
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
  });

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
});

describe("where Relight lives", () => {
  it("keeps the app's id, its composer routes and words, and renders its own tool", () => {
    const app = APPS.find((a) => a.id === "app-relight")!;
    expect(app).toMatchObject({ tool: "relight", name: "Relight", open: { modelId: "oss-qwen-relight", op: "edit" } });
    expect(app.options?.map((o) => o.key)).toEqual(["light", "dir"]);
    const page = fs.readFileSync(path.join(ROOT, "src/app/(studio)/apps/[id]/page.tsx"), "utf8");
    expect(page).toMatch(/preset\.tool === "relight"\) return <RelightTool/);
  });

  it("opens on a demo with its result shipped", () => {
    expect(RELIGHT_DEMOS.length).toBeGreaterThan(0);
    for (const d of RELIGHT_DEMOS) {
      for (const f of [d.photo, d.relit, d.depth, d.matte].filter(Boolean) as string[]) expect(fs.existsSync(path.join(ROOT, "public", f)), f).toBe(true);
      expect(getLook(d.look)).toBeDefined();
    }
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

  it("the local result route takes a Relight blend and nothing else new", () => {
    const route = fs.readFileSync(path.join(ROOT, "src/app/api/generations/local/route.ts"), "utf8");
    expect(route).toContain('op: z.enum(["grade", "relight"])');
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
    for (const label of ["Colour", "Height", "Distance", "Softness", "Strength", "Behind the subject", "Remove light", "Add light", "Custom"]) expect(panel).toContain(label);
    expect(panel).toContain("h-11");
    expect(panel).not.toMatch(/Viggle|Qwen|LoRA|seed|steps/i);
  });
});

describe("Workflows → Copy install commands for Relight", () => {
  it("download Viggle's node file as a package, never clone the model repo", async () => {
    const { hfNodeFile, nodeInstall } = await import("@/lib/comfy-install");
    const url = "https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo/resolve/009a44a895ef85f7e643c80fdca9543795248867/comfyui/viggle_turbo.py";
    expect(hfNodeFile(url)).toEqual({ repo: "https://huggingface.co/Viggle/Qwen-Image-2.1-viggle-turbo", ref: "009a44a895ef85f7e643c80fdca9543795248867", file: "comfyui/viggle_turbo.py" });
    expect(nodeInstall({ name: "viggle_turbo", repo: url })).toBe(`mkdir -p "$COMFYUI/custom_nodes/viggle_turbo" && wget -c -O "$COMFYUI/custom_nodes/viggle_turbo/__init__.py" "${url}"`);
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
