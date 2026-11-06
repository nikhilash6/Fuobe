import { describe, expect, it } from "vitest";
import {
  billedSeconds,
  chooseMaker,
  CLOUD_CLICK_PROBLEM,
  decodeSetup,
  encodeSetup,
  genjutsuProblem,
  getMaker,
  h3Extra,
  LEGACY_MAKERS,
  makerPrompt,
  makersFor,
  makerStepUsd,
  MAKERS,
  ORIGINALS,
  planGenjutsu,
  planMakerPieces,
  qualityFor,
  resolutionWords,
  swapParts,
  swapTarget,
  type GenjutsuPlanInput,
  type Maker,
} from "@/lib/catalog/genjutsu";
import { ANCHOR_FALLBACK, CLOUD_NO_LORA } from "@/lib/catalog/character-swap";
import { withoutOwnGpu } from "@/lib/catalog/engines";
import { MARKETING_IMAGE_NOTE } from "@/lib/catalog/marketing";
import { buildPayload } from "@/lib/catalog/payload";
import { estimateCost, planGeneration } from "@/lib/catalog/plan";
import { getModel, getPreset } from "@/lib/catalog";
import { onEngine } from "@/lib/catalog/engines";
import type { Engine } from "@/lib/catalog/types";

const clip = { url: "/api/files/clip.mp4", duration: 20, fps: 30, width: 1280, height: 720, hasAudio: true };
const ref = "/api/files/hero.png";
const maker = (id: string, engine: Engine = "cloud") => getMaker(id, engine)!;
const plan = (o: Partial<GenjutsuPlanInput> & { maker: Maker }) =>
  planGenjutsu({ engine: o.maker.engine, mode: "motion", title: "Genjutsu", source: clip, range: { start: 0, end: 20 }, quality: "720p", references: [ref], ...o });
const step = (p: ReturnType<typeof planGenjutsu>, key: string) => {
  const s = p.steps.find((x) => x.key === key);
  if (!s) throw new Error(`no step ${key} in ${p.steps.map((x) => x.key).join(", ")}`);
  return s;
};

