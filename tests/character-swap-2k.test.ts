import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { PlanStep } from "@/lib/catalog/shorts";
import type { GenerationRequest, GenInput } from "@/lib/catalog/types";

// Character swap in 2K: Genjutsu's 1080p / 2K / 4K and Character Swap Studio's Sharpen,
// on both engines. Your GPU: the 768p swap regenerated (sigma 0.8, never above the footage's size), then only the
// character composited over the footage (video-composite-mask); the cloud: fal's H3 at 2K / 4K, a new version.
// Your GPU's sizes regenerate with Open-H3 Regenerate, which is switched off for now (REGEN_OFFERED); these tests check
// them as they run once it is on. tests/regenerate-offered.test.ts checks that nothing offers them while it is off.
vi.mock("@/lib/catalog/regenerate", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/catalog/regenerate")>()), REGEN_OFFERED: true }));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-swap-2k-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const S = await import("@/lib/catalog/sharpen");
const C = await import("@/lib/catalog/character-swap");
const G = await import("@/lib/catalog/genjutsu");
const { DEFAULT_SETTINGS, newShot, assemblyTakes, chosenTakes, usedFinish, normalizedSize, cloudFilmSize } = await import("@/lib/catalog/swap-studio");
const { applyEdit, shotBusy } = await import("@/lib/catalog/swap-studio-edit");
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
    const { qualityHint, qualityShort } = await import("@/components/genjutsu/character-panel");
    expect(qualityShort("cloud", "2K")).toBe("$0.81 for 5 s");
    expect(qualityShort("open", "4K")).toBe("Free · your GPU");
    expect(qualityShort("cloud", "768p")).toBe("H3's native top");
    expect(qualityHint("cloud", "2K")).toBe("2K and 4K redraw the 768p swap at the higher size. $0.81 for 5 s, $2.44 for 15 s.");
    expect(qualityHint("cloud", "4K")).toBe("2K and 4K redraw the 768p swap at the higher size. $1.00 for 5 s, $3.00 for 15 s.");
    expect(qualityHint("open", "2K")).toBe(
      "1080p and 2K redraw the 768p swap at the higher size. Free on your GPU, about 3 min more per 5 s on a 72 GB GPU. Your GPU joins the clip at up to 2048 px a side, so 2K needs a clip larger than 1080p.",
    );
    expect(qualityHint("open", "480p")).toBe("Faster and cheaper");
  });

  it("your GPU's 4K is turned off with the reason (it joins at up to 2048 px a side); the cloud's isn't", async () => {
    const { qualityOff } = await import("@/components/genjutsu/character-panel");
    expect(S.OPEN_TIER_OFF).toEqual({ "4K": "Your GPU joins the clip at up to 2048 px a side, so 4K adds nothing over 2K" });
    expect(qualityOff("open", "4K")).toBe(S.OPEN_TIER_OFF["4K"]);
    expect(["480p", "768p", "1080p", "2K"].map((q) => qualityOff("open", q as never))).toEqual([null, null, null, null]);
    expect(qualityOff("cloud", "4K")).toBeNull();
    // The picker says why as text the page shows (and links it to the group), not only in a tooltip.
    const panel = fs.readFileSync(path.join(ROOT, "src/components/genjutsu/character-panel.tsx"), "utf8");
    expect(panel).toMatch(/describedBy=\{offReasons\.length \? "character-quality-off"/);
    expect(panel).toMatch(/id="character-quality-off"/);
  });
});

