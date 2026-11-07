import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  chooseMaker,
  decodeSetup,
  directRunFeatures,
  encodeSetup,
  GENJUTSU_FEATURES,
  GENJUTSU_MODES,
  genjutsuProblem,
  getMaker,
  makersFor,
  modeOpen,
  planGenjutsu,
  requestFeatures,
  reshootCanvas,
  type GenjutsuPlanInput,
} from "@/lib/catalog/genjutsu";
import { describerPrompt, paintPrompt, RESHOOT, RESHOOT_MODEL, RESHOOT_SIGMAS, RESHOOT_WORKFLOWS, reshootFrames, reshootProblem, reshootPrompt, stamp } from "@/lib/catalog/reshoot";
import { reshootFrameCount, reshootGraph, RESHOOT_IDS } from "@/lib/reshoot-graph";
import { getModel } from "@/lib/catalog";
import type { ComfyWorkflow } from "@/lib/comfy";

const ROOT = process.cwd();
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const graph = (id: string) => readJson(`workflows/comfyui/${id}.json`) as ComfyWorkflow;
const manifest = readJson("workflows/comfyui/manifest.json") as { workflows: { id: string; customNodes: { name: string }[]; models: { file: string; url: string }[]; bindings: Record<string, { node: string; input: string }[]> }[] };
const pins = readJson("workflows/comfyui/model-pins.json") as Record<string, { sha256: string; sizeBytes: number }>;
const packs = readJson("workflows/comfyui/packs.json") as Record<string, { repo: string; commit: string; subdir: string | null }>;

const maker = getMaker(RESHOOT_MODEL, "open")!;
const source = { url: "/api/files/clip.mp4", duration: 20, fps: 30, width: 1920, height: 1080, hasAudio: true };
const plan = (o: Partial<GenjutsuPlanInput> = {}) =>
  planGenjutsu({ engine: "open", mode: "reshoot", maker, title: "Genjutsu", source, range: { start: 2, end: 12 }, quality: "480p", references: ["/api/files/model.png"], reshoot: { choice: "swap" }, ...o });
const step = (p: ReturnType<typeof planGenjutsu>, key: string) => p.steps.find((s) => s.key === key)!;

/** Words that H3 reads as naming the thing they negate. */
const NEGATIONS = /\b(no|not|without|never|free of|unbranded|do not)\b/i;

describe("Fuobe Reshoot: limits and frames", () => {
  it("renders on H3's 17n + 5 grid within Remake's window, shorter at 720p", () => {
    expect(reshootFrames(3.7, "480p")).toBeNull();
    expect(reshootFrames(4, "480p")).toBe(90);
    expect(reshootFrames(5.2, "480p")).toBe(124);
    expect(reshootFrames(10, "480p")).toBe(226);
    expect(reshootFrames(12, "480p")).toBe(277);
    expect(reshootFrames(30, "480p")).toBe(294);
    expect(reshootFrames(10, "720p")).toBe(175);
    for (const s of [4, 6.5, 9, 12]) expect((reshootFrames(s, "480p")! - 5) % 17).toBe(0);
    expect(stamp(294)).toBe("00:12.250");
    expect(stamp(90)).toBe("00:03.750");
  });

  it("checks what each choice needs", () => {
    expect(reshootProblem({ choice: "swap" }, 0, 8, "480p")).toMatch(/picture of who plays the part/);
    expect(reshootProblem({ choice: "swap" }, 1, 8, "480p")).toBeNull();
    expect(reshootProblem({ choice: "edit" }, 0, 8, "480p")).toBe("Say what changes");
    expect(reshootProblem({ choice: "edit", words: "fresh snow covers the street" }, 0, 8, "480p")).toBeNull();
    expect(reshootProblem({ choice: "edit", words: "snow", painted: true }, 0, 8, "480p")).toMatch(/painted first frame/);
    expect(reshootProblem({ choice: "swap" }, 1, 3, "480p")).toMatch(/at least 4 seconds/);
  });

  it("puts the part on a canvas whose sides are on 32 px steps at the short edge", () => {
    expect(reshootCanvas(1920, 1080, 480)).toEqual({ width: 864, height: 480 });
    expect(reshootCanvas(1080, 1920, 480)).toEqual({ width: 480, height: 864 });
    expect(reshootCanvas(1080, 1350, 480)).toEqual({ width: 480, height: 608 });
    expect(reshootCanvas(1920, 1080, 736)).toEqual({ width: 1312, height: 736 });
  });
});

