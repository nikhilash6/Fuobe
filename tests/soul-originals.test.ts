import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loraEntry } from "@/lib/catalog/loras";
import {
  characterScale,
  composeSoulPrompt,
  promptWithLoras,
  soulLook,
  soulMegapixels,
  soulPostSteps,
  soulRecipe,
  soulSize,
  SOUL_ASPECTS,
} from "@/lib/catalog/soul";
import { SOUL_CINEMA, SOUL_CORE_LORAS, SOUL_ORIGINALS, SOUL_SAMPLER, SOUL_SIZES, SOUL_TAILS } from "@/lib/catalog/soul-originals.generated";
import { applyPreset, FRAGMENT, isNeutral, NEUTRAL, PRESETS, uniforms } from "@/lib/grade";
import { finishSteps, outputsToFinish, overlayLayout } from "@/lib/soul-post";
import { lookCard, lookSet, SOUL_LOOK_CARDS } from "@/lib/catalog/soul-cards";

const ROOT = path.resolve(__dirname, "..");
const research = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/research/fuobe-originals-recipes-5.json"), "utf8"));
const looks = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/research/parity-image-studios.json"), "utf8"));
/** The evaluation harness's slug (scripts/eval/lib/recipes.mjs): the Original's look ids must match it. */
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

describe("Soul looks (soul-originals.generated.ts)", () => {
  it("has the 139 looks, 106 Soul v1 and 33 Soul 2.0, with the harness's ids", () => {
    expect(SOUL_ORIGINALS).toHaveLength(139);
    expect(SOUL_ORIGINALS.filter((l) => l.family === "v1")).toHaveLength(106);
    expect(SOUL_ORIGINALS.filter((l) => l.family === "v2")).toHaveLength(33);
    const ids = SOUL_ORIGINALS.map((l) => l.id);
    expect(new Set(ids).size).toBe(139);
    for (const p of looks.soulPresets) {
      const id = `${p.model === "soul-v2" ? "v2" : "v1"}-${slug(p.name)}`;
      expect(soulLook(id)?.legacyStyleId, p.name).toBe(p.id);
    }
  });

  it("leaves the research's notes in the research: the looks are bundled into the site's browser code", () => {
    // The research does have notes on its looks, so this checks something.
    expect(research.presets.some((p: { notes?: string }) => p.notes)).toBe(true);
    for (const l of SOUL_ORIGINALS) {
      expect(Object.keys(l), l.id).not.toContain("note");
      expect(Object.keys(l), l.id).not.toContain("notes");
    }
    expect(fs.readFileSync(path.join(ROOT, "src/lib/catalog/soul-originals.generated.ts"), "utf8")).not.toMatch(/"notes?":/);
  });

  it("gives every look at most 3 LoRAs, each in the library with its licence recorded (information, not a rule)", () => {
    for (const l of SOUL_ORIGINALS) {
      expect(l.loras.length, l.id).toBeLessThanOrEqual(3);
      for (const x of l.loras) {
        const e = loraEntry(x.key);
        expect(e, `${l.id}: ${x.key}`).toBeDefined();
        expect(e!.licence.name, `${l.id}: ${x.key}`).toBeTruthy();
        expect(typeof e!.licence.commercial, `${l.id}: ${x.key}`).toBe("boolean");
        expect(x.strength).toBeGreaterThan(0);
      }
    }
    expect(SOUL_ORIGINALS.filter((l) => l.loras.length).length).toBe(136);
  });

  it("keeps the research's words, triggers, grades and overlays (and no description copied from the parity research)", () => {
    for (const p of research.presets) {
      const l = soulLook(p.id)!;
      expect(l, p.name).toBeDefined();
      const triggers = soulRecipe(l.base === "qwen-2512" ? "hd" : "soul", "{prompt}", { look: l.id }).prompt;
      // The research template with the triggers in front: "{triggers}, {prompt}. look. tail".
      expect(triggers).toBe(p.triggers ? `${p.triggers}, ${p.template}` : p.template);
      expect(l.grade ?? null).toBe(p.grade ?? null);
      expect(l.overlay ?? null).toBe(p.overlay ?? null);
      const hf = looks.soulPresets.find((x: { id: string }) => x.id === p.id).description;
      expect(l.look).not.toBe(hf);
    }
    const grades = new Set(PRESETS.map((g) => g.id));
    for (const l of SOUL_ORIGINALS) if (l.grade) expect(grades.has(l.grade), l.id).toBe(true);
    expect(soulLook("v1-invertethereal")?.grade).toBe("invert");
    expect(soulLook("v2-surreal-solarization")?.grade).toBe("solarize");
    expect(soulLook("v1-digitalcam")?.overlay).toBe("date-stamp");
    expect(soulLook("v1-digitalcam")?.look).not.toMatch(/date stamp/);
  });

  it("finds a look by Fuobe id, legacy style id or name", () => {
    expect(soulLook("v1-general")?.name).toBe("General");
    expect(soulLook("464ea177-8d40-4940-8d9d-b438bab269c7")?.id).toBe("v1-general");
    expect(soulLook("General")?.id).toBe("v1-general");
    expect(soulLook("nope")).toBeUndefined();
    const { items, categories } = lookSet("v1");
    expect(items).toHaveLength(106);
    expect(categories[0]).toBe("New");
    expect(lookCard("v1-y2k")!.civitai).toBe(true);
    expect(lookCard("v1-general")!.civitai).toBe(false);
    // The browser's cards: the legacy style id still finds its look; the words are Fuobe's.
    expect(lookCard("464ea177-8d40-4940-8d9d-b438bab269c7")?.id).toBe("v1-general");
    expect(lookCard("v1-general")?.description).toBe(soulLook("v1-general")!.look);
    expect(lookCard("v1-graffiti")?.hd).toBe(true);
    expect(SOUL_LOOK_CARDS.map((c) => c.id)).toEqual(SOUL_ORIGINALS.map((l) => l.id));
  });

  it("lays out sizes on a 16-pixel grid, the longest side at most 2048, for 7 aspect ratios in two tiers", () => {
    expect(SOUL_ASPECTS).toEqual(["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"]);
    for (const tier of Object.values(SOUL_SIZES))
      for (const [w, h] of Object.values(tier)) {
        expect(w % 16).toBe(0);
        expect(h % 16).toBe(0);
        expect(Math.max(w, h)).toBeLessThanOrEqual(2048);
      }
    expect(soulSize("16:9", "1080p")).toEqual({ width: 1920, height: 1088 });
    expect(soulSize("9:16", "720p")).toEqual({ width: 768, height: 1344 });
    expect(soulSize(undefined, undefined)).toEqual({ width: 896, height: 1152 });
    // fal bills a 1024x1024 image as one megapixel (1024 × 1024 pixels).
    expect(soulMegapixels("1:1", "720p")).toBe(1);
    expect(SOUL_SAMPLER).toEqual({ steps: 8, cfg: 1, sampler: "res_multistep", scheduler: "simple", shift: 3 });
  });
});

