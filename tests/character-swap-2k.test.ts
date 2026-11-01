import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { PlanStep } from "@/lib/catalog/shorts";
import type { GenInput } from "@/lib/catalog/types";

// Character swap in 2K (package n7-4-character-swap-2k): Genjutsu's 1080p / 2K / 4K and Character Swap Studio's Sharpen,
// on both engines. Your GPU: the 768p swap regenerated (sigma 0.8, never above the footage's size), then only the
// character composited over the footage (video-composite-mask); the cloud: fal's H3 at 2K / 4K, a new version.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-swap-2k-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const S = await import("@/lib/catalog/sharpen");
const C = await import("@/lib/catalog/character-swap");
const G = await import("@/lib/catalog/genjutsu");
const { DEFAULT_SETTINGS, newShot, assemblyTakes, chosenTakes, usedFinish, FINISH_UNAVAILABLE } = await import("@/lib/catalog/swap-studio");
type SwapClip = import("@/lib/catalog/swap-studio").SwapClip;
type SwapProject = import("@/lib/catalog/swap-studio").SwapProject;
type SwapTake = import("@/lib/catalog/swap-studio").SwapTake;
const { planTakeFinish, planAssembly } = await import("@/lib/catalog/swap-studio-plan");
const { getModel } = await import("@/lib/catalog");
const { estimateCost } = await import("@/lib/catalog/plan");
const { onEngine } = await import("@/lib/catalog/engines");
const { buildPayload } = await import("@/lib/catalog/payload");
const { prepareWorkflow, getWorkflow } = await import("@/server/providers/comfyui");

const ROOT = path.resolve(__dirname, "..");
const hd = { url: "/api/files/uploads/x/clip.mp4", duration: 20, fps: 30, width: 1920, height: 1080, hasAudio: true };
const ref = "/api/files/uploads/x/hero.png";
const maker = (id: string, engine: "open" | "cloud") => G.getMaker(id, engine)!;
const character = (engine: "open" | "cloud", quality: string, o: Partial<Parameters<typeof G.planGenjutsu>[0]> = {}) =>
  G.planGenjutsu({ engine, mode: "character", maker: maker(G.ORIGINALS.character, engine), title: "Swap", source: hd, range: { start: 2, end: 12 }, quality, references: [ref], seed: 42, ...o });
const keys = (p: { steps: { key: string }[] }) => p.steps.map((s) => s.key);
const step = (p: { steps: PlanStep[] }, key: string) => {
  const s = p.steps.find((x) => x.key === key);
  if (!s) throw new Error(`no step ${key}: ${keys(p).join(", ")}`);
  return s;
};

describe("qualities", () => {
  it("480p and 768p stay H3's own; 1080p, 2K and 4K are finishing sizes of the 768p swap", () => {
    expect(C.CHARACTER_SWAP.qualities).toEqual(["480p", "768p"]);
    expect(C.characterQuality("480p")).toBe("480p");
    for (const q of ["768p", "1080p", "2K", "4K", undefined]) expect(C.characterQuality(q)).toBe("768p");
    expect(["480p", "768p", "720p", undefined].map(C.characterFinish)).toEqual([null, null, null, null]);
    expect(["1080p", "2K", "4K"].map(C.characterFinish)).toEqual(["1080p", "2K", "4K"]);
    // fal has no 1080P: the cloud offers 2K and 4K; your GPU all three.
    expect(C.CHARACTER_QUALITIES).toEqual({ open: ["480p", "768p", "1080p", "2K", "4K"], cloud: ["480p", "768p", "2K", "4K"] });
    expect(maker(G.ORIGINALS.character, "cloud").qualities).toEqual(C.CHARACTER_QUALITIES.cloud);
    expect(maker(G.ORIGINALS.character, "open").qualities).toEqual(C.CHARACTER_QUALITIES.open);
    expect(maker("oss-h3-character-swap-relay", "open").qualities).toEqual(C.CHARACTER_QUALITIES.open);
    // H3 Max Recast keeps its own 768P / 1080P.
    expect(maker("h3-max-recast", "cloud").qualities).toEqual(["768p", "1080p"]);
  });

  it("falResolution for every quality", () => {
    expect(Object.fromEntries(["480p", "720p", "768p", "1080p", "2K", "4K", undefined].map((q) => [String(q), C.falResolution(q)]))).toEqual({
      "480p": "480P",
      "720p": "768P",
      "768p": "768P",
      "1080p": "768P",
      "2K": "2K",
      "4K": "4K",
      undefined: "768P",
    });
  });

  it("Genjutsu asks each maker for what it offers, and the setup code keeps 2K and 4K", () => {
    expect(G.qualityFor(maker(G.ORIGINALS.character, "cloud"), "2K")).toBe("2K");
    expect(G.qualityFor(maker(G.ORIGINALS.character, "cloud"), "1080p")).toBe("768p");
    expect(G.qualityFor(maker(G.ORIGINALS.character, "open"), "1080p")).toBe("1080p");
    expect(G.resolutionWords(maker(G.ORIGINALS.character, "cloud"), "1080p")).toBe("renders up to 768p");
    expect(G.decodeSetup(G.encodeSetup({ mode: "character", quality: "4K" }))?.quality).toBe("4K");
  });
});

