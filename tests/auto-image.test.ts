import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getModel, MODELS } from "@/lib/catalog";
import { planGeneration, estimateCost } from "@/lib/catalog/plan";
import { getPreset } from "@/lib/catalog";
import {
  AUTO_FALLBACKS,
  AUTO_IMAGE,
  AUTO_MODELS,
  autoCandidates,
  autoLine,
  autoPatterns,
  autoPatternsProblems,
  DEFAULT_AUTO_PATTERNS,
  matchedPattern,
  nextAutoFallback,
} from "@/lib/auto-image";
import { EDIT_STUDIO, IMAGE_STUDIO, INPAINT_STUDIO } from "@/lib/studios";
import { withAutoPattern } from "@/components/add-auto-pattern";
import { MadeNote } from "@/components/studio/made-note";
import type { Generation } from "@/lib/catalog/types";

// Auto: the open image choice that picks the model for each run (src/lib/auto-image.ts). Its rules on their own here; the
// runs it makes and their fallbacks: tests/auto-image-runs.test.ts; an account's runs on this install's GPUs:
// tests/auto-image-pool.test.ts.

const defaults = autoPatterns(DEFAULT_AUTO_PATTERNS.join("\n"));
const pick = (prompt: string, more: { op?: "t2i" | "edit" | "inpaint" | "outpaint"; images?: number } = {}) => autoCandidates({ prompt, ...more }, defaults);

describe("Auto in the catalog", () => {
  it("is an open image choice named Auto, next to the models it picks, which keep their names", () => {
    const m = getModel(AUTO_IMAGE)!;
    expect(m).toMatchObject({ name: "Auto", engine: "open", kind: "image" });
    expect(m.routes.map((r) => r.op)).toEqual(["t2i", "edit"]);
    for (const [id, name] of [
      ["oss-ideogram-4", "Ideogram 4"],
      ["oss-krea2-realism", "Krea 2 Realism"],
      ["oss-fibo2-dev", "FIBO 2 Dev"],
      ["oss-moss-image", "MOSS-Image"],
      ["oss-qwen-image-21", "Qwen-Image 2.1"],
    ])
      expect(getModel(id)?.name).toBe(name);
    // Every model it may pick is in the catalog, as an open image model.
    for (const id of AUTO_MODELS) expect(getModel(id), id).toMatchObject({ engine: "open", kind: "image" });
    expect(MODELS.filter((x) => x.name === "Auto")).toHaveLength(1);
  });

  it("is the Image studio's default on the open engine for everyone; Edit and Inpaint keep Qwen-Image 2.1", () => {
    expect(IMAGE_STUDIO.defaultModels.open).toBe(AUTO_IMAGE);
    expect(IMAGE_STUDIO.uncaptioned).toBeUndefined();
    expect(EDIT_STUDIO.defaultModels.open).toBe("oss-qwen-image-21");
    expect(INPAINT_STUDIO.defaultModels.open).toBe("oss-qwen-image-21");
  });

  it("plans and prices in the composer like the models it picks: free on a GPU", () => {
    const plan = planGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: "a koi pond at night" }, getModel, getPreset);
    expect(plan.op).toBe("t2i");
    expect(estimateCost(plan.model, plan.params, plan.jobs, plan.op)).toBe(0);
    const edit = planGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: "make it dusk", inputs: { images: ["/a.png"] } }, getModel, getPreset);
    expect(edit.op).toBe("edit");
  });
});

