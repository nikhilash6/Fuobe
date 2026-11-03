import { describe, expect, it } from "vitest";
import { TABLE_LIMITS } from "@/lib/catalog/canvas";
import {
  checkOutputs,
  checkValues,
  compile,
  csvCells,
  exampleValues,
  fill,
  leafKeys,
  parseRecipe,
  parseRows,
  RECIPE_LIMITS,
  RECIPE_MARKDOWN_MAX,
  recipeMarkdown,
  recipeProblems,
  RecipeSchema,
  stripChecks,
  stripExamples,
  valuesSchema,
  verifiedLine,
  type Recipe,
} from "@/lib/recipe";

/** The research's illustrative recipe (§9): a cut-out, a scene, a turntable clip. */
const lamp = (): Recipe =>
  RecipeSchema.parse({
    fuobeRecipe: 1,
    params: [
      { id: "product", label: "Product photo", type: "image", required: true, example: "/api/files/uploads/2026-10-20/lamp.png" },
      { id: "name", label: "Product name", type: "text", required: true, example: "Lumen desk lamp", max: 200 },
      { id: "aspect", label: "Shape", type: "choice", options: ["1:1", "9:16", "16:9"], default: "1:1" },
      { id: "takes", label: "Takes", type: "number", min: 1, max: 4, default: 1 },
    ],
    steps: [
      { key: "cutout", kind: "generate", request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: ["{{product}}"] } } },
      {
        key: "scene",
        kind: "generate",
        after: ["cutout"],
        chain: [{ slot: "images", position: "first" }],
        request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{name}} on a travertine plinth, soft window light", params: { aspectRatio: "{{aspect}}" } },
      },
      {
        key: "spin",
        kind: "generate",
        label: "Turntable",
        after: ["scene"],
        chain: [{ slot: "images" }],
        request: { feature: "skill", modelId: "kling-3", op: "i2v", prompt: "slow turntable of the {{name}}", params: { duration: 5, numOutputs: "{{takes}}" } },
      },
    ],
    checks: { spin: { kind: "video", count: "{{takes}}", aspect: "{{aspect}}", seconds: [4.5, 5.5], sound: false, look: "the product turns on a plain plinth" } },
    verified: { cloud: { plan: "2026-10-29", dryRun: "2026-10-29", real: null, catalog: "sha256:abc" }, open: null },
    source: { from: "library", generations: ["V1StGXR8_Z5j"], at: "2026-10-29" },
  });

const opts = { skill: "lamp-turntable", run: "run123", title: "Lamp turntable" };

describe("the recipe format", () => {
  it("parses the research's example and keeps it clean", () => {
    const r = lamp();
    expect(r.params).toHaveLength(4);
    expect(recipeProblems(r)).toEqual([]);
    expect(leafKeys(r)).toEqual(new Set(["spin"]));
    expect(parseRecipe(JSON.stringify(r))).toMatchObject({ ok: true });
  });

  it("refuses what isn't a recipe: a version, caps, an empty graph, bad JSON", () => {
    expect(parseRecipe("{")).toEqual({ ok: false, error: "recipe.json isn't valid JSON" });
    expect(parseRecipe(JSON.stringify({ ...lamp(), fuobeRecipe: 3 }))).toMatchObject({ ok: false, error: expect.stringContaining("fuobeRecipe") });
    expect(parseRecipe(JSON.stringify({ ...lamp(), steps: [] }))).toMatchObject({ ok: false, error: expect.stringContaining("a recipe needs a step") });
    const many = Array.from({ length: RECIPE_LIMITS.params + 1 }, (_, i) => ({ id: `p${i}`, label: `P ${i}`, type: "text" }));
    expect(parseRecipe(JSON.stringify({ ...lamp(), params: many }))).toMatchObject({ ok: false, error: expect.stringContaining("at most 12 inputs") });
    const steps = Array.from({ length: RECIPE_LIMITS.steps + 1 }, (_, i) => ({ key: `s${i}`, kind: "generate", request: { feature: "skill", modelId: "flux-2" } }));
    expect(parseRecipe(JSON.stringify({ ...lamp(), steps }))).toMatchObject({ ok: false, error: expect.stringContaining("at most 24 steps") });
    expect(parseRecipe(JSON.stringify({ ...lamp(), params: [{ id: "1bad", label: "x", type: "text" }] }))).toMatchObject({ ok: false });
  });

  it("drops fields only the server sets, whatever the file says", () => {
    const r = RecipeSchema.parse({
      fuobeRecipe: 1,
      params: [],
      steps: [{ key: "a", kind: "generate", request: { feature: "skill", modelId: "flux-2", prompt: "x", demo: true, skill: { name: "other", run: "x" }, chainFilled: true, batchTitle: "no" } }],
    });
    const req = (r.steps[0] as Extract<Recipe["steps"][number], { kind: "generate" }>).request;
    expect(req).toEqual({ feature: "skill", modelId: "flux-2", prompt: "x" });
  });
});