describe("Soul recipe (soul.ts)", () => {
  it("puts the triggers in front, the user's words, the look and the tail", () => {
    const r = soulRecipe("soul", "a woman in a silver slip dress leaving a club at 2am", { look: "v1-indie-sleaze" });
    expect(r.prompt).toMatch(/^hardflashy, emoessence, a woman in a silver slip dress leaving a club at 2am\. /);
    expect(r.prompt.endsWith(SOUL_TAILS.flash)).toBe(true);
    expect(composeSoulPrompt("a cat.", "Pop art", "art")).toBe("a cat. Pop art.");
    // A reused prompt that already carries the look isn't given it twice.
    expect(composeSoulPrompt("a cat. Pop art", "Pop art", "art")).toBe("a cat. Pop art.");
  });

  it("uses Soul's default look when none is picked", () => {
    const r = soulRecipe("soul", "a portrait");
    expect(r.look?.id).toBe("v1-general");
    expect(r.loras.map((l) => l.file)).toEqual(["AWPortrait-Z.safetensors", "lenovo_z.safetensors"]);
    expect(r.grade).toBe("natural");
  });

  it("orders slots: the user's character first, the look's own LoRAs, the core last", () => {
    const character = { file: "me.safetensors", url: "https://fal.media/me.safetensors", strength: 1 };
    const r = soulRecipe("soul", "x", { look: "v1-tokyo-streetstyle", userLoras: [character], characterStrength: 0.5 });
    expect(r.loras.map((l) => l.file)).toEqual(["me.safetensors", loraEntry("fe85")!.file, loraEntry("awportrait")!.file]);
    expect(r.loras[0].strength).toBe(0.8);
    expect(characterScale(0)).toBe(0.6);
    expect(characterScale(1)).toBe(1);
    for (const k of SOUL_CORE_LORAS) expect(loraEntry(k)).toBeDefined();
  });

  it("scales the look's LoRAs by the preset strength and drops them at 0", () => {
    const r = soulRecipe("soul", "x", { look: "v1-y2k", strength: 0.5 });
    expect(r.loras.map((l) => l.strength)).toEqual([0.45, 0.175]);
    const none = soulRecipe("soul", "x", { look: "v1-y2k", strength: 0 });
    expect(none.loras).toEqual([]);
    expect(none.prompt.startsWith("x. ")).toBe(true);
  });

  it("keeps a look made for another base as words only", () => {
    const g = soulRecipe("soul", "a wall", { look: "v1-graffiti" });
    expect(g.loras).toEqual([]);
    expect(g.notes.join(" ")).toMatch(/Fuobe Soul HD/);
    const onHd = soulRecipe("hd", "a wall", { look: "v1-y2k" });
    expect(onHd.loras).toEqual([]);
    expect(onHd.notes.join(" ")).toMatch(/words only/);
  });

  it("gives Soul Cinema its fixed film look: film still + movie wide, the cine tail, a teal-orange grade", () => {
    const r = soulRecipe("cinema", "a detective in the rain");
    expect(r.loras.map((l) => [l.file, l.strength])).toEqual(SOUL_CINEMA.loras.map((x) => [loraEntry(x.key)!.file, x.strength]));
    expect(r.prompt.endsWith(SOUL_TAILS.cine)).toBe(true);
    expect(r.grade).toBe("teal-orange");
    expect(soulRecipe("cinema", "x", { look: "v1-y2k" }).notes[0]).toMatch(/one film look/);
  });

  it("takes a left-out LoRA's trigger off the front", () => {
    const r = soulRecipe("soul", "x", { look: "v1-indie-sleaze" });
    const triggers = ["hardflashy", "emoessence"];
    const kept = r.loras.filter((l) => l.trigger !== "hardflashy");
    expect(promptWithLoras(r.prompt, triggers, kept).startsWith("emoessence, x. ")).toBe(true);
    expect(promptWithLoras(r.prompt, triggers, []).startsWith("x. ")).toBe(true);
    expect(promptWithLoras(r.prompt, triggers, r.loras)).toBe(r.prompt);
    expect(promptWithLoras("plain", triggers, [])).toBe("plain");
    // A trigger with commas of its own (Realistic Snapshot's) comes off whole.
    const phone = soulRecipe("soul", "x", { look: "v1-iphone" });
    expect(promptWithLoras(phone.prompt, ["amateur digital snapshot, candid, smartphone capture"], []).startsWith("x. ")).toBe(true);
  });

  it("says what happens after generation: the grade and the overlay", () => {
    expect(soulPostSteps("fuobe-soul", "v1-digitalcam")).toEqual({ look: "v1-digitalcam", overlay: "date-stamp" });
    expect(soulPostSteps("fuobe-soul", undefined)).toEqual({ look: "v1-general", grade: "natural" });
    expect(soulPostSteps("fuobe-soul-cinema", null)).toEqual({ grade: "teal-orange" });
    expect(soulPostSteps("nano-banana-pro", "v1-general")).toBeUndefined();
  });
});