describe("prices", () => {
  it("fal's H3 LoRA route per second: 480P $0.0625, 768P $0.075, 2K $0.1625, 4K $0.20; 5 s at 2K = $0.81, 15 s = $2.44", () => {
    expect(S.SWAP_PER_SECOND).toEqual({ "480P": 0.0625, "768P": 0.075, "2K": 0.1625, "4K": 0.2 });
    expect(S.cloudSharpenUsd("2K", 5)).toBe(0.81);
    expect(S.cloudSharpenUsd("2K", 15)).toBe(2.44);
    expect(S.cloudSharpenUsd("4K", 5)).toBe(1);
    // Whole seconds, at least 5 a call.
    expect(S.cloudSharpenUsd("2K", 2)).toBe(0.81);
    expect(S.cloudSharpenUsd("1080p", 5)).toBeNull();
    // The catalog prices the plan's step the same way.
    const m = getModel("fuobe-character-swap")!;
    const cloud = onEngine(m, "cloud");
    expect(estimateCost(cloud, { resolution: "2K", duration: 5 }, 1, "video-swap")).toBeCloseTo(0.8125, 2);
    expect(estimateCost(cloud, { resolution: "4K", duration: 15 }, 1, "video-swap")).toBeCloseTo(3, 2);
    expect(estimateCost(cloud, { resolution: "768p", duration: 5 }, 1, "video-swap")).toBeCloseTo(0.375, 2);
  });

  it("the cloud's Quality hint carries the price; your GPU's the time", async () => {
    const { qualityHint } = await import("@/components/genjutsu/character-panel");
    expect(qualityHint("cloud", "2K")).toBe("2K and 4K redraw the 768p swap at the higher size. $0.81 for 5 s, $2.44 for 15 s.");
    expect(qualityHint("cloud", "4K")).toBe("2K and 4K redraw the 768p swap at the higher size. $1.00 for 5 s, $3.00 for 15 s.");
    expect(qualityHint("open", "2K")).toMatch(/^1080p, 2K and 4K redraw the 768p swap at the higher size\. Free on your GPU, about 3 min more per 5 s on a 72 GB GPU/);
    expect(qualityHint("open", "480p")).toBe("Faster and cheaper");
  });
});

