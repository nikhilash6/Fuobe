import { describe, expect, it } from "vitest";
import { APPS, EFFECTS, getModel, getPreset, MOTIONS, PRESETS } from "@/lib/catalog";
import {
  appModels,
  ORBIT_WORDS,
  OWN_ROUTE_APPS,
  presetGpuKey,
  presetRecipe,
  presetRoutes,
  recipeKind,
  recipeMade,
  recipeRoute,
  withRecipe,
} from "@/lib/catalog/preset-recipes";
import { RECIPE_BOOK } from "@/lib/catalog/preset-recipe-book";
import { untouchedParams } from "@/lib/composer";
import type { Preset } from "@/lib/catalog/types";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";
import { appStudio } from "@/lib/studios";

// A preset opens on the model its preview was made with (its recipe), its own route second (src/lib/catalog/preset-recipes.ts).
const inCatalog = (id: string) => !!getModel(id);
const p = (id: string) => getPreset(id)!;
const VIDEO_OPS = ["i2v", "flf2v"];
/**
 * Words a default prompt never uses: it names only what is wanted, never unwanted things.
 * "No." followed by a digit (a magazine issue number like "No.128") is not a negation.
 */
const NEGATION = /\b(not|never|without|don't|avoid|nothing|none|neither|nor)\b/i;

describe("which presets get a recipe", () => {
  const kinds = new Map(PRESETS.map((x) => [x.id, recipeKind(x)]));
  const of = (k: string | undefined) => PRESETS.filter((x) => kinds.get(x.id) === k);

  it("puts every camera motion and effect with a recipe, and every image-to-video app, on MiniMax H3", () => {
    const h3 = [...of("h3"), ...of("orbit")];
    // Every motion and effect with a recipe (including prestep effects whose clip was made by H3), and every i2v/flf2v app.
    const videoApps = APPS.filter((a) => VIDEO_OPS.includes((a.open ?? a.cloud)!.op) && !OWN_ROUTE_APPS.has(a.id));
    const movesAndEffects = [...MOTIONS, ...EFFECTS].filter((x) => recipeKind(x));
    expect(h3.length).toBe(movesAndEffects.length + videoApps.length);
    expect(new Set(h3.map((x) => x.id))).toEqual(new Set([...movesAndEffects, ...videoApps].map((x) => x.id)));
    // At the time of writing: 412 total.
    expect(h3.length).toBe(412);
    const orbitIds = of("orbit").map((x) => x.id).sort();
    expect(orbitIds.length).toBeGreaterThanOrEqual(2);
    // The label: their live cover is an H3 clip (255 when this was written; it grows as clips are published). Hosted H3
    // is the same model, but has no Orbit LoRA.
    const isClip = (x: Preset) => PRESET_PREVIEWS[x.id]?.model === "minimax-h3";
    expect(h3.filter((x) => recipeMade(x, "open")).map((x) => x.id)).toEqual(h3.filter(isClip).map((x) => x.id));
    expect(h3.filter((x) => recipeMade(x, "cloud")).map((x) => x.id)).toEqual(h3.filter((x) => isClip(x) && recipeKind(x) !== "orbit").map((x) => x.id));
    expect(h3.filter(isClip).length).toBeGreaterThanOrEqual(255);
  });

  it("puts the edit apps on Qwen-Image 2.1", () => {
    const qwen = of("qwen");
    expect(qwen.length).toBeGreaterThan(30);
    // Labelled where the cover's edit came from Qwen-Image 2.1, never in the cloud.
    // Image apps whose cover is an H3 clip morphing into their Qwen-Image 2.1 edit count as made.
    const H3_MORPHS = new Set(["app-age-shift", "app-angles"]);
    const qwenMade = (x: Preset) => PRESET_PREVIEWS[x.id]?.model === "ideogram4+qwen-image-2.1-edit" || (H3_MORPHS.has(x.id) && PRESET_PREVIEWS[x.id]?.model === "minimax-h3");
    expect(qwen.filter((x) => recipeMade(x, "open")).map((x) => x.id)).toEqual(qwen.filter(qwenMade).map((x) => x.id));
    expect(PRESETS.filter((x) => recipeKind(x) === "qwen" && recipeMade(x, "cloud"))).toEqual([]);
  });

  it("leaves only the grades without a recipe and the apps that keep their own route on their default model", () => {
    const none = of(undefined);
    // Graded presets whose clip was graded afterwards and that have no recipe in the book.
    const gradesWithoutRecipe = [...MOTIONS, ...EFFECTS].filter((x) => x.grade && !recipeKind(x));
    expect(new Set(none.map((x) => x.id))).toEqual(new Set([...gradesWithoutRecipe.map((x) => x.id), ...OWN_ROUTE_APPS]));
    expect(none).toHaveLength(27);
    for (const x of none) for (const engine of ["open", "cloud"] as const) expect(presetRecipe(x, engine, inCatalog), x.id).toBeUndefined();
  });

  it("names only models the catalog has", () => {
    for (const x of PRESETS) {
      for (const engine of ["open", "cloud"] as const) {
        const r = recipeRoute(x, engine);
        if (r) expect(getModel(r.modelId), `${x.id} ${engine}`).toBeDefined();
        if (r) expect(getModel(r.modelId)!.routes.some((m) => m.op === r.op), `${x.id} ${engine} ${r.op}`).toBe(true);
      }
    }
  });

  it("writes its own words positively", () => {
    expect(ORBIT_WORDS).not.toMatch(NEGATION);
    expect(ORBIT_WORDS.endsWith("{prompt}")).toBe(true);
    for (const [id, book] of Object.entries(RECIPE_BOOK)) {
      if (book.clip?.words) expect(book.clip.words, `${id} clip words`).not.toMatch(NEGATION);
      if (book.edit?.prompt) expect(book.edit.prompt, `${id} edit prompt`).not.toMatch(NEGATION);
      if (book.clip?.end?.prompt) expect(book.clip.end.prompt, `${id} end prompt`).not.toMatch(NEGATION);
    }
  });
});

describe("spot checks", () => {
  it("Truck Left: H3 image-to-video at Fast, made on both engines, with words and sound", () => {
    const x = p("motion-truck-left");
    const openRecipe = presetRecipe(x, "open", inCatalog)!;
    expect(openRecipe.route.modelId).toBe("oss-minimax-h3");
    expect(openRecipe.route.op).toBe("i2v");
    expect(openRecipe.route.params?.duration).toBe(5);
    expect(openRecipe.route.promptTemplate).toBeDefined();
    expect(openRecipe.route.sound).toBeDefined();
    expect(openRecipe.made).toBe(true);
    const cloudRecipe = presetRecipe(x, "cloud", inCatalog)!;
    expect(cloudRecipe.route.modelId).toBe("minimax-h3");
    expect(cloudRecipe.route.op).toBe("i2v");
    expect(cloudRecipe.route.params?.duration).toBe(5);
    expect(cloudRecipe.made).toBe(true);
    // Fuobe DoP stays second on each engine.
    expect(presetRoutes(x, "open", inCatalog).map((r) => r.modelId)).toEqual(["oss-minimax-h3", x.open!.modelId]);
    expect(presetRoutes(x, "cloud", inCatalog).map((r) => r.modelId)).toEqual(["minimax-h3", x.cloud!.modelId]);
  });

  it("Set on Fire and Disintegration: H3, with the label only where the clip is out", () => {
    expect(presetRecipe(p("effect-set-on-fire"), "open", inCatalog)?.made).toBe(true);
    const dis = presetRecipe(p("effect-disintegration"), "open", inCatalog)!;
    expect(dis.route.modelId).toBe("oss-minimax-h3");
    expect(dis.made).toBe(false);
  });

  it("the presets made at Best open at Best", () => {
    const bestIds = Object.entries(RECIPE_BOOK).filter(([, b]) => b.clip?.quality === "best").map(([id]) => id);
    expect(bestIds.length).toBe(22);
    for (const id of bestIds) {
      const route = recipeRoute(p(id), "open");
      expect(route?.params?.extra?.quality, id).toBe("best");
    }
    expect(PRESETS.filter((x) => recipeRoute(x, "open")?.params?.extra?.quality === "best")).toHaveLength(22);
    expect(recipeRoute(p("motion-crash-zoom-in"), "cloud")?.params).toEqual({ duration: 5 });
  });

  it("360 Orbit: the Orbit LoRA's 3 s on the GPU, 5 s hosted, the label on the GPU only", () => {
    const x = p("motion-360-orbit");
    const open = presetRecipe(x, "open", inCatalog)!;
    expect(open.route).toEqual({ modelId: "oss-minimax-h3", op: "i2v", params: { duration: 3, extra: { orbit: true } }, promptTemplate: ORBIT_WORDS });
    expect(open.made).toBe(true);
    const cloud = presetRecipe(x, "cloud", inCatalog)!;
    expect(cloud.route).toEqual({ modelId: "minimax-h3", op: "i2v", params: { duration: 5 }, promptTemplate: ORBIT_WORDS });
    expect(cloud.made).toBe(false);
  });

  it("a colour-grade effect without a recipe stays on Fuobe DoP", () => {
    const pink = p("effect-candy-pink");
    expect(pink.grade).toBe("candy-pink");
    expect(recipeKind(pink)).toBeUndefined();
    for (const engine of ["open", "cloud"] as const) {
      expect(recipeRoute(pink, engine)).toBeUndefined();
      expect(presetRoutes(pink, engine, inCatalog)).toEqual([pink[engine]]);
    }
  });

  it("orbits circle the picture without adding to the scene", () => {
    // Bullet Time Scene, Product 360, Splash and White all circle with the Orbit LoRA.
    for (const id of ["app-bullet-time-scene", "app-product-360", "app-bullet-time-splash", "app-bullet-time-white"]) expect(recipeKind(p(id)), id).toBe("orbit");
  });

  it("Headshot Generator: Qwen-Image 2.1 Turbo with its own words, made on the GPU, no cloud recipe", () => {
    const x = p("app-headshot-generator");
    const open = presetRecipe(x, "open", inCatalog)!;
    expect(open.route).toMatchObject({ modelId: "oss-qwen-image-21-turbo", op: "edit" });
    expect(open.made).toBe(true);
    expect(presetRecipe(x, "cloud", inCatalog)).toBeUndefined();
    expect(appModels(x, "open", inCatalog)).toEqual(["oss-qwen-image-21-turbo", "oss-qwen-image-21"]);
    expect(appModels(x, "cloud", inCatalog)).toEqual([x.cloud!.modelId]);
  });

  it("Face Swap: Qwen-Image 2.1 Turbo in the cover's words, ReActor second", () => {
    const x = p("app-face-swap");
    const r = presetRecipe(x, "open", inCatalog)!;
    expect(r.route.modelId).toBe("oss-qwen-image-21-turbo");
    expect(r.route.op).toBe("edit");
    expect(r.route.promptTemplate).toMatch(/Replace the face/);
    expect(r.made).toBe(true);
    expect(appModels(x, "open", inCatalog)).toEqual(["oss-qwen-image-21-turbo", "oss-reactor"]);
  });

  it("Zooms keeps its own route", () => {
    const x = p("app-zooms");
    expect(recipeKind(x)).toBeUndefined();
    expect(OWN_ROUTE_APPS.has(x.id)).toBe(true);
    expect(appModels(x, "open", inCatalog)).toEqual(["oss-qwen-image-21"]);
  });

  it("never labels a tool", () => {
    for (const id of ["app-remove-background", "app-upscale", "app-vectorize", "app-video-background-remover", "app-image-to-3d"]) {
      for (const engine of ["open", "cloud"] as const) expect(recipeMade(p(id), engine), id).toBe(false);
    }
  });
});

describe("a linked preset that loads after the first draft", () => {
  it("brings its length and Quality to the settings still at the model's defaults", () => {
    const h3 = getModel("oss-minimax-h3")!;
    const draft = { ...h3.defaults };
    expect(untouchedParams(draft, h3.defaults ?? {}, { duration: 5, extra: { quality: "best" } })).toEqual({ ...draft, extra: { quality: "best" } });
    expect(untouchedParams(draft, h3.defaults ?? {}, { duration: 3 })).toEqual({ ...draft, duration: 3 });
    // A setting the person changed stays; nothing to change is undefined.
    expect(untouchedParams({ ...draft, duration: 10 }, h3.defaults ?? {}, { duration: 3 })).toBeUndefined();
    expect(untouchedParams({ ...draft, extra: { quality: "fast", seedLock: 1 } }, { ...h3.defaults, extra: { quality: "fast" } }, { extra: { quality: "best" } })).toEqual({
      ...draft,
      extra: { quality: "best", seedLock: 1 },
    });
    expect(untouchedParams(draft, h3.defaults ?? {}, { duration: 5 })).toBeUndefined();
  });
});

describe("without the recipe's model", () => {
  it("falls back to the preset's own route", () => {
    const noH3 = (id: string) => id !== "oss-minimax-h3" && inCatalog(id);
    const x = p("motion-truck-left");
    expect(presetRecipe(x, "open", noH3)).toBeUndefined();
    expect(presetRoutes(x, "open", noH3)).toEqual([x.open]);
    expect(presetRoutes(x, "cloud", noH3).map((r) => r.modelId)).toEqual(["minimax-h3", x.cloud!.modelId]);
    const dance = p("app-dance");
    expect(appModels(dance, "open", noH3)).toEqual([dance.open!.modelId]);
  });
});

describe("the GPU pre-flight", () => {
  it("keys a preset's badge by the route on the model picked, at the route's Quality", () => {
    const crash = p("motion-crash-zoom-in");
    // Made at Best: its badge is the 20-step graph's, so at Fast the model's own badge applies.
    expect(presetGpuKey(crash, inCatalog, "oss-minimax-h3", "best", "fast")).toBe(crash.id);
    expect(presetGpuKey(crash, inCatalog, "oss-minimax-h3", "fast", "fast")).toBeUndefined();
    expect(presetGpuKey(crash, inCatalog, "oss-minimax-h3", undefined, "fast")).toBeUndefined();
    const jib = p("motion-jib-up");
    expect(presetGpuKey(jib, inCatalog, "oss-minimax-h3", undefined, "fast")).toBe(jib.id);
    expect(presetGpuKey(jib, inCatalog, "oss-minimax-h3", "best", "fast")).toBeUndefined();
    expect(presetGpuKey(jib, inCatalog, "fuobe-dop")).toBe("motion-jib-up@fuobe-dop");
    expect(presetGpuKey(jib, inCatalog, "oss-ltx25")).toBeUndefined();
    expect(presetGpuKey(jib, inCatalog, undefined)).toBeUndefined();
  });

  it("offers hosted MiniMax H3 as the cloud alternative of a preset that opens on it", async () => {
    const { presetTool } = await import("@/server/gpu/tools");
    expect(presetTool("motion-jib-up")!.cloud).toEqual({ modelId: "minimax-h3" });
    expect(presetTool("app-dance")!.cloud).toEqual({ modelId: "minimax-h3" });
    // Its own route keeps the rule it had: Fuobe DoP runs on both engines.
    expect(presetTool("motion-jib-up", { modelId: "fuobe-dop" })!.cloud).toEqual({ modelId: p("motion-jib-up").cloud!.modelId });
    // No hosted Qwen-Image 2.1.
    expect(presetTool("app-face-swap")!.cloud).toBeUndefined();
  });

  it("describes the route a preset opens on, its own route by its model, and still looks for its own LoRAs", async () => {
    const { allLoraNames, modelTool, presetRouteTools, presetTool, toolFor } = await import("@/server/gpu/tools");
    const jib = p("motion-jib-up");
    const first = presetTool(jib.id)!;
    expect(first.ref).toBe("preset:motion-jib-up");
    expect(first.workflows).toEqual(modelTool("oss-minimax-h3", "i2v")!.workflows);
    expect(first.loras).toEqual([]);
    // The graph its settings pick: the Orbit graph for an orbit, the 20-step one at Best.
    expect(presetTool("motion-360-orbit")!.workflows).toEqual(["minimax-h3-orbit"]);
    expect(presetTool("motion-crash-zoom-in")!.workflows).toEqual(["minimax-h3-i2v-hq"]);
    // Each other open route has a badge of its own, named by its model; a recipe on the preset's own model has none.
    const others = presetRouteTools().map((t) => t.ref);
    expect(others).toContain("preset:motion-jib-up@fuobe-dop");
    expect(others).toContain("preset:app-face-swap@oss-reactor");
    expect(others.filter((r) => r.startsWith("preset:app-zooms"))).toEqual([]);
    expect(new Set(others).size).toBe(others.length);
    // The run's model picks the route the gate checks: Fuobe DoP's with its LoRAs; another model's run is its own.
    const own = presetTool(jib.id, { modelId: "fuobe-dop" })!;
    expect(own.ref).toBe("preset:motion-jib-up@fuobe-dop");
    expect(toolFor(own.ref)).toEqual(own);
    expect(own.loras.map((l) => l.file).sort()).toEqual(presetTool(jib.id, { own: true })!.loras.map((l) => l.file).sort());
    expect(presetTool(jib.id, { modelId: "oss-ltx25" })).toBeNull();
    const dopLoras = MOTIONS.flatMap((m) => m.open?.loras ?? []).map((l) => l.file.split("/").at(-1)!);
    expect(dopLoras.length).toBeGreaterThan(0);
    expect(allLoraNames()).toEqual(expect.arrayContaining(dopLoras));
    // Face Swap opens on Qwen-Image 2.1 Turbo; ReActor's graph is its own route's.
    expect(presetTool("app-face-swap")!.workflows).toEqual(modelTool("oss-qwen-image-21-turbo", "edit")!.workflows);
    expect(presetTool("app-face-swap", { own: true })!.workflows).toEqual(modelTool("oss-reactor", "face-swap")!.workflows);
  });
});

describe("an app's studio with its recipe", () => {
  it("opens on the recipe on each engine and lists both models", () => {
    const face = withRecipe(appStudio(p("app-face-swap")), inCatalog);
    expect(face.defaultModels).toEqual({ cloud: "nano-banana-pro", open: "oss-qwen-image-21-turbo" });
    expect(face.ops).toEqual(expect.arrayContaining(["edit", "face-swap"]));
    expect(face.appModels).toEqual({ cloud: ["nano-banana-pro"], open: ["oss-qwen-image-21-turbo", "oss-reactor"] });
    const colors = withRecipe(appStudio(p("app-match-colors")), inCatalog);
    expect(colors.ops).toEqual(expect.arrayContaining(["edit", "color-match"]));
    const dance = withRecipe(appStudio(p("app-dance")), inCatalog);
    expect(dance.defaultModels).toEqual({ cloud: "minimax-h3", open: "oss-minimax-h3" });
    expect(dance.appModels?.cloud).toEqual(["minimax-h3", p("app-dance").cloud!.modelId]);
    // An app with no recipe keeps its config, with its one model per engine listed.
    const influencer = withRecipe(appStudio(p("app-ai-influencer")), inCatalog);
    expect(influencer.defaultModels).toEqual(appStudio(p("app-ai-influencer")).defaultModels);
    expect(influencer.appModels).toEqual({ cloud: ["fuobe-soul"], open: ["oss-zimage-soul-cast"] });
  });

  it("keeps a motion's or a studio's config as it is", () => {
    const config = { ...appStudio(p("app-dance")), preset: p("motion-truck-left") as Preset };
    expect(withRecipe(config, inCatalog)).toBe(config);
  });
});