describe("what Auto picks", () => {
  it("a picture to work from: the studio's edit model for its operation, never Ideogram 4", () => {
    expect(pick("make it golden hour", { images: 1 })).toMatchObject({ models: ["oss-qwen-image-21", "oss-fibo2-dev"], why: "edit" });
    expect(pick("make it golden hour", { op: "edit", images: 2 }).models[0]).toBe(EDIT_STUDIO.defaultModels.open);
    expect(pick("a vase of tulips", { op: "inpaint", images: 1 }).models[0]).toBe(INPAINT_STUDIO.defaultModels.open);
    // Even a poster edit, or a prompt the patterns match.
    for (const words of ["put the logo on the poster", "a cat in a gown"]) expect(pick(words, { images: 1 }).models).not.toContain("oss-ideogram-4");
  });

  it("lettering, posters, logos, signs and words in quotes: Ideogram 4", () => {
    for (const words of [
      "a film poster for a heist movie",
      "a minimal logo for a coffee roaster",
      "bold typography that says SUMMER",
      "a neon sign above a bar",
      "hand lettering on a chalkboard menu",
      "a storefront with “OPEN LATE” painted on the glass",
      // Lettering wins over a pattern.
      "a poster of a model in a bikini",
    ])
      expect(pick(words), words).toMatchObject({ models: ["oss-ideogram-4", ...AUTO_FALLBACKS], why: "text" });
  });

  it("prompts Ideogram 4's filter often declines: Krea 2 Realism, then FIBO 2 Dev and MOSS-Image, Ideogram 4 last", () => {
    for (const words of [
      "a cat in an antique-gold paillette gown, studio light, her hair lifting in the wind",
      "a fox wearing a tailored velvet suit at a gala",
      "an elegant evening gown worn by a white rabbit",
      "a bear on the red carpet, her hair in curls",
      "editorial photo of a model in swimwear on a yacht",
      "a sheer silk blouse, studio portrait",
      "SEE THROUGH raincoat over a bodysuit",
      "a nude-tone slip dress",
      "a nude tone slip dress",
    ])
      expect(pick(words), words).toMatchObject({ models: [...AUTO_FALLBACKS, "oss-ideogram-4"], why: "trigger" });
    expect(pick("a cat in an antique-gold paillette gown").pattern).toMatch(/gowns/);
  });

  it("everything else: Ideogram 4 first", () => {
    for (const words of ["a koi pond at night, neon rain", "a cat asleep on a windowsill", "a dog running on a beach", "a woman in a red evening gown on a staircase", "sheerness of the cliffs", "a swimmer at dawn"])
      expect(pick(words), words).toMatchObject({ models: ["oss-ideogram-4", ...AUTO_FALLBACKS], why: "plain" });
  });

  it("after Ideogram 4 declines: Krea 2 Realism, FIBO 2 Dev, MOSS-Image, then none", () => {
    expect(AUTO_FALLBACKS).toEqual(["oss-krea2-realism", "oss-fibo2-dev", "oss-moss-image"]);
    expect(nextAutoFallback(undefined)).toBe("oss-krea2-realism");
    expect(nextAutoFallback("oss-krea2-realism")).toBe("oss-fibo2-dev");
    expect(nextAutoFallback("oss-fibo2-dev")).toBe("oss-moss-image");
    expect(nextAutoFallback("oss-moss-image")).toBeUndefined();
  });
});