describe("what each engine makes of a size", () => {
  it("your GPU: never above the footage (joined at most 2048 px a side)", () => {
    const film = S.filmSize(1920, 1080)!;
    expect(film).toEqual({ width: 1920, height: 1080 });
    expect(S.sharpenOptions("open", film).map((o) => [o.tier, o.available])).toEqual([
      ["1080p", true],
      ["2K", false],
      ["4K", false],
    ]);
    expect(S.sharpenOptions("open", film)[1].reason).toBe("Joined at 1920×1080, so 2K adds nothing to the film");
    expect(S.sharpenTierFor("open", "4K", film)).toBe("1080p");
    expect(S.defaultSharpenTier("open", film)).toBe("1080p");
    // A 4K square is kept at 2048 × 2048: 2K fits, 4K doesn't.
    expect(S.sharpenTierFor("open", "4K", S.filmSize(4096, 4096))).toBe("2K");
    // Below 1080p the 768p takes already match it.
    expect(S.sharpenTierFor("open", "2K", S.filmSize(1280, 720))).toBeNull();
    expect(S.sharpenOptions("open", S.filmSize(1280, 720))[0].reason).toBe(S.SHARPEN_COPY.small);
  });

  it("the cloud: 2K and 4K only (no 1080P on fal); 4K adds nothing to a film joined at 2048 px", () => {
    const film = S.filmSize(3840, 2160, "cloud")!;
    expect(film).toEqual({ width: 2048, height: 1152 });
    const o = S.sharpenOptions("cloud", film);
    expect(o.map((x) => [x.tier, x.available])).toEqual([
      ["1080p", false],
      ["2K", true],
      ["4K", false],
    ]);
    expect(o[0].reason).toBe("The cloud makes 2K or 4K");
    expect(o[2].reason).toBe("Joined at 2048×1152, so 4K adds nothing to the film");
    expect(S.sharpenTierFor("cloud", "1080p", film)).toBeNull();
    expect(S.sharpenTierFor("cloud", "4K", film)).toBe("2K");
    // The join note says the size.
    expect(S.joinNote(film)).toBe("The clip is joined at 2048×1152 (up to 2048 px a side). Each sharper take keeps its own size in Takes & review");
    // A small clip is scaled up for merge-videos, but stays below 1080p.
    expect(S.sharpenTierFor("cloud", "2K", S.filmSize(72, 128, "cloud"))).toBeNull();
  });
});

describe("the composite's geometry and windows", () => {
  it("the swap covers its canvas's part of the footage; the regenerate the centre its 16:9 draft kept", () => {
    const film = { width: 1920, height: 1080 };
    const canvas = C.h3Canvas(1920, 1080, "768p");
    const g = S.compositeGeometry(film, canvas);
    expect(g.take.width / g.take.height).toBeCloseTo(canvas.width / canvas.height, 2);
    // H3's canvas for a 1080p clip (1344 × 736) is a little wider than 16:9: the swap covers the full width.
    expect(canvas).toEqual({ width: 1344, height: 736 });
    expect(g.take).toEqual({ width: 1920, height: 1052, x: 0, y: 14 });
    expect(g.region.width / g.region.height).toBeCloseTo(1344 / 768, 2);
    expect(g.region.height).toBeLessThanOrEqual(g.take.height);
    expect(g.region.x).toBe(Math.floor((1920 - g.region.width) / 2));
    // A tall clip: the draft turns.
    const tall = S.compositeGeometry({ width: 1080, height: 1920 }, C.h3Canvas(1080, 1920, "768p"));
    expect(tall.region.height / tall.region.width).toBeCloseTo(1344 / 768, 2);
    // A square clip: the swap fills it, the regenerate is its centre 16:9 band.
    const sq = S.compositeGeometry({ width: 2048, height: 2048 }, { width: 992, height: 992 });
    expect(sq.take).toEqual({ width: 2048, height: 2048, x: 0, y: 0 });
    expect(sq.region).toMatchObject({ width: 2048, x: 0 });
    expect(sq.region.y).toBe(Math.floor((2048 - sq.region.height) / 2));
    expect(S.maskEdge({ width: 1888, height: 1080 })).toEqual({ grow: 9, feather: 13 });
  });

  it("windows: equal, never a sliver, every frame once", () => {
    expect(S.frameWindows(362, 360)).toEqual([
      { from: 0, frames: 181 },
      { from: 181, frames: 181 },
    ]);
    expect(S.frameWindows(240, 72).map((w) => w.frames)).toEqual([60, 60, 60, 60]);
    expect(S.frameWindows(50, 72)).toEqual([{ from: 0, frames: 50 }]);
  });

  it("the regenerate's words are the take's own, without H3's tags", () => {
    expect(S.sharpenPrompt("Replace the selected person in <Video 1> with the character in <Picture 1>. Preserve the timing.", "a chrome robot")).toBe(
      "The character: a chrome robot. Replace the selected person in the clip with the character in the reference. Preserve the timing.",
    );
  });
});

