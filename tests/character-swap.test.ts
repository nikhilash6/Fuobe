import { describe, expect, it } from "vitest";
import {
  alignFrames,
  ANCHOR_MODELS,
  anchorModel,
  anchorPrompt,
  CHARACTER_LICENCES,
  CHARACTER_SWAP,
  characterQuality,
  cutsInPart,
  cutWarning,
  falResolution,
  graphLoras,
  h3Canvas,
  h3Windows,
  historyChoicesFor,
  historyFrames,
  MINIMAX_H3_LICENCE,
  packResolution,
  partProblem,
  samCoords,
  seedProblem,
  speechLine,
  swapLoraRef,
  swapPrompt,
  TURBO_LORA,
  anchorAspect,
  CHARACTER_LORAS,
  partWords,
  toH3Canvas,
  whoWords,
  windowFrames,
  windowPlan,
  windowProblem,
} from "@/lib/catalog/character-swap";
import { getModel } from "@/lib/catalog";
import { licenceInfo, licenceTerms, NODE_PACKS } from "@/lib/licences";

// Genjutsu's Character swap (docs/research/openjutsu-6.md): Openjutsu's prompt and limits, H3's windows and canvas,
// who to swap, the anchor frame, and the licences as information.

describe("Character swap: the prompt", () => {
  it("Openjutsu's instruction in H3's tags, the anchor sentence only with an anchor", () => {
    expect(swapPrompt({ engine: "open", anchor: true })).toBe(
      "Replace the selected person in <Video 1> with the character in <Picture 1>. Preserve the source performance, scene and audio timing. Start from the first frame in <Picture 2>.",
    );
    expect(swapPrompt({ engine: "open", anchor: false })).toBe("Replace the selected person in <Video 1> with the character in <Picture 1>. Preserve the source performance, scene and audio timing.");
  });

  it("fal names the inputs Video 1 / Image 1 / Image 2, and says who in words (no mask in the cloud)", () => {
    expect(swapPrompt({ engine: "cloud", anchor: true, who: "leftmost" })).toBe(
      "Replace the person on the left in Video 1 with the character in Image 1. Preserve the source performance, scene and audio timing. Start from the first frame in Image 2.",
    );
    expect(swapPrompt({ engine: "cloud", anchor: false })).toMatch(/^Replace the main person in Video 1/);
    expect(swapPrompt({ engine: "cloud", anchor: false, subject: "man in the red jacket" })).toMatch(/^Replace the man in the red jacket in Video 1/);
  });

  it("description, speaker and direction follow; the direction is trimmed to 500 characters", () => {
    const p = swapPrompt({ engine: "open", anchor: false, description: "a chrome robot with blue eyes.", speech: "character", dialogue: "Hello there", direction: "keep the glasses. " });
    expect(p).toBe(
      'Replace the selected person in <Video 1> with the character in <Picture 1>. Preserve the source performance, scene and audio timing. The character: a chrome robot with blue eyes. The character speaks the clip\'s lines, lips in sync with its audio. The words: "Hello there". Keep the glasses.',
    );
    const long = swapPrompt({ engine: "open", anchor: false, direction: "x".repeat(900) });
    expect(long.length).toBeLessThan(160 + CHARACTER_SWAP.maxDirectionChars);
  });

  it("who speaks, as Akatz Labs' speaker choice", () => {
    expect(speechLine("other")).toMatch(/Someone else speaks/);
    expect(speechLine("offscreen", "Over here!")).toMatch(/off screen.*"Over here!"/);
    expect(speechLine("none")).toBe("Nobody speaks in this part.");
    expect(speechLine(undefined)).toBe("");
  });

  it("who to swap, in words", () => {
    expect(whoWords({})).toBe("the main person");
    expect(whoWords({ who: "rightmost" })).toBe("the person on the right");
    expect(whoWords({ who: "index", index: 1 })).toBe("the second person from the left");
    expect(whoWords({ subject: "person" })).toBe("the main person");
    expect(whoWords({ subject: "a woman in a hat" })).toBe("a woman in a hat");
  });

  it("the anchor's edit: Openjutsu's instruction, or Akatz Labs' brief when the character is described", () => {
    expect(anchorPrompt({})).toMatch(/^Replace the person in image 1 with the character from image 2/);
    const brief = anchorPrompt({ description: "a ronin in black armour", who: "leftmost" });
    expect(brief).toMatch(/^Image 1 is the source frame to edit\. Image 2 is character identity only: a ronin in black armour\. Replace ONLY the person on the left/);
    expect(brief).toMatch(/One full-aspect edited source frame\.$/);
  });

  it("the anchor model per engine: GPT Image 2.5 Sunburst (low) or Nano Banana Pro in the cloud, Qwen-Image 2.1 (or Krea 2 Identity Edit) on your GPU", () => {
    expect(anchorModel("cloud")).toMatchObject({ id: "gpt-image-2-5-sunburst", extra: { quality: "low" } });
    expect(anchorModel("cloud", "nano-banana-pro").id).toBe("nano-banana-pro");
    expect(ANCHOR_MODELS.open.map((m) => m.id)).toEqual(["oss-qwen-image-21", "oss-krea2-identity-edit"]);
    expect(anchorModel("open").id).toBe("oss-qwen-image-21");
    expect(anchorModel("open", "oss-krea2-identity-edit")).toMatchObject({ id: "oss-krea2-identity-edit", label: "Krea 2 Identity Edit" });
    // A Qwen-Image-Edit 2511 pick saved before, or another engine's model, falls back to the engine's own.
    expect(anchorModel("open", "oss-qwen-edit").id).toBe("oss-qwen-image-21");
    expect(anchorModel("open", "nano-banana-pro").id).toBe("oss-qwen-image-21");
    for (const m of ANCHOR_MODELS.open) expect(getModel(m.id)?.engine, m.id).toBe("open");
  });
});

