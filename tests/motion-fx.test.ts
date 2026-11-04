import { describe, expect, it } from "vitest";
import { analogous, contrastOf, ensureContrast, fromLab, kineticPalette, mixOk, toLab, withLightness } from "@/lib/motion/color";
import { columns, corner, gridFor, heroRange, inside, placementOf, safeBox, SCALE_CONTRAST, LADDER } from "@/lib/motion/grid";
import { bokeh, lightBars, lightLeak, loopPeriod, meshGradient, nightGround, ribbon, rings } from "@/lib/motion/fx/background";
import { echoStack, extrude, floorShadow, glowBehind, hardShadow, shadowTint, twoShadow } from "@/lib/motion/fx/depth";
import { CHROME_STOPS, chromeInk, gradientInk, hollow, pillBox } from "@/lib/motion/fx/materials";
import { arrow, bauhaus, blob, halftone, highlighter, keyline, pillTag, rule, squiggle } from "@/lib/motion/fx/overlays";
import { coverCrop, duotone, photo, photoInType, product, pushIn, tiltedCard } from "@/lib/motion/fx/photo";
import { blurSamples, grain, GRAIN_SIZE, GRAIN_TILES, grainPick, grainTile, vignette } from "@/lib/motion/fx/finish";
import { LAYER_ORDER, layerTransform, stack } from "@/lib/motion/fx/stack";
import type { DisplayNode, GroupNode, TextNode } from "@/lib/motion/display";
import { TILE_CHIPS } from "@/lib/motion/sizes";

// The look's building blocks: colour from a brand kit, the grid and safe areas, fields, depth, materials, overlays,
// photography, finish and the layer stack. All pure and seeded: the same frame every time.

const face: TextNode = { type: "text", field: "headline", runs: [{ text: "LUMEN", gap: "", font: '400 200px "Anton"', x: 100, y: 300, fill: "#ffffff" }] };

describe("colour from a brand kit", () => {
  it("converts to OKLab and back", () => {
    for (const c of ["#3d5afe", "#c8102e", "#0e3b2f", "#f4b860", "#ffffff", "#000000"]) expect(fromLab(toLab(c))).toBe(c);
    expect(mixOk("#000000", "#ffffff", 0.5)).not.toBe("#808080");
  });

  it("moves only lightness to reach contrast, keeping the brand's hue", () => {
    const fixed = ensureContrast("#9fe7ff", "#fbfaf7", 4.5);
    expect(contrastOf(fixed, "#fbfaf7")).toBeGreaterThanOrEqual(4.5);
    expect(analogous(fixed, "#9fe7ff", 8)).toBe(true);
    expect(withLightness("#3d5afe", 0.3)).not.toBe("#3d5afe");
  });

  it("derives each look: paper and night never pure, readable ink, tonal steps on the ground's hue", () => {
    for (const kit of [["#3d5afe", "#9fe7ff"], ["#c8102e", "#f4b43c"], ["#0e3b2f", "#cfae6e"], ["#f4b860", "#0f5c5a"]]) {
      for (const look of ["brand", "light", "dark"] as const) {
        const p = kineticPalette(kit, look);
        expect(p.paper).not.toBe("#ffffff");
        expect(p.night).not.toBe("#000000");
        expect(toLab(p.night).L).toBeGreaterThanOrEqual(0.1);
        expect(toLab(p.night).L).toBeLessThanOrEqual(0.16);
        expect(contrastOf(p.ink, p.ground), `${kit} ${look}`).toBeGreaterThanOrEqual(look === "brand" ? 3 : 4.5);
        expect(analogous(p.tone1, p.ground, 12), `${kit} ${look} tone1`).toBe(true);
        expect(Math.abs(toLab(p.tone2).L - toLab(p.ground).L)).toBeGreaterThan(Math.abs(toLab(p.tone1).L - toLab(p.ground).L));
      }
    }
    expect(kineticPalette(["#3d5afe", "#9fe7ff"], "light").ground).toBe(kineticPalette(["#3d5afe", "#9fe7ff"], "light").paper);
    expect(kineticPalette(["#3d5afe", "#9fe7ff"], "brand").ground).toBe("#3d5afe");
  });
});

