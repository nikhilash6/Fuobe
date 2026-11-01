/**
 * Drift detection: every preset's Generate run must match the recipe that made its preview cover.
 *
 * When this test breaks, a code change has made a preset behave differently from its recipe. Fix the code
 * (src/lib/catalog/preset-recipe-routes.ts, src/lib/catalog/plan.ts, src/server/generations.ts) so the run
 * matches again, or update the recipe book (src/lib/catalog/preset-recipe-book.json) if the recipe itself
 * changed.
 */
import { describe, expect, it } from "vitest";
import { APPS, EFFECTS, getPreset, MOTIONS, PRESETS } from "@/lib/catalog";
import {
  H3_CLOUD,
  H3_OPEN,
  OWN_ROUTE_APPS,
  QWEN_21_MAX_DIMENSION,
  ORBIT_WORDS,
  recipeKind,
  recipeRoute,
  qwenStep,
} from "@/lib/catalog/preset-recipe-routes";
import { RECIPE_BOOK } from "@/lib/catalog/preset-recipe-book";

describe("recipe book completeness", () => {
  it("every preset with a recipe entry in the book exists in the catalog", () => {
    for (const id of Object.keys(RECIPE_BOOK)) {
      expect(getPreset(id), `${id} missing from catalog`).toBeDefined();
    }
  });

  it("every preset whose recipe kind is set has a matching entry in the recipe book", () => {
    for (const preset of PRESETS) {
      const kind = recipeKind(preset);
      if (!kind) continue;
      expect(preset.recipe, `${preset.id} has kind ${kind} but no .recipe`).toBeDefined();
      if (kind === "h3" || kind === "orbit") {
        expect(preset.recipe!.clip, `${preset.id} kind ${kind} needs clip`).toBeDefined();
      } else if (kind === "qwen") {
        expect(preset.recipe!.edit, `${preset.id} kind qwen needs edit`).toBeDefined();
      }
    }
  });

  it("every motion and effect without a grade or own-route has a recipe", () => {
    const missing = [...MOTIONS, ...EFFECTS].filter((x) => !x.grade && !OWN_ROUTE_APPS.has(x.id) && !recipeKind(x));
    expect(missing.map((x) => x.id)).toEqual([]);
  });
});

