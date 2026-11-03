import { describe, expect, it } from "vitest";
import { getMaker, OPEN_TARGET_PROBLEM, ORIGINALS, planGenjutsu } from "@/lib/catalog/genjutsu";
import type { GenInput, Operation } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";
import { tempDir } from "./helpers/temp-dir";

// The comfyui provider driving Genjutsu's open graphs (Wan 2.1 VACE swap / insert, Wan Animate 2, MiniMax H3's
// Character swap), bound for real on the library graphs, and planned steps going through it.
const tmp = tempDir("fuobe-genjutsu-comfy-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow, withoutAnchor } = await import("@/server/providers/comfyui");

const clip: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: true, duration: 12, videoDuration: 12, width: 1280, height: 720, fps: 30, frames: 360 };
const prepare = (id: string, input: Partial<GenInput>, op: Operation) =>
  prepareWorkflow(id, { video: "clip.mp4", ...input } as GenInput, { generationId: "g1", op, upload: async (_d, _t, name) => `up_${name}`, media: (n) => (n === "clip.mp4" ? clip : undefined) });
const at = (wf: Record<string, { inputs: Record<string, unknown> }>, node: string, input: string) => wf[node]?.inputs[input];

describe("Genjutsu's open graphs through the provider", () => {
  it("VACE swap: what goes for SAM 3.1, the reference into VACE, the result's words, the window in seconds", async () => {
    const { workflow: wf } = await prepare(
      "video-swap-wan-vace",
      { prompt: "A red apple on the desk", images: ["apple.png", "apple-2.png"], startTime: 2.691667, endTime: 5.391667, aspectRatio: "auto", resolution: "720p", seed: 7, extra: { maskPrompt: "the coffee cup and the saucer" } },
      "video-swap",
    );
    expect(at(wf, "8", "text")).toBe("the coffee cup, the saucer");
    expect(at(wf, "16", "text")).toBe("A red apple on the desk");
    expect(at(wf, "40", "image")).toBe("apple.png");
    expect(at(wf, "85", "start_time")).toBe(2.691667);
    expect(at(wf, "82", "value")).toBeCloseTo(2.7, 6);
    expect(at(wf, "23", "seed")).toBe(7);
    // 720p in the clip's own shape is the work-size budget.
    expect([at(wf, "87", "value"), at(wf, "88", "value")]).toEqual([1280, 720]);
  });

  it("a sentence alone (a Canvas node) says both what goes and what comes in", async () => {
    const { workflow: wf } = await prepare("video-swap-wan-vace", { prompt: "Replace the red car with a white horse", images: ["horse.png"] }, "video-swap");
    expect(at(wf, "8", "text")).toBe("the red car");
    expect(at(wf, "16", "text")).toBe("A white horse in place of the red car, matching the light, perspective and motion of the shot.");
  });

  it("refuses in words: nothing named, clicks, no reference", async () => {
    await expect(prepare("video-swap-wan-vace", { prompt: "", images: ["a.png"] }, "video-swap")).rejects.toThrow(/Say what to swap/);
    await expect(prepare("video-swap-wan-vace", { images: ["a.png"], points: [{ x: 3, y: 4 }] }, "video-swap")).rejects.toThrow(OPEN_TARGET_PROBLEM.swap!);
    await expect(prepare("video-swap-wan-vace", { prompt: "the cup" }, "video-swap")).rejects.toThrow("Add a picture of what goes in");
  });

  it("VACE insert: the painted spot and the reference, a default description when none is given", async () => {
    const { workflow: wf } = await prepare("video-insert-wan-vace", { mask: "spot.png", images: ["lamp.png"], startTime: 0, endTime: 2.7 }, "video-insert");
    expect(at(wf, "70", "image")).toBe("spot.png");
    expect(at(wf, "40", "image")).toBe("lamp.png");
    expect(at(wf, "16", "text")).toMatch(/^The object from the reference image in the marked area/);
    await expect(prepare("video-insert-wan-vace", { images: ["lamp.png"], prompt: "a lamp" }, "video-insert")).rejects.toThrow("Paint where it goes on the first frame");
    // Clicks (a Canvas node) are refused with the insert's own words: paint, not "name what to swap".
    await expect(prepare("video-insert-wan-vace", { images: ["lamp.png"], points: [{ x: 3, y: 4 }] }, "video-insert")).rejects.toThrow(OPEN_TARGET_PROBLEM.insert!);
  });

  it("a planned swap window is what the graph is given", async () => {
    const plan = planGenjutsu({
      engine: "open",
      mode: "swap",
      maker: getMaker(ORIGINALS.swap, "open")!,
      title: "t",
      source: { url: "/api/files/clip.mp4", duration: 12, fps: 30, width: 1280, height: 720, hasAudio: true },
      range: { start: 0, end: 12 },
      quality: "480p",
      references: ["/api/files/apple.png"],
      target: "type",
      subject: "the coffee cup",
    });
    const req = plan.steps.find((s) => s.key === "make1")!.request;
    const { workflow: wf } = await prepare("video-swap-wan-vace", { prompt: req.prompt, images: ["apple.png"], ...req.params } as Partial<GenInput>, "video-swap");
    expect(at(wf, "8", "text")).toBe("the coffee cup");
    expect(at(wf, "85", "start_time")).toBe(req.params!.startTime);
    expect(at(wf, "82", "value")).toBeCloseTo(req.params!.endTime! - req.params!.startTime!, 6);
    expect([at(wf, "87", "value"), at(wf, "88", "value")]).toEqual([848, 480]);
  });

  it("Wan Animate 2: the character, the driving clip, and the clip's own shape at the quality asked", async () => {
    const { workflow: wf } = await prepare("wan-animate2", { images: ["knight.png"], prompt: "A knight in silver armour", aspectRatio: "auto", resolution: "720p" }, "motion-transfer");
    expect(at(wf, "189", "image")).toBe("knight.png");
    expect(at(wf, "240", "file")).toBe("clip.mp4");
    expect(at(wf, "672:582", "text")).toBe("A knight in silver armour");
    expect([at(wf, "672:600", "resize_type.width"), at(wf, "672:600", "resize_type.height")]).toEqual([1280, 720]);
  });
});