describe("grid and safe areas", () => {
  it("keeps ad copy out of the app's top 14 %, bottom 19 % (its 15 % and a pad) and right 11 %", () => {
    const s = safeBox({ w: 1080, h: 1920 }, "ad");
    expect(s.y).toBeCloseTo(1920 * 0.14);
    expect(s.y + s.h).toBeCloseTo(1920 * 0.81);
    expect(s.x + s.w).toBeCloseTo(1080 * 0.89);
    expect(s.x).toBeCloseTo(1080 * 0.07);
  });

  it("keeps cover copy between the tile's chips, and posts on the 7 % margin", () => {
    const c = safeBox({ w: 1080, h: 1440 }, "cover");
    expect(c.y).toBeCloseTo(1440 * TILE_CHIPS.top);
    expect(c.y + c.h).toBeCloseTo(1440 * (1 - TILE_CHIPS.bottom));
    const p = safeBox({ w: 1080, h: 1350 }, "post");
    for (const [k, v] of Object.entries({ x: 75.6, y: 75.6, w: 1080 - 151.2, h: 1350 - 151.2 })) expect(p[k as keyof typeof p]).toBeCloseTo(v, 6);
  });

  it("lays 12 columns and four corner slots on the inset line", () => {
    const g = gridFor({ w: 1080, h: 1350 });
    const all = columns(g, 0, 12);
    expect(all.x).toBeCloseTo(g.safe.x);
    expect(all.w).toBeCloseTo(g.safe.w);
    expect(columns(g, 6, 6).x + columns(g, 6, 6).w).toBeCloseTo(g.safe.x + g.safe.w);
    expect(corner(g, "tl")).toEqual({ x: g.safe.x, y: g.safe.y, align: "left", from: "top" });
    expect(corner(g, "br")).toEqual({ x: g.safe.x + g.safe.w, y: g.safe.y + g.safe.h, align: "right", from: "bottom" });
    expect(inside({ x: 100, y: 100, w: 10, h: 10 }, g.safe)).toBe(true);
    expect(inside({ x: 10, y: 100, w: 10, h: 10 }, g.safe)).toBe(false);
  });

  it("knows where a recipe is shown, and the size ladder keeps the hero 12× the details", () => {
    expect(placementOf({ size: "9:16" })).toBe("ad");
    expect(placementOf({ size: "9:16", controls: { placement: "story" } })).toBe("story");
    expect(placementOf({ size: { w: 1080, h: 1440 }, controls: { cover: "tile" } })).toBe("cover");
    expect(placementOf({ size: "4:5" })).toBe("post");
    expect(heroRange({ w: 1080, h: 1920 })).toEqual({ min: 1080 * 0.14, max: 1080 * 0.4 });
    expect(LADDER.hero[0] / LADDER.meta[1]).toBeGreaterThanOrEqual(SCALE_CONTRAST * 0.5);
    expect(LADDER.hero[1] / LADDER.meta[0]).toBeGreaterThanOrEqual(SCALE_CONTRAST);
  });
});

const json = (n: unknown) => JSON.stringify(n, (_, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v));