describe("Genjutsu's Character swap", () => {
  it("480p and 768p are the swap alone, as before", () => {
    for (const engine of ["open", "cloud"] as const) {
      for (const q of ["480p", "768p"]) {
        const p = character(engine, q);
        expect(keys(p).some((k) => /regen|comp|mask|fit/.test(k))).toBe(false);
      }
    }
    expect(keys(character("open", "768p"))).toEqual(["frame", "anchor", "swap"]);
  });

  it("your GPU at 2K: swap at 768p → mask → the part at 24 fps → regenerate (sigma 0.8, capped at 1080p for a 1080p clip) → composites → join → the sound", () => {
    const p = character("open", "2K");
    expect(keys(p)).toEqual(["frame", "anchor", "swap", "mask", "fit", "sharpen-regen0", "sharpen-comp0", "sharpen-comp1", "sharpen-comp2", "sharpen-comp3", "sharpen-join", "sound"]);
    expect(p.final).toBe("sound");
    expect(p.sound).toBe(true);
    // The swap itself stays 768p and is a step now.
    expect(step(p, "swap").request).toMatchObject({ feature: "genjutsu-step", params: { resolution: "768p" } });
    expect(step(p, "mask").request).toMatchObject({
      modelId: "oss-h3-person-mask",
      inputs: { video: hd.url },
      params: { startTime: 2, endTime: 12, resolution: "768p", matteOutput: "matte", extra: { keyFrame: 0, spanFrames: 240, shotFrames: 240, selection: "largest" } },
    });
    expect(step(p, "fit").request).toMatchObject({ modelId: "oss-fit-clip", params: { startTime: 2, endTime: 12, fps: 24, extra: { width: 1920, height: 1080 } } });
    const regen = step(p, "sharpen-regen0");
    expect(regen.request).toMatchObject({ modelId: "oss-h3-regenerate", op: "upscale-video", params: { resolution: "1080p", seed: 42, extra: { startSigma: 0.8, draftFrom: "h3" } } });
    expect(regen.request.prompt).toMatch(/^Replace the selected person in the clip with the character in the reference/);
    expect(regen.after).toEqual(["swap"]);
    const c1 = step(p, "sharpen-comp1");
    expect(c1.request).toMatchObject({ modelId: "oss-composite-mask", op: "overlay", params: { startTime: 2.5, endTime: 5, extra: { windowStart: 2.5, takeStart: 2.5, maskStart: 2.5 } } });
    expect(c1.after).toEqual(["sharpen-regen0", "fit", "swap", "mask"]);
    expect(c1.chain).toEqual([{ slot: "videos", at: 1 }, { slot: "videos", at: 0 }, { slot: "videos", at: 2 }, { slot: "mask" }]);
    expect(step(p, "sharpen-join").request).toMatchObject({ modelId: "oss-join-encoded", feature: "genjutsu-step" });
    expect(step(p, "sound").request).toMatchObject({ modelId: "oss-mux", feature: "genjutsu", title: "Swap" });
    expect(step(p, "sound").chain).toEqual([{ slot: "video" }, { slot: "audio" }]);
  });

  it("your GPU: a 4K square clip regenerates at 2K; a part over 15 s runs in two regenerate windows; a silent clip ends on the join", () => {
    const sq = character("open", "4K", { source: { ...hd, width: 4096, height: 4096 } });
    expect(step(sq, "sharpen-regen0").request.params).toMatchObject({ resolution: "1440p" });
    const long = character("open", "2K", { range: { start: 0, end: 20 } });
    expect(step(long, "sharpen-regen0").request.params).toMatchObject({ startTime: 0, endTime: 10, sourceDuration: 10 });
    expect(step(long, "sharpen-regen1").request.params).toMatchObject({ startTime: 10, endTime: 20 });
    const quiet = character("open", "1080p", { source: { ...hd, hasAudio: false } });
    expect(quiet.final).toBe("sharpen-join");
    expect(step(quiet, "sharpen-join").request).toMatchObject({ feature: "genjutsu", title: "Swap" });
    expect(() => character("open", "2K", { source: { ...hd, width: 1280, height: 720 } })).toThrow(S.SHARPEN_COPY.small);
  });

  it("the cloud at 2K: the same pieces, fal's H3 asked for 2K (no regenerate, no composite)", () => {
    const p = character("cloud", "2K");
    expect(keys(p).some((k) => /regen|comp/.test(k))).toBe(false);
    const swap = p.steps.find((s) => s.request.modelId === "fuobe-character-swap")!;
    expect(swap.request.params).toMatchObject({ resolution: "2K", duration: 10, seed: 42 });
    // 1080p on the cloud is the 768P swap.
    expect(character("cloud", "1080p").steps.find((s) => s.request.modelId === "fuobe-character-swap")!.request.params).toMatchObject({ resolution: "768p" });
    // The payload fal gets.
    const m = getModel("fuobe-character-swap")!;
    const route = onEngine(m, "cloud").routes.find((r) => r.provider === "fal")!;
    const payload = buildPayload(route.map!, { ...swap.request.params, prompt: swap.request.prompt, images: [ref] } as never) as Record<string, unknown>;
    expect(payload).toMatchObject({ resolution: "2K", seed: 42, duration: 10 });
  });
});

