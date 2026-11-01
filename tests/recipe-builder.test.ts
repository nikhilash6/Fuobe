import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers call connection() (no request scope in a test).
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-recipe-builder-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: open models run on the demo provider, and there's no LLM.
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { createPipeline } = await import("@/server/chains");
const { db } = await import("@/server/db");
const { saveFile } = await import("@/server/storage");
const { createElement } = await import("@/server/elements");
const { encodePng } = await import("@/server/png");
const builder = await import("@/server/recipe-builder");
const recipes = await import("@/server/recipes");
const skills = await import("@/server/skills");
const lib = await import("@/lib/recipe-builder");
const { recipeProblems } = await import("@/lib/recipe");
const draftRoute = await import("@/app/api/assist/skills/draft/route");
const checkRoute = await import("@/app/api/assist/skills/draft/check/route");
const saveRoute = await import("@/app/api/assist/skills/draft/save/route");
const nameRoute = await import("@/app/api/assist/skills/draft/name/route");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let photo = "";
let clip = "";
beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
  photo = saveFile({ data: encodePng({ width: 64, height: 48, data: Buffer.alloc(64 * 48 * 4, 180) }), contentType: "image/png", source: "upload", name: "lamp.png" }).url;
  clip = saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "talk.mp4" }).url;
});

async function settle(ids: string[], ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    const all = ids.map((id) => gens.getGeneration(id, { includeDeleted: true })!);
    if (all.every((g) => ["succeeded", "failed", "canceled"].includes(g.status))) return all;
    if (Date.now() > until) throw new Error(`timed out: ${all.map((g) => `${g.id} ${g.status} ${g.message}`).join(", ")}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** A finished row written straight into the table (an old run, a studio's step): only what the builder reads. */
function row(o: { id: string; request: Record<string, unknown>; feature?: string; op?: string; kind?: string; batch?: string | null; dependsOn?: string | string[]; provider?: string; outputs?: { url: string; kind: string; width?: number; height?: number }[] }) {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO generations (id, batch_id, feature, preset_id, model_id, engine, provider, op, kind, status, progress, message, prompt, request_json, provider_input_json, external_id, external_meta_json, outputs_json, error, cost_usd, favorite, created_at, updated_at, completed_at, depends_on)
       VALUES (@id, @batch, @feature, NULL, @model, 'cloud', @provider, @op, @kind, 'succeeded', NULL, NULL, @prompt, @request, NULL, NULL, NULL, @outputs, NULL, 0, 0, @now, @now, @now, @deps)`,
    )
    .run({
      id: o.id,
      batch: o.batch ?? null,
      feature: o.feature ?? (o.request.feature as string),
      model: o.request.modelId as string,
      provider: o.provider ?? "mock",
      op: o.op ?? (o.request.op as string) ?? "t2i",
      kind: o.kind ?? "image",
      prompt: (o.request.prompt as string) ?? null,
      request: JSON.stringify(o.request),
      outputs: JSON.stringify(o.outputs ?? [{ url: photo, kind: o.kind ?? "image", width: 64, height: 48 }]),
      now,
      deps: o.dependsOn === undefined ? null : Array.isArray(o.dependsOn) ? JSON.stringify(o.dependsOn) : o.dependsOn,
    });
  return o.id;
}

/** The research's turntable as it was made in the composer: a cut-out, a scene from it, a clip of the scene. */
async function turntable() {
  const p = createPipeline([
    { key: "cutout", request: { feature: "image", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: [photo] } } },
    { key: "scene", after: "cutout", chain: [{ slot: "images", position: "first" }], request: { feature: "edit", modelId: "nano-banana-pro", op: "edit", prompt: "a matte black desk lamp on a travertine plinth, soft window light", params: { aspectRatio: "1:1" } } },
    { key: "spin", after: "scene", chain: [{ slot: "images" }], request: { feature: "video", modelId: "kling-3", op: "i2v", prompt: "slow turntable of the matte black desk lamp", params: { duration: 5 } } },
  ]);
  await settle(p.items.map((g) => g.id));
  return p;
}

