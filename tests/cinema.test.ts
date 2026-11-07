import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { onEngine } from "@/lib/catalog/engines";
import {
  APERTURES,
  CAMERA_BODIES,
  CAMERA_MOVES,
  CAST_MODELS,
  CINEMA_CAMERA_LORA,
  CINEMA_MAX_SECONDS,
  CINEMA_MODELS,
  LOCATION_MODELS,
  EMOTION_FAMILIES,
  ERAS,
  GENRES,
  LENSES,
  LIGHTING_PRESETS,
  LIGHT_DIRECTIONS,
  PALETTES,
  SOUL_CAST_FIELDS,
  TEMPOS,
  applyEmotions,
  castPrompt,
  checkReferences,
  cinemaMoveRoute,
  compileDirector,
  gridPrompt,
  openCameraRoute,
  planCinema,
  randomizeCast,
  rigError,
  visibleCast,
  type CinemaGenerateInput,
  type DirectorSettings,
} from "@/lib/catalog/cinema";
import { buildPayload } from "@/lib/catalog/payload";
import { HARMONIES, harmonyPalette, hexToRgb, kmeans, paletteFromPixels, rgbToHsl, type RGB } from "@/components/cinema/color-math";
import { equalSpans, findCuts, lineStats, tileRects } from "@/components/cinema/grid-math";

const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/parity-studios.json"), "utf8")).cinemaStudio;
const imageResearch = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/parity-image-studios.json"), "utf8"));
const dp = research.directorsPanel;

describe("Cinema Studio data matches the research", () => {
  it("film setup, camera and lighting options", () => {
    const strip = (xs: { name: string; apiSlug?: string | null }[]) => xs.map((x) => [x.name, x.apiSlug ?? null]);
    expect(GENRES.map((g) => [g.name, g.slug])).toEqual(strip(dp.filmSetup.genre));
    expect(ERAS.map((g) => [g.name, g.slug])).toEqual(strip(dp.filmSetup.era));
    expect(TEMPOS.map((g) => [g.name, g.slug])).toEqual(strip(dp.filmSetup.tempo));
    expect(CAMERA_BODIES.map((g) => [g.name, g.slug])).toEqual(strip(dp.camera.camera));
    expect(LENSES.map((g) => [g.name, g.slug])).toEqual(strip(dp.camera.lens));
    expect(APERTURES.map((g) => [g.name, g.slug])).toEqual(strip(dp.camera.aperture));
    expect(LIGHTING_PRESETS.map((g) => [g.name, g.slug])).toEqual(strip(dp.lighting.presets));
    expect(GENRES[1].description).toBe(dp.filmSetup.genre[1].description);
  });

  it("all 33 camera moves, 50 palettes with 12 hex colours each, and the Emotion Wheel fragments", () => {
    expect(CAMERA_MOVES).toHaveLength(33);
    expect(CAMERA_MOVES.map((m) => m.slug)).toEqual(dp.camera.movements.map((m: { apiSlug: string }) => m.apiSlug));
    expect(PALETTES).toHaveLength(50);
    expect(PALETTES.map((p) => [p.slug, p.hex])).toEqual(dp.colorPalette.presets.map((p: { apiSlug: string; hexColors: string[] }) => [p.apiSlug, p.hexColors]));
    expect(PALETTES.every((p) => p.hex.length === 12)).toBe(true);
    expect(EMOTION_FAMILIES).toHaveLength(8);
    expect(EMOTION_FAMILIES.flatMap((f) => f.steps.map((s) => s.prompt))).toEqual(
      dp.emotionWheel.families.flatMap((f: { steps: { prompt: string }[] }) => f.steps.map((s) => s.prompt)),
    );
    expect(LIGHT_DIRECTIONS).toHaveLength(26);
    expect(new Set(LIGHT_DIRECTIONS).size).toBe(26);
    expect(LIGHT_DIRECTIONS).toContain("back-bottom-left");
  });

  it("the 17 Soul Cast fields with their options and defaults", () => {
    expect(SOUL_CAST_FIELDS).toHaveLength(17);
    const f = imageResearch.characterSheet.soulCast.fields as Record<string, (string | number)[]>;
    const byKey = Object.fromEntries(SOUL_CAST_FIELDS.map((x) => [x.key, x]));
    for (const [k, opts] of Object.entries(f)) {
      const key = k === "budget_millions" ? "budget" : k;
      expect(byKey[key], key).toBeDefined();
      expect(byKey[key].options.map((o) => String(o).toLowerCase()), key).toEqual(opts.map((o) => String(o).toLowerCase()));
    }
    expect(byKey.budget.default).toBe(250);
    expect(byKey.era.default).toBe(2020);
  });
});