describe("fields and atmosphere", () => {
  it("move a mesh on seeded paths that close on the clip's length", () => {
    const o = { w: 1080, h: 1920, colors: ["#3d5afe", "#2a3fb0", "#9fe7ff", "#1b2a80"], seed: 7, duration: 6, dark: true };
    expect(json(meshGradient({ ...o, t: 0 }))).toBe(json(meshGradient({ ...o, t: 6 })));
    expect(json(meshGradient({ ...o, t: 2 }))).not.toBe(json(meshGradient({ ...o, t: 0 })));
    expect(json(meshGradient({ ...o, t: 2 }))).toBe(json(meshGradient({ ...o, t: 2 })));
    expect(meshGradient({ ...o, t: 0 }).blend).toBe("screen");
    expect(meshGradient({ ...o, t: 0, dark: false }).blend).toBeUndefined();
    expect(loopPeriod(10, 6)).toBe(6);
    expect(loopPeriod(4, 9)).toBe(4.5);
  });

  it("draw light bars, rings, an orb-lit night ground, bokeh, a ribbon and leaks only around a cut", () => {
    const bars = lightBars({ x: 0, y: 0, w: 1080, h: 1920, count: 8, ground: "#0e3b2f", accent: "#cfae6e", t: 1, duration: 6, seed: 7 });
    expect(bars.children.length).toBe(8);
    expect(rings({ cx: 0, cy: 0, count: 6, gap: 90, colors: ["#ffffff"] }).children.length).toBe(6);
    expect(nightGround({ w: 1080, h: 1920, night: "#101420", glow: "#3d5afe" })).toHaveLength(2);
    expect(json(bokeh({ w: 1080, h: 1920, count: 20, colors: ["#ffffff"], seed: 7, t: 0, duration: 6 }))).toBe(json(bokeh({ w: 1080, h: 1920, count: 20, colors: ["#ffffff"], seed: 7, t: 6, duration: 6 })));
    expect(lightLeak({ w: 1080, h: 1920, from: "left", p: 0, seed: 7 })).toBeNull();
    expect(lightLeak({ w: 1080, h: 1920, from: "left", p: 0.5, seed: 7 })!.blend).toBe("screen");
    const r = ribbon({ d: "M0 0C300 200 600 -200 900 0", from: [0, 0], to: [900, 0], width: 40, hue: "#9fe7ff", key: "r", bounds: { x: -100, y: -300, w: 1100, h: 600 } });
    expect((r.children[0] as GroupNode).cache).toBeDefined();
  });
});

describe("depth", () => {
  it("follows the two-shadow rule: tight contact plus wide ambient, tinted toward the ground", () => {
    const [ambient, contact] = twoShadow({ nodes: [face], size: 200, ground: "#3d5afe", bounds: { x: 100, y: 300, w: 500, h: 200 }, key: "lumen" });
    expect(ambient.opacity).toBeCloseTo(0.14);
    expect(ambient.transform![5]).toBeCloseTo(7);
    expect((ambient.children[0] as GroupNode).soften).toBeCloseTo(16);
    expect(contact.opacity).toBeCloseTo(0.3);
    expect(contact.transform![5]).toBeCloseTo(2);
    expect((contact.children[0] as GroupNode).soften).toBeCloseTo(1.5);
    const tint = shadowTint("#3d5afe");
    expect(tint).not.toBe("#000000");
    expect(analogous(tint, "#3d5afe", 20)).toBe(true);
    const shadowText = (contact.children[0] as GroupNode).children[0] as TextNode;
    expect(shadowText.decor).toBe(true);
  });

  it("extrudes in stepped copies, darker toward the back, cached once the word has landed", () => {
    const e = extrude({ face, color: "#f4b860", depth: 16, key: "x", bounds: { x: 100, y: 300, w: 500, h: 200 } });
    expect(e.children.length).toBe(16);
    expect(e.cache).toBeDefined();
    const half = extrude({ face, color: "#f4b860", depth: 16, p: 0.5, key: "x", bounds: { x: 100, y: 300, w: 500, h: 200 } });
    expect(half.children.length).toBe(8);
    expect(half.cache).toBeUndefined();
    const back = ((e.children[0] as GroupNode).children[0] as TextNode).runs[0].fill as string;
    const front = ((e.children[15] as GroupNode).children[0] as TextNode).runs[0].fill as string;
    expect(toLab(back).L).toBeLessThan(toLab(front).L);
  });

  it("offers hard shadows, echo stacks, glows and a floor shadow, all as decorative copies", () => {
    expect(hardShadow(face, 200, "#c8102e").transform).toEqual([1, 0, 0, 1, 12, 12]);
    expect(echoStack(face, { count: 3, dx: 6, dy: 6 }).map((g) => g.opacity)).toEqual([0.12, 0.25, 0.5]);
    expect(glowBehind({ nodes: [face], color: "#9fe7ff", blur: 8, bounds: { x: 0, y: 0, w: 10, h: 10 }, key: "g" }).blend).toBe("lighter");
    expect(floorShadow({ cx: 500, y: 1200, width: 400, ground: "#f4efe6", key: "p" }).cache).toBeDefined();
  });
});

