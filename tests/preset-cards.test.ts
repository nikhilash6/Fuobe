import { describe, expect, it, vi } from "vitest";
import { APPS, EFFECTS, getPreset, MOTIONS } from "@/lib/catalog";

// One measured cover (pnpm eval:covers writes this file) and one still cover (pnpm eval:covers --from-masters), for preset ids the catalog doesn't have.
vi.mock("@/lib/preset-previews.generated", () => ({
  PRESET_PREVIEWS: {
    "effect-measured-cover": { poster: "/previews/dop/effect-measured-cover.jpg", video: "/previews/dop/effect-measured-cover.mp4", run: "r", engine: "open", model: "oss-wan22-14b", variant: "research" },
    "app-still-cover": { poster: "/previews/presets/app-still-cover.jpg", run: "comfyui-previews-2026-10", engine: "comfyui", model: "ideogram4", variant: "lean-json" },
  },
}));
import {
  appFx,
  CAMERA_MOVES,
  effectFx,
  FX,
  isCover,
  LAYER_BLEED,
  layerTransform,
  lookHue,
  motionMove,
  moveVars,
  PREVIEW_LAYERS,
  parityNote,
  presetHowTo,
  presetRouteLines,
  previewFlip,
  readMoreTap,
  searchText,
  TAP_TO_READ,
  matchesSearch,
  type CameraMove,
  type MoveSpec,
  type PreviewLayer,
} from "@/lib/preset-cards";
import { previewFor, toPresetCard } from "@/lib/preset-card-data";
import type { Preset } from "@/lib/catalog/types";

const byName = (list: Preset[], name: string) => {
  const p = list.find((x) => x.name === name);
  if (!p) throw new Error(`no preset named ${name}`);
  return p;
};