describe("Genjutsu: which model runs", () => {
  it("each mode's default is its Fuobe Original on both engines, Lite unless Quality is High", () => {
    for (const engine of ["cloud", "open"] as const) {
      expect(chooseMaker({ engine, mode: "motion" })).toEqual({ maker: maker(ORIGINALS.motionLite, engine) });
      expect(chooseMaker({ engine, mode: "motion", tier: "high" })).toEqual({ maker: maker(ORIGINALS.motion, engine) });
      expect(chooseMaker({ engine, mode: "swap", target: "type" })).toEqual({ maker: maker(ORIGINALS.swapLite, engine) });
      expect(chooseMaker({ engine, mode: "swap", target: "type", tier: "high" })).toEqual({ maker: maker(ORIGINALS.swap, engine) });
      expect(chooseMaker({ engine, mode: "restyle", look: { kind: "preset", id: "shorts-claymation" } })).toEqual({ maker: maker(ORIGINALS.restyle, engine) });
      expect(chooseMaker({ engine, mode: "character" })).toEqual({ maker: maker(ORIGINALS.character, engine) });
    }
    // Clicking or painting what to swap is the cloud Original too.
    expect(chooseMaker({ engine: "cloud", mode: "swap", target: "paint" })).toMatchObject({ maker: { id: ORIGINALS.swapLite } });
    expect(chooseMaker({ engine: "cloud", mode: "swap", target: "click" })).toMatchObject({ maker: { id: ORIGINALS.swapLite } });
    // The picker lists Lite; the full Original is the same choice.
    expect(makersFor("cloud", "motion").map((m) => m.id)).toEqual([ORIGINALS.motionLite, "scail-2", "wan-motion", "kling-motion-control"]);
    expect(makersFor("cloud", "motion").map((m) => m.id)).not.toContain(ORIGINALS.motion);
  });

  it("only current models are offered, and old setups naming a retired one open the Original that replaced it", () => {
    expect(MAKERS.some((m) => m.id.startsWith("genjutsu-"))).toBe(false);
    expect(MAKERS.every((m) => onEngine(getModel(m.id)!, m.engine).routes.length > 0)).toBe(true);
    expect(chooseMaker({ engine: "cloud", mode: "motion", modelId: "genjutsu-motion-transfer" })).toEqual({ maker: maker(ORIGINALS.motion) });
    expect(chooseMaker({ engine: "cloud", mode: "swap", modelId: "genjutsu-lite-object-swap" })).toEqual({ maker: maker(ORIGINALS.swapLite) });
    expect(chooseMaker({ engine: "open", mode: "motion", modelId: "oss-wan22-animate" })).toEqual({ maker: maker(ORIGINALS.motion, "open") });
    expect(Object.values(LEGACY_MAKERS).every((id) => MAKERS.some((m) => m.id === id))).toBe(true);
  });

  it("partners and other open weights stay as labelled alternatives", () => {
    const sources = (engine: Engine, mode: "motion" | "character" | "swap" | "restyle" | "insert", target?: "type" | "click" | "paint") =>
      Object.fromEntries(makersFor(engine, mode, target).map((m) => [m.id, m.source]));
    expect(sources("cloud", "character")).toEqual({ [ORIGINALS.character]: "original", "scail-2": "open", "h3-max-recast": "partner", "wan-22-animate-replace": "open", "kling-o3": "partner", "p-video-replace": "partner" });
    expect(sources("cloud", "swap", "type")).toEqual({ [ORIGINALS.swapLite]: "original", "kling-o3": "partner", "kling-4": "partner", "p-video-replace": "partner" });
    expect(sources("cloud", "insert", "type")).toMatchObject({ "kling-o3": "partner", "kling-4": "partner" });
    expect(sources("cloud", "swap", "paint")).toEqual({ [ORIGINALS.swapLite]: "original", "wan-22-vace-inpaint": "open" });
    expect(sources("cloud", "restyle")).toEqual({ [ORIGINALS.restyle]: "original", "gemini-omni-flash": "partner", "kling-o3-4k-edit": "partner", "happy-horse-video-edit": "partner" });
    expect(sources("open", "character", "type")).toEqual({ [ORIGINALS.character]: "original", "oss-h3-character-swap-relay": "open", "oss-h3-group-swap": "open" });
    // A visitor before Group swap has opened: as before.
    expect(Object.keys(Object.fromEntries(makersFor("open", "character", "type", () => false).map((m) => [m.id, m.source])))).toEqual([ORIGINALS.character, "oss-h3-character-swap-relay"]);
    // A picked partner runs.
    expect(chooseMaker({ engine: "cloud", mode: "character", modelId: "h3-max-recast" })).toMatchObject({ maker: { id: "h3-max-recast" } });
  });

  it("the picker's lines carry no licence (Thanks & licences lists them)", () => {
    for (const m of MAKERS) expect(`${m.label} ${m.note ?? ""}`, m.id).not.toMatch(/licen[cs]e|Apache-2\.0|\bGPL\b|non-commercial/i);
  });

  it("a guest or an account reads the open models' notes without 'free on your GPU' (Genjutsu doesn't run there)", () => {
    for (const m of MAKERS) {
      const note = withoutOwnGpu(m.note);
      expect(note, m.id).not.toMatch(/your GPU|^free\b| · free\b/);
      expect(note.length, m.id).toBeGreaterThan(10);
      if (!/your GPU|free/.test(m.note)) expect(note, m.id).toBe(m.note);
    }
    expect(withoutOwnGpu("Wan Animate 2 at 480p in 4 steps · free on your GPU (24 GB) · Apache-2.0")).toBe("Wan Animate 2 at 480p in 4 steps · Apache-2.0");
    expect(withoutOwnGpu("MiniMax H3 + the swap LoRA on your GPU: SAM 3.1 picks the person · free · 48 GB+ advised")).toBe("MiniMax H3 + the swap LoRA: SAM 3.1 picks the person · 48 GB+ advised");
    expect(withoutOwnGpu(MARKETING_IMAGE_NOTE.open)).toBe("Fuobe Original · Qwen-Image 2.1");
    expect(withoutOwnGpu("Lip sync · free on your GPU (24 GB), or hosted on fal")).toBe("Lip sync · hosted on fal");
  });

  it("refuses in words what an engine can't do", () => {
    expect(chooseMaker({ engine: "cloud", mode: "character", target: "click" })).toEqual({ problem: CLOUD_CLICK_PROBLEM });
    expect(chooseMaker({ engine: "open", mode: "character", target: "click" })).toMatchObject({ maker: { id: ORIGINALS.character, engine: "open" } });
    // Painting on your GPU is Scene edit's (the owner, or once it has opened); before that, words only.
    expect(chooseMaker({ engine: "open", mode: "swap", target: "paint", open: () => false })).toEqual({ problem: expect.stringMatching(/name what to swap/) });
    expect(chooseMaker({ engine: "open", mode: "swap", target: "paint" })).toMatchObject({ maker: { id: "oss-h3-scene-edit" } });
    expect(chooseMaker({ engine: "open", mode: "insert", target: "type" })).toEqual({ problem: expect.stringMatching(/paint where it goes/) });
    expect(chooseMaker({ engine: "cloud", mode: "character", target: "paint" })).toEqual({ problem: expect.stringMatching(/doesn't take paint/) });
  });

  it("every maker is a catalog model that does its mode's operation on its engine", () => {
    const ops = { motion: "motion-transfer", character: "video-swap", swap: "video-swap", insert: "video-insert", restyle: "v2v", picture: "picture-video", finish: "tone-video" } as const;
    const opOf = (m: Maker, mode: keyof typeof ops) =>
      m.group ? "group-swap" : m.actions ? "scene-edit" : m.review ? "picture-video" : m.tool === "faces" ? "face-fix-video" : m.tool === "colours" ? "tone-video" : ops[mode];
    for (const m of MAKERS) {
      const model = getModel(m.id);
      expect(model, m.id).toBeDefined();
      expect(model!.engines ?? [model!.engine], m.id).toContain(m.engine);
      const providers = m.engine === "open" ? ["comfyui"] : ["fal", "replicate"];
      for (const mode of m.modes) expect(model!.routes.some((r) => r.op === opOf(m, mode) && providers.includes(r.provider)), `${m.id} ${m.engine} ${mode}`).toBe(true);
    }
    // The Originals are one model on both engines.
    for (const id of Object.values(ORIGINALS)) expect(getModel(id)?.engines).toEqual(["open", "cloud"]);
  });
});

describe("Genjutsu: checks", () => {
  const base = { mode: "motion" as const, maker: maker(ORIGINALS.motionLite), source: clip, range: { start: 0, end: 20 }, references: 1 };

  it("the source window is 4–30 s; Character swap's part is 5–15 s (up to 30 s continued)", () => {
    expect(genjutsuProblem({ ...base, range: { start: 0, end: 3 } })).toMatch(/between 4 and 30 seconds/);
    expect(genjutsuProblem({ ...base, source: { ...clip, duration: 40 }, range: { start: 0, end: 31 } })).toMatch(/up to 30 seconds/);
    expect(genjutsuProblem(base)).toBeNull();
    const ch = { ...base, mode: "character" as const, maker: maker(ORIGINALS.character) };
    expect(genjutsuProblem({ ...ch, range: { start: 0, end: 4.5 } })).toMatch(/Pick a part of 5–15 seconds/);
    expect(genjutsuProblem({ ...ch, range: { start: 2, end: 9 } })).toBeNull();
    expect(genjutsuProblem({ ...ch, range: { start: 2, end: 9 }, seed: 2 ** 33 })).toMatch(/whole-number seed/);
    expect(genjutsuProblem({ ...ch, range: { start: 2, end: 9 }, references: 0 })).toBe("Add a picture of your character");
    expect(genjutsuProblem({ ...ch, maker: maker(ORIGINALS.character, "open"), range: { start: 2, end: 9 }, target: "click" })).toBe("Click the person to swap on the first frame");
    // Recast takes 5–30 s.
    expect(genjutsuProblem({ ...ch, maker: maker("h3-max-recast"), source: { ...clip, duration: 30 }, range: { start: 0, end: 24 } })).toBeNull();
  });

  it("references, words, clicks and paint are asked for per mode", () => {
    expect(genjutsuProblem({ ...base, references: 0 })).toBe("Add a picture of your character");
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker("kling-o3"), target: "type" })).toMatch(/Say what to swap/);
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker(ORIGINALS.swapLite), target: "type" })).toMatch(/Say what to swap/);
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker("p-video-replace"), target: "type" })).toBeNull();
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker(ORIGINALS.swapLite), target: "click" })).toMatch(/Click what to swap/);
    expect(genjutsuProblem({ ...base, mode: "insert", maker: maker("oss-vace-insert", "open"), target: "paint" })).toMatch(/Paint where it goes/);
    expect(genjutsuProblem({ ...base, mode: "restyle", maker: maker(ORIGINALS.restyle), references: 0 })).toBe("Pick a look");
    expect(genjutsuProblem({ ...base, mode: "restyle", maker: maker("gemini-omni-flash"), references: 0, look: { kind: "custom", images: [ref] } })).toMatch(/restyles from words only/);
    expect(genjutsuProblem({ ...base, mode: "restyle", maker: maker(ORIGINALS.restyle), references: 0, look: { kind: "soul", id: "v1-general" } })).toBeNull();
  });

  it("each model's own limits", () => {
    const small = { ...clip, width: 640, height: 360 };
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker("kling-o3"), source: small, target: "type", subject: "the cup" })).toMatch(/at least 720 px/);
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker(ORIGINALS.swapLite), source: { ...clip, fps: 60 }, target: "paint", mask: true })).toBe(
      "Fuobe Genjutsu takes up to 30 fps (this clip is 60 fps) — pick another model",
    );
    expect(genjutsuProblem({ ...base, mode: "swap", maker: maker(ORIGINALS.swap, "open"), source: { ...clip, fps: undefined }, target: "type", subject: "the cup" })).toMatch(/frame rate/);
  });
});