describe("materials and overlays", () => {
  it("anchor a gradient to the line box in OKLab, and keep chrome's hard horizon", () => {
    const g = gradientInk({ x: 0, y: 0, w: 600, h: 200 }, ["#3d5afe", "#5a7bff", "#9fe7ff"]);
    expect(g.kind).toBe("linear");
    expect(g.stops.length).toBe(5);
    const c = chromeInk(10, 150, 200);
    expect(c.fill.stops.map((s) => s.at)).toEqual(CHROME_STOPS.map((s) => s.at));
    expect(hollow(200, "#ffffff").fill).toBe("transparent");
    const pill = pillBox({ x: 100, y: 100, w: 200, h: 40 }, 40);
    expect(pill.r).toBe(pill.h / 2);
  });

  it("tilt a pill, grow a jittered highlighter from the left, and draw rules and arrows on", () => {
    const tag = pillTag({ x: 100, y: 100, w: 300, h: 80 }, "#f4b43c", [], { deg: -6 });
    expect(tag.transform![1]).toBeCloseTo(Math.sin((-6 * Math.PI) / 180));
    expect(highlighter({ capTop: 100, baseline: 200, x: 0, w: 400, color: "#f4b43c", seed: 7, p: 0 })).toBeNull();
    const h = highlighter({ capTop: 100, baseline: 200, x: 0, w: 400, color: "#f4b43c", seed: 7 });
    expect(h).toEqual(highlighter({ capTop: 100, baseline: 200, x: 0, w: 400, color: "#f4b43c", seed: 7 }));
    expect((rule({ x: 0, y: 0, w: 100, color: "#fff", p: 0.5 }) as { stroke: { trim: number } }).stroke.trim).toBeGreaterThan(0);
    expect(arrow({ x: 0, y: 0, size: 20, color: "#fff" }).type).toBe("path");
    expect(squiggle({ x: 0, y: 0, w: 200, amp: 10, seed: 7, color: "#fff" }).type).toBe("path");
    expect(bauhaus({ x: 0, y: 0, size: 50, color: "#c8102e", seed: 7 }).children).toHaveLength(3);
    expect(blob({ cx: 0, cy: 0, r: 100, seed: 7, t: 1, fill: "#fff" })).toEqual(blob({ cx: 0, cy: 0, r: 100, seed: 7, t: 1, fill: "#fff" }));
    expect((keyline([face], 7)[0] as TextNode).runs[0].stroke!.width).toBe(14);
  });

  it("set halftone dots by the square root of their coverage, once, cached", () => {
    const h = halftone({ box: { x: 0, y: 0, w: 400, h: 400 }, spacing: 20, origin: [0, 0], reach: 500, color: "#000", key: "corner" });
    expect(h.cache).toEqual({ key: "halftone|corner", bounds: { x: 0, y: 0, w: 400, h: 400 } });
    const d = (h.children[0] as { d: string }).d;
    expect(d.length).toBeGreaterThan(100);
    expect(d).toBe((halftone({ box: { x: 0, y: 0, w: 400, h: 400 }, spacing: 20, origin: [0, 0], reach: 500, color: "#000", key: "corner" }).children[0] as { d: string }).d);
  });
});

describe("photography and products", () => {
  it("crops to cover, pushes in over the clip, and grades into the palette", () => {
    expect(coverCrop({ w: 1000, h: 1000 }, { w: 500, h: 1000 })).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(coverCrop({ w: 1000, h: 1000 }, { w: 1000, h: 1000 }, { x: 0.5, y: 0.5 }, 1.25).w).toBeCloseTo(0.8);
    expect(pushIn(0, 5).zoom).toBe(1);
    expect(pushIn(5, 5).zoom).toBeCloseTo(1.06);
    const p = photo({ src: "photo", img: { w: 2000, h: 3000 }, box: { x: 0, y: 0, w: 1080, h: 1920 }, t: 2, duration: 5, grade: { dark: "#0e3b2f", light: "#cfae6e" } });
    expect(p.isolate).toBeDefined();
    expect(p.children).toHaveLength(3);
    expect(duotone({ x: 0, y: 0, w: 10, h: 10 }, { dark: "#000000", light: "#ffffff" }).map((n) => (n as GroupNode).blend)).toEqual(["multiply", "screen"]);
  });

  it("shows a photo through the letters, sets tilted cards with their shadows, and sweeps light across a product once", () => {
    const pit = photoInType(face, { src: "photo", img: { w: 1000, h: 1000 }, box: { x: 0, y: 0, w: 1080, h: 1080 }, t: 0, duration: 5, bounds: { x: 0, y: 0, w: 1080, h: 1080 } });
    expect((pit.children[1] as GroupNode).blend).toBe("destination-in");
    const card = tiltedCard({ src: "photo", img: { w: 1000, h: 1000 }, box: { x: 100, y: 100, w: 400, h: 500 }, t: 0, duration: 5, deg: 4, ground: "#f4efe6", key: "c" });
    expect(card.children.length).toBe(4);
    const still = product({ src: "product", box: { x: 300, y: 600, w: 480, h: 800 }, ground: "#f4efe6", t: 1, key: "p" });
    const sweeping = product({ src: "product", box: { x: 300, y: 600, w: 480, h: 800 }, ground: "#f4efe6", t: 2.4, sweepAt: 2, key: "p" });
    expect(json(still)).not.toBe(json(sweeping));
    const done = product({ src: "product", box: { x: 300, y: 600, w: 480, h: 800 }, ground: "#f4efe6", t: 3, sweepAt: 2, key: "p" });
    expect(json(done)).toBe(json(still));
  });
});