describe("what each engine makes of a size", () => {
  it("your GPU: tiers gated and defaulted by the part the character is redrawn in (joined at most 2048 px a side)", () => {
    const film = S.filmSize(1920, 1080)!;
    expect(film).toEqual({ width: 1920, height: 1080 });
    const canvas = C.h3Canvas(1920, 1080, "768p");
    expect(S.redrawnRegion(film, canvas)).toEqual({ width: 1842, height: 1052 });
    expect(S.sharpenOptions("open", film, canvas).map((o) => [o.tier, o.available])).toEqual([
      ["1080p", true],
      ["2K", false],
      ["4K", false],
    ]);
    expect(S.sharpenOptions("open", film, canvas)[1].reason).toBe("Your character is redrawn in a 1842×1052 part of the frame (the clip is joined at up to 2048 px a side), so 2K adds nothing over 1080p");
    expect(S.sharpenOptions("open", film, canvas)[2].reason).toBe(S.OPEN_TIER_OFF["4K"]);
    expect(S.sharpenTierFor("open", "4K", film, canvas)).toBe("1080p");
    expect(S.defaultSharpenTier("open", film, canvas)).toBe("1080p");
    // A 1440 square: the regenerate's 16:9 draft keeps a 1440 × 822 band of it, so 2K adds nothing there.
    const sq1440 = S.filmSize(1440, 1440)!;
    expect(S.redrawnRegion(sq1440, C.h3Canvas(1440, 1440, "768p"))).toEqual({ width: 1440, height: 822 });
    expect(S.sharpenTierFor("open", "2K", sq1440, C.h3Canvas(1440, 1440, "768p"))).toBe("1080p");
    // 4:3 at 2048 × 1536 (2048 × 1170 redrawn) and a 4K square (kept at 2048 × 2048): 2K adds a little and can be
    // picked, but 1080p is the default, since neither part is 1440 tall.
    for (const [w, h] of [
      [2048, 1536],
      [4096, 4096],
    ]) {
      const f = S.filmSize(w, h)!;
      const c = C.h3Canvas(w, h, "768p");
      expect(Math.min(S.redrawnRegion(f, c).width, S.redrawnRegion(f, c).height)).toBe(1170);
      expect(S.sharpenTierFor("open", "4K", f, c)).toBe("2K");
      expect(S.defaultSharpenTier("open", f, c)).toBe("1080p");
    }
    // Without the canvas, the film's own shape stands in for it.
    expect(S.redrawnRegion(film)).toEqual({ width: 1890, height: 1080 });
    // Below 1080p the 768p takes already match it.
    expect(S.sharpenTierFor("open", "2K", S.filmSize(1280, 720))).toBeNull();
    expect(S.sharpenOptions("open", S.filmSize(1280, 720))[0].reason).toBe(S.SHARPEN_COPY.small);
  });

  it("Genjutsu's note names the clip's own size, the 2048 px join and the part redrawn when a size is capped", () => {
    expect(S.openCapNote({ width: 3840, height: 2160 }, "4K", C.h3Canvas(3840, 2160, "768p"))).toBe(
      "Your clip is 3840×2160, joined at 2048×1152 (up to 2048 px a side), and your character is redrawn in a 1964×1122 part of it, so it is sharpened at 2K",
    );
    expect(S.openCapNote({ width: 1920, height: 1080 }, "2K", C.h3Canvas(1920, 1080, "768p"))).toBe(
      "Your clip is 1920×1080 (clips are joined at up to 2048 px a side), and your character is redrawn in a 1842×1052 part of it, so it is sharpened at 1080p",
    );
    expect(S.openCapNote({ width: 1920, height: 1080 }, "1080p", C.h3Canvas(1920, 1080, "768p"))).toBeNull();
  });

  it("the studio's film sizes are sharpen.ts's (one copy of the rule)", () => {
    for (const [w, h] of [
      [3840, 2160],
      [72, 128],
      [1080, 1920],
    ]) {
      expect(normalizedSize(w, h)).toEqual(S.filmSize(w, h, "open"));
      expect(cloudFilmSize(w, h)).toEqual(S.filmSize(w, h, "cloud"));
    }
    expect(normalizedSize(3840, 2160)).toEqual({ width: 2048, height: 1152 });
    expect(cloudFilmSize(72, 128)).toEqual({ width: 512, height: 910 });
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

  it("at 1080p and 4K the regenerate covers the centre 1080 / 1088 (2160 / 2176) of the region: its finish trims the grid's rows", () => {
    const film = { width: 1920, height: 1080 };
    const canvas = C.h3Canvas(1920, 1080, "768p");
    const hd = S.compositeGeometry(film, canvas, "1080p");
    expect(hd.region).toEqual({ width: 1842, height: 1052, x: 39, y: 14 });
    // 1052 × 1080 / 1088 = 1044.3 rows, 4 above and 4 below.
    expect(hd.regen).toEqual({ width: 1842, height: 1044, x: 39, y: 18 });
    expect(hd.trim).toEqual({ x: 0, y: 4 });
    // 2K is drawn on 1440 rows and keeps them all.
    const k2 = S.compositeGeometry(film, canvas, "2K");
    expect(k2.regen).toEqual({ ...k2.region });
    expect(k2.trim).toEqual({ x: 0, y: 0 });
    // 4K keeps 2160 of 2176 rows.
    expect(S.compositeGeometry(film, canvas, "4K").regen.height).toBe(Math.round((1052 * 2160) / 2176));
    // A tall clip: the columns are trimmed.
    const tall = S.compositeGeometry({ width: 1080, height: 1920 }, C.h3Canvas(1080, 1920, "768p"), "1080p");
    expect(tall.regen.height).toBe(tall.region.height);
    expect(tall.regen.width).toBe(Math.round((tall.region.width * 1080) / 1088));
    expect(tall.regen.x - tall.region.x).toBe(tall.trim.x);
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
    expect(c1.request).toMatchObject({ modelId: "oss-composite-mask", op: "composite", params: { startTime: 2.5, endTime: 5, extra: { windowStart: 2.5, takeStart: 2.5, maskStart: 2.5 } } });
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

  it("an evaluation may try another start noise (0.5–0.909); the page leaves it at 0.8", () => {
    expect(step(character("open", "2K", { character: { sharpenSigma: 0.909 } }), "sharpen-regen0").request.params?.extra).toMatchObject({ startSigma: 0.909 });
    expect(step(character("open", "2K", { character: { sharpenSigma: 0.3 } }), "sharpen-regen0").request.params?.extra).toMatchObject({ startSigma: 0.8 });
    // It never reaches the swap's own graph settings.
    expect(step(character("open", "2K", { character: { sharpenSigma: 0.7 } }), "swap").request.params?.extra).not.toHaveProperty("sharpenSigma");
    const suite = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/eval/cases/character-2k.json"), "utf8"));
    expect(suite.cases.map((c: { submit: { body: { character: { sharpenSigma?: number } } } }) => c.submit.body.character.sharpenSigma)).toEqual([undefined, 0.7, 0.8, 0.909, undefined]);
    expect(suite.defaults.metrics).toEqual(["identity", "background", "temporal"]);
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

  it("Finish is Sharpen alone: its card names the size picked and the model, and says why a size can't be picked", () => {
    const page = fs.readFileSync(path.join(ROOT, "src/components/swap-studio/stage-review.tsx"), "utf8");
    expect(page).toMatch(/SHARPEN_COPY\.title/);
    expect(page).not.toMatch(/backplate|Not available/i);
    expect(page).toMatch(/describedBy=\{off\.length \? offId : undefined\}/);
    expect(S.SHARPEN_COPY.card("1080p")).toBe(
      "Redraws each chosen take at 1080p with Open-H3 Regenerate, then puts only your character back over the original footage. The background and the sound stay as filmed. Faces can change slightly; compare before you keep it.",
    );
    expect(S.SHARPEN_COPY.cardCloud("2K")).toMatch(/^Makes each chosen take again at 2K on MiniMax H3/);
    expect(S.SHARPEN_COPY.model("open", "1080p")).toBe("Open-H3 Regenerate at 1080p");
    expect(S.SHARPEN_COPY.model("cloud", "2K")).toBe("MiniMax H3 at 2K");
  });

  it("a take's sharper version still being made keeps its take and its shot's layout from changing", () => {
    const x = studio("open");
    const finish = { id: "finish-1", createdAt: 2, engine: "open" as const, asked: "1080p" as const, tier: "1080p" as const, genId: "g-fin", stepIds: ["g-regen", "g-fin"], use: false };
    const shot = { ...x.shot, segments: [{ ...x.seg, takes: [{ ...x.take, finish }] }] };
    const project = { ...x.project, clips: [{ ...x.clip, shots: [shot] }] };
    const running = (id: string) => id === "g-regen";
    expect(shotBusy(shot, running)).toBe(true);
    expect(shotBusy(shot, () => false)).toBe(false);
    const ref = { clipId: x.clip.id, shotId: shot.id, segmentId: x.seg.id, takeId: x.take.id };
    expect(() => applyEdit(project, { type: "take", ...ref, remove: true }, { active: running })).toThrow(/sharper version is still being made/);
    expect(() => applyEdit(project, { type: "remove-clip", clipId: x.clip.id } as never, { active: running })).toThrow(/Wait for this clip's takes/);
    // Done: the take can go (with its version).
    const out = applyEdit(project, { type: "take", ...ref, remove: true }, { active: () => false });
    expect(out.clips[0].shots[0].segments![0].takes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The graph

describe("the GPU pre-flight", () => {
  it("has a Character swap in 2K row on every graph Genjutsu's GPU run takes: the swap, the mask, the fit, the regenerate, the composite, the join and the mux", async () => {
    const { STUDIO_ROWS, studioTool } = await import("@/server/gpu/tools");
    const row = STUDIO_ROWS.find((r) => r.label === "Character swap in 2K")!;
    expect(row).toMatchObject({ href: "/genjutsu?mode=character", group: "Video tools" });
    // Every model the open 2K plan runs has its step on the row.
    // (The optional anchor frame has its own models and rows.)
    const planned = character("open", "2K").steps.filter((s) => s.key !== "frame" && s.key !== "anchor");
    const listed = row.steps!.map((s) => `${s.modelId}#${s.op}`);
    expect([...new Set(planned.map((s) => `${s.request.modelId}#${s.request.op}`))].sort()).toEqual([...listed].sort());
    const t = studioTool(row)!;
    expect(t.workflows).toEqual(expect.arrayContaining(["video-regenerate-h3", "video-composite-mask", "video-concat-encoded", "video-mask-h3-relay"]));
    expect(t.loras.map((l) => l.file)).toContain("open_h3_regenerate_2k_lora.safetensors");
  });
});

describe("video-composite-mask", () => {
  const { manifest } = getWorkflow(S.COMPOSITE_WORKFLOW);

  it("is core nodes only, validated, with the bindings the plan fills", () => {
    expect(manifest).toMatchObject({ capability: "composite", vramGb: 0, validated: true });
    expect(Object.keys(manifest.bindings).sort()).toEqual(
      [
        ...["video", "video2", "video3", "mask", "startTime", "windowStart", "takeStart", "maskStart", "duration", "canvasWidth", "canvasHeight", "takeX", "takeY"],
        ...["regionWidth", "regionHeight", "regenWidth", "regenHeight", "regenX", "regenY", "trimX", "trimY", "maskGrow", "feather", "filenamePrefix"],
      ].sort(),
    );
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/video-composite-mask.json"), "utf8")) as Record<string, { class_type: string }>;
    expect(new Set(Object.values(graph).map((n) => n.class_type))).toEqual(
      new Set(["LoadVideo", "Video Slice", "GetVideoComponents", "ImageScale", "ImageToMask", "CropMask", "GrowMask", "FeatherMask", "ImageCompositeMasked", "CreateVideo", "SaveVideo"]),
    );
    expect(getModel(S.COMPOSITE_MODEL)).toMatchObject({ engine: "open", hidden: true });
  });

  it("a run keeps the person's mask (it isn't taken for a painted one) and needs the three clips and the mask", async () => {
    const { applySketch } = await import("@/lib/catalog/sketch");
    const { missingInputs } = await import("@/lib/catalog/plan");
    const m = getModel(S.COMPOSITE_MODEL)!;
    const req = { feature: "genjutsu-step", modelId: m.id, op: "composite" as const, inputs: { videos: ["/s.mp4", "/r.mp4", "/t.mp4"], mask: "/m.mp4" } } as GenerationRequest;
    const kept = applySketch(req, m);
    expect(kept.request.inputs).toEqual(req.inputs);
    expect(kept.note).toBeUndefined();
    expect(missingInputs("composite", req)).toBeNull();
    const msg = "Add the footage, the redrawn clip, the swap and the person's mask to put the character back over it";
    expect(missingInputs("composite", { inputs: { videos: ["/s.mp4", "/r.mp4"], mask: "/m.mp4" } })).toBe(msg);
    expect(missingInputs("composite", { inputs: { videos: ["/s.mp4", "/r.mp4", "/t.mp4"] } })).toBe(msg);
  });

  it("the provider puts the footage, the regenerate, the swap, the mask and the composite's places on their nodes", async () => {
    const x = studio("open");
    const plan = planTakeFinish({ ...x, numbers: { shot: 1, segment: 1, take: 1 }, tier: "1080p", video: "/take.mp4" });
    const c = step(plan, "comp0").request;
    const extra = c.params!.extra as Record<string, number>;
    const { workflow: wf } = await prepareWorkflow(
      S.COMPOSITE_WORKFLOW,
      { video: undefined, videos: ["src.mp4", "regen.mp4", "take.mp4"], mask: "mask.mp4", startTime: c.params!.startTime, endTime: c.params!.endTime, extra: { ...extra } } as GenInput,
      { generationId: "g1", op: "composite", upload: async (_d, _t, name) => `up_${name}`, media: () => undefined },
    );
    const at = (node: string, input: string) => (wf as Record<string, { inputs: Record<string, unknown> }>)[node].inputs[input];
    expect([at("source", "file"), at("regen", "file"), at("take", "file"), at("mask", "file")]).toEqual(["src.mp4", "regen.mp4", "take.mp4", "mask.mp4"]);
    expect(at("source_slice", "start_time")).toBe(2);
    expect([at("source_slice", "duration"), at("regen_slice", "duration"), at("take_slice", "duration"), at("mask_slice", "duration")]).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect([at("regen_slice", "start_time"), at("take_slice", "start_time"), at("mask_slice", "start_time")]).toEqual([0, 0, 0]);
    expect([at("take_scaled", "width"), at("take_scaled", "height"), at("base", "x"), at("base", "y")]).toEqual([extra.canvasWidth, extra.canvasHeight, extra.takeX, extra.takeY]);
    expect([at("regen_mask_img", "width"), at("regen_mask_img", "height")]).toEqual([extra.regionWidth, extra.regionHeight]);
    expect(at("regen_mask_img", "crop")).toBe("center");
    // The regenerate and its mask: the rows its finish kept (1044 of the region's 1052 at 1080p), 4 rows down.
    expect([at("regen_scaled", "width"), at("regen_scaled", "height"), at("composite", "x"), at("composite", "y")]).toEqual([extra.regenWidth, extra.regenHeight, extra.regenX, extra.regenY]);
    expect([at("regen_trim", "x"), at("regen_trim", "y"), at("regen_trim", "width"), at("regen_trim", "height")]).toEqual([extra.trimX, extra.trimY, extra.regenWidth, extra.regenHeight]);
    expect(extra).toMatchObject({ regionWidth: 1842, regionHeight: 1052, regenWidth: 1842, regenHeight: 1044, regenX: 39, regenY: 18, trimX: 0, trimY: 4 });
    expect([at("take_grow", "expand"), at("regen_feather", "bottom")]).toEqual([extra.maskGrow, extra.feather]);
  });
});