describe("Character swap: limits", () => {
  it("a part of 5–15 s (up to 30 s continued), inside a clip of at least 5 s", () => {
    expect(partProblem({ start: 0, end: 4 })).toMatch(/Pick a part of 5–15 seconds/);
    expect(partProblem({ start: 0, end: 5 })).toBeNull();
    expect(partProblem({ start: 2, end: 17 })).toBeNull();
    expect(partProblem({ start: 0, end: 30 })).toBeNull();
    expect(partProblem({ start: 0, end: 31 })).toMatch(/up to 30 seconds/);
    expect(partProblem({ start: 0, end: 4 }, 4)).toBe("Choose a clip at least 5 seconds long");
    expect(partProblem({ start: 8, end: 14 }, 12)).toBe("The part runs past the end of the clip");
    expect(partProblem({ start: -1, end: 6 })).toBe("Choose where the part starts");
  });

  it("seeds are whole numbers 0 … 2³²−1, blank is random", () => {
    expect(seedProblem(undefined)).toBeNull();
    expect(seedProblem(0)).toBeNull();
    expect(seedProblem(2 ** 32 - 1)).toBeNull();
    expect(seedProblem(2 ** 32)).toMatch(/whole-number seed/);
    expect(seedProblem(1.5)).toMatch(/whole-number seed/);
  });

  it("qualities: 480p stays, the rest is 768p; the unpatched pack takes strings, fal its enum", () => {
    expect(characterQuality("480p")).toBe("480p");
    expect(characterQuality("720p")).toBe("768p");
    expect(characterQuality("1080p")).toBe("768p");
    expect(characterQuality(undefined)).toBe("768p");
    expect(packResolution("480p")).toBe("480");
    expect(packResolution("768p")).toBe("768");
    expect(packResolution("768p", true)).toBe(768);
    expect(falResolution("480p")).toBe("480P");
    expect(falResolution("1080p")).toBe("768P");
  });

  it("H3's windows: the pack's plan_windows (5 s → 1, 7.5 and 10 s → 2, 12.5 and 15 s → 3)", () => {
    expect(alignFrames(120)).toBe(124);
    expect(alignFrames(240)).toBe(243);
    expect(alignFrames(360)).toBe(362);
    expect(h3Windows(5)).toBe(1);
    expect(h3Windows(7.5)).toBe(2);
    expect(h3Windows(10)).toBe(2);
    expect(h3Windows(12.5)).toBe(3);
    expect(h3Windows(15)).toBe(3);
    expect(h3Windows(30)).toBe(6);
    // Later windows start on the last frame made: 247 frames (10.29 s) fit two windows of 124, not three.
    expect(h3Windows(247 / 24)).toBe(2);
    expect(h3Windows(248 / 24)).toBe(3);
    // A longer window means fewer; no history means each later window delivers its whole length.
    expect(h3Windows(15, 362)).toBe(1);
    expect(h3Windows(10.25, 124, 0)).toBe(2);
    // Window sizes are the pack's combo strings (17n+5 and 0, 1, 17n+1).
    expect(windowFrames(124)).toBe("124");
    expect(windowFrames(130)).toBe("124");
    expect(windowFrames(undefined)).toBe("124");
    expect(historyFrames(18)).toBe("18");
    expect(historyFrames(0)).toBe("0");
    expect(historyFrames(40)).toBe("35");
  });

  it("refuses a history as long as the window, as the pack's validate_settings does", () => {
    expect(windowProblem({})).toBeNull();
    expect(windowProblem({ windowFrames: 124, historyFrames: 18 })).toBeNull();
    expect(windowProblem({ windowFrames: 22, historyFrames: 35 })).toBe("History (35 frames) must be shorter than the window (22 frames)");
    expect(windowProblem({ windowFrames: 39, historyFrames: 52 })).toMatch(/must be shorter/);
    expect(historyChoicesFor(22)).toEqual([0, 1, 18]);
    expect(historyChoicesFor(124).at(-1)).toBe(120);
    // The provider's last guard: snapped to the grid, the history comes down below the window.
    expect(windowPlan(22, 35)).toEqual({ window: 22, history: 18 });
    expect(windowPlan(undefined, undefined)).toEqual({ window: 124, history: 18 });
  });

  it("H3's canvas is the pack's canvas_dimensions (0.5 / 1.0 MP budgets on the 32 grid)", () => {
    // Values from the pinned pack's own function (video.py at 0670e4f), run in Python.
    expect(h3Canvas(1920, 1080, "768p")).toEqual({ width: 1344, height: 736 });
    expect(h3Canvas(1080, 1920, "768p")).toEqual({ width: 736, height: 1344 });
    expect(h3Canvas(1024, 1024, "768p")).toEqual({ width: 992, height: 992 });
    expect(h3Canvas(1080, 1080, "768p")).toEqual({ width: 992, height: 992 });
    expect(h3Canvas(1280, 720, "480p")).toEqual({ width: 928, height: 512 });
    expect(h3Canvas(1280, 720, "768p")).toEqual({ width: 1344, height: 736 });
    expect(h3Canvas(720, 1280, "480p")).toEqual({ width: 512, height: 928 });
    // A clip already on the grid and within the budget keeps its size.
    expect(h3Canvas(1024, 576, "768p")).toEqual({ width: 1024, height: 576 });
    expect(h3Canvas(640, 480, "480p")).toEqual({ width: 640, height: 480 });
  });

  it("moves clicks into the prepared frame: scaled to cover, the middle cropped", () => {
    // 1920×1080 at 768: scaled to 1344×756, 10 rows cropped off the top and bottom.
    expect(toH3Canvas({ x: 960, y: 540 }, { width: 1920, height: 1080 }, "768p")).toEqual({ x: 672, y: 368 });
    expect(toH3Canvas({ x: 100, y: 100 }, { width: 1920, height: 1080 }, "768p")).toEqual({ x: 70, y: 60 });
    // A square clip at 768 is 992×992 (not 768×768): a click 80 % across stays 80 % across.
    expect(toH3Canvas({ x: 864, y: 540 }, { width: 1080, height: 1080 }, "768p")).toEqual({ x: 794, y: 496 });
    expect(toH3Canvas({ x: 1024, y: 360 }, { width: 1280, height: 720 }, "480p")).toEqual({ x: 742, y: 256 });
    expect(toH3Canvas({ x: 864, y: 960 }, { width: 1080, height: 1920 }, "768p")).toEqual({ x: 595, y: 672 });
    // In the cropped margin: the nearest edge.
    expect(toH3Canvas({ x: 1079, y: 0 }, { width: 1080, height: 1920 }, "768p")).toEqual({ x: 735, y: 0 });
    const [pos, neg] = samCoords(
      [
        { x: 960, y: 540, label: "positive" },
        { x: 100, y: 100, label: "negative" },
      ],
      { width: 1920, height: 1080 },
      "768p",
    );
    expect(JSON.parse(pos)).toEqual([{ x: 672, y: 368 }]);
    expect(JSON.parse(neg)).toEqual([{ x: 70, y: 60 }]);
    expect(samCoords(undefined, { width: 10, height: 10 }, "768p")).toEqual(["", ""]);
  });

  it("the first frame keeps the part's shape: auto when the model takes it, else the nearest ratio", () => {
    expect(anchorAspect(["auto", "16:9", "1:1"], { width: 1280, height: 720 })).toBe("auto");
    expect(anchorAspect(["1:1", "4:3", "3:4", "16:9", "9:16"], { width: 1280, height: 720 })).toBe("16:9");
    expect(anchorAspect(["1:1", "4:3", "3:4", "16:9", "9:16"], { width: 1080, height: 1920 })).toBe("9:16");
    expect(anchorAspect(["1:1", "4:3", "3:4", "16:9", "9:16"], { width: 1440, height: 1080 })).toBe("4:3");
    expect(anchorAspect(["1:1", "16:9"], {})).toBeUndefined();
    expect(anchorAspect(undefined, { width: 1, height: 1 })).toBeUndefined();
  });

  it("the part's words from a transcription of the whole clip", () => {
    const cues = [
      { start: 0, end: 2, text: "Before the part." },
      { start: 4.5, end: 6, text: "Hello there," },
      { start: 6, end: 8, text: "how are you?" },
      { start: 12, end: 14, text: "After it." },
    ];
    expect(partWords(cues, { start: 5, end: 10 })).toBe("Hello there, how are you?");
    expect(partWords(cues, { start: 2, end: 4 })).toBe("");
    expect(partWords(undefined, { start: 0, end: 5 })).toBe("");
  });

  it("warns about a hard cut inside the part, not at its edges", () => {
    expect(cutsInPart([1, 7.2, 15], { start: 2, end: 12 })).toEqual([7.2]);
    expect(cutsInPart([2.1, 11.9], { start: 2, end: 12 })).toEqual([]);
    expect(cutWarning([7.2])).toBe("Your part has a cut at 7.2 s — the swap breaks at a cut. Move the part, or pick one continuous shot");
    expect(cutWarning([])).toBeNull();
  });
});

