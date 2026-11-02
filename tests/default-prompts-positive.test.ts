import { describe, expect, it } from "vitest";
import { COVER_PROMPT } from "@/components/moodboards/logic";
import { getPreset } from "@/lib/catalog";
import { anchorPrompt } from "@/lib/catalog/character-swap";
import { relightWords } from "@/lib/catalog/dop";
import { customPack, getPack, SHEET_PROMPT, shotPrompt } from "@/lib/catalog/packs";
import { SHEET_FRONT_PROMPT } from "@/lib/catalog/turnaround";
import type { Preset } from "@/lib/catalog/types";
import { ENHANCE_LOOKS, enhancePrompt, RELIGHT_DIRECTIONS, RELIGHT_LIGHTS, relightPrompt } from "@/lib/layers";
import { LOOKS, lightsOfLook, relightPrompt as lightsPrompt } from "@/lib/relight/lights";

// Default prompts name only what is wanted: an unwanted thing, even negated ("no text", "without a cut"), tends to
// show up in the picture or the clip.
const NEGATION = /\b(no|not|never|nothing|none|without|don't|do not|doesn't|avoid)\b/i;

/** A preset's words with every choice of every option filled in. */
function everyWording(p: Preset): string[] {
  const base = p.promptTemplate.replace(/\{prompt\}/g, "");
  const options = p.options ?? [];
  if (!options.length) return [base];
  return options.flatMap((o) => o.choices.map((c) => base.replace(`{option:${o.key}}`, c.prompt)));
}

describe("default prompts name only what is wanted", () => {
  it("the apps' rewritten prompts: Expand Image, Outfit Swap, Hook Frame, Transitions, Skin Enhancer", () => {
    for (const id of ["app-expand-image", "app-outfit-swap", "app-hook-frame", "app-transitions", "app-skin-enhancer"]) {
      const p = getPreset(id);
      expect(p, id).toBeDefined();
      for (const words of everyWording(p!)) expect(words, id).not.toMatch(NEGATION);
    }
    expect(getPreset("app-transitions")!.promptTemplate).toMatch(/One continuous shot/);
    expect(getPreset("app-expand-image")!.promptTemplate).toMatch(/fill the new area with more of the same surroundings/);
    expect(getPreset("app-outfit-swap")!.promptTemplate).toMatch(/only the clothing comes from the second image/);
  });

  it("the motions and effects: Pedestal Down, Skate Cruise, One Take, Explosion", () => {
    for (const id of ["motion-pedestal-down", "motion-skate-cruise", "motion-one-take", "effect-explosion"]) {
      const p = getPreset(id);
      expect(p, id).toBeDefined();
      expect(p!.promptTemplate, id).not.toMatch(NEGATION);
    }
    expect(getPreset("motion-one-take")!.promptTemplate).toMatch(/one unbroken take/);
  });

  it("the Character Sheet, Turnaround's front view and Character Swap's anchor frame", () => {
    expect(SHEET_PROMPT).not.toMatch(NEGATION);
    expect(SHEET_FRONT_PROMPT).not.toMatch(NEGATION);
    expect(anchorPrompt({})).not.toMatch(NEGATION);
    expect(anchorPrompt({ description: "a ronin in black armour", who: "leftmost" })).not.toMatch(NEGATION);
    expect(anchorPrompt({})).toMatch(/every garment they wear comes from image 2/);
  });

  it("Photodump's photo words, a moodboard's cover and the Layers retouch and relight words", () => {
    const selfie = { kind: "selfie" as const, url: "/api/files/uploads/me.png" };
    const pack = getPack("winter-special")!;
    expect(shotPrompt(pack, pack.shots[0], selfie)).not.toMatch(NEGATION);
    const mine = customPack({ id: "user-1", name: "Mine", refs: ["/api/files/uploads/a.png"] });
    expect(shotPrompt(mine, mine.shots[0], selfie, 2)).not.toMatch(NEGATION);
    expect(COVER_PROMPT("Neon Haze")).not.toMatch(NEGATION);
    for (const look of ENHANCE_LOOKS) expect(enhancePrompt(look.id) ?? "", look.id).not.toMatch(NEGATION);
    for (const [, light] of RELIGHT_LIGHTS) {
      for (const [, direction] of RELIGHT_DIRECTIONS) {
        for (const model of ["oss-qwen-image-21-turbo", "oss-krea2-edit", "oss-qwen-relight"]) expect(relightPrompt(model, light, direction)).not.toMatch(NEGATION);
      }
    }
  });

  it("Fuobe DoP's relight effects: Qwen-Image 2.1 Turbo's start-frame words", () => {
    for (const id of ["effect-silhouette", "effect-practicals", "effect-window", "effect-overhead-fall", "effect-contre-jour", "effect-soft-cross"]) {
      const step = getPreset(id)!.prestep!.open;
      expect(step.prompt, id).not.toMatch(NEGATION);
      expect(step.prompt, id).toMatch(/^Relight <image1>: /);
    }
    expect(relightWords("soft natural window light")).toBe(
      "Relight <image1>: soft natural window light. Keep every person, face, pose, object, the setting and the framing exactly as in <image1>, same film grain.",
    );
  });

  it("the Relight tool's words, written from the placed lights (every look)", () => {
    for (const look of LOOKS) {
      expect(lightsPrompt(lightsOfLook(look)), look.id).not.toMatch(NEGATION);
      expect(lightsPrompt(lightsOfLook(look), "shared"), look.id).not.toMatch(NEGATION);
    }
    expect(lightsPrompt(lightsOfLook(LOOKS[0]))).toMatch(/The scene is in darkness, lit only by these lights/);
  });
});
