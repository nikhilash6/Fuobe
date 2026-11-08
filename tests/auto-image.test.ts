import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getModel, MODELS } from "@/lib/catalog";
import { planGeneration, estimateCost } from "@/lib/catalog/plan";
import { getPreset } from "@/lib/catalog";
import {
  AUTO_IMAGE,
  AUTO_MODELS,
  AUTO_T2I_MODELS,
  autoCandidates,
  autoLine,
  autoModelsFor,
  autoNext,
  autoPatterns,
  autoPatternsProblems,
  DECLINED_FALLBACKS,
  DEFAULT_AUTO_PATTERNS,
  matchedPattern,
  nextDeclinedFallback,
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
const KREA_FIRST = ["oss-krea2-realism", "oss-moss-image"];
const MOSS_FIRST = ["oss-moss-image", "oss-krea2-realism"];

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
    // Its text-to-image route is Krea 2 Realism's (the GPU pre-flight reads it), and it says what it picks.
    expect(m.routes.find((r) => r.op === "t2i")?.endpoint).toBe(getModel("oss-krea2-realism")!.routes[0].endpoint);
    expect(m.tagline).toMatch(/Krea 2 Realism/);
    expect(m.tagline).toMatch(/MOSS-Image/);
    expect(m.tagline).not.toMatch(/Ideogram|FIBO/);
  });

  it("never plans a picture from words on Ideogram 4 or FIBO 2 Dev; both stay in the catalog to pick by hand", () => {
    expect(AUTO_T2I_MODELS).toEqual(KREA_FIRST);
    expect(autoModelsFor("t2i")).toEqual(KREA_FIRST);
    for (const id of ["oss-ideogram-4", "oss-fibo2-dev"]) {
      expect(autoModelsFor("t2i")).not.toContain(id);
      expect(getModel(id)).toMatchObject({ engine: "open", kind: "image" });
    }
    expect(AUTO_MODELS.has("oss-ideogram-4")).toBe(false);
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

  it("lettering, posters, logos, signs and words in quotes: MOSS-Image, then Krea 2 Realism", () => {
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
      expect(pick(words), words).toEqual({ models: MOSS_FIRST, why: "text" });
  });

  it("a prompt the setting's patterns match: Krea 2 Realism, then MOSS-Image, naming the line", () => {
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
      expect(pick(words), words).toMatchObject({ models: KREA_FIRST, why: "trigger" });
    expect(pick("a cat in an antique-gold paillette gown").pattern).toMatch(/gowns/);
  });

  it("everything else: Krea 2 Realism, then MOSS-Image", () => {
    for (const words of ["a koi pond at night, neon rain", "a cat asleep on a windowsill", "a dog running on a beach", "a woman in a red evening gown on a staircase", "sheerness of the cliffs", "a swimmer at dawn"])
      expect(pick(words), words).toEqual({ models: KREA_FIRST, why: "plain" });
  });

  it("lettering a prompt only rules out doesn't count as asking for it", () => {
    for (const words of [
      "editorial portrait of a model in a camel coat, sharp focus, no text, no watermark.",
      "a beach at dawn without any text or logos",
      "studio photo, no visible text, no captions, no watermarks",
      "a clean product shot, text-free, logo-free",
      "a misty forest, avoid text and labels",
    ])
      expect(pick(words), words).toEqual({ models: KREA_FIRST, why: "plain" });
    // A prompt that rules some lettering out and asks for other lettering still asks for it.
    for (const words of ['a poster that says "OPEN", no watermark', "a neon sign above a bar, no logos", "no text on the shirt, a logo on the cap"])
      expect(pick(words), words).toMatchObject({ why: "text" });
  });

  it("whatever the words, Ideogram 4 and FIBO 2 Dev are never among the picks for a picture from words", () => {
    for (const words of ["a koi pond at night", 'a poster that says "OPEN"', "a cat in an antique-gold paillette gown", "a neon sign above a bar", ""]) {
      const c = pick(words);
      expect(c.models, words).not.toContain("oss-ideogram-4");
      expect(c.models, words).not.toContain("oss-fibo2-dev");
      expect([...c.models].sort(), words).toEqual([...KREA_FIRST].sort());
    }
  });

  it("the next model after one fails: the other of the two, each at most once, then none", () => {
    expect(autoNext(KREA_FIRST, ["oss-krea2-realism"])).toEqual(["oss-moss-image"]);
    expect(autoNext(MOSS_FIRST, ["oss-moss-image"])).toEqual(["oss-krea2-realism"]);
    expect(autoNext(KREA_FIRST, ["oss-krea2-realism", "oss-moss-image"])).toEqual([]);
    // An older run that started on Ideogram 4: both are left, in order.
    expect(autoNext(KREA_FIRST, ["oss-ideogram-4"])).toEqual(KREA_FIRST);
  });

  it("Ideogram 4 picked by name, after it declines: Krea 2 Realism, FIBO 2 Dev, MOSS-Image, then none", () => {
    expect(DECLINED_FALLBACKS).toEqual(["oss-krea2-realism", "oss-fibo2-dev", "oss-moss-image"]);
    expect(nextDeclinedFallback(undefined)).toBe("oss-krea2-realism");
    expect(nextDeclinedFallback("oss-krea2-realism")).toBe("oss-fibo2-dev");
    expect(nextDeclinedFallback("oss-fibo2-dev")).toBe("oss-moss-image");
    expect(nextDeclinedFallback("oss-moss-image")).toBeUndefined();
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
      modelId: "oss-krea2-realism",
      modelName: "Krea 2 Realism",
      made: undefined,
      ...o,
      request: { feature: "image", modelId: o.requestModel ?? AUTO_IMAGE, prompt: "a cat in a gown", ...(o.auto && { auto: o.auto }) },
    }) as unknown as Generation;

  it("says what made it, and that it was Auto's next model when the one before couldn't make it", () => {
    expect(autoLine(run({ auto: { model: "oss-krea2-realism", why: "plain" } }))).toBe("Auto · made with Krea 2 Realism");
    expect(autoLine(run({ modelId: "oss-moss-image", modelName: "MOSS-Image", auto: { model: "oss-moss-image", why: "fallback" } }))).toBe(
      "Auto · made with MOSS-Image · Auto's next model",
    );
    // An older run Ideogram 4 declined reads the same, naming no model that declined.
    expect(autoLine(run({ auto: { model: "oss-krea2-realism", why: "declined" } }))).toBe("Auto · made with Krea 2 Realism · Auto's next model");
    expect(autoLine(run({ status: "running", auto: { model: "oss-krea2-realism", why: "plain" } }))).toBe("Auto · making it with Krea 2 Realism");
    expect(autoLine(run({ status: "failed", auto: { model: "oss-krea2-realism", why: "plain" } }))).toBe("Auto · tried Krea 2 Realism");
    for (const why of ["plain", "text", "trigger", "fallback", "declined"] as const) expect(autoLine(run({ auto: { model: "oss-krea2-realism", why } }))).not.toMatch(/declined|Ideogram/);
    // A model picked by name says nothing of Auto.
    expect(autoLine(run({ requestModel: "oss-ideogram-4" }))).toBeNull();
  });

  it("shows on the feed card and the run details; the owner's review line only with the cards", () => {
    const g = run({ modelId: "oss-krea2-realism", modelName: "Krea 2 Realism", auto: { model: "oss-krea2-realism", why: "declined" } });
    const theirs = renderToStaticMarkup(MadeNote({ g })!);
    expect(theirs).toContain("Auto · made with Krea 2 Realism · Auto&#x27;s next model");
    expect(theirs).not.toContain("Add a pattern");
    expect(theirs).not.toContain("Words:");
    const owners = renderToStaticMarkup(MadeNote({ g: { ...g, declinedCards: [{ url: "/api/files/card.png", spread: 9, grey: 0.9 }] } })!);
    expect(owners).toContain("Ideogram 4 declined: what it returned");
    expect(owners).toContain("Words: “a cat in a gown”");
    expect(owners).toContain("Add a pattern");
  });
});