describe("Fuobe Reshoot: the prompts", () => {
  const sections = ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"];
  for (const choice of ["swap", "edit"] as const) {
    it(`${choice}: Remake's six sections in order, every tag defined, {scene} once, nothing negated`, () => {
      const p = reshootPrompt({ choice, who: "the woman on the left", words: "fresh snow covers the street and keeps falling" }, 226);
      const at = sections.map((s) => p.indexOf(s));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(p.match(/\{scene\}/g)).toHaveLength(1);
      for (const tag of p.match(/<(Video|Picture|Subject) \d+>/g) ?? []) expect(p.split(sections[1])[0], tag).toContain(tag);
      expect(p).not.toMatch(/<Picture 2>|<Audio/);
      expect(p).toContain("00:09.417");
      expect(p.replace(/non_diegetic_music:\nN\/A/, "")).not.toMatch(NEGATIONS);
      expect(p).not.toMatch(/\b(slowly|slow motion|stunning|beautiful)\b/i);
    });
  }

  it("swap: says who becomes whom, by role, through the last frame", () => {
    const p = reshootPrompt({ choice: "swap", who: "the dancer in front" }, 124);
    expect(p).toContain("the dancer in front becomes <Subject 1>, exactly as in <Picture 1>, in every frame through the last frame");
    expect(reshootPrompt({ choice: "swap" }, 124)).toContain("the person with the most screen time becomes <Subject 1>");
  });

  it("keeps the person's words from breaking the layout", () => {
    const p = reshootPrompt({ choice: "edit", words: "a {scene} <Picture 9> [Shot 4] gold gown" }, 124);
    expect(p.match(/\{scene\}/g)).toHaveLength(1);
    expect(p).not.toContain("<Picture 9>");
    expect(p).not.toContain("[Shot 4]");
  });

  it("paints the first frame with the change, and the describer sees motion only", () => {
    expect(paintPrompt({ choice: "swap", who: "the man at the bar" }, 1)).toMatch(/^Image 1 is a frame from a video\. Replace the man at the bar in image 1 with the person from image 2/);
    expect(paintPrompt({ choice: "edit", words: "she wears a crimson velvet gown" }, 0)).toContain("Edit image 1 so that she wears a crimson velvet gown.");
    expect(paintPrompt({ choice: "edit", words: "a crimson gown" }, 2)).toContain("images 2 to 3");
    expect(describerPrompt({ choice: "swap", who: "the singer" })).toContain('calling the singer "the person"');
  });
});