describe("Genjutsu: plans", () => {
  it("cloud motion on the Original: Wan 2.2 Animate on the whole selection, billed as frames ÷ 16, the sound put back", () => {
    const p = plan({ maker: maker(ORIGINALS.motion), prompt: "a knight in silver armour", quality: "1080p" });
    expect(p.pieces).toBe(1);
    const make = step(p, "make0").request;
    expect(make).toMatchObject({ modelId: ORIGINALS.motion, engine: "cloud", op: "motion-transfer", feature: "genjutsu-step", inputs: { video: clip.url, images: [ref] } });
    // 20 s at 30 fps = 600 frames = 37.5 video seconds; 1080p goes to its top, 720p.
    expect(make.params).toMatchObject({ resolution: "720p", duration: 37.5, sourceDuration: 20 });
    expect(p.final).toBe("final");
    expect(step(p, "final").request).toMatchObject({ op: "mux", feature: "genjutsu", inputs: { audio: clip.url } });
    // $0.08 a video second at 720p: $3.00.
    expect(estimateCost(onEngine(getModel(ORIGINALS.motion)!, "cloud"), make.params!, 1, "motion-transfer")).toBeCloseTo(3, 6);
    // Lite: 480p turbo, $0.04.
    const lite = step(plan({ maker: maker(ORIGINALS.motionLite) }), "make0").request;
    expect(lite.params).toMatchObject({ resolution: "480p" });
    expect(estimateCost(onEngine(getModel(ORIGINALS.motionLite)!, "cloud"), lite.params!, 1, "motion-transfer")).toBeCloseTo(1.5, 6);
  });

  it("open motion on the Original: Wan Animate 2 on the cut selection; Lite runs it in 4 steps at 480p", () => {
    const anim = plan({ maker: maker(ORIGINALS.motion, "open"), range: { start: 4, end: 14 } });
    expect(anim.steps.map((s) => s.key)).toEqual(["cut0", "make0"]);
    expect(step(anim, "cut0").request).toMatchObject({ modelId: "oss-trim", params: { startTime: 4, endTime: 14 } });
    expect(step(anim, "make0").request).toMatchObject({ engine: "open", op: "motion-transfer", feature: "genjutsu", params: { aspectRatio: "auto", resolution: "720p" } });
    expect(anim.final).toBe("make0");
    const lite = plan({ maker: maker(ORIGINALS.motionLite, "open"), range: { start: 4, end: 14 } });
    expect(step(lite, "make0").request.params).toMatchObject({ resolution: "480p", extra: { steps: 4 } });
  });

  it("cloud swap on the Original: SAM 3.1 follows what you name, Wan VACE paints into each piece's part of its mask video", () => {
    const p = plan({ mode: "swap", maker: maker(ORIGINALS.swap), target: "type", subject: "Replace the coffee cup with a red apple", references: [ref, "/api/files/b.png"], range: { start: 2, end: 18 } });
    expect(p.tracked).toBe(true);
    expect(step(p, "range").request).toMatchObject({ modelId: "trim-video", params: { startTime: 2, endTime: 18 } });
    expect(step(p, "track").request).toMatchObject({ modelId: "sam-3-1-video-mask", op: "bg-remove-video", prompt: "the coffee cup" });
    expect(step(p, "track").request.params?.points).toBeUndefined();
    // 16 s at 30 fps = 480 frames → two windows of ≤241.
    expect(p.pieces).toBe(2);
    expect(step(p, "make1").after).toEqual(["cut1", "mcut1"]);
    expect(step(p, "make1").chain).toEqual([{ slot: "video" }, { slot: "mask" }]);
    expect(step(p, "mcut1").after).toEqual(["track"]);
    expect(step(p, "make0").request).toMatchObject({ modelId: ORIGINALS.swap, engine: "cloud", inputs: { images: [ref, "/api/files/b.png"] }, prompt: "A red apple in place of the coffee cup, matching the light, perspective and motion of the shot." });
    expect(p.steps.some((s) => s.key.startsWith("mframe"))).toBe(false);
    // Clicks: the points go to the tracker.
    const c = plan({ mode: "swap", maker: maker(ORIGINALS.swapLite), target: "click", points: [{ x: 10, y: 20, label: "positive" }], range: { start: 0, end: 6 } });
    expect(step(c, "track").request.params?.points).toEqual([{ x: 10, y: 20, label: "positive" }]);
    expect(step(c, "make0").after).toEqual(["range", "track"]);
    expect(step(c, "make0").request.params).toMatchObject({ resolution: "480p" });
  });

  it("hosted Wan 2.2 VACE by paint over several pieces: the paint for the first, SAM 3.1's first frames for the rest", () => {
    const p = plan({ mode: "swap", maker: maker("wan-22-vace-inpaint"), target: "paint", mask: "/api/files/mask.png", points: [{ x: 600, y: 300, label: "positive" }], quality: "1080p" });
    expect(p.tracked).toBe(true);
    expect(p.pieces).toBe(3);
    expect(step(p, "make0").request.inputs?.mask).toBe("/api/files/mask.png");
    expect(step(p, "make1").after).toEqual(["cut1", "mframe1"]);
    expect(step(p, "mframe1").request).toMatchObject({ modelId: "extract-frame", op: "frame", params: { extra: { frame_type: "first" } } });
    const frames = planMakerPieces(maker("wan-22-vace-inpaint"), clip, { start: 0, end: 20 })[0].frames!;
    expect(step(p, "make0").request.params?.duration).toBeCloseTo(frames / 16, 5);
  });

  it("open swap on the Original: windows straight from the upload, SAM 3.1's words, the first reference only", () => {
    const p = plan({ mode: "swap", maker: maker(ORIGINALS.swap, "open"), target: "type", subject: "Replace the coffee cup with a red apple", references: [ref, "/api/files/b.png"], quality: "720p" });
    expect(p.pieces).toBe(8);
    const w = step(p, "make1").request;
    expect(w).toMatchObject({ modelId: ORIGINALS.swap, engine: "open", op: "video-swap", inputs: { video: clip.url, images: [ref] } });
    expect(w.params?.extra).toEqual({ maskPrompt: "the coffee cup" });
    expect(p.steps.filter((s) => s.request.op === "concat").length).toBe(3);
    expect(step(p, "final").request).toMatchObject({ modelId: "oss-mux", feature: "genjutsu" });
  });

  it("cloud restyle on the Original: per piece the first frame takes the look, then Wan Fun VACE by depth", () => {
    const p = plan({ mode: "restyle", maker: maker(ORIGINALS.restyle), look: { kind: "preset", id: "shorts-claymation" }, references: [], range: { start: 0, end: 10 } });
    expect(p.pieces).toBe(2);
    expect(step(p, "frame0").request).toMatchObject({ modelId: "extract-frame", op: "frame" });
    expect(step(p, "look0").request).toMatchObject({ modelId: "qwen-image-edit-2511-cloud", op: "edit" });
    expect(step(p, "look0").request.prompt).toMatch(/claymation/i);
    expect(step(p, "restyle0").request).toMatchObject({ modelId: ORIGINALS.restyle, engine: "cloud", op: "v2v", params: { aspectRatio: "auto", resolution: "720p" } });
    expect(step(p, "restyle0").chain).toEqual([{ slot: "video" }, { slot: "images", position: "first" }]);
    expect(step(p, "final").request.op).toBe("mux");
    // A Soul look restyles the first frame with its LoRAs (Fuobe Soul's edit).
    const soul = plan({ mode: "restyle", maker: maker(ORIGINALS.restyle), look: { kind: "soul", id: "v1-general" }, references: [], range: { start: 0, end: 6 } });
    expect(step(soul, "look0").request).toMatchObject({ modelId: "fuobe-soul", engine: "cloud", op: "edit", presetId: "v1-general" });
  });

  it("open restyle on the Original: the Shorts chain on the Original's graph; a Soul look's frame on Fuobe Soul", () => {
    const open = plan({ mode: "restyle", maker: maker(ORIGINALS.restyle, "open"), look: { kind: "custom", images: [ref, "/api/files/b.png", "/api/files/c.png"] }, references: [] });
    expect(open.steps.find((s) => s.request.modelId === "oss-segment")!.request.params?.aspectRatio).toBe("auto");
    // The first frame in the look: Qwen-Image 2.1 Turbo on your GPU (hosted Qwen-Image-Edit 2511 in the cloud).
    expect(open.steps.find((s) => s.request.modelId === "oss-qwen-image-21-turbo")!.request.inputs?.images).toEqual([ref, "/api/files/b.png"]);
    expect(open.steps.some((s) => s.request.modelId === "oss-qwen-edit")).toBe(false);
    const look = open.steps.find((s) => s.request.modelId === ORIGINALS.restyle)!.request;
    expect(look).toMatchObject({ engine: "open", op: "v2v" });
    const soul = plan({ mode: "restyle", maker: maker(ORIGINALS.restyle, "open"), look: { kind: "soul", id: "v1-general" }, references: [], range: { start: 0, end: 5 } });
    const frame = soul.steps.find((s) => s.key.startsWith("frame"))!.request;
    expect(frame).toMatchObject({ modelId: "fuobe-soul", engine: "open", op: "edit", presetId: "v1-general" });
    expect(frame.inputs).toBeUndefined();
  });

  it("partners still restyle through the Shorts chain in the clip's own shape", () => {
    const p = plan({ mode: "restyle", maker: maker("gemini-omni-flash"), look: { kind: "soul", id: "v1-general" }, references: [] });
    expect(p.pieces).toBe(2);
    expect(p.steps.every((s) => s.request.feature === (s.key === p.final ? "genjutsu" : "genjutsu-step"))).toBe(true);
    expect(p.steps.some((s) => s.request.op === "reframe")).toBe(false);
  });

  it("Kling Motion Control takes one image and 10 s pieces; Kling O3 swap names the references as @Image", () => {
    const k = plan({ maker: maker("kling-motion-control"), references: [ref, "/api/files/b.png"] });
    expect(k.pieces).toBe(2);
    expect(step(k, "make0").request.inputs?.images).toEqual([ref]);
    const s = plan({ mode: "swap", maker: maker("kling-o3"), target: "type", subject: "the red car", prompt: "a white horse trotting", references: [ref, "/api/files/b.png"], range: { start: 2, end: 12 } });
    expect(step(s, "make0").request.prompt).toBe("Replace the red car in @Video1 with @Image1, @Image2. A white horse trotting. Keep everything else the same: the motion, camera, framing and light.");
    expect(s.final).toBe("make0");
    expect(makerStepUsd("kling-o3", { duration: 10 })).toBeCloseTo(1.68, 6);
  });
});