describe("clip recipe routes match the book", () => {
  const clipPresets = PRESETS.filter((x) => x.recipe?.clip);

  it("the route's model and operation match the clip's quality", () => {
    for (const preset of clipPresets) {
      const kind = recipeKind(preset);
      const open = recipeRoute(preset, "open")!;
      const cloud = recipeRoute(preset, "cloud")!;
      expect(open, `${preset.id} open`).toBeDefined();
      expect(cloud, `${preset.id} cloud`).toBeDefined();
      expect(open.modelId, `${preset.id} open model`).toBe(H3_OPEN);
      expect(cloud.modelId, `${preset.id} cloud model`).toBe(H3_CLOUD);
      if (kind === "orbit") {
        expect(open.params?.extra?.orbit, `${preset.id} open orbit`).toBe(true);
        expect(open.promptTemplate, `${preset.id} orbit words`).toBe(ORBIT_WORDS);
        expect(cloud.promptTemplate, `${preset.id} cloud orbit words`).toBe(ORBIT_WORDS);
      }
    }
  });

  it("the route's duration matches the recipe's seconds, hosted H3 at least 5 s", () => {
    for (const preset of clipPresets) {
      const open = recipeRoute(preset, "open")!;
      const cloud = recipeRoute(preset, "cloud")!;
      expect(open.params?.duration, `${preset.id} open duration`).toBe(preset.recipe!.clip!.seconds);
      expect(cloud.params?.duration, `${preset.id} cloud duration`).toBe(Math.max(5, preset.recipe!.clip!.seconds));
    }
  });

  it("the route's quality matches the recipe's quality", () => {
    for (const preset of clipPresets) {
      const open = recipeRoute(preset, "open")!;
      const kind = recipeKind(preset);
      if (kind === "orbit") {
        expect(open.params?.extra?.orbit, `${preset.id} orbit`).toBe(true);
      } else if (preset.recipe!.clip!.quality === "best") {
        expect(open.params?.extra?.quality, `${preset.id} best`).toBe("best");
      } else {
        // Fast is the default: no extra quality param.
        expect(open.params?.extra?.quality, `${preset.id} fast`).toBeUndefined();
      }
    }
  });

  it("the open route carries the recipe's sound and music when present", () => {
    for (const preset of clipPresets) {
      const open = recipeRoute(preset, "open")!;
      const clip = preset.recipe!.clip!;
      if (clip.sound !== undefined) {
        expect(open.sound, `${preset.id} sound`).toBeDefined();
        expect(open.sound!.soundscape, `${preset.id} soundscape`).toBe(clip.sound);
        expect(open.sound!.music, `${preset.id} music`).toBe(clip.music ?? "N/A");
      } else {
        expect(open.sound, `${preset.id} no sound`).toBeUndefined();
      }
    }
  });

  it("the route's words match the recipe's words", () => {
    for (const preset of clipPresets) {
      const kind = recipeKind(preset);
      if (kind === "orbit") continue; // orbit uses ORBIT_WORDS, checked above
      const open = recipeRoute(preset, "open")!;
      const cloud = recipeRoute(preset, "cloud")!;
      const clip = preset.recipe!.clip!;
      // The cloud route carries the same words (without {prompt} it adds the visitor's separately).
      expect(typeof open.promptTemplate, `${preset.id} open template type`).toBe("string");
      expect(typeof cloud.promptTemplate, `${preset.id} cloud template type`).toBe("string");
      // The words include the recipe's words.
      if (clip.words) {
        expect(open.promptTemplate, `${preset.id} open words`).toContain(clip.words);
        expect(cloud.promptTemplate, `${preset.id} cloud words`).toContain(clip.words);
      }
    }
  });
});

describe("end-frame step routes match the book", () => {
  const endPresets = PRESETS.filter((x) => x.recipe?.clip?.end);

  it("the open route carries the end-frame step from the recipe", () => {
    for (const preset of endPresets) {
      const kind = recipeKind(preset);
      if (kind === "orbit") continue; // orbits don't carry end steps
      const open = recipeRoute(preset, "open")!;
      const end = preset.recipe!.clip!.end!;
      // Only i2v presets get end steps (flf2v already have an end frame from the user).
      if (open.op !== "i2v") continue;
      expect(open.end, `${preset.id} end`).toBeDefined();
      const expected = qwenStep(end);
      expect(open.end!.modelId, `${preset.id} end model`).toBe(expected.modelId);
      expect(open.end!.op, `${preset.id} end op`).toBe(expected.op);
      expect(open.end!.promptTemplate, `${preset.id} end prompt`).toBe(expected.promptTemplate);
    }
  });

  it("the cloud route never carries an end-frame step (no hosted Qwen)", () => {
    for (const preset of endPresets) {
      const cloud = recipeRoute(preset, "cloud");
      expect(cloud?.end, `${preset.id} cloud end`).toBeUndefined();
    }
  });
});