describe("save-time problems", () => {
  const base = lamp();
  const withSteps = (steps: unknown[], extra: Partial<Recipe> = {}) => RecipeSchema.parse({ ...base, ...extra, steps });
  const [cutout, scene, spin] = base.steps;

  it("names unknown and unused placeholders", () => {
    const r = withSteps([cutout, { ...scene, request: { ...(scene as { request: object }).request, prompt: "{{nme}} on a plinth" } }, spin]);
    expect(recipeProblems(r)).toEqual(expect.arrayContaining([expect.stringContaining("uses {{nme}}, which isn't an input")]));
    const unused = RecipeSchema.parse({ ...base, params: [...base.params, { id: "mood", label: "Mood", type: "text" }] });
    expect(recipeProblems(unused)).toEqual([expect.stringContaining("“Mood” ({{mood}}) isn't used")]);
    const badCheck = RecipeSchema.parse({ ...base, checks: { spin: { count: "{{many}}" }, nope: { kind: "image" } } });
    expect(recipeProblems(badCheck)).toEqual(expect.arrayContaining([expect.stringContaining("{{many}}"), expect.stringContaining("“nope”")]));
  });

  it("refuses a count from an input on a step that feeds others", () => {
    const sceneN = { ...scene, request: { ...(scene as { request: { params: object } }).request, params: { aspectRatio: "{{aspect}}", numOutputs: "{{takes}}" } } };
    expect(recipeProblems(withSteps([cutout, sceneN, spin]))).toEqual([expect.stringContaining("Step “scene” feeds later steps, so its count can't come from an input")]);
    const sceneTwo = { ...scene, request: { ...(scene as { request: { params: object } }).request, params: { aspectRatio: "{{aspect}}", numOutputs: 2 } } };
    expect(recipeProblems(withSteps([cutout, sceneTwo, spin]))).toEqual([expect.stringContaining("must make one result")]);
  });

  it("refuses duplicate keys and ids, a tool step that isn't alone, and a broken graph", () => {
    expect(recipeProblems(withSteps([cutout, { ...scene, key: "cutout", after: undefined, chain: undefined }, spin]))).toEqual(expect.arrayContaining(["Two steps are called “cutout”"]));
    expect(recipeProblems(RecipeSchema.parse({ ...base, params: [...base.params, base.params[0]] }))).toEqual(expect.arrayContaining(["Two inputs are called “product”"]));
    const tool = { key: "dub", kind: "tool", tool: "dub_video", input: { video: "{{product}}", languages: ["Spanish"] } };
    expect(recipeProblems(withSteps([cutout, scene, spin, tool]))).toEqual(expect.arrayContaining([expect.stringContaining("must be the recipe's only step")]));
    expect(recipeProblems(withSteps([cutout, { ...scene, after: ["ghost"] }, spin]))).toEqual(expect.arrayContaining([expect.stringContaining("waits for “ghost”")]));
    expect(recipeProblems(withSteps([cutout, { ...scene, chain: [{ slot: "images" }, { slot: "images" }] }, spin]))).toEqual(expect.arrayContaining([expect.stringContaining("2 chain slots for 1 earlier step")]));
    const loop = withSteps([{ ...cutout, after: ["spin"], chain: [{ slot: "images" }] }, scene, spin]);
    expect(recipeProblems(loop)).toEqual(expect.arrayContaining([expect.stringContaining("in a loop")]));
  });

  it("checks each input's own default, example and options", () => {
    const r = RecipeSchema.parse({
      ...base,
      params: [
        { ...base.params[0], example: "C:\\photos\\lamp.png" },
        base.params[1],
        { ...base.params[2], default: "4:3" },
        { ...base.params[3], min: 5, max: 2 },
        { id: "who", label: "Who", type: "choice" },
      ],
      steps: [...base.steps, { key: "x", kind: "generate", request: { feature: "skill", modelId: "flux-2", prompt: "{{who}}" } }],
    });
    const p = recipeProblems(r);
    expect(p).toEqual(
      expect.arrayContaining([
        expect.stringContaining("The example of “Product photo” doesn't fit"),
        expect.stringContaining("The default of “Shape” doesn't fit"),
        "“Takes”: its minimum is above its maximum",
        "The choice “Who” needs options",
      ]),
    );
  });
});