describe("gen-soul-originals.py", () => {
  it("writes what is committed (the generated files match the research)", () => {
    const files = ["src/lib/catalog/soul-originals.generated.ts", "src/lib/catalog/soul-looks.generated.ts"].map((f) => path.join(ROOT, f));
    const before = files.map((f) => fs.readFileSync(f, "utf8"));
    execFileSync("python3", ["scripts/gen-soul-originals.py"], { cwd: ROOT });
    expect(files.map((f) => fs.readFileSync(f, "utf8"))).toEqual(before);
  });
});

describe("Soul post steps (soul-post.ts)", () => {
  it("finds the outputs that still need a grade or an overlay", () => {
    const g = {
      status: "succeeded" as const,
      provider: "comfyui" as const,
      outputs: [
        { url: "/a.png", kind: "image" as const, meta: { grade: "portra" } },
        { url: "/b.png", kind: "image" as const, meta: { grade: "portra", finished: true } },
        { url: "/c.png", kind: "image" as const },
        { url: "/d.mp4", kind: "video" as const, meta: { grade: "portra" } },
        { url: "/e.png", kind: "image" as const, meta: { overlay: "cctv" } },
      ],
    };
    expect(outputsToFinish(g)).toEqual([0, 4]);
    expect(finishSteps(g.outputs[4])).toEqual({ overlay: "cctv" });
    expect(outputsToFinish({ ...g, status: "running" as const })).toEqual([]);
  });

  it("lays out the overlays: an LCD date stamp, a CCTV caption, a photo-booth print", () => {
    const when = new Date(2026, 9, 25, 22, 14, 7);
    const stamp = overlayLayout("date-stamp", 1000, 800, when);
    expect(stamp.texts[0]).toMatchObject({ text: "’26 10 25", align: "right", baseline: "bottom" });
    expect(stamp.texts[0].x).toBeLessThan(1000);
    const cctv = overlayLayout("cctv", 1344, 768, when);
    expect(cctv.texts.map((t) => t.text)).toEqual(["CAM 03", "2026-10-25  22:14:07", "● REC"]);
    const booth = overlayLayout("photo-booth", 896, 1152, when);
    expect(booth.width).toBeGreaterThan(896);
    expect(booth.height - 1152 - booth.photo.y).toBeGreaterThan(booth.photo.y);
    expect(booth.paper).toBeTruthy();
  });

  it("has the invert and solarize curves as grade presets with their sliders", () => {
    expect(PRESETS.find((p) => p.id === "invert")?.grade.invert).toBe(100);
    expect(PRESETS.find((p) => p.id === "solarize")?.grade.solarize).toBe(100);
    expect(uniforms(applyPreset(PRESETS.find((p) => p.id === "invert")!))).toMatchObject({ u_invert: 1, u_solarize: 0 });
    expect(isNeutral(NEUTRAL)).toBe(true);
    expect(FRAGMENT).toMatch(/u_invert/);
    expect(FRAGMENT).toMatch(/u_solarize/);
  });
});