describe("Genjutsu: Character swap", () => {
  const ch = (o: Partial<GenjutsuPlanInput> & { maker: Maker }) => plan({ mode: "character", range: { start: 2, end: 12 }, quality: "768p", seed: 42, ...o });

  it("open: the part's first frame, your character put in it, then the H3 swap with the anchor as Picture 2", () => {
    const p = ch({ maker: maker(ORIGINALS.character, "open"), prompt: "keep the glasses", character: { description: "a chrome robot", who: "leftmost", maskGrow: 80, lora: "v1", windowFrames: 158, historyFrames: 18 } });
    expect(p.steps.map((s) => s.key)).toEqual(["frame", "anchor", "swap"]);
    expect(step(p, "frame").request).toMatchObject({ modelId: "oss-extract-frame", op: "frame", inputs: { video: clip.url }, params: { startTime: 2, endTime: 2.5, extra: { frameIndex: 0 } } });
    expect(step(p, "anchor").request).toMatchObject({ modelId: "oss-qwen-image-21", op: "edit", inputs: { images: [ref] } });
    expect(step(p, "anchor").request.prompt).toMatch(/^Image 1 is the source frame to edit\. Image 2 is character identity only: a chrome robot/);
    expect(step(p, "anchor").chain).toEqual([{ slot: "images", position: "first" }]);
    const swap = step(p, "swap");
    expect(swap.request).toMatchObject({
      modelId: ORIGINALS.character,
      engine: "open",
      op: "video-swap",
      feature: "genjutsu",
      inputs: { video: clip.url, images: [ref] },
      params: { startTime: 2, endTime: 12, resolution: "768p", seed: 42, extra: { selection: "leftmost", subjectIndex: 0, maskGrow: 80, lora: "v1", windowFrames: 158, historyFrames: 18 } },
    });
    expect(swap.request.prompt).toMatch(/^Replace the selected person in <Video 1> with the character in <Picture 1>\. .*Start from the first frame in <Picture 2>\. The character: a chrome robot\. Keep the glasses\.$/);
    // The anchor is optional: without it the swap runs with the prompt that doesn't name it, and says so.
    expect(swap.after).toEqual(["anchor"]);
    expect(swap.chain).toEqual([{ slot: "images", position: "last", optional: { prompt: expect.not.stringContaining("Picture 2"), notice: ANCHOR_FALLBACK } }]);
    // The graph keeps the clip's sound: the swap is the result.
    expect(p.final).toBe("swap");
    expect(p.sound).toBe(false);
    expect(p.anchors).toBe(1);
  });

  it("open: the anchor switch, clicks and the Relay graph (no anchor)", () => {
    const off = ch({ maker: maker(ORIGINALS.character, "open"), character: { anchor: false }, points: [{ x: 300, y: 200, label: "positive" }] });
    expect(off.steps.map((s) => s.key)).toEqual(["swap"]);
    expect(step(off, "swap").request.params?.points).toEqual([{ x: 300, y: 200, label: "positive" }]);
    expect(step(off, "swap").request.prompt).not.toMatch(/Picture 2/);
    expect(off.anchors).toBe(0);
    const relay = ch({ maker: maker("oss-h3-character-swap-relay", "open") });
    expect(relay.steps.map((s) => s.key)).toEqual(["swap"]);
    expect(step(relay, "swap").request).toMatchObject({ modelId: "oss-h3-character-swap-relay" });
    // A part longer than 15 s is one prompt on your GPU (the graph continues window by window).
    const long = ch({ maker: maker(ORIGINALS.character, "open"), range: { start: 0, end: 20 } });
    expect(long.steps.filter((s) => s.request.op === "video-swap").length).toBe(1);
  });

  it("cloud: the part cut, its anchor, then fal's H3 with the swap LoRA; whole seconds trimmed back; the clip's sound put back", () => {
    const p = ch({ maker: maker(ORIGINALS.character), range: { start: 2, end: 9.4 }, quality: "1080p", character: { who: "rightmost" } });
    expect(p.steps.map((s) => s.key)).toEqual(["cut0", "frame0", "anchor0", "swap0", "fit0", "sound", "final"]);
    expect(step(p, "anchor0").request).toMatchObject({ modelId: "gpt-image-2-5-sunburst", op: "edit", params: { extra: { quality: "low" } } });
    const swap = step(p, "swap0");
    expect(swap.request).toMatchObject({ modelId: ORIGINALS.character, engine: "cloud", op: "video-swap", inputs: { images: [ref] }, params: { duration: 8, sourceDuration: 7.4, resolution: "768p", seed: 42 } });
    expect(swap.request.loras).toEqual([expect.objectContaining({ file: "h3_character_swap_v1.5.safetensors", weightName: "h3_character_swap_v1.5.safetensors", strength: 1 })]);
    expect(swap.request.prompt).toMatch(/^Replace the person on the right in Video 1 with the character in Image 1\. .*Image 2\.$/);
    expect(swap.after).toEqual(["cut0", "anchor0"]);
    expect(swap.chain).toEqual([{ slot: "video" }, { slot: "images", position: "last", optional: { prompt: expect.any(String), notice: ANCHOR_FALLBACK } }]);
    expect(step(p, "fit0").request).toMatchObject({ modelId: "trim-video", params: { startTime: 0, endTime: 7.4 } });
    expect(step(p, "final").request).toMatchObject({ op: "mux", feature: "genjutsu" });
    // $0.075 a second at 768p on 8 whole seconds; 480p $0.0625.
    expect(estimateCost(onEngine(getModel(ORIGINALS.character)!, "cloud"), swap.request.params!, 1, "video-swap")).toBeCloseTo(0.6, 6);
    expect(estimateCost(onEngine(getModel(ORIGINALS.character)!, "cloud"), { ...swap.request.params!, resolution: "480p" }, 1, "video-swap")).toBeCloseTo(0.5, 6);
  });

  it("cloud: a part over 15 s runs as pieces of 5–15 s, each with its own anchor, joined", () => {
    const p = ch({ maker: maker(ORIGINALS.character), range: { start: 0, end: 20 }, character: { anchorModel: "nano-banana-pro" } });
    expect(p.pieces).toBe(2);
    expect(p.anchors).toBe(2);
    expect(step(p, "anchor1").request.modelId).toBe("nano-banana-pro");
    expect(step(p, "swap0").request.params).toMatchObject({ duration: 10, sourceDuration: 10 });
    expect(p.steps.some((s) => s.key.startsWith("fit"))).toBe(false);
    expect(step(p, "join").after).toEqual(["swap0", "swap1"]);
  });

  it("open: a click selects the clicked person (SAM 3.1's point mask, first among its detections)", () => {
    const p = ch({ maker: maker(ORIGINALS.character, "open"), target: "click", character: { who: "largest" }, points: [{ x: 900, y: 300, label: "positive" }] });
    expect(step(p, "swap").request.params?.extra).toMatchObject({ selection: "index", subjectIndex: 0 });
    const relay = ch({ maker: maker("oss-h3-character-swap-relay", "open"), target: "click", points: [{ x: 900, y: 300, label: "positive" }] });
    expect(step(relay, "swap").request.params?.extra).toMatchObject({ selection: "index", subjectIndex: 0 });
    // Without clicks, who you picked stays.
    expect(step(ch({ maker: maker(ORIGINALS.character, "open"), character: { who: "rightmost" } }), "swap").request.params?.extra).toMatchObject({ selection: "rightmost" });
  });

  it("cloud: the first frame keeps the part's shape (Sunburst's nearest size, Nano Banana Pro's auto), not the square default", () => {
    const wide = ch({ maker: maker(ORIGINALS.character) });
    const sunburst = step(wide, "anchor0").request;
    expect(sunburst.params).toMatchObject({ aspectRatio: "16:9" });
    const route = onEngine(getModel("gpt-image-2-5-sunburst")!, "cloud").routes.find((r) => r.op === "edit")!;
    expect(buildPayload(route.map!, { prompt: sunburst.prompt, images: [ref, ref], aspectRatio: "16:9", extra: { quality: "low" } })).toMatchObject({ image_size: "landscape_16_9", quality: "low" });
    const tall = ch({ maker: maker(ORIGINALS.character), source: { ...clip, width: 1080, height: 1920 } });
    expect(step(tall, "anchor0").request.params).toMatchObject({ aspectRatio: "9:16" });
    const nano = ch({ maker: maker(ORIGINALS.character), character: { anchorModel: "nano-banana-pro" } });
    expect(step(nano, "anchor0").request.params).toMatchObject({ aspectRatio: "auto" });
    const nanoRoute = onEngine(getModel("nano-banana-pro")!, "cloud").routes.find((r) => r.op === "edit" && r.provider === "fal")!;
    expect(buildPayload(nanoRoute.map!, { prompt: "p", images: [ref, ref], aspectRatio: "auto" })).toMatchObject({ aspect_ratio: "auto" });
    // Through the catalog the ratio stays (no square default merged over it).
    const planned = planGeneration({ ...sunburst, inputs: { images: ["/api/files/f.png", ref] } }, getModel, getPreset);
    expect(planned.params.aspectRatio).toBe("16:9");
    // On your GPU the first frame keeps the frame's own size: Qwen-Image 2.1 gets the nearest ratio, which its edit graph
    // doesn't read (the result follows image 1), and Krea 2 Identity Edit "auto" (its canvas in image 1's shape).
    expect(step(ch({ maker: maker(ORIGINALS.character, "open") }), "anchor").request.params?.aspectRatio).toBe("16:9");
    const krea = step(ch({ maker: maker(ORIGINALS.character, "open"), character: { anchorModel: "oss-krea2-identity-edit" } }), "anchor").request;
    expect(krea).toMatchObject({ modelId: "oss-krea2-identity-edit", op: "edit", params: { aspectRatio: "auto" } });
    // A Qwen-Image-Edit 2511 pick saved before falls back to the engine's default.
    expect(step(ch({ maker: maker(ORIGINALS.character, "open"), character: { anchorModel: "oss-qwen-edit" } }), "anchor").request.modelId).toBe("oss-qwen-image-21");
  });

  it("cloud: a silent clip's result is silent too (H3's own soundtrack is replaced with silence)", () => {
    const p = ch({ maker: maker(ORIGINALS.character), source: { ...clip, hasAudio: false }, range: { start: 2, end: 9.4 } });
    expect(p.steps.map((s) => s.key)).toEqual(["cut0", "frame0", "anchor0", "swap0", "fit0", "mute"]);
    expect(step(p, "fit0").request.feature).toBe("genjutsu-step");
    expect(step(p, "mute").request).toMatchObject({ op: "mux", modelId: "merge-audio-video", feature: "genjutsu", inputs: { audio: "silence:7.4" } });
    expect(step(p, "mute").after).toEqual(["fit0"]);
    expect(p.final).toBe("mute");
    const pieces = ch({ maker: maker(ORIGINALS.character), source: { ...clip, hasAudio: false }, range: { start: 0, end: 20 } });
    expect(step(pieces, "join").request.feature).toBe("genjutsu-step");
    expect(step(pieces, "mute").after).toEqual(["join"]);
  });

  it("cloud: fal's route needs a swap LoRA, so \"None\" is refused there (it runs on your GPU)", () => {
    expect(() => ch({ maker: maker(ORIGINALS.character), character: { lora: "none" } })).toThrow(CLOUD_NO_LORA);
    const check = { mode: "character" as const, source: clip, range: { start: 2, end: 12 }, references: 1 };
    expect(genjutsuProblem({ ...check, maker: maker(ORIGINALS.character), character: { lora: "none" } })).toBe(CLOUD_NO_LORA);
    expect(genjutsuProblem({ ...check, maker: maker(ORIGINALS.character, "open"), character: { lora: "none" } })).toBeNull();
    expect(step(ch({ maker: maker(ORIGINALS.character, "open"), character: { lora: "none" } }), "swap").request.params?.extra).toMatchObject({ lora: "none" });
    // The window plan the pack would refuse is said before anything runs.
    expect(genjutsuProblem({ ...check, maker: maker(ORIGINALS.character, "open"), character: { windowFrames: 22, historyFrames: 35 } })).toMatch(/must be shorter than the window/);
  });

  it("Settings → Models & licences: a switched-off tier gives way to the other; an entry stays while either is on", () => {
    const off = (ids: string[]) => (id: string) => !ids.includes(id);
    // Lite off, the full Original on: the Original stays the pick (High), not a partner.
    expect(chooseMaker({ engine: "cloud", mode: "motion", offered: off([ORIGINALS.motionLite]) })).toMatchObject({ maker: { id: ORIGINALS.motion } });
    expect(chooseMaker({ engine: "cloud", mode: "motion", tier: "standard", offered: off([ORIGINALS.motionLite]) })).toMatchObject({ maker: { id: ORIGINALS.motion } });
    expect(chooseMaker({ engine: "cloud", mode: "motion", modelId: ORIGINALS.motionLite, offered: off([ORIGINALS.motionLite]) })).toMatchObject({ maker: { id: ORIGINALS.motion } });
    // The full Original off: High falls back to Lite.
    expect(chooseMaker({ engine: "cloud", mode: "motion", tier: "high", offered: off([ORIGINALS.motion]) })).toMatchObject({ maker: { id: ORIGINALS.motionLite } });
    // Both off: the next model that is on.
    const both = chooseMaker({ engine: "cloud", mode: "motion", offered: off([ORIGINALS.motion, ORIGINALS.motionLite]) });
    expect("maker" in both && both.maker.source).not.toBe("original");
  });

  it("partners in Character swap: MiniMax's Recast, Wan Animate Replace, Kling O3 with who in words", () => {
    const r = ch({ maker: maker("h3-max-recast"), range: { start: 2, end: 20 }, quality: "1080p", character: { who: "leftmost", description: "a ronin" } });
    expect(r.steps.map((s) => s.key)).toEqual(["cut0", "make0"]);
    expect(step(r, "make0").request).toMatchObject({ modelId: "h3-max-recast", op: "video-swap", params: { resolution: "1080p" } });
    expect(step(r, "make0").request.prompt).toBe("The person on the left becomes the person in the photo, a ronin.");
    expect(r.final).toBe("make0");
    const w = ch({ maker: maker("wan-22-animate-replace") });
    expect(step(w, "make0").request).toMatchObject({ op: "video-swap", params: { resolution: "720p" } });
    expect(w.final).toBe("final");
    expect(makerPrompt({ mode: "character", maker: maker("kling-o3"), refs: 1, character: { who: "rightmost" } })).toBe(
      "Replace the person on the right in @Video1 with @Image1. Keep everything else the same: the performance, camera, framing, light and timing.",
    );
  });

  it("the H3 settings the open graph takes", () => {
    expect(h3Extra(undefined)).toEqual({ selection: "largest", subjectIndex: 0 });
    expect(h3Extra({ who: "index", index: 2, subject: "man in red", audioGuide: false, useMask: false, lora: "none" })).toEqual({
      selection: "index",
      subjectIndex: 2,
      maskPrompt: "man in red",
      audioGuide: false,
      useMask: false,
      lora: "none",
    });
  });

  it("qualities: 480p or 768p for H3, Recast's 768p / 1080p", () => {
    expect(qualityFor(maker(ORIGINALS.character), "720p")).toBe("768p");
    expect(qualityFor(maker(ORIGINALS.character, "open"), "480p")).toBe("480p");
    expect(qualityFor(maker("h3-max-recast"), "480p")).toBe("768p");
    expect(resolutionWords(maker("h3-max-recast"), "480p")).toBe("renders 768p (its lowest)");
  });
});