describe("values", () => {
  const r = lamp();

  it("applies defaults, limits and options, and says what's missing", () => {
    expect(checkValues(r, { product: "/api/files/uploads/a.png", name: "Desk lamp" })).toEqual({ values: { product: "/api/files/uploads/a.png", name: "Desk lamp", aspect: "1:1", takes: 1 }, errors: {} });
    const bad = checkValues(r, { product: "file:///etc/passwd", name: "", aspect: "4:3", takes: 9 });
    expect(bad.values).toBeUndefined();
    expect(bad.errors).toEqual({
      product: "Product photo: a file from Fuobe (/api/files/…) or an http(s) link",
      name: "Product name is needed",
      aspect: "Shape: one of 1:1, 9:16, 16:9",
      takes: "Takes: at most 4",
    });
    expect(checkValues(r, { product: "https://example.com/a.jpg", name: "x".repeat(201) }).errors.name).toBe("Product name: at most 200 characters");
    expect(checkValues(r, { product: "https://example.com/a.jpg", name: "Lamp", takes: "0" }).errors.takes).toBe("Takes: at least 1");
  });

  it("reads a number as it is being typed: “0.” and “.5” are numbers, words aren't", () => {
    const strength = RecipeSchema.parse({ ...r, params: [{ id: "s", label: "Strength", type: "number", min: 0, max: 1, step: 0.1, default: 0.5 }], steps: [{ key: "a", kind: "generate", request: { feature: "skill", modelId: "m", prompt: "x", params: { extra: { s: "{{s}}" } } } }] });
    expect(checkValues(strength, { s: "0." }).values).toEqual({ s: 0 });
    expect(checkValues(strength, { s: ".5" }).values).toEqual({ s: 0.5 });
    expect(checkValues(strength, { s: "0.75" }).values).toEqual({ s: 0.75 });
    expect(checkValues(strength, { s: "a lot" }).errors.s).toBe("Strength: a number");
  });

  it("reads text from a form or a CSV: numbers as numbers, choices without minding case, @handles", () => {
    const withEl = RecipeSchema.parse({ ...r, params: [...r.params, { id: "hero", label: "Hero", type: "element", required: true }] });
    const ok = checkValues(withEl, { product: "/api/files/a.png", name: "Lamp", takes: "3", aspect: "16:9", hero: "Maya_Lopez" });
    expect(ok.values).toMatchObject({ takes: 3, aspect: "16:9", hero: "@Maya_Lopez" });
    expect(checkValues(withEl, { product: "/api/files/a.png", name: "Lamp", hero: "@two words" }).errors.hero).toBe("Hero: an element's @handle, e.g. @Maya");
    expect(checkValues(withEl, { product: "/api/files/a.png", name: "Lamp", hero: "@Maya", aspect: "9:16".toUpperCase() }).values?.aspect).toBe("9:16");
    // valuesSchema is a plain zod object, one field per input.
    expect(Object.keys(valuesSchema(withEl).shape)).toEqual(["product", "name", "aspect", "takes", "hero"]);
  });

  it("gives a check its examples, and a stand-in file for a media input with none", () => {
    const noEx = RecipeSchema.parse({ ...r, params: r.params.map((p) => ({ ...p, example: undefined })) });
    expect(exampleValues(noEx, (t) => `/api/files/stand-in.${t}`)).toEqual({ product: "/api/files/stand-in.image", name: "Product name", aspect: "1:1", takes: 1 });
    expect(exampleValues(r, () => "x")).toMatchObject({ product: "/api/files/uploads/2026-10-20/lamp.png", name: "Lumen desk lamp" });
  });
});