const json = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("draftFromGenerations", () => {
  it("rebuilds a cut-out → edit → image-to-video chain as 3 steps with after and chain, and one image input", async () => {
    const p = await turntable();
    const { draft, refusals } = builder.draftFromGenerations([p.byKey.spin.id]);
    expect(refusals).toEqual([]);
    expect(draft).not.toBeNull();
    const steps = draft!.recipe.steps;
    expect(steps.map((s) => (s.kind === "generate" ? s.request.modelId : s.tool))).toEqual(["birefnet-cloud", "nano-banana-pro", "kling-3"]);
    const [cut, scene, spin] = steps as Extract<(typeof steps)[number], { kind: "generate" }>[];
    expect(cut.after).toBeUndefined();
    expect(scene.after).toBe(cut.key);
    expect(scene.chain).toEqual([{ slot: "images", position: "first" }]);
    expect(spin.after).toBe(scene.key);
    expect(spin.chain).toEqual([{ slot: "images" }]);
    // Chain-filled inputs are taken out: the scene and the clip get their pictures from the steps before.
    expect(scene.request.inputs).toBeUndefined();
    expect(spin.request.inputs).toBeUndefined();
    // Server fields are dropped.
    for (const s of [cut, scene, spin]) for (const k of ["chainFilled", "step", "batchTitle", "title", "skill", "demo", "asked", "chain"]) expect(s.request).not.toHaveProperty(k);
    const media = draft!.candidates.filter((c) => c.kind === "media");
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ type: "image", example: photo, at: [{ step: cut.key, path: ["inputs", "images", 0] }] });
    // Every candidate starts Fixed: the draft's recipe has no inputs, and its values are where they were.
    expect(draft!.recipe.params).toEqual([]);
    expect(draft!.candidates.some((c) => c.kind === "text" && c.example === "slow turntable of the matte black desk lamp")).toBe(true);
    expect(draft!.candidates.find((c) => c.setting === "numOutputs")?.at).toEqual([{ step: spin.key, path: ["params", "numOutputs"] }]);
    // The leaf's check: what it made (a demo result says nothing about a real one's length).
    expect(draft!.recipe.checks).toEqual({ [spin.key]: { kind: "video", count: 1 } });
    expect(draft!.steps.map((s) => s.waits)).toEqual([[], [draft!.steps[0].label], [draft!.steps[1].label]]);
    expect(draft!.demo).toBe(true);
    expect(draft!.notes).toContain(lib.DEMO_NOTE);
    expect(draft!.recipe.source).toMatchObject({ from: "library", generations: [p.byKey.spin.id], demo: true });
    expect(recipeProblems(draft!.recipe)).toEqual([]);
  });

  it("makes the same upload used by two steps one input", async () => {
    const p = createPipeline([
      { key: "a", request: { feature: "edit", modelId: "nano-banana-pro", op: "edit", prompt: "the lamp in red", inputs: { images: [photo] } } },
      { key: "b", after: "a", request: { feature: "edit", modelId: "nano-banana-pro", op: "edit", prompt: "both lamps side by side", inputs: { images: [photo] } } },
    ]);
    await settle(p.items.map((g) => g.id));
    const { draft } = builder.draftFromGenerations([p.byKey.b.id]);
    const media = draft!.candidates.filter((c) => c.kind === "media");
    expect(media).toHaveLength(1);
    expect(media[0].at).toHaveLength(2);
    // The second step keeps its own picture; the first step's result comes back through the chain.
    const b = draft!.recipe.steps[1] as Extract<NonNullable<typeof draft>["recipe"]["steps"][number], { kind: "generate" }>;
    expect(b.request.inputs).toEqual({ images: [photo] });
    expect(b.chain).toEqual([{ slot: "images", position: "last" }]);
    // Varying it puts the input in both places.
    const recipe = lib.buildRecipe(draft!, { varies: { [media[0].id]: true } });
    expect(recipe.params).toEqual([{ id: media[0].id, label: media[0].label, type: "image", required: true, example: photo }]);
    expect(JSON.stringify(recipe.steps).match(new RegExp(`\\{\\{${media[0].id}\\}\\}`, "g"))).toHaveLength(2);
    expect(recipeProblems(recipe)).toEqual([]);
  });

  it("moves a retired model to what replaced it, and says so", () => {
    row({ id: "old-soul-1", request: { feature: "image", modelId: "soul-1", op: "t2i", prompt: "a ceramicist at her wheel", params: { aspectRatio: "3:4" } } });
    const { draft } = builder.draftFromGenerations(["old-soul-1"]);
    const step = draft!.recipe.steps[0] as { request: { modelId: string } };
    expect(step.request.modelId).toBe("fuobe-soul");
    expect(draft!.notes.some((n) => /Fuobe Soul/.test(n))).toBe(true);
    expect(draft!.steps[0].notes.some((n) => /Fuobe Soul/.test(n))).toBe(true);
  });

  it("rebuilds a multi-shot film from the request as asked, and refuses one made before it was kept", async () => {
    const [film] = gens.createGenerations({
      feature: "video",
      modelId: "oss-wan22-14b-fast",
      op: "t2v",
      prompt: "a fox in the snow",
      params: { shots: [{ prompt: "it sniffs the air", duration: 3 }, { prompt: "it runs off", duration: 3 }] },
    });
    expect(film.request.asked?.params?.shots).toHaveLength(2);
    await settle([film.id]);
    const { draft, refusals } = builder.draftFromGenerations([film.id]);
    expect(refusals).toEqual([]);
    expect(draft!.recipe.steps).toHaveLength(1);
    const step = draft!.recipe.steps[0] as { request: Record<string, unknown> & { params?: { shots?: unknown[] } } };
    expect(step.request.modelId).toBe("oss-wan22-14b-fast");
    expect(step.request.params?.shots).toHaveLength(2);
    expect(step.request).not.toHaveProperty("asked");
    expect(draft!.steps[0].notes.some((n) => /asked as/.test(n))).toBe(true);
    // A shot of the same film stands for the film too.
    const shot = gens.listGenerations({ batchId: film.batchId! }).find((g) => g.request.step?.label === "Shot 1 of 2")!;
    expect(builder.draftFromGenerations([shot.id]).draft!.recipe.steps).toHaveLength(1);
    // Asked without an operation (Assist, MCP, the API), the step is named by what was asked, not by the join it ran as.
    const [bare] = gens.createGenerations({ feature: "video", modelId: "oss-wan22-14b-fast", prompt: "a heron in the reeds", params: { shots: [{ prompt: "it waits", duration: 3 }, { prompt: "it strikes", duration: 3 }] } });
    await settle([bare.id]);
    const named = builder.draftFromGenerations([bare.id]).draft!;
    expect(named.steps[0].label).toBe("Text to video");
    expect(named.recipe.steps[0].key).toBe("t2v");
    expect(named.recipe.steps[0].kind === "generate" && named.recipe.steps[0].request.op).toBeUndefined();

    // The same film made before W2: the rows, labelled, and no `asked`.
    row({ id: "old-shot-1", batch: "oldfilm", feature: "video", kind: "video", request: { feature: "video", modelId: "oss-wan22-14b-fast", op: "t2v", prompt: "a fox. it sniffs", step: { label: "Shot 1 of 2", index: 0, of: 3 } } });
    row({ id: "old-shot-2", batch: "oldfilm", feature: "video", kind: "video", request: { feature: "video", modelId: "oss-wan22-14b-fast", op: "t2v", prompt: "a fox. it runs", step: { label: "Shot 2 of 2", index: 1, of: 3 } } });
    row({ id: "old-film", batch: "oldfilm", feature: "video", kind: "video", op: "concat", dependsOn: ["old-shot-1", "old-shot-2"], request: { feature: "video", modelId: "oss-join-clips", op: "concat", chain: [{ slot: "videos" }, { slot: "videos" }], step: { label: "Film · 2 shots", index: 2, of: 3 } } });
    const old = builder.draftFromGenerations(["old-film"]);
    expect(old.draft).toBeNull();
    expect(old.refusals).toEqual([expect.objectContaining({ id: "old-film", reason: lib.STEPS_REFUSAL })]);
  });

  it("refuses a storyboard frame, a per-frame Mixed Media step and a helper step with the studio's name", () => {
    row({ id: "frame-1", feature: "storyboard", request: { feature: "storyboard", modelId: "nano-banana-pro", op: "t2i", prompt: "scene 1", frame: { scene: "s1", index: 0, of: 4 } } });
    row({ id: "mm-frame", feature: "mixed-media-frame-step", request: { feature: "mixed-media-frame-step", modelId: "nano-banana-pro", op: "edit", prompt: "in clay", chain: [{ slot: "images", index: 3 }] }, dependsOn: "frame-1" });
    row({ id: "fl-voice", feature: "faceless-voice", kind: "audio", request: { feature: "faceless-voice", modelId: "oss-chatterbox", op: "tts", prompt: "Hello" } });
    row({ id: "dub-plain", feature: "image", request: { feature: "image", modelId: "nano-banana-pro", op: "t2i", prompt: "x" }, dependsOn: "fl-voice" });
    const { draft, refusals } = builder.draftFromGenerations(["frame-1", "mm-frame", "fl-voice", "dub-plain"]);
    expect(draft).toBeNull();
    const why = Object.fromEntries(refusals.map((r) => [r.id, r.reason]));
    expect(why["frame-1"]).toBe(lib.notSupported("Storyboard"));
    expect(why["mm-frame"]).toBe("Made frame by frame in Mixed Media: making a skill from it isn't supported yet");
    expect(why["fl-voice"]).toBe(lib.notSupported("Faceless Studio"));
    // A plain result is refused with the reason of a step it needs.
    expect(why["dub-plain"]).toBe(lib.notSupported("Faceless Studio"));
  });

  it("lifts a dub to one dub_video step from its session, and refuses a studio with no tool", () => {
    row({ id: "dub-film", feature: "dub", kind: "video", op: "mux", request: { feature: "dub", modelId: "oss-mux", op: "mux" }, outputs: [{ url: clip, kind: "video" }] });
    const now = Date.now();
    db()
      .prepare("INSERT INTO dub_sessions (id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("dub1", JSON.stringify({ title: "talk", engine: "open", mode: "steps", video: clip, source: "en", targets: ["es", "de"], batchId: "b", prepare: { stems: "x" }, voices: { es: [{ ids: { film: "dub-film" }, at: now, lipsync: false }] } }), now, now);
    const { draft, refusals } = builder.draftFromGenerations(["dub-film"]);
    expect(refusals).toEqual([]);
    expect(draft!.recipe.steps).toEqual([expect.objectContaining({ kind: "tool", tool: "dub_video", input: { video: clip, languages: ["Spanish", "German"], source_language: "English", lipsync: false, review: true } })]);
    expect(draft!.candidates.filter((c) => c.kind === "media")).toEqual([expect.objectContaining({ type: "video", example: clip, at: [{ step: draft!.recipe.steps[0].key, path: ["video"] }] })]);
    // An open dub that picked its Voice split keeps it in the recipe.
    row({ id: "dub-film-dbs", feature: "dub", kind: "video", op: "mux", request: { feature: "dub", modelId: "oss-mux", op: "mux" }, outputs: [{ url: clip, kind: "video" }] });
    db()
      .prepare("INSERT INTO dub_sessions (id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("dub2", JSON.stringify({ title: "talk", engine: "open", mode: "steps", video: clip, source: "en", targets: ["es"], voiceSplit: "dbs", batchId: "b2", prepare: { stems: "y" }, voices: { es: [{ ids: { film: "dub-film-dbs" }, at: now, lipsync: true }] } }), now, now);
    expect(builder.draftFromGenerations(["dub-film-dbs"]).draft!.recipe.steps[0]).toMatchObject({ tool: "dub_video", input: { languages: ["Spanish"], voice_split: "dbs", review: true } });

    row({ id: "cinema-1", feature: "cinema", kind: "video", request: { feature: "cinema", modelId: "fuobe-cinema", op: "t2v", prompt: "a chase" } });
    row({ id: "dub-orphan", feature: "dub", kind: "video", request: { feature: "dub", modelId: "oss-mux", op: "mux" } });
    const no = builder.draftFromGenerations(["cinema-1", "dub-orphan"]);
    expect(no.refusals.map((r) => r.reason)).toEqual([lib.notSupported("Cinema Studio"), lib.notSupported("Translate & dub")]);
    // A studio step and generate steps don't mix yet.
    const mixed = builder.draftFromGenerations(["dub-film", "old-soul-1"]);
    expect(mixed.draft!.recipe.steps).toHaveLength(1);
    expect(mixed.refusals).toEqual([expect.objectContaining({ id: "dub-film", reason: expect.stringContaining("on its own") })]);
  });

  it("lifts a Katana job and a captioned video to their tools", () => {
    row({ id: "kat-final", feature: "katana", kind: "video", op: "concat", request: { feature: "katana", modelId: "join-clips", op: "concat" }, outputs: [{ url: clip, kind: "video" }] });
    const now = Date.now();
    db()
      .prepare("INSERT INTO katana_jobs (id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("kat1", JSON.stringify({ title: "edit", engine: "cloud", reference: clip, photos: [photo], instructions: "keep the jacket", motionModel: "kling-o3", segments: [{ start: 0, end: 5 }, { start: 5, end: 9 }], keepAudio: true, batchId: "kb", steps: { final: "kat-final" }, final: "final" }), now, now);
    const kat = builder.draftFromGenerations(["kat-final"]).draft!;
    expect(kat.recipe.steps).toEqual([expect.objectContaining({ kind: "tool", tool: "katana", input: { reference: clip, photos: [photo], instructions: "keep the jacket", segment_seconds: 5, motion_model: "kling-o3", keep_audio: true } })]);
    expect(kat.candidates.map((c) => [c.type, c.example])).toEqual([
      ["video", clip],
      ["image", photo],
      ["text", "keep the jacket"],
    ]);

    row({ id: "cap-burn", feature: "captions", kind: "video", op: "captions", request: { feature: "captions", modelId: "veed-subtitles", op: "captions", inputs: { video: clip }, params: { sourceLanguage: "en", targetLanguage: "Spanish" } }, outputs: [{ url: clip, kind: "video" }] });
    const cap = builder.draftFromGenerations(["cap-burn"]).draft!;
    expect(cap.recipe.steps).toEqual([expect.objectContaining({ kind: "tool", tool: "add_captions", input: { video: clip, spoken_language: "English", translate_to: "Spanish" } })]);

    // On the open engine the languages are on the transcript and the translation the burn waited for.
    row({ id: "cap-words", batch: "capopen", feature: "captions", kind: "text", op: "transcribe", request: { feature: "captions", modelId: "oss-qwen3-asr", op: "transcribe", inputs: { video: clip }, params: { sourceLanguage: "es" } } });
    row({ id: "cap-tr", batch: "capopen", feature: "captions", kind: "text", op: "translate", request: { feature: "captions", modelId: "oss-text-llm", op: "translate", params: { targetLanguage: "French" }, chain: [{ slot: "prompt" }] }, dependsOn: "cap-words" });
    row({ id: "cap-open", batch: "capopen", feature: "captions", kind: "video", op: "captions", request: { feature: "captions", modelId: "oss-captions-burnin", op: "captions", inputs: { video: clip }, params: { extra: { fontSize: 48 } }, chain: [{ slot: "prompt" }] }, dependsOn: "cap-tr", outputs: [{ url: clip, kind: "video" }] });
    const open = builder.draftFromGenerations(["cap-open"]).draft!;
    expect(open.recipe.steps).toEqual([expect.objectContaining({ kind: "tool", tool: "add_captions", input: { video: clip, spoken_language: "Spanish", translate_to: "French" } })]);
  });

  it("links results handed on by hand (the composer's Animate) into a chain", async () => {
    const [a] = gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", op: "t2i", prompt: "a brass desk lamp", params: { numOutputs: 2 } });
    await settle([a.id]);
    const still = gens.getGeneration(a.id)!.outputs[1].url;
    const [b] = gens.createGenerations({ feature: "edit", modelId: "nano-banana-pro", op: "edit", prompt: "on a plinth", inputs: { images: [still, photo] } });
    await settle([b.id]);
    const [c] = gens.createGenerations({ feature: "video", modelId: "kling-3", op: "i2v", prompt: "slow turntable", inputs: { images: [gens.getGeneration(b.id)!.outputs[0].url] } });
    await settle([c.id]);
    const { draft } = builder.draftFromGenerations([c.id, a.id, b.id]);
    const steps = draft!.recipe.steps as Extract<NonNullable<typeof draft>["recipe"]["steps"][number], { kind: "generate" }>[];
    expect(steps.map((s) => s.request.op)).toEqual(["t2i", "edit", "i2v"]);
    expect(steps[1]).toMatchObject({ after: steps[0].key, chain: [{ slot: "images", position: "first" }], request: { inputs: { images: [photo] } } });
    expect(steps[2]).toMatchObject({ after: steps[1].key, chain: [{ slot: "images", position: "first" }] });
    expect(steps[2].request.inputs).toBeUndefined();
    // A step that feeds another makes one result.
    expect((steps[0].request.params as { numOutputs?: number }).numOutputs).toBe(1);
    expect(draft!.candidates.filter((x) => x.kind === "media").map((x) => x.example)).toEqual([photo]);
    expect(recipeProblems(draft!.recipe)).toEqual([]);
  });

  it("makes unrelated picks parallel steps", async () => {
    const [a] = gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", op: "t2i", prompt: "a red chair" });
    const [b] = gens.createGenerations({ feature: "image", modelId: "flux-2-pro", op: "t2i", prompt: "a blue sofa" });
    await settle([a.id, b.id]);
    const { draft } = builder.draftFromGenerations([a.id, b.id]);
    expect(draft!.recipe.steps).toHaveLength(2);
    expect(draft!.recipe.steps.every((s) => s.kind === "generate" && s.after === undefined)).toBe(true);
    expect(draft!.steps.every((s) => s.leaf)).toBe(true);
    expect(Object.keys(draft!.recipe.checks ?? {})).toHaveLength(2);
  });

  it("makes a Library stack whose request ran as one job per result one step, as it was asked", () => {
    // A route that can't batch (a ComfyUI graph, Replicate without num_outputs) stores one row per result, each with the request.
    const req = { feature: "image", modelId: "nano-banana-pro", op: "t2i", prompt: "a teal armchair", params: { numOutputs: 4, aspectRatio: "1:1" } };
    const ids = [1, 2, 3, 4].map((i) => row({ id: `stack-${i}`, batch: "stackbatch", request: req, outputs: [{ url: `/api/files/outputs/stack-${i}.png`, kind: "image", width: 64, height: 64 }] }));
    for (const pick of [ids, [ids[2]]]) {
      const { draft, refusals } = builder.draftFromGenerations(pick);
      expect(refusals).toEqual([]);
      expect(draft!.recipe.steps).toHaveLength(1);
      const step = draft!.recipe.steps[0] as { key: string; request: { params?: { numOutputs?: number } } };
      // Four results, as asked: not four steps of four.
      expect(step.request.params?.numOutputs).toBe(4);
      expect(draft!.steps[0].notes).toContain("Ran as 4 jobs of one request: one step here");
      // How many rows a run makes depends on the route: the count isn't checked, even when it varies.
      expect(draft!.recipe.checks?.[step.key]).toEqual({ kind: "image", aspect: "1:1" });
      const takes = draft!.candidates.find((c) => c.setting === "numOutputs")!;
      expect(takes.example).toBe(4);
      const recipe = lib.buildRecipe(draft!, { varies: { [takes.id]: true } });
      expect(recipe.checks?.[step.key]?.count).toBeUndefined();
      expect(recipeProblems(recipe)).toEqual([]);
    }
  });

  it("makes a PixeletedFace run of several pictures one step", async () => {
    const made = gens.createGenerations({ feature: "image", modelId: "fuobe-soul", prompt: "a skater", engine: "cloud", presetId: "v1-pixeletedface", params: { numOutputs: 2, seed: 42 } });
    await settle(made.map((g) => g.id));
    const mosaics = made.filter((g) => !g.request.postMade);
    expect(mosaics).toHaveLength(2);
    const { draft, refusals } = builder.draftFromGenerations(mosaics.map((g) => g.id));
    expect(refusals).toEqual([]);
    expect(draft!.recipe.steps).toHaveLength(1);
    const step = draft!.recipe.steps[0] as { request: Record<string, unknown> & { params?: { numOutputs?: number; seed?: number } } };
    expect(step.request).toMatchObject({ modelId: "fuobe-soul", presetId: "v1-pixeletedface", engine: "cloud" });
    expect(step.request).not.toHaveProperty("postMade");
    expect(step.request.params).toMatchObject({ numOutputs: 2, seed: 42 });
  });

  it("refuses an Explainer episode and a Marketing Studio video's steps by name, and replays a Marketing picture", () => {
    row({ id: "ex-a", feature: "explainer", request: { feature: "explainer", modelId: "nano-banana-pro", op: "t2i", prompt: "scene 1" } });
    row({ id: "ex-b", feature: "explainer", kind: "video", request: { feature: "explainer", modelId: "kling-3", op: "i2v", prompt: "scene 1 moves", chain: [{ slot: "images" }] }, dependsOn: "ex-a" });
    row({ id: "mk-shot", feature: "marketing-step", kind: "video", request: { feature: "marketing-step", modelId: "kling-3", op: "t2v", prompt: "shot 1" } });
    row({ id: "mk-video", feature: "marketing", kind: "video", op: "concat", request: { feature: "marketing", modelId: "join-clips", op: "concat", chain: [{ slot: "videos" }] }, dependsOn: "mk-shot" });
    row({ id: "mk-photo", feature: "marketing", request: { feature: "marketing", modelId: "nano-banana-pro", op: "t2i", prompt: "Commercial product photograph of a lamp", params: { aspectRatio: "1:1" } } });
    const { draft, refusals } = builder.draftFromGenerations(["ex-b", "mk-video", "mk-photo"]);
    const why = Object.fromEntries(refusals.map((r) => [r.id, r.reason]));
    expect(why["ex-b"]).toBe(lib.notSupported("Explainer"));
    expect(why["mk-video"]).toBe(lib.notSupported("Marketing Studio"));
    expect(draft!.recipe.steps).toHaveLength(1);
    expect(draft!.steps[0].generation).toBe("mk-photo");
  });

  it("keeps the order of a list whose items earlier steps made, and says when it can't", () => {
    const out = (id: string, kind = "video") => [{ url: `/api/files/outputs/${id}.${kind === "video" ? "mp4" : "png"}`, kind }];
    const t = Date.now() - 60_000;
    const at = (id: string, ms: number) => db().prepare("UPDATE generations SET created_at = ? WHERE id = ?").run(t + ms, id);
    // A clip made first, then joined with an upload after it: the clip goes first, as it did.
    row({ id: "ord-c1", feature: "video", kind: "video", request: { feature: "video", modelId: "kling-3", op: "t2v", prompt: "a wave" }, outputs: out("ord-c1") });
    row({ id: "ord-join", feature: "video", kind: "video", op: "concat", request: { feature: "video", modelId: "join-clips", op: "concat", inputs: { videos: [out("ord-c1")[0].url, clip] } }, outputs: out("ord-join") });
    at("ord-c1", 0);
    at("ord-join", 1000);
    const join = builder.draftFromGenerations(["ord-join", "ord-c1"]).draft!;
    const j = join.recipe.steps.find((s) => s.kind === "generate" && s.request.op === "concat") as Extract<(typeof join.recipe.steps)[number], { kind: "generate" }>;
    expect(j.chain).toEqual([{ slot: "videos", position: "first" }]);
    expect(j.request.inputs).toEqual({ videos: [clip] });
    // A picture between two of the step's own goes last, and the step says so.
    row({ id: "ord-p", feature: "image", request: { feature: "image", modelId: "nano-banana-pro", op: "t2i", prompt: "a lamp" }, outputs: out("ord-p", "image") });
    row({ id: "ord-edit", feature: "edit", request: { feature: "edit", modelId: "nano-banana-pro", op: "edit", prompt: "together", inputs: { images: [photo, out("ord-p", "image")[0].url, "/api/files/uploads/other.png"] } }, outputs: out("ord-edit", "image") });
    at("ord-p", 2000);
    at("ord-edit", 3000);
    const edit = builder.draftFromGenerations(["ord-edit", "ord-p"]).draft!;
    const e = edit.recipe.steps.find((s) => s.kind === "generate" && s.request.op === "edit") as Extract<(typeof edit.recipe.steps)[number], { kind: "generate" }>;
    expect(e.chain).toEqual([{ slot: "images", position: "last" }]);
    expect(e.request.inputs).toEqual({ images: [photo, "/api/files/uploads/other.png"] });
    expect(edit.steps.find((s) => s.key === e.key)!.notes.some((n) => /another order/.test(n))).toBe(true);
  });

  it("keeps the engine an Original ran on in the request as asked", () => {
    const [clip0] = gens.createGenerations({ feature: "motion", modelId: "fuobe-dop", presetId: "effect-window", prompt: "a woman reading", inputs: { images: [photo] } });
    expect(clip0.request.asked?.engine).toBe(clip0.engine);
  });

  it("answers over the API, refusing what isn't there", async () => {
    const res = await draftRoute.POST(json({ generations: ["nope"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ draft: null, refusals: [{ id: "nope", title: "nope", reason: "It's gone (deleted, or in the Trash)" }] });
    expect((await draftRoute.POST(json({ generations: [] }))).status).toBe(400);
  });
});

describe("the naming pass", () => {
  const draft = () => ({
    candidates: [{ id: "image", label: "Image", type: "image" as const, kind: "media" as const, example: "/api/files/x.png", at: [] }],
    recipe: { fuobeRecipe: 1 as const, params: [], steps: [{ key: "edit", kind: "generate" as const, request: { feature: "edit", modelId: "m", prompt: "a matte black desk lamp on a plinth" } }] },
  });

  it("keeps what fits the draft and drops the rest", () => {
    const n = lib.parseNaming(
      'Here you go:\n```json\n{"name": "Lamp Turntable!", "title": "Lamp turntable", "inputs": [{"candidate": "image", "id": "product", "label": "Product photo"}, {"candidate": "nope", "id": "x", "label": "X"}], "slots": [{"step": "edit", "text": "a matte black desk lamp", "id": "product_name", "label": "Product"}, {"step": "edit", "text": "not in the prompt", "id": "y", "label": "Y"}]}\n```',
      draft(),
    );
    expect(n).toEqual({ name: "lamp-turntable", title: "Lamp turntable", inputs: [{ candidate: "image", id: "product", label: "Product photo" }], slots: [{ step: "edit", text: "a matte black desk lamp", id: "product_name", label: "Product" }] });
  });

  it("ignores malformed output", () => {
    expect(lib.parseNaming("no json here", draft())).toBeNull();
    expect(lib.parseNaming('{"title": 42}', draft())).toBeNull();
    expect(lib.parseNaming('{"inputs": [{"candidate": "image", "id": "1bad", "label": "x"}]}', draft())).toBeNull();
    expect(lib.parseNaming(null, draft())).toBeNull();
  });

  it("is skipped without an LLM", async () => {
    const p = await turntable();
    const res = await nameRoute.POST(json({ generations: [p.byKey.scene.id] }));
    expect(await res.json()).toEqual({ naming: null });
    expect(builder.draftFromGenerations([p.byKey.scene.id]).draft!.llm).toBeNull();
  });
});

describe("choices, body, check and save", () => {
  it("turns slots and Varies into inputs and keeps the body deterministic", async () => {
    const p = await turntable();
    const { draft } = builder.draftFromGenerations([p.byKey.spin.id]);
    const image = draft!.candidates.find((c) => c.kind === "media")!;
    const takes = draft!.candidates.find((c) => c.setting === "numOutputs")!;
    const recipe = lib.buildRecipe(draft!, {
      varies: { [image.id]: true, [takes.id]: true },
      ids: { [image.id]: "product" },
      labels: { [image.id]: "Product photo" },
      slots: [{ step: draft!.recipe.steps[1].key, text: "matte black desk lamp", id: "name", label: "Product name" }],
    });
    expect(recipe.params.map((x) => x.id)).toEqual(["product", "name", takes.id]);
    expect(recipe.params.find((x) => x.id === takes.id)).toMatchObject({ type: "number", default: 1, min: 1 });
    // The same words in both prompts are one input.
    const prompts = recipe.steps.flatMap((s) => (s.kind === "generate" && typeof s.request.prompt === "string" ? [s.request.prompt] : []));
    expect(prompts).toEqual(["a {{name}} on a travertine plinth, soft window light", "slow turntable of the {{name}}"]);
    const leaf = recipe.steps[2].key;
    expect(recipe.checks?.[leaf]?.count).toBe(`{{${takes.id}}}`);
    expect(recipeProblems(recipe)).toEqual([]);
    const meta = { title: "Lamp turntable", description: "A product turntable from a photo.", name: "lamp-turntable" };
    const body = lib.skillBody(recipe, draft!, meta);
    expect(lib.skillBody(recipe, draft!, meta)).toBe(body);
    expect(body).toContain("## Inputs");
    expect(body).toContain("**Product photo** (`product`)");
    expect(body).toContain("## Steps");
    expect(body).toContain("## Using Fuobe from an agent");
  });

  it("puts an element in for its @handle, and asks only for the prompt when the whole prompt varies too", () => {
    createElement({ name: "Maya", kind: "character", references: [photo] });
    row({ id: "el-shot", feature: "image", request: { feature: "image", modelId: "nano-banana-pro", op: "t2i", prompt: "@Maya walks on the beach" } });
    const { draft } = builder.draftFromGenerations(["el-shot"]);
    const el = draft!.candidates.find((c) => c.kind === "element")!;
    const words = draft!.candidates.find((c) => c.kind === "text")!;
    expect(el).toMatchObject({ type: "element", example: "@Maya" });
    const alone = lib.buildRecipe(draft!, { varies: { [el.id]: true } });
    expect(alone.params.map((p) => [p.id, p.type])).toEqual([[el.id, "element"]]);
    expect((alone.steps[0] as { request: { prompt: string } }).request.prompt).toBe(`{{${el.id}}} walks on the beach`);
    expect(recipeProblems(alone)).toEqual([]);
    // Both: the whole prompt carries the element, and there is no input left that nothing uses.
    const both = lib.buildRecipe(draft!, { varies: { [el.id]: true, [words.id]: true } });
    expect(both.params.map((p) => p.id)).toEqual([words.id]);
    expect((both.steps[0] as { request: { prompt: string } }).request.prompt).toBe(`{{${words.id}}}`);
    expect(recipeProblems(both)).toEqual([]);
  });

  it("checks a draft for free with Demo mode off and no keys, saves it with what passed, and runs it", async () => {
    const p = await turntable();
    const { draft } = builder.draftFromGenerations([p.byKey.spin.id]);
    const image = draft!.candidates.find((c) => c.kind === "media")!;
    const recipe = lib.buildRecipe(draft!, { varies: { [image.id]: true } });
    setSetting("demoMode", "off");
    try {
      const plan = await (await checkRoute.POST(json({ recipe, level: "plan" }))).json();
      expect(plan.ok).toBe(true);
      expect(plan.ready).toEqual(["cloud"]);
      const before = (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
      const demo = await (await checkRoute.POST(json({ recipe, level: "demo" }))).json();
      expect(demo.ok).toBe(true);
      expect(demo.engines[0].dryRun).toEqual({ ok: true, problems: [] });
      // The dry run's rows are hidden helpers, in the Trash once it ends.
      const made = db().prepare("SELECT g.feature, g.provider, t.deleted_at FROM generations g LEFT JOIN generation_trash t ON t.generation_id = g.id ORDER BY g.created_at DESC LIMIT ?").all((db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n - before) as { feature: string; provider: string; deleted_at: number | null }[];
      expect(made.length).toBe(3);
      expect(made.every((r) => r.feature === "skill-check" && r.provider === "mock" && r.deleted_at)).toBe(true);
      const res = await saveRoute.POST(json({ name: "lamp-turntable", title: "Lamp turntable", description: "A product turntable from a photo.", body: lib.skillBody(recipe, draft!, { title: "Lamp turntable", description: "x" }), recipe }));
      expect(res.status).toBe(201);
      const view = await res.json();
      expect(view.ready).toEqual(["cloud"]);
      // The dry run that passed on the draft comes with it.
      expect(view.recipe.verified.cloud.dryRun).toBeTruthy();
      expect(view.recipe.source.demo).toBe(true);
    } finally {
      setSetting("demoMode", "auto");
    }
    const run = await recipes.runRecipe("lamp-turntable", { values: { [image.id]: photo } });
    expect(run.runs[0].ids).toHaveLength(3);
    // Saving the same name twice, or a reserved one, is refused.
    expect((await saveRoute.POST(json({ name: "lamp-turntable", title: "x", description: "x", body: "x", recipe }))).status).toBe(409);
    expect(() => skills.createSkill({ name: "draft", title: "Draft", description: "x", body: "x" })).toThrow(/reserved/);
  });

  it("writes a dry run still going when the draft was saved into the saved skill", async () => {
    const p = await turntable();
    const { draft } = builder.draftFromGenerations([p.byKey.scene.id]);
    const recipe = lib.buildRecipe(draft!, { varies: { [draft!.candidates.find((c) => c.kind === "text")!.id]: true } });
    await recipes.checkDraft(recipe, "plan");
    const dry = recipes.checkDraft(recipe, "demo");
    const view = await recipes.saveDraft({ name: "scene-early", title: "Scene", description: "A scene.", body: "# Scene", recipe });
    expect(view.recipe.verified?.cloud?.plan).toBeTruthy();
    expect(view.recipe.verified?.cloud?.dryRun ?? null).toBeNull();
    expect((await dry).ok).toBe(true);
    expect(recipes.recipeView("scene-early").recipe.verified?.cloud?.dryRun).toBeTruthy();
  });

  it("refuses to save a recipe whose plan fails, and keeps no half-made skill", async () => {
    const bad = { fuobeRecipe: 1, params: [], steps: [{ key: "a", kind: "generate", request: { feature: "image", modelId: "no-such-model", prompt: "x" } }] };
    const res = await saveRoute.POST(json({ name: "broken-draft", title: "Broken", description: "x", body: "x", recipe: bad }));
    expect(res.status).toBe(422);
    expect(skills.getSkill("broken-draft")).toBeNull();
  });
});