describe("edit recipe routes match the book", () => {
  const editPresets = PRESETS.filter((x) => recipeKind(x) === "qwen");

  it("the open route uses the right Qwen model and operation", () => {
    for (const preset of editPresets) {
      const open = recipeRoute(preset, "open")!;
      const edit = preset.recipe!.edit!;
      expect(open, `${preset.id} open`).toBeDefined();
      const expected = qwenStep(edit);
      expect(open.modelId, `${preset.id} model`).toBe(expected.modelId);
      expect(open.op, `${preset.id} op`).toBe(expected.op);
    }
  });

  it("there is no cloud route for a Qwen edit (no hosted Qwen)", () => {
    for (const preset of editPresets) {
      expect(recipeRoute(preset, "cloud"), `${preset.id} cloud`).toBeUndefined();
    }
  });

  it("the route carries the edit's maxDimension only when it differs from the graph's default", () => {
    for (const preset of editPresets) {
      const open = recipeRoute(preset, "open")!;
      const edit = preset.recipe!.edit!;
      if (edit.maxDimension && edit.maxDimension !== QWEN_21_MAX_DIMENSION) {
        expect(open.params?.extra?.maxDimension, `${preset.id} maxDimension`).toBe(edit.maxDimension);
      } else {
        expect(open.params?.extra?.maxDimension, `${preset.id} no maxDimension`).toBeUndefined();
      }
    }
  });

  it("the route carries the edit's crop when present", () => {
    for (const preset of editPresets) {
      const open = recipeRoute(preset, "open")!;
      const edit = preset.recipe!.edit!;
      if (edit.crop) {
        expect(open.params?.extra?.crop, `${preset.id} crop`).toEqual(edit.crop);
      } else {
        expect(open.params?.extra?.crop, `${preset.id} no crop`).toBeUndefined();
      }
    }
  });
});

describe("recipe text safety", () => {
  /** Words a default prompt never uses: it names only what is wanted. */
  const NEGATION = /\b(not|never|without|don't|avoid|nothing|none|neither|nor)\b/i;

  it("no recipe text contains negation words", () => {
    for (const [id, book] of Object.entries(RECIPE_BOOK)) {
      if (book.clip?.words) expect(book.clip.words, `${id} clip.words`).not.toMatch(NEGATION);
      if (book.edit?.prompt) expect(book.edit.prompt, `${id} edit.prompt`).not.toMatch(NEGATION);
      if (book.clip?.end?.prompt) expect(book.clip.end.prompt, `${id} clip.end.prompt`).not.toMatch(NEGATION);
      if (book.clip?.sound) expect(book.clip.sound, `${id} clip.sound`).not.toMatch(NEGATION);
      if (book.clip?.music) expect(book.clip.music, `${id} clip.music`).not.toMatch(NEGATION);
    }
  });

  it("no recipe text names the cover's specific subject (generalised to 'the subject')", () => {
    // Recipe texts should say "the subject" / "the scene", never a cover-specific name like "a woman in a red dress".
    const SPECIFIC_SUBJECT = /\b(a (?:young |beautiful |handsome )?(?:woman|man|girl|boy|lady|gentleman)\b(?:\s+(?:in|with|wearing)\b))/i;
    for (const [id, book] of Object.entries(RECIPE_BOOK)) {
      const texts = [book.clip?.words, book.edit?.prompt, book.clip?.end?.prompt].filter(Boolean) as string[];
      for (const t of texts) {
        expect(t, `${id} has a specific subject`).not.toMatch(SPECIFIC_SUBJECT);
      }
    }
  });
});

describe("no preset is orphaned by code changes", () => {
  it("every video app that is not in OWN_ROUTE_APPS gets a recipe route", () => {
    const VIDEO_OPS = ["i2v", "flf2v"];
    const videoApps = APPS.filter((a) => VIDEO_OPS.includes((a.open ?? a.cloud)!.op) && !OWN_ROUTE_APPS.has(a.id));
    for (const a of videoApps) {
      const open = recipeRoute(a, "open");
      expect(open, `${a.id} open route`).toBeDefined();
      expect(open!.modelId, `${a.id} model`).toBe(H3_OPEN);
    }
  });

  it("every OWN_ROUTE_APPS id exists as a preset", () => {
    for (const id of OWN_ROUTE_APPS) {
      expect(getPreset(id), `${id} not found`).toBeDefined();
    }
  });

  it("a graded effect without a recipe still uses its own route", () => {
    const graded = [...MOTIONS, ...EFFECTS].filter((x) => x.grade && !recipeKind(x));
    for (const x of graded) {
      expect(recipeRoute(x, "open"), `${x.id} open`).toBeUndefined();
      expect(recipeRoute(x, "cloud"), `${x.id} cloud`).toBeUndefined();
    }
  });
});