describe("Character swap's open graphs through the provider (MiniMax H3)", () => {
  type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  const h3 = (input: Partial<GenInput>) => prepare("video-character-swap-h3", input, "video-swap").then((r) => r.workflow as Graph);
  const relay = (input: Partial<GenInput>) => prepare("video-character-swap-h3-relay", input, "video-swap").then((r) => r.workflow as Graph);

  it("the clip, the character, the part, the quality as the pack's string, the words and the seed", async () => {
    const wf = await h3({ images: ["hero.png", "anchor.png"], startTime: 2, endTime: 9, resolution: "768p", seed: 77, prompt: "Replace the selected person in <Video 1> with the character in <Picture 1>." });
    expect(at(wf, "30", "file")).toBe("clip.mp4");
    expect(at(wf, "9", "image")).toBe("hero.png");
    expect(at(wf, "anchor_image", "image")).toBe("anchor.png");
    expect([at(wf, "trim", "start_time"), at(wf, "trim", "duration"), at(wf, "31", "duration_seconds")]).toEqual([2, 7, 7]);
    expect(at(wf, "31", "resolution")).toBe("768");
    expect(at(wf, "801", "prompt")).toBe("Replace the selected person in <Video 1> with the character in <Picture 1>.");
    expect(at(wf, "801", "seed")).toBe(77);
    expect(at(wf, "803", "use_anchor")).toBe(true);
    expect(at(wf, "803", "anchor")).toEqual(["anchor_fit", 0]);
    // The swap LoRA v1.5 by default; the output is the saved video.
    expect(at(wf, "850", "lora_name")).toBe("h3_character_swap_v1.5.safetensors");
    expect(wf["809"].class_type).toBe("SaveVideo");
    const low = await h3({ images: ["hero.png"], startTime: 0, endTime: 5, resolution: "480p" });
    expect(at(low, "31", "resolution")).toBe("480");
  });

  it("who to swap: SAM 3.1's words, largest / leftmost / rightmost / by number, the mask's margin", async () => {
    const wf = await h3({ images: ["hero.png"], startTime: 0, endTime: 6, extra: { selection: "index", subjectIndex: 2, maskPrompt: "the dancer", maskGrow: 32, useMask: false, audioGuide: false } });
    expect(at(wf, "101", "text")).toBe("the dancer");
    expect([at(wf, "104", "selection"), at(wf, "104", "index")]).toEqual(["index", 2]);
    expect(at(wf, "110", "expansion_px")).toBe(32);
    expect(at(wf, "803", "use_mask")).toBe(false);
    expect(at(wf, "801", "audio_guide")).toBe(false);
  });

  it("clicks are moved into the pack's prepared frame for SAM 3.1, and the clicked mask is the one taken", async () => {
    const wf = await h3({ images: ["hero.png"], startTime: 0, endTime: 6, resolution: "768p", points: [{ x: 640, y: 360, label: "positive" }, { x: 20, y: 20, label: "negative" }], extra: { selection: "largest", subjectIndex: 0 } });
    // 1280×720 at "768": the pack's canvas is 1344×736 (scaled to 1344×756, 10 rows cropped top and bottom).
    expect(JSON.parse(String(at(wf, "103", "positive_coords")))).toEqual([{ x: 672, y: 368 }]);
    expect(JSON.parse(String(at(wf, "103", "negative_coords")))).toEqual([{ x: 21, y: 11 }]);
    // SAM3_Detect returns the point mask first, then the "person" detections: SelectSubject takes index 0, not "largest".
    expect([at(wf, "104", "selection"), at(wf, "104", "index")]).toEqual(["index", 0]);
    const relayWf = await relay({ images: ["hero.png"], startTime: 0, endTime: 6, resolution: "480p", points: [{ x: 1024, y: 360 }] });
    // 1280×720 at "480": 928×512 (scaled to 928×522).
    expect(JSON.parse(String(at(relayWf, "detect", "positive_coords")))).toEqual([{ x: 742, y: 256 }]);
    expect([at(relayWf, "select", "selection"), at(relayWf, "select", "index")]).toEqual(["index", 0]);
    // Without clicks, the choice made stays.
    const words = await h3({ images: ["hero.png"], startTime: 0, endTime: 6, extra: { selection: "largest" } });
    expect([at(words, "103", "positive_coords"), at(words, "104", "selection")]).toEqual(["", "largest"]);
  });

  it("the window plan as the pack's choices, and the LoRA's release (v1, or none: the Turbo LoRA alone)", async () => {
    const wf = await h3({ images: ["hero.png"], startTime: 0, endTime: 6, extra: { windowFrames: 120, historyFrames: 20, lora: "v1" } });
    expect([at(wf, "805", "window_frames"), at(wf, "805", "history_frames")]).toEqual(["124", "18"]);
    // A history as long as the window would stop the pack's WindowPlan: it comes down below the window.
    const short = await h3({ images: ["hero.png"], startTime: 0, endTime: 6, extra: { windowFrames: 22, historyFrames: 35 } });
    expect([at(short, "805", "window_frames"), at(short, "805", "history_frames")]).toEqual(["22", "18"]);
    const onlyHistory = await relay({ images: ["hero.png"], startTime: 0, endTime: 6, extra: { historyFrames: 137 } });
    expect([at(onlyHistory, "plan", "window_frames"), at(onlyHistory, "plan", "history_frames")]).toEqual(["124", "120"]);
    expect(at(wf, "850", "lora_name")).toBe("h3_character_swap_pro4500_1000.safetensors");
    const bare = await h3({ images: ["hero.png"], startTime: 0, endTime: 6, extra: { lora: "none" } });
    expect(bare["850"]).toBeUndefined();
    expect(at(bare, "800", "model")).toEqual(["4", 0]);
  });

  it("no anchor frame: its loader and fit go, the shot takes none and its switch is off", async () => {
    const wf = await h3({ images: ["hero.png"], startTime: 0, endTime: 6 });
    expect(wf.anchor_image).toBeUndefined();
    expect(wf.anchor_fit).toBeUndefined();
    expect(at(wf, "803", "anchor")).toBeUndefined();
    expect(at(wf, "803", "use_anchor")).toBe(false);
    expect(at(wf, "803", "reference")).toEqual(["9", 0]);
    // withoutAnchor leaves a graph with no dangling links.
    const ids = new Set(Object.keys(wf));
    for (const n of Object.values(wf)) for (const v of Object.values(n.inputs)) if (Array.isArray(v) && typeof v[0] === "string") expect(ids.has(v[0])).toBe(true);
    expect(withoutAnchor({ a: { class_type: "LoadImage", inputs: { image: "x" } }, b: { class_type: "Shot", inputs: { anchor: ["a", 0], use_anchor: true } } }, "a")).toEqual({ b: { class_type: "Shot", inputs: { use_anchor: false } } });
    // No words given: Openjutsu's instruction without the anchor sentence (the graph's own text names <Picture 2>).
    expect(at(wf, "801", "prompt")).toBe("Replace the selected person in <Video 1> with the character in <Picture 1>. Preserve the source performance, scene and audio timing.");
    const anchored = await h3({ images: ["hero.png", "anchor.png"], startTime: 0, endTime: 6 });
    expect(at(anchored, "801", "prompt")).toMatch(/Start from the first frame in <Picture 2>\.$/);
    const relayed = await relay({ images: ["hero.png"], startTime: 0, endTime: 6 });
    expect(at(relayed, "reference_conditioning", "prompt")).not.toMatch(/Picture 2/);
  });

  it("H3 Relay: the same part, quality, words, seed and who, on Akatz's relay graph", async () => {
    const wf = await relay({ images: ["hero.png"], startTime: 1, endTime: 11, resolution: "480p", seed: 5, prompt: "Replace the selected person in <Video 1> with the character in <Picture 1>.", extra: { selection: "leftmost", maskPrompt: "the singer" } });
    expect(at(wf, "source", "file")).toBe("clip.mp4");
    expect(at(wf, "reference", "image")).toBe("hero.png");
    expect([at(wf, "trim", "start_time"), at(wf, "trim", "duration"), at(wf, "prepare", "duration_seconds")]).toEqual([1, 10, 10]);
    expect(at(wf, "prepare", "resolution")).toBe("480");
    expect(at(wf, "plan", "seed")).toBe(5);
    expect(at(wf, "reference_conditioning", "prompt")).toMatch(/<Picture 1>/);
    expect([at(wf, "select", "selection"), at(wf, "subject", "text")]).toEqual(["leftmost", "the singer"]);
    expect(wf.save.class_type).toBe("SaveVideo");
  });

  it("a planned open Character swap is what the graph is given", async () => {
    const p = planGenjutsu({
      engine: "open",
      mode: "character",
      maker: getMaker(ORIGINALS.character, "open")!,
      title: "t",
      source: { url: "/api/files/clip.mp4", duration: 12, fps: 30, width: 1280, height: 720, hasAudio: true },
      range: { start: 2, end: 9 },
      quality: "768p",
      references: ["/api/files/hero.png"],
      seed: 11,
      character: { who: "rightmost", subject: "the drummer" },
    });
    const req = p.steps.find((s) => s.key === "swap")!.request;
    const wf = (await prepare("video-character-swap-h3", { prompt: req.prompt, images: ["hero.png", "anchor.png"], ...req.params } as Partial<GenInput>, "video-swap")).workflow as Graph;
    expect([at(wf, "trim", "start_time"), at(wf, "trim", "duration")]).toEqual([2, 7]);
    expect(at(wf, "31", "resolution")).toBe("768");
    expect([at(wf, "104", "selection"), at(wf, "101", "text")]).toEqual(["rightmost", "the drummer"]);
    expect(at(wf, "801", "seed")).toBe(11);
    expect(at(wf, "801", "prompt")).toMatch(/<Video 1>.*<Picture 1>.*<Picture 2>/s);
    expect(at(wf, "anchor_image", "image")).toBe("anchor.png");
  });
});