describe("Genjutsu: the steps plan as catalog generations", () => {
  it("every step of every mode on both engines is a request the catalog accepts", () => {
    const plans = [
      plan({ maker: maker(ORIGINALS.motionLite) }),
      plan({ maker: maker(ORIGINALS.motion, "open"), range: { start: 0, end: 10 } }),
      plan({ maker: maker("scail-2") }),
      plan({ maker: maker("wan-motion") }),
      plan({ maker: maker("kling-motion-control") }),
      plan({ mode: "swap", maker: maker(ORIGINALS.swap), target: "type", subject: "the cup", range: { start: 0, end: 10 } }),
      plan({ mode: "swap", maker: maker(ORIGINALS.swapLite), target: "click", points: [{ x: 1, y: 2, label: "positive" }], range: { start: 0, end: 6 } }),
      plan({ mode: "swap", maker: maker("p-video-replace"), target: "type", quality: "480p" }),
      plan({ mode: "swap", maker: maker("kling-o3"), target: "type", subject: "the cup", range: { start: 0, end: 10 } }),
      plan({ mode: "insert", maker: maker("wan-22-vace-inpaint"), target: "paint", mask: "/api/files/m.png", range: { start: 0, end: 6 } }),
      plan({ mode: "swap", maker: maker(ORIGINALS.swap, "open"), target: "type", subject: "the cup", range: { start: 0, end: 6 } }),
      plan({ mode: "insert", maker: maker("oss-vace-insert", "open"), target: "paint", mask: "/api/files/m.png", range: { start: 0, end: 6 } }),
      plan({ mode: "restyle", maker: maker(ORIGINALS.restyle), look: { kind: "soul", id: "v1-general" }, references: [], range: { start: 0, end: 6 } }),
      plan({ mode: "restyle", maker: maker(ORIGINALS.restyle), look: { kind: "preset", id: "shorts-claymation" }, references: [], range: { start: 0, end: 6 } }),
      plan({ mode: "restyle", maker: maker(ORIGINALS.restyle, "open"), look: { kind: "soul", id: "v1-general" }, references: [], range: { start: 0, end: 5 } }),
      plan({ mode: "character", maker: maker(ORIGINALS.character), range: { start: 0, end: 12 }, quality: "768p" }),
      plan({ mode: "character", maker: maker(ORIGINALS.character, "open"), range: { start: 0, end: 12 }, quality: "480p" }),
      plan({ mode: "character", maker: maker("h3-max-recast"), range: { start: 0, end: 12 } }),
      plan({ mode: "character", maker: maker("scail-2"), range: { start: 0, end: 8 } }),
      plan({ mode: "character", maker: maker("oss-h3-character-swap-relay", "open"), range: { start: 0, end: 8 } }),
      plan({ mode: "character", maker: maker(ORIGINALS.character), source: { ...clip, hasAudio: false }, range: { start: 0, end: 20 }, character: { anchorModel: "nano-banana-pro" } }),
    ];
    for (const p of plans) {
      for (const s of p.steps) {
        // Chained inputs arrive at run time: stand-ins for what an earlier step makes.
        const chained: Record<string, unknown> = {};
        for (const c of s.chain ?? []) {
          if (c.slot === "videos") chained.videos = ["/api/files/x.mp4", "/api/files/y.mp4"];
          else if (c.slot === "images") chained.images = [...((chained.images as string[]) ?? s.request.inputs?.images ?? []), "/api/files/x.png"];
          else chained[c.slot] = "/api/files/x.mp4";
        }
        const req = { ...s.request, inputs: { ...s.request.inputs, ...chained } };
        expect(() => planGeneration(req, getModel, getPreset), `${s.request.modelId} ${s.key}`).not.toThrow();
      }
    }
  });

  it("billed seconds: fal's video seconds count 16 (Wan Motion 24) frames a second at the clip's own rate", () => {
    const piece = { index: 0, start: 0, end: 10 };
    expect(billedSeconds(maker(ORIGINALS.motion), piece, 30)).toBeCloseTo(18.75, 6);
    expect(billedSeconds(maker("wan-motion"), piece, 30)).toBeCloseTo(12.5, 6);
    expect(billedSeconds(maker("kling-motion-control"), piece, 30)).toBe(10);
    expect(billedSeconds(maker(ORIGINALS.swap), { ...piece, frames: 241 }, 30)).toBeCloseTo(241 / 16, 6);
  });
});