const NOIR: DirectorSettings = {
  genre: "noir",
  era: "1980s",
  tempo: "calm",
  camera: "35mm-film",
  lens: "anamorphic",
  focal: "50mm",
  aperture: "f14-wide-open",
  lighting: { kind: "preset", slug: "window" },
  palette: { kind: "preset", slug: "neon-rain-at-midnight" },
  emotions: { maya: { family: "Sadness", step: 1 } },
};

describe("compileDirector", () => {
  it("sends Cinema Studio 4.0 its own fields and writes only the rest into the prompt", () => {
    const c = compileDirector({ prompt: "@maya waits at the bus stop in the rain", settings: NOIR, moves: ["dolly-in", "whip-pan"], brief: "A quiet neo-noir about loss.", mode: "video", target: "native" });
    expect(c.extra).toEqual({
      genre: "noir",
      era: "1980s",
      pacing: "calm",
      camera_model: "35mm-film",
      camera_lens: "anamorphic",
      camera_aperture: "f14-wide-open",
      camera_movement: "dolly-in",
      light: "window",
      color_palette: "neon-rain-at-midnight",
    });
    expect(c.prompt.startsWith("Project brief: A quiet neo-noir about loss. @maya (with sad emotion) waits at the bus stop in the rain.")).toBe(true);
    // Focal length has no API field; the second move goes into words, in order.
    expect(c.prompt).toContain("50mm focal length");
    expect(c.prompt).toMatch(/first .*dolly in.*finally .*whip pan/i);
    expect(c.prompt).not.toMatch(/noir film|1980s|anamorphic|window|#0c0c0e/i);
  });

  it("compiles everything into words for other models, Auto fields left out", () => {
    const c = compileDirector({ prompt: "@maya waits at the bus stop", settings: NOIR, moves: ["dolly-in"], mode: "video", target: "prompt" });
    expect(c.extra).toEqual({});
    expect(c.prompt).toContain("Noir film: hard shadow and high contrast");
    expect(c.prompt).toContain("Set in the 1980s");
    expect(c.prompt).toContain("Montage pacing: calm");
    expect(c.prompt).toMatch(/Shot on 35mm Film .*anamorphic lens.*50mm focal length.*f\/1\.4 aperture/);
    expect(c.prompt).toContain("Camera: the camera performs a smooth, steady dolly in");
    expect(c.prompt).toContain("Lighting: window");
    expect(c.prompt).toContain('"Neon Rain at Midnight" palette #0c0c0e, #334d4e');
    const bare = compileDirector({ prompt: "A lighthouse at dawn", settings: {}, mode: "video", target: "prompt" });
    expect(bare.prompt).toBe("A lighthouse at dawn.");
  });

  it("stills skip tempo and moves; custom palettes and light rigs are always words", () => {
    const c = compileDirector({
      prompt: "a diner at night",
      settings: { ...NOIR, palette: { kind: "custom", name: "Mine", hex: ["#101010", "#ff8800"] }, lighting: { kind: "custom", lights: [{ direction: "front-top-left", color: "#ffaa55", brightness: 80, diffuse: 70 }] } },
      moves: ["whip-pan"],
      mode: "image",
      target: "native",
    });
    expect(c.extra.pacing).toBeUndefined();
    expect(c.extra.camera_movement).toBeUndefined();
    expect(c.extra.color_palette).toBeUndefined();
    expect(c.extra.light).toBeUndefined();
    expect(c.prompt).toContain("palette #101010, #ff8800");
    expect(c.prompt).toContain("key light from the front top left");
    expect(c.prompt).toContain("80% brightness, soft and diffuse");
  });

  it("puts the emotion fragment after the first mention only, once", () => {
    const e = { kai: { family: "Anger", step: 2 } };
    expect(applyEmotions("@Kai turns. @kai shouts", e)).toBe("@Kai (with extremely enraged emotions loudly) turns. @kai shouts");
    expect(applyEmotions("@Kai (with extremely enraged emotions loudly) turns", e)).toBe("@Kai (with extremely enraged emotions loudly) turns");
    expect(applyEmotions("@kaiser turns", e)).toBe("@kaiser turns");
  });

  it("validates the custom rig and references with the researched messages", () => {
    const l = { direction: "front", color: "#ffffff", brightness: 50, diffuse: 50 };
    expect(rigError([l, l, l])).toBe("A custom rig supports at most 2 light sources");
    expect(rigError([{ ...l, color: "white" }])).toBe("color must be a #RRGGBB hex value");
    expect(rigError([{ ...l, brightness: 101 }])).toBe("brightness must be an integer between 0 and 100");
    expect(rigError([l])).toBeNull();
    expect(checkReferences({ images: 31, videos: [], audios: [], elements: 0 })).toBe("You can add a maximum of 30 images");
    expect(checkReferences({ images: 2, videos: [12, 20], audios: [], elements: 0 })).toBe("The total video duration limit is 30 seconds");
    expect(checkReferences({ images: 2, videos: [1], audios: [], elements: 0 })).toMatch(/at least 2 seconds/);
    expect(checkReferences({ images: 30, videos: [5, 5, 5], audios: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], elements: 8 })).toMatch(/50 input media/);
    expect(checkReferences({ images: 3, videos: [5], audios: [3], elements: 2 })).toBeNull();
  });
});