describe("Fuobe Reshoot in Genjutsu", () => {
  it("is a mode of its own, open with either choice, on your GPU only", () => {
    expect(GENJUTSU_MODES.find((m) => m.id === "reshoot")).toMatchObject({ label: "Fuobe Reshoot" });
    expect(GENJUTSU_FEATURES["reshoot-swap"]).toEqual({ mode: "reshoot", workflows: [RESHOOT_WORKFLOWS.swap], maker: RESHOOT_MODEL });
    expect(GENJUTSU_FEATURES["reshoot-edit"]).toEqual({ mode: "reshoot", workflows: [RESHOOT_WORKFLOWS.edit], maker: RESHOOT_MODEL });
    expect(modeOpen("reshoot", () => false)).toBe(false);
    expect(modeOpen("reshoot", (f) => f === "reshoot-edit")).toBe(true);
    expect(makersFor("open", "reshoot").map((m) => m.id)).toEqual([RESHOOT_MODEL]);
    expect(makersFor("cloud", "reshoot")).toEqual([]);
    expect(chooseMaker({ engine: "open", mode: "reshoot" })).toEqual({ maker });
    expect("problem" in chooseMaker({ engine: "cloud", mode: "reshoot" })).toBe(true);
    expect(requestFeatures({ mode: "reshoot", maker, reshoot: { choice: "edit", words: "snow" } })).toEqual(["reshoot-edit"]);
    expect(requestFeatures({ mode: "reshoot", maker })).toEqual(["reshoot-swap"]);
    expect(directRunFeatures(RESHOOT_MODEL, { choice: "edit" })).toEqual(["reshoot-edit"]);
    expect(directRunFeatures(RESHOOT_MODEL, {})).toEqual(["reshoot-swap"]);
  });

  it("keeps every existing mode and product name", () => {
    expect(GENJUTSU_MODES.map((m) => m.label)).toEqual(["Motion transfer", "Character swap", "Object swap", "Restyle", "Insert", "From picture", "Finish", "Fuobe Reshoot"]);
    expect(getModel("oss-h3-scene-edit")?.name).toBe("Scene edit");
    expect(getModel("oss-h3-group-swap")?.name).toBe("Group swap");
  });

  it("checks the part: 4–12 s", () => {
    const c = { mode: "reshoot" as const, maker, source, references: 1, reshoot: { choice: "swap" as const } };
    expect(genjutsuProblem({ ...c, range: { start: 0, end: 10 } })).toBeNull();
    expect(genjutsuProblem({ ...c, range: { start: 0, end: 15 } })).toMatch(/between 4 and 12 seconds/);
    expect(genjutsuProblem({ ...c, range: { start: 0, end: 10 }, references: 0 })).toMatch(/who plays the part/);
  });

  it("swap: the part at 24 fps, its first frame, the painted frame, then one render pinned to it", () => {
    const p = plan({ references: ["/api/files/model.png", "/api/files/model-side.png"], reshoot: { choice: "swap", who: "the woman in white" }, seed: 7 });
    expect(p.steps.map((s) => s.key)).toEqual(["part", "frame", "paint", "reshoot"]);
    expect(p).toMatchObject({ final: "reshoot", pieces: 1, sound: false });
    expect(step(p, "part").request).toMatchObject({ modelId: "oss-fit-clip", op: "trim", params: { startTime: 2, endTime: 11.5, fps: 24, extra: { width: 864, height: 480 } } });
    expect(step(p, "frame")).toMatchObject({ after: ["part"], chain: [{ slot: "video" }], request: { modelId: "oss-extract-frame", op: "frame", params: { startTime: 0, extra: { frameIndex: 0 } } } });
    const paint = step(p, "paint");
    expect(paint).toMatchObject({ after: ["frame"], chain: [{ slot: "images", position: "first" }], request: { modelId: "oss-qwen-image-21", op: "edit", inputs: { images: ["/api/files/model.png", "/api/files/model-side.png"] } } });
    expect(paint.request.prompt).toContain("Replace the woman in white in image 1");
    const r = step(p, "reshoot");
    expect(r.after).toEqual(["part", "paint"]);
    expect(r.chain).toEqual([{ slot: "video" }, { slot: "images", position: "first" }]);
    expect(r.request).toMatchObject({ modelId: RESHOOT_MODEL, op: "video-swap", params: { seed: 7, resolution: "480p", extra: { openjutsu: { choice: "swap", frames: 226, quality: "480p", seed: 7 } } } });
    expect(r.request.inputs?.images).toBeUndefined();
    expect(r.request.prompt).toContain("{scene}");
    expect(getModel(RESHOOT_MODEL)!.routes.find((x) => x.op === "video-swap")!.endpoint).toBe(RESHOOT_WORKFLOWS.swap);
  });

  it("edit: runs on the edit graph; a painted frame of your own skips the painting", () => {
    const e = plan({ references: [], reshoot: { choice: "edit", words: "fresh snow covers the street" }, quality: "720p" });
    expect(step(e, "reshoot").request).toMatchObject({ op: "scene-edit", params: { resolution: "720p", extra: { openjutsu: { choice: "edit", frames: 175 } } } });
    expect(step(e, "paint").request.inputs).toBeUndefined();
    expect(getModel(RESHOOT_MODEL)!.routes.find((x) => x.op === "scene-edit")!.endpoint).toBe(RESHOOT_WORKFLOWS.edit);
    const own = plan({ references: ["/api/files/painted.png"], reshoot: { choice: "edit", words: "snow", painted: true } });
    expect(own.steps.map((s) => s.key)).toEqual(["part", "reshoot"]);
    expect(step(own, "reshoot")).toMatchObject({ after: ["part"], chain: [{ slot: "video" }], request: { inputs: { images: ["/api/files/painted.png"] } } });
  });

  it("travels in a setup code", () => {
    const code = encodeSetup({ mode: "reshoot", reshoot: { choice: "edit", words: "golden hour light", painted: true } });
    expect(decodeSetup(code)).toMatchObject({ mode: "reshoot", reshoot: { choice: "edit", words: "golden hour light", painted: true } });
    expect(decodeSetup(code, () => false)?.mode).toBe("motion");
  });
});