describe("fill and compile", () => {
  const r = lamp();
  const values = { product: "/api/files/uploads/new.png", name: "Arc floor lamp", aspect: "9:16", takes: 3 };

  it("keeps types for exact placeholders and puts text into longer strings", () => {
    const { steps, checks } = fill(r, values);
    const [cut, scene, spin] = steps as Extract<Recipe["steps"][number], { kind: "generate" }>[];
    expect(cut.request.inputs).toEqual({ images: ["/api/files/uploads/new.png"] });
    expect(scene.request.prompt).toBe("Arc floor lamp on a travertine plinth, soft window light");
    expect(scene.request.params).toEqual({ aspectRatio: "9:16" });
    expect(spin.request.params).toEqual({ duration: 5, numOutputs: 3 });
    expect(checks.spin).toEqual({ kind: "video", count: 3, aspect: "9:16", seconds: [4.5, 5.5], sound: false, look: "the product turns on a plain plinth" });
  });

  it("drops a field whose optional input is empty, and tidies the words around it", () => {
    const r2 = RecipeSchema.parse({
      fuobeRecipe: 1,
      params: [
        { id: "ref", label: "Reference", type: "image" },
        { id: "mood", label: "Mood", type: "text" },
      ],
      steps: [{ key: "a", kind: "generate", request: { feature: "skill", modelId: "flux-2", prompt: "A lamp, {{mood}}, studio light", inputs: { images: ["{{ref}}"] } } }],
    });
    const [a] = fill(r2, {}).steps as Extract<Recipe["steps"][number], { kind: "generate" }>[];
    expect(a.request.prompt).toBe("A lamp, studio light");
    expect(a.request.inputs).toBeUndefined();
  });

  it("compiles to createPipeline's steps with after, chain, batchTitle and the skill stamp", () => {
    const c = compile(r, values, opts);
    expect(c.kind).toBe("pipeline");
    if (c.kind !== "pipeline") return;
    expect(c.steps.map((s) => s.key)).toEqual(["cutout", "scene", "spin"]);
    expect(c.steps[1]).toMatchObject({ after: ["cutout"], chain: [{ slot: "images", position: "first" }] });
    for (const s of c.steps) {
      expect(s.request.batchTitle).toBe("Lamp turntable");
      expect(s.request.skill).toEqual({ name: "lamp-turntable", run: "run123" });
      expect(s.request.demo).toBeUndefined();
      expect(s.request.feature).toBe("skill");
    }
    // A labelled step keeps its label on the tile; the others get createPipeline's "Step i of n".
    expect(c.steps[2].request.step).toEqual({ label: "Turntable", index: 2, of: 3 });
    expect(c.steps[0].request.step).toBeUndefined();
    // The count varies only on the leaf.
    expect(c.steps.map((s) => s.request.params?.numOutputs)).toEqual([undefined, undefined, 3]);
  });

  it("compiles a dry run onto the demo provider as hidden helper rows", () => {
    const c = compile(r, values, { ...opts, demo: true });
    if (c.kind !== "pipeline") throw new Error("pipeline expected");
    expect(c.steps.every((s) => s.request.demo === true && s.request.feature === "skill-check")).toBe(true);
  });

  it("compiles a tool recipe to one tool call", () => {
    const t = RecipeSchema.parse({
      fuobeRecipe: 1,
      params: [
        { id: "clip", label: "Clip", type: "video", required: true },
        { id: "lang", label: "Language", type: "choice", options: ["Spanish", "German"], default: "Spanish" },
      ],
      steps: [{ key: "captions", kind: "tool", tool: "add_captions", input: { video: "{{clip}}", translate_to: "{{lang}}" } }],
    });
    expect(recipeProblems(t)).toEqual([]);
    expect(compile(t, { clip: "/api/files/a.mp4" }, opts)).toMatchObject({ kind: "tool", tool: "add_captions", input: { video: "/api/files/a.mp4", translate_to: "Spanish" } });
  });
});