describe("the owner's patterns (Settings → Auto image model)", () => {
  it("the built-in list reads, and its notes are no patterns", () => {
    expect(autoPatternsProblems(DEFAULT_AUTO_PATTERNS.join("\n"))).toEqual([]);
    expect(defaults.length).toBe(DEFAULT_AUTO_PATTERNS.filter((l) => !l.startsWith("#")).length);
  });

  it("a word or phrase matches as a whole word, in any case; any other line is a regular expression", () => {
    const p = autoPatterns("paillette\nvelvet cape\n\\bglitter(ed)?\\b\n# a note");
    expect(p.map((x) => x.line)).toEqual(["paillette", "velvet cape", "\\bglitter(ed)?\\b"]);
    expect(matchedPattern("A PAILLETTE dress", p)).toBe("paillette");
    expect(matchedPattern("paillettes everywhere", p)).toBeUndefined();
    expect(matchedPattern("a velvet-cape", p)).toBe("velvet cape");
    expect(matchedPattern("glittered heels", p)).toBe("\\bglitter(ed)?\\b");
    // A word or phrase is never read as a pattern: no characters of its own mean anything.
    expect(matchedPattern("a  cat", autoPatterns("a cat"))).toBe("a cat");
  });

  it("refuses a line that can't be read, matches every prompt, or is too long; and too many lines", () => {
    expect(autoPatternsProblems("bikini\n(unclosed")).toEqual([expect.stringMatching(/^Line 2 isn't a pattern/)]);
    expect(autoPatternsProblems(".*")[0]).toMatch(/matches every prompt/);
    expect(autoPatternsProblems("x?")[0]).toMatch(/matches every prompt/);
    expect(autoPatternsProblems("a".repeat(301))[0]).toMatch(/over 300 characters/);
    expect(autoPatternsProblems(Array.from({ length: 201 }, (_, i) => `w${i}`).join("\n"))[0]).toMatch(/200 lines/);
    expect(autoPatternsProblems("")).toEqual([]);
  });

  it("Add a pattern puts one line after the list, once, and refuses one that can't be read", () => {
    expect(withAutoPattern("bikini\nsheer", "paillette")).toBe("bikini\nsheer\npaillette");
    expect(withAutoPattern("bikini\n", "paillette")).toBe("bikini\npaillette");
    expect(withAutoPattern("bikini\nsheer", " sheer ")).toBeNull();
    expect(() => withAutoPattern("bikini", "(")).toThrow(/isn't a pattern/);
    expect(() => withAutoPattern("bikini", "  ")).toThrow(/Type a word/);
  });
});

describe("the line under a run of Auto", () => {
  const run = (o: Partial<Generation> & { auto?: Generation["request"]["auto"]; requestModel?: string }): Generation =>
    ({
      id: "g",
      status: "succeeded",
      modelId: "oss-ideogram-4",
      modelName: "Ideogram 4",
      made: undefined,
      ...o,
      request: { feature: "image", modelId: o.requestModel ?? AUTO_IMAGE, prompt: "a cat in a gown", ...(o.auto && { auto: o.auto }) },
    }) as unknown as Generation;

  it("says what made it, and that Ideogram 4 declined when another model made it", () => {
    expect(autoLine(run({ auto: { model: "oss-ideogram-4", why: "plain" } }))).toBe("Auto · made with Ideogram 4");
    expect(autoLine(run({ modelId: "oss-krea2-realism", modelName: "Krea 2 Realism", auto: { model: "oss-krea2-realism", why: "declined" } }))).toBe(
      "Auto · made with Krea 2 Realism · Ideogram 4 declined this one",
    );
    expect(autoLine(run({ status: "running", auto: { model: "oss-ideogram-4", why: "plain" } }))).toBe("Auto · making it with Ideogram 4");
    expect(autoLine(run({ status: "failed", auto: { model: "oss-ideogram-4", why: "plain" } }))).toBe("Auto · tried Ideogram 4");
    // A model picked by name says nothing of Auto.
    expect(autoLine(run({ requestModel: "oss-ideogram-4" }))).toBeNull();
  });

  it("shows on the feed card and the run details; the owner's review line only with the cards", () => {
    const g = run({ modelId: "oss-krea2-realism", modelName: "Krea 2 Realism", auto: { model: "oss-krea2-realism", why: "declined" } });
    const theirs = renderToStaticMarkup(MadeNote({ g })!);
    expect(theirs).toContain("Auto · made with Krea 2 Realism · Ideogram 4 declined this one");
    expect(theirs).not.toContain("Add a pattern");
    expect(theirs).not.toContain("Words:");
    const owners = renderToStaticMarkup(MadeNote({ g: { ...g, declinedCards: [{ url: "/api/files/card.png", spread: 9, grey: 0.9 }] } })!);
    expect(owners).toContain("Ideogram 4 declined: what it returned");
    expect(owners).toContain("Words: “a cat in a gown”");
    expect(owners).toContain("Add a pattern");
  });
});