describe("Fuobe Reshoot's graphs", () => {
  it("are in the manifest with the pack and the Remake weights, every file pinned", () => {
    for (const choice of ["swap", "edit"] as const) {
      const id = RESHOOT_WORKFLOWS[choice];
      expect(RESHOOT_IDS.has(id)).toBe(true);
      const w = manifest.workflows.find((x) => x.id === id)!;
      expect(w, id).toBeDefined();
      expect(w.customNodes.map((c) => c.name)).toEqual(["ComfyUI-VideoHelperSuite", "ComfyUI-Viggle-Remake"]);
      expect(w.models.map((m) => m.file)).toContain(`viggle_remake_${choice}_pruned_int8_convrot.safetensors`);
      for (const m of w.models) {
        if (m.url.includes("/resolve/main/")) continue;
        expect(pins[m.url]?.sha256, m.file).toMatch(/^[0-9a-f]{64}$/);
      }
      const g = graph(id);
      expect(g["1"].inputs.unet_name).toBe(`viggle_remake_${choice}_pruned_int8_convrot.safetensors`);
      expect(g["17"].inputs.sigmas).toBe(RESHOOT_SIGMAS[choice]);
      expect(g["20"].inputs.save_metadata).toBe(false);
      expect(w.bindings.prompt).toEqual([{ node: "12", input: "string" }]);
    }
    expect(packs["ComfyUI-Viggle-Remake"]).toMatchObject({ repo: "https://huggingface.co/Viggle/Viggle-Remake", commit: "21665fa7a1e038e0a5312fb15f37b18d0f06f117", subdir: "comfyui/ComfyUI-Viggle-Remake" });
  });

  it("take the run's frames, canvas, pin, describer words and seed", () => {
    const g = reshootGraph(graph(RESHOOT_WORKFLOWS.swap), { frames: 226, quality: "480p", describe: "Describe how things move.", seed: 42 });
    expect(g["13"].inputs).toMatchObject({ frames: 226, short_edge: 480, pins: "0" });
    expect(g["6"].inputs.frame_load_cap).toBe(226);
    expect(g["14"].inputs.seed).toBe(42);
    expect(g["11"].inputs.prompt).toBe("Describe how things move.");
    expect(g["2"].inputs.keyframe_until).toBe(RESHOOT.keyframeUntil);
    const big = reshootGraph(graph(RESHOOT_WORKFLOWS.edit), { frames: 345, quality: "720p" });
    expect(big["13"].inputs).toMatchObject({ frames: 175, short_edge: 736 });
    expect(reshootFrameCount(300, "480p")).toBe(294);
    expect(reshootFrameCount(100, "480p")).toBe(90);
    expect(reshootFrameCount("x", "480p")).toBe(124);
  });
});