describe("Character swap: LoRAs", () => {
  it("the swap LoRA at its pinned revision (V1.5 by default, V1 on request), hostable on fal", () => {
    const v15 = swapLoraRef(undefined);
    expect(v15).toMatchObject({ file: "h3_character_swap_v1.5.safetensors", weightName: "h3_character_swap_v1.5.safetensors", strength: 1, version: "d06323b7c8e70e97cdab48b78a1e05f786c8cba9" });
    expect(v15.url).toBe("https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/resolve/d06323b7c8e70e97cdab48b78a1e05f786c8cba9/h3_character_swap_v1.5.safetensors");
    expect(v15.licence).toMatchObject({ commercial: true, hostedOk: true, name: "MiniMax H3 Community License" });
    expect(swapLoraRef("v1").file).toBe("h3_character_swap_pro4500_1000.safetensors");
  });

  it("the files an open Character swap graph loads itself, downloaded before it runs", () => {
    expect(graphLoras("video-character-swap-h3", {}).map((l) => l.file)).toEqual([TURBO_LORA.file, "h3_character_swap_v1.5.safetensors"]);
    expect(graphLoras("video-character-swap-h3-relay", { lora: "v1" }).map((l) => l.file)).toEqual([TURBO_LORA.file, "h3_character_swap_pro4500_1000.safetensors"]);
    expect(graphLoras("video-character-swap-h3", { lora: "none" }).map((l) => l.file)).toEqual([TURBO_LORA.file]);
    expect(graphLoras("wan-animate2", {})).toEqual([]);
    expect(TURBO_LORA.url).toContain("/resolve/3ec17a324ced54151364f24f8b5fb6bf7e26414f/");
  });
});