describe("rows from a CSV", () => {
  const r = lamp();

  it("reads headers by id or label, quotes, a BOM and empty rows", () => {
    const csv = '\uFEFFProduct photo,name,Shape,Notes\r\n/api/files/a.png,"Lamp, brass",16:9,x\n\n/api/files/b.png,"The ""Arc"" lamp",,\n,,,\n';
    const p = parseRows(csv, r);
    expect(p.errors).toEqual([]);
    expect(p.columns).toEqual(["product", "name", "aspect", null]);
    expect(p.notes).toEqual(["“Notes” isn't an input of this skill, so it's left out"]);
    expect(p.rows.map((x) => x.values)).toEqual([
      { product: "/api/files/a.png", name: "Lamp, brass", aspect: "16:9", takes: 1 },
      { product: "/api/files/b.png", name: 'The "Arc" lamp', aspect: "1:1", takes: 1 },
    ]);
    expect(p.rows.map((x) => x.line)).toEqual([2, 4]);
  });

  it("reads a spreadsheet's paste (tabs) and line breaks inside quotes", () => {
    expect(csvCells('a\tb\n"one\ntwo"\tthree').map((x) => x.cells)).toEqual([
      ["a", "b"],
      ["one\ntwo", "three"],
    ]);
  });

  it("says what's wrong per row, and what stops every row", () => {
    const p = parseRows("product,name,takes\nnot-a-link,Lamp,2\n/api/files/a.png,,9", r);
    expect(p.errors).toEqual([]);
    expect(p.rows[0].errors).toEqual(["Product photo: a file from Fuobe (/api/files/…) or an http(s) link"]);
    expect(p.rows[1].errors).toEqual(["Product name is needed", "Takes: at most 4"]);
    expect(parseRows("name\nLamp", r).errors).toEqual(["No column for “Product photo”"]);
    expect(parseRows("", r).errors[0]).toMatch(/Paste a table/);
    expect(parseRows("foo,bar\n1,2", r).errors[0]).toMatch(/names no input/);
    // A header and no rows: nothing to run, said as such (not "fix the rows").
    const empty = parseRows("product,name\n\n", r);
    expect(empty.rows).toEqual([]);
    expect(empty.errors).toEqual(["Add a row under the header: one row per run"]);
  });

  it("takes at most 50 rows, as a Canvas table does", () => {
    expect(RECIPE_LIMITS.rows).toBe(TABLE_LIMITS.rows);
    const rows = (n: number) => ["product,name", ...Array.from({ length: n }, (_, i) => `/api/files/${i}.png,Lamp ${i}`)].join("\n");
    expect(parseRows(rows(50), r).errors).toEqual([]);
    const over = parseRows(rows(51), r);
    expect(over.errors).toEqual(["At most 50 rows at a time — this has 51"]);
    expect(over.rows).toHaveLength(50);
  });
});

describe("checking outputs", () => {
  const video = (w: number, h: number) => ({ kind: "video" as const, width: w, height: h });
  const info = (duration: number, hasAudio: boolean) => ({ container: "mp4" as const, duration, width: 720, height: 1280, hasVideo: true, hasAudio });

  it("passes the right kind, count, shape, length and sound", () => {
    const c = { kind: "video" as const, count: 2, aspect: "9:16", seconds: [4.5, 5.5] as [number, number], sound: false };
    expect(checkOutputs(c, [video(720, 1280), video(1080, 1920)], [info(5, false), info(5.2, false)])).toEqual({ ok: true, problems: [], skipped: [] });
  });

  it("names each thing that's off, within the tolerances", () => {
    const c = { kind: "video" as const, count: 1, aspect: "16:9", seconds: 5, sound: true };
    const out = checkOutputs(c, [video(720, 1280), video(720, 1280)], [info(6, false), info(5.4, true)]);
    expect(out.ok).toBe(false);
    expect(out.problems).toEqual(["it made 2 videos, not 1", "output 1 is 720×1280, not 16:9", "output 2 is 720×1280, not 16:9", "output 1 is 6 s, not 5 s", "output 1 is silent"]);
    // ±2% on the shape: 1280×722 is still 16:9.
    expect(checkOutputs({ aspect: "16:9" }, [video(1280, 722)]).ok).toBe(true);
    expect(checkOutputs({ kind: "image" }, [video(10, 10)]).problems).toEqual(["it made no image (got video)"]);
  });

  it("skips what it can't read instead of failing it", () => {
    const out = checkOutputs({ kind: "video", seconds: 5, sound: false, aspect: "1:1" }, [{ kind: "video" }], [null]);
    expect(out).toEqual({ ok: true, problems: [], skipped: ["the shape of output 1", "the length of output 1", "the sound of output 1"] });
  });
});