// ---------------------------------------------------------------------------
// Character Swap Studio: Sharpen per chosen take

const clipOf = (over: Partial<SwapClip> = {}): SwapClip => ({
  id: "clip-1",
  name: "walk",
  source: { url: "/api/files/uploads/x/walk.mp4", name: "walk.mp4", duration: 20, fps: 30, width: 1920, height: 1080, hasAudio: true },
  normalized: { url: "/api/files/outputs/x/walk24.mp4", genId: "g-norm" },
  frames: 480,
  cuts: [],
  detected: null,
  cutsReviewed: true,
  shots: [],
  transcript: null,
  review: "pending",
  reviewNotes: "",
  assembly: null,
  ...over,
});

function studio(engine: "open" | "cloud", frames = 120) {
  const shot = { ...newShot(48, 48 + frames, DEFAULT_SETTINGS, true, () => 0.5), id: "shot-1" };
  const t: SwapTake = {
    id: "take-1",
    createdAt: 1,
    engine,
    state: "launched",
    genId: "g-take",
    signature: "",
    dependencies: [],
    prompt: "Replace the selected person in <Video 1> with the character in <Picture 1>.",
    seed: 7,
    favourite: false,
    decision: "pending",
    notes: "",
    frozen: { reference: ref, shotStart: 48, start: 0, end: frames, history: 0, anchor: null, mask: engine === "open" ? "/api/files/outputs/x/mask.mp4" : null, settings: { ...DEFAULT_SETTINGS }, who: shot.who },
  };
  const seg = { id: "seg-1", start: 0, end: frames, connection: "start" as const, history: 0, seed: 7, prompt: "", performancePrompt: null, dialogue: null, speaker: null, anchorMode: "none" as const, anchor: null, anchors: [], takes: [t], selectedTake: t.id, needsReview: false };
  const s = { ...shot, segments: [seg] };
  const clip = clipOf({ shots: [s] });
  const project: SwapProject = { id: "p1", name: "Demo", engine, character: { image: ref, description: "a chrome robot" }, defaults: { ...DEFAULT_SETTINGS }, clips: [clip], createdAt: 0, updatedAt: 0, revision: 1 };
  return { project, clip, shot: s, seg, take: t };
}