describe("Genjutsu: words", () => {
  it("swapTarget takes what goes out of a sentence", () => {
    expect(swapTarget("Replace the red car with a horse")).toBe("the red car");
    expect(swapTarget("swap the mug for a can of soda")).toBe("the mug");
    expect(swapTarget("her jacket")).toBe("her jacket");
    expect(swapParts("Replace the red car with a white horse.")).toEqual({ what: "the red car", into: "a white horse" });
    expect(makerPrompt({ mode: "swap", maker: maker("kling-o3"), subject: "swap the mug for a can of soda", refs: 1 })).toBe(
      "Replace the mug in @Video1 with @Image1 (a can of soda). Keep everything else the same: the motion, camera, framing and light.",
    );
  });

  it("optional words stay optional", () => {
    expect(makerPrompt({ mode: "swap", maker: maker("p-video-replace"), refs: 2 })).toBeUndefined();
    expect(makerPrompt({ mode: "motion", maker: maker(ORIGINALS.motion), refs: 1 })).toBeUndefined();
    expect(makerPrompt({ mode: "character", maker: maker("p-video-replace"), refs: 1 })).toBeUndefined();
  });
});

describe("Genjutsu: setup codes", () => {
  it("round-trips a setup, Character swap's settings included (not the part's words)", () => {
    const setup = {
      mode: "character" as const,
      engine: "open" as const,
      model: ORIGINALS.character,
      quality: "768p" as const,
      target: "type" as const,
      prompt: "keep the glasses — ünïcode",
      references: [ref],
      character: { who: "index" as const, index: 2, subject: "man in red", anchor: false, description: "a ronin", speech: "other" as const, lora: "v1" as const, windowFrames: 158 },
    };
    const code = encodeSetup(setup);
    // No seed, length or sound: still a gj1 code, which an install that reads only gj1 pastes too.
    expect(code).toMatch(/^gj1\.[A-Za-z0-9_-]+$/);
    expect(decodeSetup(code)).toEqual(setup);
    const full = { ...setup, seed: 7, length: 5.166, originalSound: "dialogue" as const };
    expect(encodeSetup(full)).toMatch(/^gj2\.[A-Za-z0-9_-]+$/);
    expect(decodeSetup(encodeSetup(full))).toEqual(full);
    expect(decodeSetup(` http://localhost:3000/genjutsu?setup=${code} `)).toEqual(setup);
    expect(decodeSetup(encodeSetup({ mode: "character", character: { dialogue: "secret words", who: "largest" } as never }))?.character).toEqual({ who: "largest" });
  });

  it("keeps looks, maps old models to the Originals and drops what isn't valid (the retired provider's looks too)", () => {
    expect(decodeSetup(encodeSetup({ mode: "restyle", look: { kind: "custom", images: [ref, "https://evil.example/x.png"], words: "neon" } }))).toEqual({ mode: "restyle", look: { kind: "custom", images: [ref], words: "neon" } });
    expect(decodeSetup(encodeSetup({ mode: "restyle", look: { kind: "soul", id: "v1-general" } }))?.look).toEqual({ kind: "soul", id: "v1-general" });
    expect(decodeSetup(encodeSetup({ mode: "restyle", look: { kind: "preset", id: "nope" } }))?.look).toBeUndefined();
    const old = `gj1.${btoa(JSON.stringify({ m: "restyle", x: "genjutsu-restyle", l: { k: "h", id: "9b1c", n: "Anime" } }))}`;
    expect(decodeSetup(old)).toEqual({ mode: "restyle", model: ORIGINALS.restyle });
    expect(decodeSetup(`gj1.${btoa(JSON.stringify({ m: "motion", x: "genjutsu-lite-motion-transfer", t: "high" }))}`)).toEqual({ mode: "motion", model: ORIGINALS.motionLite, tier: "high" });
    expect(decodeSetup(encodeSetup({ mode: "motion", target: "paint", model: "not-a-model" }))).toEqual({ mode: "motion" });
    expect(decodeSetup("gj1.!!!")).toBeNull();
    expect(decodeSetup("https://x/genjutsu?setup=%E0%A4%A")).toBeNull();
    expect(decodeSetup(`gj1.${btoa(JSON.stringify({ m: "fly" }))}`)).toBeNull();
  });
});