describe("Character swap: licences are information", () => {
  it("records the MiniMax H3 Community License with its regions, revenue condition and notice", () => {
    expect(MINIMAX_H3_LICENCE).toMatchObject({ name: "MiniMax H3 Community License", class: "regions", excludes: "the US, the EU, the UK and South Korea", notices: ["MiniMax H3"] });
    expect(MINIMAX_H3_LICENCE.note).toMatch(/US\$20M/);
    expect(MINIMAX_H3_LICENCE.url).toContain("MiniMaxAI/MiniMax-H3");
  });

  it("every part the swap touches has a licence: the SAM License, the GPL-3.0 packs, the Turbo LoRA, MIT workflows, the paid API", () => {
    const by = Object.fromEntries(CHARACTER_LICENCES.map((l) => [l.item.split(" (")[0], l]));
    expect(by["SAM 3.1"]).toMatchObject({ name: "Meta SAM License", class: "conditions" });
    expect(by["FL2V Turbo 8-step LoRA"]).toMatchObject({ name: "Apache-2.0", class: "commercial" });
    expect(by["h3_character_swap node pack"]).toMatchObject({ name: "GPL-3.0" });
    expect(by["H3 Relay 2.0 node pack"]).toMatchObject({ name: "GPL-3.0" });
    expect(CHARACTER_LICENCES.find((l) => l.class === "paid-api")?.item).toMatch(/fal/);
    expect(CHARACTER_LICENCES.every((l) => l.url.startsWith("https://"))).toBe(true);
  });

  it("Settings → Models & licences knows the packs, the LoRAs and the H3 licence by name", () => {
    const packs = NODE_PACKS.filter((p) => p.name === "h3_character_swap" || p.name === "h3-relay");
    expect(packs.map((p) => [p.name, p.licence.name])).toEqual([
      ["h3_character_swap", "GPL-3.0"],
      ["h3-relay", "GPL-3.0"],
    ]);
    expect(packs[0].repo).toContain("/tree/0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b/");
    expect(packs[1].repo).toContain("/tree/e2a7665b6eb8ea37a88c0de2c9c6b69a8f7c9220");
    // The swap LoRA's releases are MiniMax H3 work (restricted regions); Turbo is Apache-2.0.
    expect(CHARACTER_LORAS.map((l) => [l.file, l.licence.class])).toEqual([
      ["h3_character_swap_v1.5.safetensors", "regions"],
      ["h3_character_swap_pro4500_1000.safetensors", "regions"],
      [TURBO_LORA.file, "commercial"],
      ["H3-Person-Remover-V1.safetensors", "regions"],
    ]);
  });

  it("the H3 workflows' licence text reads as the MiniMax H3 Community License, not SAM's", async () => {
    const { default: manifest } = await import("../workflows/comfyui/manifest.json");
    for (const id of ["video-character-swap-h3", "video-character-swap-h3-relay"]) {
      const wf = (manifest as { workflows: { id: string; license?: string }[] }).workflows.find((w) => w.id === id)!;
      expect(licenceInfo(wf.license!)).toMatchObject({ name: "MiniMax H3 Community License", class: "regions", excludes: "the US, the EU, the UK and South Korea", notices: ["MiniMax H3"] });
    }
  });

  it("the manifest's licence text reads as restricted regions with the notice (About & licences)", async () => {
    const { default: manifest } = await import("../workflows/comfyui/manifest.json");
    const wf = (manifest as { workflows: { id: string; license?: string }[] }).workflows.find((w) => w.id === "video-character-swap-h3")!;
    const terms = licenceTerms(wf.license!);
    expect(terms.flags).toContain("territory");
    expect(terms.excludes).toBe("the US, the EU, the UK and South Korea");
    expect(terms.notices).toContain("MiniMax H3");
  });
});