describe("finish", () => {
  it("makes seeded grain tiles that change on twos, the same frame always getting the same grain", () => {
    const a = grainTile(7, 0);
    expect(a.length).toBe(GRAIN_SIZE * GRAIN_SIZE);
    expect(Buffer.from(a).equals(Buffer.from(grainTile(7, 0)))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(grainTile(7, 1)))).toBe(false);
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    expect(Math.abs(mean - 128)).toBeLessThan(2);
    expect(grainPick(7, 0)).toEqual(grainPick(7, 1));
    expect(grainPick(7, 2)).not.toEqual(grainPick(7, 1));
    expect(grainPick(7, 2 * GRAIN_TILES).tile).toBe(0);
    expect(grain({ w: 1080, h: 1920, seed: 7, frame: 3, dark: true })).toMatchObject({ blend: "screen", amount: 0.04 });
    expect(grain({ w: 1080, h: 1920, seed: 7, frame: 3, dark: false })).toMatchObject({ blend: "overlay", amount: 0.05 });
  });

  it("darkens the corners with a vignette and picks motion-blur samples from speed", () => {
    expect(vignette({ w: 1080, h: 1920 }).type).toBe("rect");
    expect(blurSamples(0)).toBe(1);
    expect(blurSamples(10)).toBe(5);
    expect(blurSamples(400)).toBe(16);
  });
});

describe("layer stack", () => {
  it("orders layers bottom to top, grain under the readable type, and the product over the type when sandwiched", () => {
    const n = (id: string): DisplayNode[] => [{ type: "rect", id, x: 0, y: 0, w: 1, h: 1 }];
    const layers = LAYER_ORDER.map((role) => ({ role, nodes: n(role) }));
    const ids = (nodes: DisplayNode[]) => nodes.map((g) => (g as GroupNode).id);
    const o = { w: 1080, h: 1920, t: 0, duration: 5 };
    expect(ids(stack([...layers].reverse(), o))).toEqual(LAYER_ORDER.map((r) => `layer-${r}`));
    const sand = ids(stack(layers, { ...o, sandwich: true }));
    expect(sand.indexOf("layer-subject")).toBe(sand.indexOf("layer-hero") + 1);
    expect(sand.indexOf("layer-grain")).toBeLessThan(sand.indexOf("layer-hero"));
  });

  it("moves far layers less than near ones and settles each in at its own rate, home on the last frame", () => {
    const o = { w: 1080, h: 1920, t: 5, duration: 5, camera: { x: 40, y: 0 } };
    expect(layerTransform("ground", { ...o, push: false })![4]).toBeCloseTo(10);
    expect(layerTransform("subject", { ...o, push: false })![4]).toBeCloseTo(40 / 1.2);
    expect(layerTransform("meta", o)).toBeUndefined();
    expect(layerTransform("ground", { ...o, t: 0, camera: undefined })![0]).toBeCloseTo(1.04);
    expect(layerTransform("subject", { ...o, t: 0, camera: undefined })![0]).toBeCloseTo(1.1);
    expect(layerTransform("ground", { ...o, camera: undefined })).toBeUndefined();
  });
});