const base = (over: Partial<CinemaGenerateInput>): CinemaGenerateInput => ({
  engine: "cloud",
  mode: "video",
  action: "generate",
  prompt: "@maya waits at the bus stop in the rain",
  settings: NOIR,
  moves: ["dolly-in", "whip-pan"],
  duration: 10,
  resolution: "1080p",
  aspectRatio: "21:9",
  batch: 2,
  ...over,
});

const ctx = { cloudAllowed: true };
/** fal bills LTX-2.3 per megapixel of video made (width × height × frames), rounded up. */
const videoMp = (w: number, h: number, frames: number) => Math.ceil((w * h * frames) / 1e6);
const route = (id: string, op: string, engine: "open" | "cloud" = "cloud") => onEngine(getModel(id)!, engine).routes.find((r) => r.op === op)!;

describe("planCinema", () => {
  it("runs Fuobe Cinema on LTX-2.3 in the cloud: the Director in the prompt, the move as camera_lora, prompt expansion off", () => {
    const plan = planCinema(base({}), ctx);
    expect(plan.model).toMatchObject({ id: "fuobe-cinema", engine: "cloud" });
    expect(plan.blocker).toBeUndefined();
    const req = plan.steps[0].request;
    expect(req).toMatchObject({ modelId: "fuobe-cinema", engine: "cloud" });
    expect(req.params).toMatchObject({ aspectRatio: "21:9", resolution: "1080p", duration: 10, numOutputs: 2, generateAudio: true, extra: { camera_lora: "dolly_in" } });
    expect(req.prompt).toContain("Noir film");
    expect(req.prompt).toMatch(/Camera moves, in this order: first .*; finally /);
    expect(plan.notes).toContain("Dolly In drives LTX-2.3's dolly in camera LoRA");
    // 2 takes of 2240×960 (1080p at 21:9) × 241 frames, at $0.001605 per megapixel rounded up.
    expect(plan.costUsd).toBeCloseTo(2 * videoMp(2240, 960, 241) * 0.001605, 3);
    // What fal receives: the tier's exact size, 241 frames at 24 fps (8n+1), the camera LoRA, prompt expansion off.
    const payload = buildPayload(route("fuobe-cinema", "t2v").map!, { ...req.params, prompt: req.prompt });
    expect(payload).toMatchObject({ video_size: { width: 2240, height: 960 }, num_frames: 241, camera_lora: "dolly_in", enable_prompt_expansion: false, generate_audio: true });
    // Sound off is sent as off.
    const silent = planCinema(base({ audio: false }), ctx).steps[0].request;
    expect(buildPayload(route("fuobe-cinema", "t2v").map!, { ...silent.params, prompt: silent.prompt })).toMatchObject({ generate_audio: false });
  });

  it("a take longer than 20 s is one LTX-2.3 call plus one extend for the rest", () => {
    const plan = planCinema(base({ duration: 30 }), ctx);
    expect(plan.steps.map((s) => s.key)).toEqual(["main", "more"]);
    expect(plan.steps[0].request.params!.duration).toBe(20);
    expect(plan.steps[1]).toMatchObject({ after: ["main"], perJobOf: "main", request: { modelId: "fuobe-cinema", engine: "cloud", op: "extend", chain: [{ slot: "video" }], params: { duration: 10, extra: { camera_lora: "dolly_in" } } } });
    expect(plan.steps[1].request.step).toMatchObject({ label: "Extended to 30s", index: 1, of: 2 });
    expect(plan.notes.join(" ")).toMatch(/an extend adds the last 10s/);
    // 20 s at 481 frames; the extend adds 241 frames; both takes are extended.
    expect(buildPayload(route("fuobe-cinema", "t2v").map!, { ...plan.steps[0].request.params, prompt: "x" })).toMatchObject({ num_frames: 481 });
    expect(buildPayload(route("fuobe-cinema", "extend").map!, { ...plan.steps[1].request.params, prompt: "x", video: "https://x/take.mp4" })).toMatchObject({ num_frames: 241, video_url: "https://x/take.mp4" });
    // Each take: 481 frames, then the extend's 241, at the 21:9 1080p size.
    expect(plan.costUsd).toBeCloseTo(2 * (videoMp(2240, 960, 481) + videoMp(2240, 960, 241)) * 0.001605, 3);
    // Any whole second up to 20 in one call (no rounding to a preset length).
    expect(planCinema(base({ duration: 7 }), ctx).steps[0].request.params!.duration).toBe(7);
  });

  it("partner models stay pickable with the Director in the prompt", () => {
    const plan = planCinema(base({ modelId: "seedance-2-5" }), ctx);
    expect(plan.model.id).toBe("seedance-2-5");
    const req = plan.steps[0].request;
    expect(req.params!.extra).toBeUndefined();
    expect(req.prompt).toContain("Noir film");
    expect(req.params!.duration).toBe(10);
    expect(planCinema(base({ modelId: "kling-3", duration: 30 }), ctx).steps[0].request.params!.duration).toBe(15);
    expect(planCinema(base({ modelId: "veo-3-1", duration: 30 }), ctx).steps[0].request.params!.duration).toBe(8);
    // An old pick (Cinema Studio 4.0, a retired model) falls back to the Original.
    expect(planCinema(base({ modelId: "cinema-studio-4" }), ctx).model.id).toBe("fuobe-cinema");
    expect(CINEMA_MODELS.video.cloud).not.toContain("cinema-studio-4");
    expect(CINEMA_MODELS.image.cloud).not.toContain("soul-cinema");
  });

  it("open engine: Fuobe Cinema on Wan 2.2 Lightning, camera LoRA or Fun Camera, then a palette lock per take", () => {
    const plan = planCinema(base({ engine: "open", moves: ["arc-left"], images: ["/api/files/a.png", "/api/files/b.png"] }), ctx);
    expect(plan.model).toMatchObject({ id: "fuobe-cinema", engine: "open" });
    expect(plan.steps[0].request.engine).toBe("open");
    expect(plan.steps[0].request.loras?.length).toBeGreaterThan(0);
    expect(plan.steps[0].request.prompt).toMatch(/^orbit 360\. /);
    expect(plan.steps[0].request.inputs).toEqual({ images: ["/api/files/a.png"] });
    expect(plan.notes.join(" ")).toMatch(/doesn't make 21:9/);
    // Without a start frame the move is camera language in the prompt.
    const t2v = planCinema(base({ engine: "open", moves: ["arc-left"] }), ctx);
    expect(t2v.steps[0].request.loras).toBeUndefined();
    expect(t2v.notes.join(" ")).toMatch(/add a start frame/);
    expect(plan.steps[0].request.params!.duration).toBe(5);
    expect(plan.steps[0].request.params!.generateAudio).toBeUndefined();
    expect(plan.steps[1]).toMatchObject({ key: "palette", perJobOf: "main", after: ["main"] });
    expect(plan.steps[1].request).toMatchObject({ modelId: "oss-palette-video", op: "color-match", chain: [{ slot: "video" }] });
    expect(plan.steps[1].swatch).toEqual(PALETTES.find((p) => p.slug === "neon-rain-at-midnight")!.hex);
    expect(plan.costUsd).toBe(0);

    // A Fun Camera pose needs a start frame; it stays on Fuobe Cinema (its image-to-video graph runs the pose).
    expect(openCameraRoute("pan-left", true)).toMatchObject({ via: "fun-camera", pose: "Pan Left" });
    const withFrame = planCinema(base({ engine: "open", moves: ["pan-left"], images: ["/api/files/a.png"], settings: {} }), ctx);
    expect(withFrame.model.id).toBe("fuobe-cinema");
    expect(withFrame.steps[0].request.params!.extra).toMatchObject({ cameraMotion: "Pan Left" });
    expect(withFrame.steps).toHaveLength(1);
    const noLock = planCinema(base({ engine: "open", settings: { ...NOIR, paletteLock: false } }), ctx);
    expect(noLock.steps).toHaveLength(1);
    // LTX-2.5 is the open choice with sound; partner moves are words.
    const ltx = planCinema(base({ engine: "open", modelId: "oss-ltx25", moves: ["arc-left"], images: ["/api/files/a.png"] }), ctx);
    expect(ltx.model.id).toBe("oss-ltx25");
    expect(ltx.steps[0].request.loras).toBeUndefined();
  });

  it("every camera move has a route on both engines, and the camera LoRA map is the research's", () => {
    const rec = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/fuobe-originals-recipes-5.json"), "utf8")).studios.find((s: { id: string }) => s.id === "cinema-studio").original;
    expect(CINEMA_CAMERA_LORA).toEqual(rec.cameraLora.moves);
    expect(Object.keys(CINEMA_CAMERA_LORA)).toEqual(CAMERA_MOVES.map((m) => m.slug));
    expect(CINEMA_MAX_SECONDS).toBe(Math.floor(rec.cloud.maxFrames / rec.cloud.fps));
    // Every camera_lora value is one the endpoint takes.
    const enumValues = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/fuobe-originals-recipes-5.json"), "utf8"))
      .hostedLoraEndpoints.find((e: { id: string }) => e.id === "fal-ai/ltx-2.3-22b/image-to-video/lora").inputs.camera_lora.values;
    for (const v of Object.values(CINEMA_CAMERA_LORA)) if (v) expect(enumValues).toContain(v);

    // Cloud, with a start frame: camera_lora (on Fuobe Cinema) or the move's Wan LoRA (on Fuobe DoP) or a hosted move; else words.
    const words = new Set<string>();
    for (const m of CAMERA_MOVES) {
      const plan = planCinema(base({ moves: [m.slug], images: ["/api/files/a.png"], settings: {} }), ctx);
      const req = plan.steps[0].request;
      expect(plan.blocker, m.slug).toBeUndefined();
      const r = cinemaMoveRoute(m.slug, "cloud", true);
      if (r.via === "camera-lora") {
        expect(req.modelId).toBe("fuobe-cinema");
        expect(buildPayload(route("fuobe-cinema", "i2v").map!, { ...req.params, prompt: req.prompt, images: ["https://x/a.png"] }).camera_lora, m.slug).toBe(CINEMA_CAMERA_LORA[m.slug]);
      } else if (r.via === "lora") {
        expect(req.modelId, m.slug).toBe("fuobe-dop");
        expect(req.loras!.length, m.slug).toBeGreaterThan(0);
        expect(req.loras!.every((l) => l.licence?.hostedOk !== false), m.slug).toBe(true);
      } else if (r.via === "hosted-move") {
        expect(req.modelId).toBe("ltx-2-5-fast");
        expect(req.params!.extra).toMatchObject({ camera_motion: "focus_shift" });
      } else {
        expect(req.modelId).toBe("fuobe-cinema");
        words.add(m.slug);
      }
      // On the user's GPU every move is a Wan LoRA, a Fun Camera pose or words, always on Fuobe Cinema.
      const open = planCinema(base({ engine: "open", moves: [m.slug], images: ["/api/files/a.png"], settings: {} }), ctx).steps[0].request;
      expect(open.modelId).toBe("fuobe-cinema");
      const o = cinemaMoveRoute(m.slug, "open", true);
      if (o.via === "lora") expect(open.loras?.length).toBeGreaterThan(0);
      if (o.via === "fun-camera") expect(open.params!.extra).toMatchObject({ cameraMotion: o.pose });
    }
    expect([...words].sort()).toEqual(["helicopter-shot", "pan-left", "pan-right", "tilt-down", "tilt-up", "whip-pan"]);
    expect(Object.values(CINEMA_CAMERA_LORA).filter(Boolean)).toHaveLength(14);
  });

  it("a Wan-only move runs on Fuobe DoP in the cloud, Rack Focus on LTX-2.5's focus shift; both need a start frame", () => {
    const arc = planCinema(base({ moves: ["arc-left"], images: ["/api/files/a.png"] }), ctx);
    expect(arc.model).toMatchObject({ id: "fuobe-dop", engine: "cloud" });
    expect(arc.steps[0].request.prompt).toMatch(/^orbit 360\. /);
    expect(arc.notes.join(" ")).toMatch(/made for Wan 2.2, so this take runs on Fuobe DoP/);
    expect(arc.steps[0].request.params!.duration).toBe(5);
    // Replicate's fast Wan 2.2 with the move's LoRA: $0.11 a clip at 720p, two takes.
    expect(arc.costUsd).toBeCloseTo(2 * 0.11, 3);
    const t2v = planCinema(base({ moves: ["arc-left"] }), ctx);
    expect(t2v.model.id).toBe("fuobe-cinema");
    expect(t2v.notes.join(" ")).toMatch(/add a start frame to drive it with its camera LoRA$/);
    const focus = planCinema(base({ moves: ["rack-focus"], images: ["/api/files/a.png"], aspectRatio: "16:9" }), ctx);
    expect(focus.model.id).toBe("ltx-2-5-fast");
    expect(focus.steps[0].request.params!.extra).toMatchObject({ camera_motion: "focus_shift" });
  });

  it("multi-shot: Auto on Seedance, Manual into one prompt on Fuobe Cinema in the cloud, one clip per shot on the GPU", () => {
    const auto = planCinema(base({ modelId: "seedance-2-5", multiShot: { mode: "auto" } }), ctx);
    expect(auto.steps[0].request.params!.multiShot).toBe("auto");
    expect(planCinema(base({ multiShot: { mode: "auto" } }), ctx).notes.join(" ")).toMatch(/can't plan its own cuts/);
    const shots = [{ prompt: "wide of the street", duration: 4 }, { prompt: "close on @maya", duration: 6 }];
    const manual = planCinema(base({ multiShot: { mode: "manual", shots } }), ctx);
    expect(manual.steps[0].request.prompt).toMatch(/Shot 1 \[0-4s\]: wide of the street\. Shot 2 \[4-10s\]: close on @maya/);
    expect(manual.steps[0].request.params!.duration).toBe(10);
    const open = planCinema(base({ engine: "open", multiShot: { mode: "manual", shots } }), ctx);
    expect(open.steps[0].request.params!.shots).toEqual([{ prompt: "wide of the street", duration: 3 }, { prompt: "close on @maya", duration: 5 }]);
  });

  it("image mode: stills on Fuobe Soul Cinema need the camera; grids are one contact sheet", () => {
    const blocked = planCinema(base({ mode: "image", settings: { genre: "noir" } }), ctx);
    expect(blocked.blocker).toMatch(/Camera settings are required/);
    const still = planCinema(base({ mode: "image", resolution: undefined }), ctx);
    expect(still.blocker).toBeUndefined();
    expect(still.model).toMatchObject({ id: "fuobe-soul-cinema", engine: "cloud" });
    // Cinema's 1K is Soul's 720p tier (about 1 MP); 21:9 is Soul Cinema's crop.
    expect(still.steps[0].request).toMatchObject({ feature: "cinema-image", engine: "cloud", params: { aspectRatio: "21:9", resolution: "720p", numOutputs: 2 } });
    expect(planCinema(base({ mode: "image", resolution: "4K" }), ctx).notes.join(" ")).toMatch(/up to about 2 megapixels/);
    const open = planCinema(base({ mode: "image", engine: "open", resolution: "2K" }), ctx);
    expect(open.model).toMatchObject({ id: "fuobe-soul-cinema", engine: "open" });
    expect(open.steps.map((s) => s.request.modelId)).toEqual(["fuobe-soul-cinema", "oss-palette-image"]);
    expect(open.steps[0].request.params!.resolution).toBe("1080p");
    expect(open.costUsd).toBe(0);
    // A partner still stays pickable.
    expect(planCinema(base({ mode: "image", modelId: "nano-banana-pro" }), ctx).model.id).toBe("nano-banana-pro");
    const grid = planCinema(base({ mode: "image", action: "grid", grid: { size: "3x3", type: "zooms" } }), ctx);
    expect(grid.steps[0].request.params!.numOutputs).toBe(1);
    expect(grid.steps[0].request.prompt).toMatch(/3×3 grid of 9 equally sized film stills/);
    expect(grid.steps[0].request.prompt).toMatch(/extreme wide shot/);
    expect(gridPrompt("x", "4x4", "next_shots")).toMatch(/4×4 grid of 16/);
  });

  it("extend forward / backward and edit on a selected take", () => {
    const source = { url: "/api/files/take.mp4", kind: "video" as const };
    const fwd = planCinema(base({ action: "extend-forward", source }), ctx);
    expect(fwd.model).toMatchObject({ id: "fuobe-cinema", engine: "cloud" });
    expect(fwd.steps[0].request).toMatchObject({ op: "extend", engine: "cloud", inputs: { video: source.url }, params: { duration: 10, numOutputs: 1, extra: { camera_lora: "dolly_in" } } });
    // A partner that extends on fal keeps the take; on the GPU it is Wan 2.2 Fun VACE.
    expect(planCinema(base({ modelId: "seedance-2-5", action: "extend-forward", source }), ctx).model.id).toBe("seedance-2-5");
    expect(planCinema(base({ engine: "open", action: "extend-forward", source }), ctx).model.id).toBe("oss-wan22-vace-extend");

    // Fuobe Cinema's prequel: LTX-2.3 extends the take backward in one call.
    const back = planCinema(base({ action: "extend-backward", source }), ctx);
    expect(back.steps).toHaveLength(1);
    expect(back.steps[0].request).toMatchObject({ modelId: "fuobe-cinema", op: "extend", inputs: { video: source.url }, params: { extra: { extend_direction: "backward" } } });
    expect(buildPayload(route("fuobe-cinema", "extend").map!, { ...back.steps[0].request.params, prompt: "x", video: "https://x/t.mp4" })).toMatchObject({ extend_direction: "backward", enable_prompt_expansion: false });
    // A partner's prequel: the first frame, the moment before, then a start/end-frame clip.
    const partner = planCinema(base({ modelId: "seedance-2-5", action: "extend-backward", source }), ctx);
    expect(partner.steps.map((s) => s.key)).toEqual(["frame", "before", "main"]);
    expect(partner.steps[0].request).toMatchObject({ modelId: "extract-frame", params: { extra: { frame_type: "first" } } });
    expect(partner.steps[2]).toMatchObject({ after: ["before", "frame"], request: { op: "flf2v", chain: [{ slot: "images", position: "first" }, { slot: "endImage" }] } });
    const backOpen = planCinema(base({ engine: "open", action: "extend-backward", source: { ...source, firstFrame: "/api/files/f.png" } }), ctx);
    expect(backOpen.steps.map((s) => s.request.modelId)).toEqual(["oss-qwen-edit", "fuobe-cinema"]);
    expect(backOpen.steps[1].request).toMatchObject({ engine: "open", op: "flf2v", inputs: { endImage: "/api/files/f.png" } });

    // Edit: LTX-2.3 video to video on Fuobe Cinema; a partner's take is edited with Kling O3.
    const edit = planCinema(base({ action: "edit", source, prompt: "make it snow", images: ["/api/files/ref.png"] }), ctx);
    expect(edit.steps[0].request).toMatchObject({ modelId: "fuobe-cinema", engine: "cloud", op: "v2v", inputs: { video: source.url } });
    expect(edit.steps[0].request.inputs!.images).toBeUndefined();
    const kling = planCinema(base({ modelId: "seedance-2-5", action: "edit", source, prompt: "make it snow" }), ctx);
    expect(kling.steps[0].request).toMatchObject({ modelId: "kling-o3", op: "v2v" });
    expect(kling.notes.join(" ")).toMatch(/edited with Kling O3/);
    expect(planCinema(base({ action: "edit", source: undefined }), ctx).blocker).toBe("Select a video take to edit");
  });

  it("Soul Cast and Soul Location on Fuobe Soul, other views with the Multiple-Angles LoRA", () => {
    const values = { genre: "Western", budget: 150, era: 1880, archetype: "Rebel", gender: "Female", race: "Latino", age: 35, facial_hair: "Beard", imperfections: ["Freckles", "Facial scar"], outfit: "Workwear" };
    expect(visibleCast(values).facial_hair).toBeUndefined();
    const p = castPrompt(values);
    expect(p).toMatch(/western film with a \$150M budget/);
    expect(p).toMatch(/35-year-old latino woman, the rebel archetype/);
    expect(p).toMatch(/freckles, facial scar/);
    expect(p).toMatch(/Full-body front view, three-quarter view, side profile and back view/);
    const r = randomizeCast({}, () => 0.5);
    expect(Object.keys(r).sort()).toEqual(["age", "archetype", "era", "gender", "genre", "race"]);
    const cast = planCinema(base({ action: "cast", mode: "image", cast: values, prompt: "" }), ctx);
    expect(cast.blocker).toBeUndefined();
    expect(cast.steps[0].request).toMatchObject({ feature: "cinema-cast", modelId: "fuobe-soul", engine: "cloud", presetId: "v1-realistic", params: { aspectRatio: "16:9", resolution: "1080p" } });
    // On the GPU: the Soul Cast sheet graph with Fuobe Soul's Realistic look (its LoRAs and words), which also cuts the
    // sheet's four views; Fuobe Soul alone when the graph is missing or picked.
    const open = planCinema(base({ action: "cast", mode: "image", cast: values, engine: "open" }), ctx);
    expect(open.model.id).toBe("oss-zimage-soul-cast");
    const sheet = open.steps[0].request;
    expect(sheet.presetId).toBeUndefined();
    expect(sheet.loras?.map((l) => l.file).length).toBeGreaterThan(0);
    expect(sheet.prompt).toMatch(/No filters, flawless clarity/);
    expect(sheet.prompt).toMatch(/35-year-old latino woman, the rebel archetype/);
    expect(open.notes.join(" ")).toMatch(/Realistic look on the Soul Cast sheet graph: the sheet, then its four views/);
    expect(CAST_MODELS.open).toEqual(["oss-zimage-soul-cast", "fuobe-soul"]);
    const noSheet = planCinema(base({ action: "cast", mode: "image", cast: values, engine: "open" }), { ...ctx, has: (id: string) => id !== "oss-zimage-soul-cast" });
    expect(noSheet.model).toMatchObject({ id: "fuobe-soul", engine: "open" });
    expect(noSheet.steps[0].request).toMatchObject({ presetId: "v1-realistic" });
    expect(planCinema(base({ action: "cast", mode: "image", cast: values, engine: "open", modelId: "fuobe-soul" }), ctx).model.id).toBe("fuobe-soul");
    expect(planCinema(base({ action: "cast", mode: "image", cast: values, modelId: "nano-banana-pro" }), ctx).model.id).toBe("nano-banana-pro");
    expect(CAST_MODELS.cloud).not.toContain("soul-2");

    const loc = planCinema(base({ action: "location", mode: "image", prompt: "an abandoned diner on Route 66", brief: "" }), ctx);
    expect(loc.steps[0].request).toMatchObject({ modelId: "fuobe-soul", presetId: "v1-movie", params: { aspectRatio: "16:9", resolution: "1080p" } });
    expect(loc.steps[0].request.prompt).toMatch(/^Establishing shot of a film location: an abandoned diner on Route 66\. An empty set, the place itself the only subject/);
    expect(LOCATION_MODELS.cloud).not.toContain("soul-cinema");

    const still = { url: "/api/files/diner.png", kind: "image" as const };
    const reverse = planCinema(base({ action: "location-view", mode: "image", view: "reverse", source: still, prompt: "" }), ctx);
    expect(reverse.steps[0].request).toMatchObject({ modelId: "qwen-multiple-angles", op: "edit", inputs: { images: [still.url] }, params: { extra: { horizontal_angle: 180, vertical_angle: 0, zoom: 5 } } });
    const high = planCinema(base({ action: "location-view", mode: "image", view: "high", source: still, prompt: "", engine: "open" }), ctx);
    expect(high.steps[0].request).toMatchObject({ modelId: "oss-qwen-edit", op: "edit" });
    expect(high.steps[0].request.prompt).toMatch(/^<sks> front view high-angle shot medium shot\. Show the same location from a high angle/);
    expect(high.steps[0].request.loras?.[0].file).toMatch(/multiple-angles/);
    expect(planCinema(base({ action: "location-view", mode: "image", view: "wide", prompt: "" }), ctx).blocker).toBe("Pick the location image to re-angle");
    // The project brief keeps the project's look in other views too, on both engines (after the LoRA's own words).
    const briefed = (engine: "open" | "cloud") => planCinema(base({ action: "location-view", mode: "image", view: "high", source: still, prompt: "", engine, brief: "Muted 1970s Kodachrome" }), ctx).steps[0].request;
    expect(briefed("cloud").prompt).toMatch(/Project brief: Muted 1970s Kodachrome/);
    expect(briefed("open").prompt).toMatch(/^<sks> front view high-angle shot medium shot\. .*Project brief: Muted 1970s Kodachrome/s);
  });
});

describe("grid crop math", () => {
  /** A white sheet with rows × cols grey noise panels at uneven positions. */
  function sheet(width: number, height: number, xs: [number, number][], ys: [number, number][]) {
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    let seed = 3;
    const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 160) + 40;
    for (const [y0, y1] of ys)
      for (const [x0, x1] of xs)
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const o = (y * width + x) * 4;
            data[o] = data[o + 1] = data[o + 2] = noise();
          }
    return data;
  }

  it("finds gutters a few pixels off the even split", () => {
    const xs: [number, number][] = [[4, 98], [106, 200], [208, 296]];
    const ys: [number, number][] = [[0, 61], [69, 120], [128, 180]];
    const data = sheet(300, 180, xs, ys);
    const x = lineStats(data, 300, 180, "x");
    const y = lineStats(data, 300, 180, "y");
    expect(findCuts(x, 3)).toEqual(xs);
    expect(findCuts(y, 3)).toEqual(ys);
    const { rects, detected } = tileRects(300, 180, 3, 3, { x, y });
    expect(detected).toBe(true);
    expect(rects).toHaveLength(9);
    expect(rects[4]).toEqual({ x: 106, y: 69, w: 94, h: 51, row: 1, col: 1 });
  });

  it("falls back to an equal split when there are no gutters", () => {
    const data = sheet(200, 100, [[0, 200]], [[0, 100]]);
    const x = lineStats(data, 200, 100, "x");
    expect(findCuts(x, 2)).toBeNull();
    const { rects, detected } = tileRects(200, 100, 2, 2, { x, y: lineStats(data, 200, 100, "y") });
    expect(detected).toBe(false);
    expect(rects.map((r) => [r.x, r.y, r.w, r.h])).toEqual([[0, 0, 100, 50], [100, 0, 100, 50], [0, 50, 100, 50], [100, 50, 100, 50]]);
    expect(equalSpans(10, 3)).toEqual([[0, 3], [3, 7], [7, 10]]);
  });
});