describe("sharing and reading", () => {
  it("strips examples, source and this install's checks, and asks for fixed files as inputs", () => {
    const base = lamp();
    const withLogo = RecipeSchema.parse({
      ...base,
      steps: [...base.steps.slice(0, 2), { ...base.steps[2], request: { ...(base.steps[2] as { request: object }).request, inputs: { audio: "/api/files/uploads/2026-10-20/bed.mp3" } } }],
    });
    const s = stripExamples(withLogo);
    expect(s.source).toBeUndefined();
    expect(s.verified).toBeUndefined();
    expect(s.params.every((p) => p.example === undefined)).toBe(true);
    expect(s.params.at(-1)).toEqual({ id: "file_1", label: "Audio for “Turntable”", type: "audio", required: true });
    expect(JSON.stringify(s.steps)).not.toContain("/api/files/");
    expect(recipeProblems(s)).toEqual([]);
    // Kept with its examples (a backup): only this install's checks are left out.
    const kept = stripChecks(withLogo);
    expect(kept.verified).toBeUndefined();
    expect(kept.params[0].example).toBe("/api/files/uploads/2026-10-20/lamp.png");
    expect(kept.source).toEqual(withLogo.source);
  });

  it("writes a Run it section with the inputs, the steps and the equivalent generate call", () => {
    const md = recipeMarkdown(lamp(), { name: "lamp-turntable" });
    expect(md).toMatch(/^## Run it/);
    expect(md).toContain("- `product` — Product photo: an image; required");
    expect(md).toContain("- `aspect` — Shape: one of `1:1`, `9:16`, `16:9`; default `1:1`");
    expect(md).toContain("3. Turntable: `kling-3` (i2v) — “slow turntable of the {{name}}”, from the result of step 2");
    expect(md).toContain('"model_id": "kling-3"');
    expect(md).toContain('"after": 1');
    expect(md).toContain("run_skill");
    expect(md).not.toContain("leaves out");
  });

  it("puts a look, a negative prompt and a voice into the generate call, and says what it can't carry", () => {
    const soul = RecipeSchema.parse({
      fuobeRecipe: 1,
      params: [{ id: "subject", label: "Subject", type: "text", required: true }],
      steps: [
        {
          key: "portrait",
          kind: "generate",
          request: { feature: "skill", modelId: "fuobe-soul", presetId: "v1-y2k", prompt: "{{subject}}", negativePrompt: "blurry", params: { aspectRatio: "4:5", seed: 7, generateAudio: false }, loras: [{ file: "maya.safetensors", strength: 0.8 }] },
        },
      ],
    });
    const md = recipeMarkdown(soul, { name: "soul" });
    expect(md).toContain('"look": "v1-y2k"');
    expect(md).toContain('"negative_prompt": "blurry"');
    expect(md).toContain('"generate_audio": false');
    expect(md).toContain("That call leaves out its LoRAs, `params.seed` (the `generate` tool has no field for them)");
  });

  it("keeps the Run it section to a few pages, whatever the recipe holds", () => {
    const long = "word ".repeat(1900);
    const big = RecipeSchema.parse({
      fuobeRecipe: 1,
      params: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, label: `Input ${i}`, type: "choice", options: Array.from({ length: 24 }, (_, j) => `option ${j} ${"x".repeat(60)}`), hint: "h".repeat(200) })),
      steps: Array.from({ length: 24 }, (_, i) => ({ key: `s${i}`, kind: "generate", request: { feature: "skill", modelId: "fuobe-soul", prompt: `${long} {{p${i % 12}}}` } })),
    });
    const md = recipeMarkdown(big, { name: "big" });
    expect(md.length).toBeLessThanOrEqual(RECIPE_MARKDOWN_MAX);
    expect(md).toContain("the call is too long to show here");
    expect(md).toContain("**Steps**");
  });

  it("says when and where it was checked", () => {
    expect(verifiedLine(lamp(), ["cloud", "open"])).toBe("Tested 29 Oct · Cloud ✓ · Your GPU not tested yet");
    expect(verifiedLine({}, ["cloud"])).toMatch(/Not tested yet · a test run is free and runs nothing for real/);
  });

  it("says Priced, not Tested, when only the plan was checked", () => {
    const planOnly = { verified: { cloud: { plan: "2026-10-29", dryRun: null, real: null, catalog: "sha256:abc" }, open: null } } as Pick<Recipe, "verified">;
    expect(verifiedLine(planOnly, ["cloud", "open"])).toBe("Priced 29 Oct · Cloud priced · Your GPU not tested yet");
  });
});
