import { describe, expect, it } from "vitest";
import { APPS, EFFECTS, getModel, getPreset, MOTIONS, PRESETS } from "@/lib/catalog";
import {
  appModels,
  BEST_QUALITY_PRESETS,
  imageTags,
  ORBIT_PRESETS,
  ORBIT_WORDS,
  OWN_ROUTE_APPS,
  presetGpuKey,
  presetRecipe,
  presetRoutes,
  recipeKind,
  recipeMade,
  recipeRoute,
  SPECIALIST_TEMPLATES,
  withRecipe,
  WORDS_APPS,
} from "@/lib/catalog/preset-recipes";
import { planGeneration } from "@/lib/catalog/plan";
import { untouchedParams } from "@/lib/composer";
import type { Preset } from "@/lib/catalog/types";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";
import { appStudio } from "@/lib/studios";

// A preset opens on the model its preview was made with (its recipe), its own route second (src/lib/catalog/preset-recipes.ts).
const inCatalog = (id: string) => !!getModel(id);
const p = (id: string) => getPreset(id)!;
const VIDEO_OPS = ["i2v", "flf2v"];
/** Words a default prompt never uses: it names only what is wanted. */
const NEGATION = /\b(no|not|never|without|don't|avoid|nothing|none|neither|nor)\b/i;

describe("which presets get a recipe", () => {
  const kinds = new Map(PRESETS.map((x) => [x.id, recipeKind(x)]));
  const of = (k: string | undefined) => PRESETS.filter((x) => kinds.get(x.id) === k);

  it("puts every camera motion and effect without a start-frame step or a grade, and every image-to-video app, on MiniMax H3", () => {
    const moves = [...MOTIONS, ...EFFECTS].filter((x) => !x.prestep && !x.grade);
    const videoApps = APPS.filter((a) => VIDEO_OPS.includes((a.open ?? a.cloud)!.op) && !OWN_ROUTE_APPS.has(a.id));
    const h3 = [...of("h3"), ...of("orbit")];
    expect(h3.length).toBe(moves.length + videoApps.length);
    expect(new Set(h3.map((x) => x.id))).toEqual(new Set([...moves, ...videoApps].map((x) => x.id)));
    // At the time of writing: 310 moves and 61 video apps.
    expect(h3.length).toBe(371);
    expect(of("orbit").map((x) => x.id).sort()).toEqual([...ORBIT_PRESETS].sort());
    // The label: their live cover is an H3 clip (255 when this was written; it grows as clips are published). Hosted H3
    // is the same model, but has no Orbit LoRA.
    const isClip = (x: Preset) => PRESET_PREVIEWS[x.id]?.model === "minimax-h3";
    expect(h3.filter((x) => recipeMade(x, "open")).map((x) => x.id)).toEqual(h3.filter(isClip).map((x) => x.id));
    expect(h3.filter((x) => recipeMade(x, "cloud")).map((x) => x.id)).toEqual(h3.filter((x) => isClip(x) && !ORBIT_PRESETS.has(x.id)).map((x) => x.id));
    expect(h3.filter(isClip).length).toBeGreaterThanOrEqual(255);
  });

  it("puts the edit apps on Qwen-Image 2.1 on its Turbo, and the specialists on it in their covers' words", () => {
    const edits = APPS.filter((a) => a.open?.modelId === "oss-qwen-image-21" && a.open.op === "edit" && !["app-shots", "app-what-s-next", "app-zooms"].includes(a.id));
    expect(of("turbo").map((x) => x.id).sort()).toEqual(edits.map((x) => x.id).sort());
    expect(of("turbo")).toHaveLength(39);
    // Labelled where the cover's edit came from the Turbo (35 when this was written), never in the cloud.
    const qwenMade = (x: Preset) => PRESET_PREVIEWS[x.id]?.model === "ideogram4+qwen-image-2.1-edit" || (x.id === "app-age-shift" && PRESET_PREVIEWS[x.id]?.model === "minimax-h3");
    expect(of("turbo").filter((x) => recipeMade(x, "open")).map((x) => x.id)).toEqual(of("turbo").filter(qwenMade).map((x) => x.id));
    expect(of("turbo").filter(qwenMade).length).toBeGreaterThanOrEqual(35);
    expect(PRESETS.filter((x) => recipeKind(x) !== "h3" && recipeKind(x) !== "orbit" && recipeMade(x, "cloud"))).toEqual([]);
    expect(of("specialist").map((x) => x.id).sort()).toEqual(Object.keys(SPECIALIST_TEMPLATES).sort());
    expect(of("own").map((x) => x.id).sort()).toEqual(["app-expand-image", "app-zoom-out", "app-zooms"]);
  });

  it("leaves the effects with a start-frame step or a grade, and the apps that need their own route, as they are", () => {
    const none = of(undefined);
    const steps = EFFECTS.filter((x) => x.prestep);
    expect(steps).toHaveLength(38);
    // Fuobe DoP's clip of a colour-grade effect is graded afterwards, as its cover was.
    const grades = [...MOTIONS, ...EFFECTS].filter((x) => x.grade && !x.prestep);
    expect(grades).toHaveLength(15);
    expect(new Set(none.map((x) => x.id))).toEqual(new Set([...steps.map((x) => x.id), ...grades.map((x) => x.id), ...OWN_ROUTE_APPS]));
    expect(none).toHaveLength(68);
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
    for (const [id, words] of Object.entries(SPECIALIST_TEMPLATES)) expect(words, id).not.toMatch(NEGATION);
    expect(ORBIT_WORDS.endsWith("{prompt}")).toBe(true);
  });
});

describe("spot checks", () => {
  it("Truck Left: H3 image-to-video at Fast, made on both engines", () => {
    const x = p("motion-truck-left");
    // Fast is H3's default Quality: nothing to set.
    expect(presetRecipe(x, "open", inCatalog)).toEqual({ route: { modelId: "oss-minimax-h3", op: "i2v", params: { duration: 5 } }, made: true });
    expect(presetRecipe(x, "cloud", inCatalog)).toEqual({ route: { modelId: "minimax-h3", op: "i2v", params: { duration: 5 } }, made: true });
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
    expect(BEST_QUALITY_PRESETS.size).toBe(25);
    // Particles keeps its start-frame step (Mixed Media), so it keeps Fuobe DoP.
    const stepped = [...BEST_QUALITY_PRESETS].filter((id) => p(id).prestep);
    expect(stepped).toEqual(["effect-particles"]);
    for (const id of BEST_QUALITY_PRESETS) if (!p(id).prestep) expect(recipeRoute(p(id), "open")?.params?.extra?.quality, id).toBe("best");
    expect(PRESETS.filter((x) => recipeRoute(x, "open")?.params?.extra?.quality === "best")).toHaveLength(24);
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

  it("a colour-grade effect stays on Fuobe DoP, whose clip is graded", () => {
    const pink = p("effect-candy-pink");
    expect(pink.grade).toBe("candy-pink");
    for (const engine of ["open", "cloud"] as const) {
      expect(recipeRoute(pink, engine)).toBeUndefined();
      expect(presetRoutes(pink, engine, inCatalog)).toEqual([pink[engine]]);
    }
  });

  it("orbits only a picture as it is: an app whose words add to the scene keeps them", () => {
    // Bullet Time Scene and Product 360 circle the picture with the Orbit LoRA.
    for (const id of ["app-bullet-time-scene", "app-product-360"]) expect(recipeKind(p(id)), id).toBe("orbit");
    // Bullet Time Splash and White run H3's image-to-video in their own words (the water, the white cyclorama).
    for (const id of ["app-bullet-time-splash", "app-bullet-time-white"]) {
      expect(recipeKind(p(id)), id).toBe("h3");
      expect(recipeRoute(p(id), "open"), id).toEqual({ modelId: "oss-minimax-h3", op: "i2v", params: { duration: 5 } });
      expect(recipeRoute(p(id), "cloud")?.promptTemplate, id).toBeUndefined();
    }
    // 3D Rotation keeps its own route and its Rotate LoRA.
    expect(recipeKind(p("app-3d-rotation"))).toBeUndefined();
    expect(appModels(p("app-3d-rotation"), "open", inCatalog)).toEqual([p("app-3d-rotation").open!.modelId]);
  });

  it("Headshot Generator: Qwen-Image 2.1 Turbo with its own words, made on the GPU, no cloud recipe", () => {
    const x = p("app-headshot-generator");
    const open = presetRecipe(x, "open", inCatalog)!;
    expect(open.route).toMatchObject({ modelId: "oss-qwen-image-21-turbo", op: "edit" });
    expect(open.route.promptTemplate).toBeUndefined();
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
    expect(r.route.promptTemplate).toMatch(/^Replace the face of the person in <image1> with the face of the person in <image2>/);
    expect(r.made).toBe(true);
    expect(appModels(x, "open", inCatalog)).toEqual(["oss-qwen-image-21-turbo", "oss-reactor"]);
  });

  it("the specialists keep their options, and Product Shot keeps the product as it is", () => {
    expect(SPECIALIST_TEMPLATES["app-relight"]).toContain("{option:light} {option:dir}");
    expect(SPECIALIST_TEMPLATES["app-product-shot"]).toContain("{option:scene}");
    expect(SPECIALIST_TEMPLATES["app-product-shot"]).toMatch(/Keep the product, its shape, colours, label, position and size/);
    for (const id of Object.keys(SPECIALIST_TEMPLATES)) {
      const options = p(id).options?.map((o) => o.key) ?? [];
      for (const key of options) expect(SPECIALIST_TEMPLATES[id], `${id} ${key}`).toContain(`{option:${key}}`);
    }
  });

  it("names a two-image app's pictures as Qwen-Image 2.1's encoder does", () => {
    expect(imageTags("Place the product from the second image into the first image. Keep the first image's light.")).toBe(
      "Place the product from <image2> into <image1>. Keep <image1>'s light.",
    );
    expect(imageTags("Relight image 1 so it matches image 2.")).toBe("Relight <image1> so it matches <image2>.");
    const swap = recipeRoute(p("app-character-swap"), "open")!;
    expect(swap.promptTemplate).toMatch(/<image1>/);
    expect(swap.promptTemplate).not.toMatch(/(first|second) image/);
    // An app that names no picture by position keeps its words (the preset's own).
    expect(recipeRoute(p("app-headshot-generator"), "open")!.promptTemplate).toBeUndefined();
  });

  it("Zooms keeps its own Qwen-Image 2.1 route, with the label its H3 morph earns", () => {
    const x = p("app-zooms");
    expect(presetRecipe(x, "open", inCatalog)).toEqual({ route: x.open, made: true });
    expect(appModels(x, "open", inCatalog)).toEqual(["oss-qwen-image-21"]);
    expect(presetRecipe(p("app-expand-image"), "open", inCatalog)?.made).toBe(false);
  });

  it("Angles: Qwen-Image 2.1 Turbo in the app's words, its Multiple-Angles LoRA route second", () => {
    const x = p("app-angles");
    expect([...WORDS_APPS]).toEqual(["app-angles"]);
    expect(recipeKind(x)).toBe("words");
    const r = presetRecipe(x, "open", inCatalog)!;
    expect(r.route).toEqual({ modelId: "oss-qwen-image-21-turbo", op: "edit", promptTemplate: x.promptTemplate });
    expect(r.route.loras).toBeUndefined();
    // Its cover's new view came from the Turbo, then an H3 morph.
    expect(r.made).toBe(PRESET_PREVIEWS[x.id]?.model === "minimax-h3");
    expect(appModels(x, "open", inCatalog)).toEqual(["oss-qwen-image-21-turbo", "oss-qwen-edit"]);
    expect(presetRecipe(x, "cloud", inCatalog)).toBeUndefined();
    // The options become words on the Turbo; the 2511 route keeps the LoRA's own words.
    const choice = { angle: "back-left", height: "high-angle", distance: "close-up" };
    const run = (modelId: string) =>
      planGeneration({ feature: "app:app-angles", presetId: x.id, modelId, op: "edit", inputs: { images: ["/api/files/a.png"] }, presetOptions: choice }, getModel, getPreset);
    const turbo = run("oss-qwen-image-21-turbo");
    expect(turbo.prompt).toMatch(/^Show the exact same scene and subject as a back-left quarter view, high-angle shot, close-up/);
    expect(turbo.loras).toEqual([]);
    const own = run("oss-qwen-edit");
    expect(own.prompt).toMatch(/^<sks> back-left quarter view high-angle shot close-up/);
    expect(own.loras[0]?.file).toMatch(/multiple-angles/);
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