describe("palette editor colour math", () => {
  it("k-means finds the colours of an image, dark to light", () => {
    const px: RGB[] = [];
    for (let i = 0; i < 300; i++) px.push([10 + (i % 5), 12, 14], [200, 40 + (i % 7), 30], [240, 240, 235 - (i % 4)]);
    const c = kmeans(px, 3);
    expect(c).toHaveLength(3);
    expect(c[0].rgb[0]).toBeLessThan(20);
    expect(c[1].rgb[0]).toBeGreaterThan(190);
    expect(c[2].rgb[1]).toBeGreaterThan(230);
    expect(c.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
    const pal = paletteFromPixels(px, 4);
    expect(pal).toHaveLength(4);
    expect(pal[3]).toBe(c[1].color);
  });

  it("harmonies place their hues at the research's angles", () => {
    expect(HARMONIES.map((h) => h.name)).toEqual(["Analogous", "Complementary", "Monochromatic", "Split complementary", "Triad", "Square"]);
    const tri = harmonyPalette("#d03030", "triad", 7);
    expect(tri).toHaveLength(7);
    expect(tri[6]).toBe("#d03030");
    const hues = tri.slice(0, 6).map((h) => Math.round(rgbToHsl(hexToRgb(h))[0] / 10) * 10);
    expect(new Set(hues.map((h) => h % 360))).toEqual(new Set([0, 120, 240]));
    const mono = harmonyPalette("#3060d0", "monochromatic", 5).map((h) => Math.round(rgbToHsl(hexToRgb(h))[0]));
    expect(Math.max(...mono) - Math.min(...mono)).toBeLessThan(6);
  });
});