describe("Character Swap Studio: Sharpen", () => {
  it("your GPU: per take, regenerate → composites over the 24 fps copy through the mask it was made with → join", () => {
    const x = studio("open");
    const plan = planTakeFinish({ ...x, numbers: { shot: 1, segment: 1, take: 1 }, tier: "1080p", video: "/api/files/outputs/x/take.mp4" });
    expect(keys(plan)).toEqual(["regen0", "comp0", "comp1", "join"]);
    expect(plan.final).toBe("join");
    expect(step(plan, "regen0").request).toMatchObject({ modelId: "oss-h3-regenerate", inputs: { video: "/api/files/outputs/x/take.mp4" }, params: { resolution: "1080p", seed: 7, extra: { startSigma: 0.8 } } });
    expect(step(plan, "regen0").request.prompt).toBe("The character: a chrome robot. Replace the selected person in the clip with the character in the reference.");
    const c1 = step(plan, "comp1");
    // The take starts at frame 48 of the clip (2 s) and at frame 0 of the shot's mask.
    expect(c1.request).toMatchObject({
      inputs: { videos: ["/api/files/outputs/x/walk24.mp4", "/api/files/outputs/x/take.mp4"], mask: "/api/files/outputs/x/mask.mp4" },
      params: { startTime: 4.5, endTime: 7, extra: { windowStart: 2.5, takeStart: 2.5, maskStart: 2.5 } },
    });
    expect(c1.chain).toEqual([{ slot: "videos", at: 1 }]);
    expect(step(plan, "join").request).toMatchObject({ feature: "swap-studio-step", title: "Shot 1 · segment 1 · take 1 · 1080p" });
    // No mask, no composite.
    expect(() => planTakeFinish({ ...x, shot: { ...x.shot, approvedMask: null }, take: { ...x.take, frozen: { ...x.take.frozen!, mask: null } }, numbers: { shot: 1, segment: 1, take: 1 }, tier: "1080p", video: "/v.mp4" })).toThrow(
      S.SHARPEN_COPY.noMask,
    );
  });

  it("the cloud: the segment made again on fal's H3 at 2K, with its words, LoRA, references and seed", () => {
    const x = studio("cloud");
    const plan = planTakeFinish({ ...x, numbers: { shot: 1, segment: 1, take: 1 }, tier: "2K" });
    expect(keys(plan)).toEqual(["cut", "swap", "fit"]);
    expect(step(plan, "swap").request).toMatchObject({ modelId: "fuobe-character-swap", inputs: { images: [ref] }, params: { resolution: "2K", seed: 7, duration: 5, sourceDuration: 5 } });
    expect(step(plan, "swap").request.loras?.[0]?.file).toMatch(/swap/);
    expect((step(plan, "swap").request.step as { label: string }).label).toMatch(/swap at 2K$/);
    expect(() => planTakeFinish({ ...x, numbers: { shot: 1, segment: 1, take: 1 }, tier: "1080p" })).toThrow(/2K or 4K/);
  });

  it("the assembly uses a sharper version only once it is picked, and knows when that changed", () => {
    const x = studio("open");
    const pieces = [{ kind: "take" as const, start: 48, end: 168, take: x.take, segmentId: "seg-1" }];
    expect(chosenTakes(pieces)).toHaveLength(1);
    expect(assemblyTakes(pieces)).toEqual(["take-1"]);
    const finish = { id: "finish-1", createdAt: 2, engine: "open" as const, asked: "2K" as const, tier: "1080p" as const, genId: "g-fin", use: false };
    expect(usedFinish({ finish })).toBeNull();
    const used = [{ ...pieces[0], take: { ...x.take, finish: { ...finish, use: true } } }];
    expect(assemblyTakes(used)).toEqual(["take-1@finish-1"]);
    const plan = planAssembly({ engine: "open", clip: x.clip, pieces: used, videoOf: (p) => (usedFinish(p.take) ? "/api/files/outputs/x/sharp.mp4" : "/v.mp4") });
    expect(plan.steps.find((s) => s.request.inputs?.video === "/api/files/outputs/x/sharp.mp4")).toBeTruthy();
  });

  it("Finish keeps Clean backplate + alpha on the page, not available", () => {
    expect(FINISH_UNAVAILABLE.title).toBe("Clean backplate + alpha");
    const page = fs.readFileSync(path.join(ROOT, "src/components/swap-studio/stage-review.tsx"), "utf8");
    expect(page).toMatch(/FINISH_UNAVAILABLE\.title/);
    expect(page).toMatch(/Not available/);
    expect(page).toMatch(/SHARPEN_COPY\.title/);
    expect(S.SHARPEN_COPY.card).toBe(
      "Redraws each chosen take at 2K, then puts only your character back over the original footage. The background and the sound stay as filmed. Faces can change slightly; compare before you keep it.",
    );
  });
});