describe("motion → camera move", () => {
  it("gives every one of the camera motions a known move", () => {
    expect(MOTIONS.length).toBeGreaterThanOrEqual(100);
    for (const m of MOTIONS) expect(Object.keys(CAMERA_MOVES), m.name).toContain(motionMove(m));
  });

  it.each<[string, CameraMove]>([
    ["Zoom In", "zoom-in"],
    ["Zoom Out", "zoom-out"],
    ["Zoom", "optical-zoom"],
    ["Crash Zoom In", "crash-in"],
    ["Crash Zoom Out", "crash-out"],
    ["Rapid Zoom In", "rapid-in"],
    ["Dolly In", "dolly-in"],
    ["Dolly Out", "dolly-out"],
    ["Super Dolly In", "super-dolly-in"],
    ["Dolly Zoom In", "dolly-zoom-in"],
    ["Dolly Zoom Out", "dolly-zoom-out"],
    ["Dolly Left", "truck-left"],
    ["Truck Right", "truck-right"],
    ["YoYo Zoom", "yoyo"],
    ["Through Object In", "through-in"],
    ["360 Orbit", "orbit-360"],
    ["Arc Left", "orbit-left"],
    ["Arc Right", "orbit-right"],
    ["Lazy Orbit", "lazy-orbit"],
    ["Bullet Time", "bullet-time"],
    ["Lazy Susan", "turntable"],
    ["Crane Up", "crane-up"],
    ["Crane Down", "crane-down"],
    ["Crane Over The Head", "crane-over"],
    ["Jib Down", "crane-down"],
    ["Tilt Up", "tilt-up"],
    ["Tilt Down", "tilt-down"],
    ["Pan Left", "pan-left"],
    ["Pan Right", "pan-right"],
    ["Whip Pan", "whip-pan"],
    ["Dutch Angle", "dutch"],
    ["Handheld", "handheld"],
    ["Snorricam", "snorricam"],
    ["FPV Drone", "fpv"],
    ["Drone Reveal", "drone-rise"],
    ["Road Rush", "road-rush"],
    ["Hyperlapse", "hyperlapse"],
    ["Timelapse", "timelapse"],
    ["Slow Motion", "slow-mo"],
    ["Focus Change", "rack-focus"],
    ["Static", "static"],
    ["Earth Zoom Out", "earth-out"],
    ["Skateboard Ollie", "jump"],
    ["Moonwalk Left", "slide-left"],
    ["Boxing", "impact"],
    ["Roll Transition", "roll"],
  ])("%s → %s", (name, move) => {
    expect(motionMove(byName(MOTIONS, name))).toBe(move);
  });

  it("spreads the motions over many different moves", () => {
    const counts = new Map<string, number>();
    for (const m of MOTIONS) counts.set(motionMove(m), (counts.get(motionMove(m)) ?? 0) + 1);
    expect(counts.size).toBeGreaterThanOrEqual(40);
    // The generic fallback ("dolly-in") stays rare: almost every motion gets its own reading.
    expect(counts.get("dolly-in") ?? 0).toBeLessThanOrEqual(3);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(10);
  });

  it("keeps the subject the same size during a dolly zoom", () => {
    for (const k of ["dolly-zoom-in", "dolly-zoom-out"] as const) {
      expect(layerTransform(CAMERA_MOVES[k], "subject", 1).scale).toBeCloseTo(1, 5);
      expect(layerTransform(CAMERA_MOVES[k], "bg", 1).scale).not.toBeCloseTo(1, 2);
    }
  });

  it("separates zooms (no parallax) from dollies and trucks (parallax)", () => {
    const zoom = CAMERA_MOVES["zoom-in"];
    expect(layerTransform(zoom, "bg", 1).scale).toBe(layerTransform(zoom, "fg", 1).scale);
    const dolly = CAMERA_MOVES["dolly-in"];
    expect(layerTransform(dolly, "fg", 1).scale).toBeGreaterThan(layerTransform(dolly, "bg", 1).scale);
    const truck = CAMERA_MOVES["truck-left"];
    expect(Math.abs(layerTransform(truck, "fg", 1).x)).toBeGreaterThan(Math.abs(layerTransform(truck, "bg", 1).x));
    const pan = CAMERA_MOVES["pan-left"];
    expect(layerTransform(pan, "fg", 1).x).toBe(layerTransform(pan, "bg", 1).x);
    const orbit = CAMERA_MOVES["orbit-left"];
    expect(Math.sign(layerTransform(orbit, "fg", 1).x)).toBe(-Math.sign(layerTransform(orbit, "bg", 1).x));
  });

  // Card is 1 × 0.75 (4:3), centered. A layer is the card plus LAYER_BLEED on each side, moved by
  // translate(x%, y%) scale(s) rotate(r) around its center (CSS order).
  function covers(spec: MoveSpec, layer: PreviewLayer, t: number): boolean {
    const W = 1 + 2 * LAYER_BLEED;
    const H = 0.75 * W;
    const { x, y, scale, rotate } = layerTransform(spec, layer, t);
    const T = [(x / 100) * W, (y / 100) * H];
    const a = (-rotate * Math.PI) / 180;
    // The background must cover the whole card; the other layers only their sides and bottom.
    const points =
      layer === "bg"
        ? [[-0.5, -0.375], [0.5, -0.375], [-0.5, 0.375], [0.5, 0.375]]
        : [[-0.5, 0.375], [0.5, 0.375], [-0.5, 0], [0.5, 0]];
    return points.every(([cx, cy]) => {
      const dx = (cx - T[0]) / scale;
      const dy = (cy - T[1]) / scale;
      const px = dx * Math.cos(a) - dy * Math.sin(a);
      const py = dx * Math.sin(a) + dy * Math.cos(a);
      return Math.abs(px) <= W / 2 + 1e-9 && Math.abs(py) <= H / 2 + 1e-9;
    });
  }

  it("never shows a layer's edge inside the card, at any point of any move", () => {
    const bad: string[] = [];
    for (const [name, spec] of Object.entries(CAMERA_MOVES) as [string, MoveSpec][]) {
      for (const layer of PREVIEW_LAYERS) {
        if (layer === "fg" && spec.through) continue; // the foreground flies past and fades out
        for (let t = 0; t <= 1.0001; t += 0.025) if (!covers(spec, layer, t)) bad.push(`${name}/${layer}@${t.toFixed(3)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("turns a move into CSS variables", () => {
    expect(moveVars(CAMERA_MOVES["truck-left"])).toEqual({ "--pv-dur": "3s", "--pv-tx": 9 });
    expect(moveVars(CAMERA_MOVES.handheld)["--pv-dur"]).toBe("4.8s");
  });
});

describe("effect and app treatments", () => {
  it("gives every effect and app a known treatment", () => {
    for (const e of EFFECTS) expect(FX, e.name).toContain(effectFx(e));
    for (const a of APPS) expect(FX, a.name).toContain(appFx(a));
  });

  it.each<[string, string]>([
    ["Set On Fire", "fire"],
    ["Firework", "sparkle"],
    ["Water Splash", "water"],
    ["Freezing", "ice"],
    ["Sand Storm", "wind"],
    ["Thunder God", "lightning"],
    ["Building Explosion", "explode"],
    ["Glitch", "glitch"],
    ["Lens Flare", "flare"],
    ["Sakura Petals", "petals"],
    ["Tiny Planet", "tiny"],
    ["Bleach Bypass", "grade"],
    ["Silhouette", "relight"],
    ["Column Wipe", "wipe"],
    ["Comic", "halftone"],
    ["Horror Face", "dark"],
    ["Turn Into Statue", "morph"],
    ["Angel Wings", "glow"],
    ["Windows", "halftone"],
  ])("effect %s → %s", (name, fx) => {
    expect(effectFx(byName(EFFECTS, name))).toBe(fx);
  });

  it.each<[string, string]>([
    ["Face Swap", "swap"],
    ["Headshot Generator", "scan"],
    ["Upscale", "sharpen"],
    ["Packshot", "shine"],
    ["Relight", "relight"],
    ["Match Colors", "grade"],
    ["Angles", "frame"],
    ["Remove Background", "wipe"],
  ])("app %s → %s", (name, fx) => {
    expect(appFx(byName(APPS, name))).toBe(fx);
  });

  it("puts people presets on the portrait still and products on the product still", () => {
    expect(previewFor(byName(APPS, "Face Swap")).scene).toBe("portrait");
    expect(previewFor(byName(APPS, "Packshot")).scene).toBe("product");
    expect(previewFor(byName(MOTIONS, "FPV Drone")).scene).toBe("city");
    expect(previewFor(byName(MOTIONS, "Crane Up")).scene).toBe("landscape");
    expect(previewFor(byName(MOTIONS, "Crane Up")).poster).toBe("/samples/previews/landscape.svg");
  });
});

describe("slim card DTOs", () => {
  it("keeps only what a card shows", () => {
    const p = byName(APPS, "Face Swap");
    const card = toPresetCard(p);
    expect(Object.keys(card).sort()).toEqual(
      ["category", "cloud", "description", "hue", "icon", "id", "name", "open", "preview", ...(p.badges?.includes("top") ? ["top"] : [])].sort(),
    );
    expect(card).toMatchObject({ id: p.id, name: p.name, cloud: true, open: true, icon: p.look.icon });
    const json = JSON.stringify(card);
    // No prompt templates, routes, model ids or LoRA URLs reach the browser.
    expect(json).not.toContain(p.promptTemplate.slice(0, 20));
    expect(json).not.toMatch(/modelId|loras|https?:|promptTemplate|parity/);
  });

  it("carries the whole description, which a phone opens in place of a tooltip", () => {
    for (const p of [...APPS, ...MOTIONS, ...EFFECTS]) expect(toPresetCard(p).description, p.id).toBe(p.description);
    expect(Math.max(...EFFECTS.map((p) => p.description.length))).toBeGreaterThan(100);
  });

  it("is a small fraction of the full preset payload", () => {
    for (const list of [APPS, MOTIONS, EFFECTS]) {
      const full = JSON.stringify(list).length;
      const slim = JSON.stringify(list.map(toPresetCard)).length;
      expect(slim / full).toBeLessThan(0.45);
    }
    // The 255-card effects gallery ships under 85 KB of card data (2.3 KB of it the descriptions' whole text).
    expect(JSON.stringify(EFFECTS.map(toPresetCard)).length).toBeLessThan(85_000);
  });

  it("reads the hue back from the preset look", () => {
    expect(lookHue({ icon: "Zap", from: "oklch(0.72 0.16 123)", to: "oklch(0.55 0.2 173)" })).toBe(123);
    expect(lookHue({ icon: "Zap", from: "#fff", to: "#000" })).toBe(282);
  });

  it("marks only presets that have a route on each engine", () => {
    const cards = [...APPS, ...MOTIONS, ...EFFECTS].map((p) => [p, toPresetCard(p)] as const);
    for (const [p, c] of cards) {
      expect(c.cloud).toBe(!!p.cloud);
      expect(c.open).toBe(!!p.open);
    }
  });

  it("searches name, description and category", () => {
    expect(searchText({ name: "Crash Zoom In", description: "A sudden zoom", category: "Push & Pull" })).toBe("crash zoom in a sudden zoom push & pull");
    // Every word, in any order and in its plain forms.
    const t = searchText({ name: "Remove Background", description: "A clean cut-out with one explosion", category: "Edit" });
    for (const q of ["remover", "removing", "explosions", "background remove", "explosion", "edit"]) expect(matchesSearch(t, q), q).toBe(true);
    for (const q of ["fire", "remove fire"]) expect(matchesSearch(t, q), q).toBe(false);
  });
});

describe("preset route lines (details popover)", () => {
  it("names each engine's model, or says there is none", () => {
    const names: Record<string, string> = { "nano-banana-pro": "Nano Banana Pro" };
    const lines = presetRouteLines({ cloud: { modelId: "nano-banana-pro", op: "edit" }, open: null }, (id) => names[id]);
    expect(lines).toEqual([
      { engine: "cloud", label: "Cloud", model: "Nano Banana Pro" },
      { engine: "open", label: "Open source", model: null },
    ]);
    // Unknown names fall back to the model id.
    expect(presetRouteLines({ cloud: null, open: { modelId: "oss-x", op: "edit" } })[1].model).toBe("oss-x");
  });

  it("says when a motion's cloud route runs words because its LoRA is licensed for the GPU only", () => {
    const wiggle = getPreset("motion-wiggle")!;
    const [cloud, open] = presetRouteLines(wiggle, (id) => ({ "fuobe-dop": "Fuobe DoP", "kling-2-5-turbo": "Kling 2.5 Turbo" })[id]);
    // The cloud route carries no LoRA it can't host: the move's words, on its partner model until Fuobe DoP's are measured.
    expect(cloud.model).toBe("Kling 2.5 Turbo · words only (its LoRA is licensed for your GPU only)");
    expect(open.model).toBe("Fuobe DoP");
    expect(presetRouteLines(getPreset("motion-overhead")!, () => "Fuobe DoP")[0].model).toBe("Fuobe DoP");
  });

  it("names the model a preset's preview was made with first, with the label when it made the live preview", () => {
    const truck = getPreset("motion-truck-left")!;
    const names: Record<string, string> = { "oss-minimax-h3": "MiniMax H3", "minimax-h3": "MiniMax H3", "fuobe-dop": "Fuobe DoP", "fuobe-dop-ltx": "Fuobe DoP · LTX" };
    const h3 = (made: boolean) => (e: "cloud" | "open") => ({ route: { modelId: e === "open" ? "oss-minimax-h3" : "minimax-h3" }, made });
    expect(presetRouteLines(truck, (id) => names[id], h3(true))).toEqual([
      { engine: "cloud", label: "Cloud", model: "MiniMax H3", made: true },
      { engine: "cloud", label: "Cloud", model: names[truck.cloud!.modelId], alt: true },
      { engine: "open", label: "Open source", model: "MiniMax H3", made: true },
      { engine: "open", label: "Open source", model: names[truck.open!.modelId], alt: true },
    ]);
    // The preset's note then speaks of its second choice.
    const truckLines = presetRouteLines(truck, (id) => names[id], h3(true));
    expect(parityNote("Fuobe DoP: Wan 2.2 with the motionpushin LoRA, on your GPU and in the cloud", truckLines)).toBe(
      "As a second choice, Fuobe DoP: Wan 2.2 with the motionpushin LoRA, on your GPU and in the cloud",
    );
    expect(parityNote("Fuobe DoP: Wan 2.2", presetRouteLines(truck, (id) => names[id]))).toBe("Fuobe DoP: Wan 2.2");
    const colors = [
      { engine: "open" as const, model: "Qwen-Image 2.1 Turbo" },
      { engine: "open" as const, model: "Palette match", alt: true as const },
    ];
    expect(parityNote("The open version transfers the palette directly (no AI model, runs on CPU)", colors)).toBe(
      "Palette match, the second choice on your GPU, transfers the palette directly (no AI model, runs on CPU)",
    );
    expect(parityNote("Approximation: one combined image", colors)).toBe("Approximation: one combined image");
    expect(parityNote(undefined, colors)).toBeUndefined();
    // A still cover: the recipe leads, without the label.
    expect(presetRouteLines(truck, (id) => names[id], h3(false))[0]).toEqual({ engine: "cloud", label: "Cloud", model: "MiniMax H3" });
    // A recipe on the preset's own model (Zooms on Qwen-Image 2.1) is one line; an engine without a recipe keeps its route.
    const zooms = getPreset("app-zooms")!;
    const lines = presetRouteLines(zooms, (id) => ({ "oss-qwen-image-21": "Qwen-Image 2.1", "nano-banana-pro": "Nano Banana Pro" })[id], (e) => (e === "open" ? { route: zooms.open!, made: true } : undefined));
    expect(lines).toEqual([
      { engine: "cloud", label: "Cloud", model: "Nano Banana Pro" },
      { engine: "open", label: "Open source", model: "Qwen-Image 2.1", made: true },
    ]);
  });
});

describe("a card's description on a phone", () => {
  const cut = { scrollHeight: 64, clientHeight: 32 };
  const fits = { scrollHeight: 32, clientHeight: 32 };

  it("opens text cut short in place, and a second tap closes it", () => {
    expect(readMoreTap(cut, false, true)).toBe(true);
    expect(readMoreTap({ scrollHeight: 64, clientHeight: 64 }, true, true)).toBe(false);
  });

  it("lets a tap on text that fits through to the preset", () => {
    expect(readMoreTap(fits, false, true)).toBeNull();
    // Sub-pixel rounding isn't text cut short.
    expect(readMoreTap({ scrollHeight: 33, clientHeight: 32 }, false, true)).toBeNull();
  });

  it("leaves the desktop as it is: a click opens the preset", () => {
    expect(readMoreTap(cut, false, false)).toBeNull();
    expect(readMoreTap(cut, true, false)).toBeNull();
  });

  it("applies on phones and on screens with no mouse", () => {
    expect(TAP_TO_READ).toContain("(max-width: 639px)");
    expect(TAP_TO_READ).toContain("(hover: none)");
  });
});

describe("preset how-to line", () => {
  it("names the required inputs", () => {
    expect(presetHowTo(byName(APPS, "Face Swap"))).toMatch(/^Add .+ and .+, then Generate\.$/);
    expect(presetHowTo({ type: "motion", userPrompt: "optional", inputs: [{ key: "image", label: "Start frame", accept: "image", required: true }] })).toBe(
      "Add a start frame, then Generate.",
    );
    expect(presetHowTo({ type: "app", userPrompt: "none", inputs: [{ key: "image", label: "Your photo", accept: "image", required: true }] })).toBe(
      "Add your photo, then Generate.",
    );
  });

  it("asks for the prompt only when it's required", () => {
    expect(presetHowTo({ type: "app", userPrompt: "required", inputs: [{ key: "image", label: "Product photo", accept: "image", required: true }] })).toBe(
      "Add a product photo and describe what you want, then Generate.",
    );
  });

  it("handles presets without inputs", () => {
    expect(presetHowTo({ type: "app", userPrompt: "required", inputs: [] })).toBe("Describe what you want, then Generate.");
    expect(presetHowTo({ type: "app", userPrompt: "none", inputs: [] })).toBe("Press Generate — no inputs needed.");
  });
});

describe("real covers", () => {
  it("a preset with a measured cover shows that clip and its poster instead of the procedural preview", () => {
    const measured = previewFor({ id: "effect-measured-cover", type: "effect", name: "Measured", category: "Elements" });
    expect(measured).toMatchObject({ poster: "/previews/dop/effect-measured-cover.jpg", video: "/previews/dop/effect-measured-cover.mp4" });
    expect(measured.fx).toBeUndefined();
    // The others keep their procedural preview.
    expect(previewFor({ id: "effect-other", type: "effect", name: "Other", category: "Elements" }).video).toBeUndefined();
  });

  it("a still cover is the card's image: no clip, no move or treatment, never mirrored", () => {
    const still = previewFor({ id: "app-still-cover", type: "app", name: "Still", category: "Identity" });
    expect(still).toStrictEqual({ poster: "/previews/presets/app-still-cover.jpg", scene: "portrait" });
    expect(isCover(still)).toBe(true);
    // Whatever its id hashes to, a cover is shown as rendered.
    for (const id of ["app-still-cover", "a", "b", "c", "d", "e", "f"]) expect(previewFlip({ id, preview: still })).toBe(false);
  });

  it("no procedural preview counts as a cover, and only treatments mirror", () => {
    const all = [...APPS, ...MOTIONS, ...EFFECTS].map(toPresetCard);
    for (const c of all) expect(isCover(c.preview), c.id).toBe(false);
    expect(all.filter((c) => c.preview.move).some((c) => previewFlip(c))).toBe(false);
    expect(all.filter((c) => c.preview.fx).some((c) => previewFlip(c))).toBe(true);
  });
});