// ---------------------------------------------------------------------------
// The graph

describe("the GPU pre-flight", () => {
  it("has a Character swap in 2K row on the regenerate, the composite and the join", async () => {
    const { STUDIO_ROWS, studioTool } = await import("@/server/gpu/tools");
    const row = STUDIO_ROWS.find((r) => r.label === "Character swap in 2K")!;
    expect(row).toMatchObject({ href: "/genjutsu?mode=character", group: "Video tools" });
    const t = studioTool(row)!;
    expect(t.workflows).toEqual(expect.arrayContaining(["video-regenerate-h3", "video-composite-mask", "video-concat-encoded"]));
    expect(t.loras.map((l) => l.file)).toContain("open_h3_regenerate_2k_lora.safetensors");
  });
});

describe("video-composite-mask", () => {
  const { manifest } = getWorkflow(S.COMPOSITE_WORKFLOW);

  it("is core nodes only, validated, with the bindings the plan fills", () => {
    expect(manifest).toMatchObject({ capability: "overlay", vramGb: 0, validated: true });
    expect(Object.keys(manifest.bindings).sort()).toEqual(
      ["video", "video2", "video3", "mask", "startTime", "windowStart", "takeStart", "maskStart", "duration", "canvasWidth", "canvasHeight", "takeX", "takeY", "regionWidth", "regionHeight", "regionX", "regionY", "maskGrow", "feather", "filenamePrefix"].sort(),
    );
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/video-composite-mask.json"), "utf8")) as Record<string, { class_type: string }>;
    expect(new Set(Object.values(graph).map((n) => n.class_type))).toEqual(
      new Set(["LoadVideo", "Video Slice", "GetVideoComponents", "ImageScale", "ImageToMask", "GrowMask", "FeatherMask", "ImageCompositeMasked", "CreateVideo", "SaveVideo"]),
    );
    expect(getModel(S.COMPOSITE_MODEL)).toMatchObject({ engine: "open", hidden: true });
  });

  it("the provider puts the footage, the regenerate, the swap, the mask and the composite's places on their nodes", async () => {
    const x = studio("open");
    const plan = planTakeFinish({ ...x, numbers: { shot: 1, segment: 1, take: 1 }, tier: "1080p", video: "/take.mp4" });
    const c = step(plan, "comp0").request;
    const extra = c.params!.extra as Record<string, number>;
    const { workflow: wf } = await prepareWorkflow(
      S.COMPOSITE_WORKFLOW,
      { video: undefined, videos: ["src.mp4", "regen.mp4", "take.mp4"], mask: "mask.mp4", startTime: c.params!.startTime, endTime: c.params!.endTime, extra: { ...extra } } as GenInput,
      { generationId: "g1", op: "overlay", upload: async (_d, _t, name) => `up_${name}`, media: () => undefined },
    );
    const at = (node: string, input: string) => (wf as Record<string, { inputs: Record<string, unknown> }>)[node].inputs[input];
    expect([at("source", "file"), at("regen", "file"), at("take", "file"), at("mask", "file")]).toEqual(["src.mp4", "regen.mp4", "take.mp4", "mask.mp4"]);
    expect(at("source_slice", "start_time")).toBe(2);
    expect([at("source_slice", "duration"), at("regen_slice", "duration"), at("take_slice", "duration"), at("mask_slice", "duration")]).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect([at("regen_slice", "start_time"), at("take_slice", "start_time"), at("mask_slice", "start_time")]).toEqual([0, 0, 0]);
    expect([at("take_scaled", "width"), at("take_scaled", "height"), at("base", "x"), at("base", "y")]).toEqual([extra.canvasWidth, extra.canvasHeight, extra.takeX, extra.takeY]);
    expect([at("regen_scaled", "width"), at("regen_mask_img", "height"), at("composite", "x"), at("composite", "y")]).toEqual([extra.regionWidth, extra.regionHeight, extra.regionX, extra.regionY]);
    expect(at("regen_mask_img", "crop")).toBe("center");
    expect([at("take_grow", "expand"), at("regen_feather", "bottom")]).toEqual([extra.maskGrow, extra.feather]);
  });
});
