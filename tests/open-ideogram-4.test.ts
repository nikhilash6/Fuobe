import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenInput, Generation, Operation } from "@/lib/catalog/types";
import type { ComfyWorkflow, Manifest } from "@/lib/comfy";
import type { ChatRequest } from "@/server/llm";

// Ideogram 4 on the open engine: the owner's int8 graph with its Quality / Default / Turbo preset table, and the JSON
// caption the server writes from the words before the run (lean JSON, src/lib/ideogram-caption.ts).
vi.setConfig({ testTimeout: 60_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-ideogram4-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: runs fall back to the demo
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.ANTHROPIC_API_KEY; // a key on this machine must not reach Claude

// The local LLM: each call takes the next answer (null: nothing answers) and is kept.
const llm = vi.hoisted(() => ({ answers: [] as (string | null)[], seen: [] as { system: string; user: string; json: unknown }[] }));
vi.mock("@/server/llm", async (orig) => ({
  ...(await orig<typeof import("@/server/llm")>()),
  activeLocal: async () => ({ server: { kind: "ollama", url: "http://127.0.0.1:9" }, status: { loaded: true } }),
  chatLocal: async (_ready: unknown, req: ChatRequest) => {
    llm.seen.push({ system: String(req.messages[0].content), user: String(req.messages[1].content), json: req.json });
    return { text: llm.answers.shift() ?? "" };
  },
}));

const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration } = await import("@/server/generations");
const { mockProvider } = await import("@/server/providers/mock");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { ideogramCaption } = await import("@/server/enhance");
const { looksBlocked } = await import("@/server/safety-card");
const { encodePng } = await import("@/server/png");
const { listAssets } = await import("@/server/storage");
const { getModel, getPreset, MODELS } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { computeDimensions } = await import("@/lib/comfy");
const { licenceInfo, licenceTerms } = await import("@/lib/licences");
const { captionFromWords, captionRequest, leanProblems, parseCaption, readCaption, writeCaption } = await import("@/lib/ideogram-caption");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  llm.answers = [];
  llm.seen = [];
});

const LIBRARY = path.join(process.cwd(), "workflows/comfyui");
const manifest = JSON.parse(fs.readFileSync(path.join(LIBRARY, "manifest.json"), "utf8")) as Manifest;
const entry = () => manifest.workflows.find((w) => w.id === "ideogram4-t2i");
/** The graph as committed (the library's copy is the same nodes, sorted). */
const graph = () => JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/comfy/hand-built/ideogram4-t2i.json"), "utf8")) as ComfyWorkflow;

/** A lean caption as the schema orders it (the graph's own example). */
const GOOD = {
  high_level_description:
    "A full-length editorial fashion photograph of a woman in a floor-length ivory silk slip gown at the stone balustrade of a Mediterranean villa terrace above a calm turquoise sea, late morning.",
  style_description: {
    aesthetics: "luxurious, serene, editorial, high-end fashion campaign",
    lighting: "soft late-morning sun from the left, open shade fill, neutral white balance",
    photo: "85mm lens, f/2.8, eye level, smooth skin with fine pores",
    medium: "photograph",
    color_palette: ["#F3EEE4", "#D9CBB4", "#9DB09A", "#3FA7B5", "#1F5F7A", "#2B2522"],
  },
  compositional_deconstruction: {
    background: "A sunlit terrace of pale travertine with a carved stone balustrade, white bougainvillea on a limestone wall, and a calm turquoise sea under a clear sky.",
    elements: [
      {
        type: "obj",
        bbox: [150, 520, 1000, 820],
        desc: "A fashion model in her late twenties with dark brown hair in a loose low chignon, sculpted cheekbones, wearing a floor-length ivory silk slip gown, standing in a relaxed contrapposto with one hand on the balustrade, face turned towards the camera. Her whole head is inside the frame.",
      },
    ],
  },
};
const good = JSON.stringify(GOOD);
type Caption = Omit<typeof GOOD, "compositional_deconstruction"> & {
  compositional_deconstruction: { background: string; elements: { type: string; bbox?: number[]; text?: string; desc: string }[] };
};
const variant = (change: (c: Caption) => void) => {
  const c = structuredClone(GOOD) as Caption;
  change(c);
  return JSON.stringify(c);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settled(id: string, ms = 20_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`${id} is still ${g.status}`);
    await sleep(50);
  }
}
async function prepare(input: GenInput, op: Operation = "t2i"): Promise<ComfyWorkflow> {
  const { workflow } = await prepareWorkflow("ideogram4-t2i", { seed: 7, ...input }, { generationId: "g", op, upload: async (_d, _t, name) => `up_${name}`, media: () => undefined, serverRam: async () => undefined });
  return workflow;
}

describe("Ideogram 4 captions", () => {
  it("keeps a caption it is given, in the schema's key order, without aspect_ratio or keys the model wasn't trained on", () => {
    const given = JSON.stringify({
      compositional_deconstruction: {
        elements: [{ desc: GOOD.compositional_deconstruction.elements[0].desc, bbox: [150, 520, 1000, 820], type: "obj", mood: "calm" }],
        background: GOOD.compositional_deconstruction.background,
      },
      aspect_ratio: "4:3",
      style_description: { medium: "photograph", color_palette: GOOD.style_description.color_palette.map((c) => c.toLowerCase()), photo: GOOD.style_description.photo, lighting: GOOD.style_description.lighting, aesthetics: GOOD.style_description.aesthetics },
      high_level_description: GOOD.high_level_description,
      negative_prompt: "blurry",
    });
    expect(parseCaption(given)).toBe(good);
    // Pretty-printed or in a code fence (an LLM's answer), it is the same caption.
    expect(parseCaption(`Here it is:\n\`\`\`json\n${JSON.stringify(GOOD, null, 2)}\n\`\`\``)).toBe(good);
    // Already compact and in order: unchanged, byte for byte.
    expect(parseCaption(good)).toBe(good);
  });

  it("doesn't take plain words, or other JSON, for a caption", () => {
    expect(parseCaption("a red fox in deep snow")).toBeNull();
    expect(parseCaption('a neon sign reading {OPEN}')).toBeNull();
    expect(parseCaption('{"prompt":"a red fox"}')).toBeNull();
    expect(parseCaption('{"compositional_deconstruction":"a fox"}')).toBeNull();
  });

  it("keeps one of photo and art_style, palettes as uppercase hex, boxes inside 0–1000, lettering as written", () => {
    const c = readCaption(
      JSON.stringify({
        high_level_description: "A flat vector poster of a fox.",
        style_description: { aesthetics: "bold", lighting: "flat", photo: "50mm", medium: "illustration", art_style: "flat vector, thick outlines", color_palette: ["#abc", "#e43f5a", 7] },
        compositional_deconstruction: {
          background: "A cream backdrop.",
          elements: [
            { type: "obj", bbox: [10.4, 20, 2000, 900], desc: "A red fox." },
            { type: "obj", bbox: [600, 0, 100, 900], desc: "A pine tree." },
            { type: "text", text: "  Wild  Things\n", desc: "Bold black letters across the top." },
            { type: "text", desc: "A text element without its text is an object." },
            { type: "obj", desc: "" },
          ],
        },
      }),
    )!;
    expect(c.style_description).toEqual({ aesthetics: "bold", lighting: "flat", medium: "illustration", art_style: "flat vector, thick outlines", color_palette: ["#E43F5A"] });
    expect(Object.keys(c.style_description!)).toEqual(["aesthetics", "lighting", "medium", "art_style", "color_palette"]);
    expect(c.compositional_deconstruction.elements).toEqual([
      { type: "obj", bbox: [10, 20, 1000, 900], desc: "A red fox." },
      { type: "obj", desc: "A pine tree." },
      { type: "text", text: "  Wild  Things\n", desc: "Bold black letters across the top." },
      { type: "obj", desc: "A text element without its text is an object." },
    ]);
    expect(Object.keys(c.compositional_deconstruction.elements[2])).toEqual(["type", "text", "desc"]);
  });

  it("wraps plain words byte for byte when no LLM writes the caption", () => {
    expect(captionFromWords("  a red   fox\n in deep snow ")).toBe(
      '{"high_level_description":"a red fox in deep snow","compositional_deconstruction":{"background":"","elements":[{"type":"obj","desc":"a red fox in deep snow"}]}}',
    );
    expect(captionFromWords('a sign that says "OPEN"')).toBe(
      '{"high_level_description":"a sign that says \\"OPEN\\"","compositional_deconstruction":{"background":"","elements":[{"type":"obj","desc":"a sign that says \\"OPEN\\""}]}}',
    );
    // The wrapper is a caption the model reads as one (and the run keeps as it is).
    expect(parseCaption(captionFromWords("a red fox"))).toBe(captionFromWords("a red fox"));
  });

  it("lints the lean caps, negations and the words that trip the safety filter", () => {
    expect(leanProblems(good)).toEqual([]);
    // The graph's own example prompt is a lean caption too.
    const example = String(graph()["98:24"].inputs.text);
    expect(parseCaption(example)).toBe(example);
    expect(leanProblems(example)).toEqual([]);

    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    expect(leanProblems(variant((c) => (c.high_level_description = long)))).toEqual(["high_level_description has 40 words (at most 35)"]);
    expect(leanProblems(variant((c) => (c.compositional_deconstruction.background = long)))).toEqual(["background has 40 words (at most 35)"]);
    expect(leanProblems(variant((c) => (c.style_description.lighting = "soft window light from the left")))).toEqual(['lighting does not end with "neutral white balance"']);
    expect(leanProblems(variant((c) => (c.style_description.photo = `${long} lens`)))).toEqual(["photo has 41 words (at most 13)"]);
    expect(leanProblems(variant((c) => (c.compositional_deconstruction.elements[0].desc = `${long} ${long}`))).join()).toMatch(/main element's desc has 80 words/);
    expect(leanProblems(variant((c) => (c.compositional_deconstruction.background = "A cliff path with no tourists and not a cloud")))).toEqual([
      "it says no, not: describe only what is in the picture, a negated thing is still drawn",
    ]);
    expect(leanProblems(variant((c) => (c.high_level_description += " A sexy look.")))[0]).toMatch(/"sexy"/);
    expect(leanProblems(variant((c) => (c.compositional_deconstruction.elements[0].desc += " A sheer weathered shawl.")))[0]).toMatch(/^it says sheer, weathered/);
    expect(leanProblems(variant((c) => (c.compositional_deconstruction.background = "An empty beach.")))[0]).toMatch(/"empty"/);
    expect(leanProblems(variant((c) => (c.compositional_deconstruction.elements = [])))).toEqual(["there are no elements (a caption without them invites the safety card)"]);
    const objects = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "obj", desc: `A pebble number ${i}.` }));
    expect(leanProblems(variant((c) => (c.compositional_deconstruction.elements = objects(6))))).toEqual(["there are 6 object elements (at most 5)"]);

    // Words about lettering draw lettering in a picture that has none; with a text element they belong, and the
    // lettering itself is never judged.
    const sign = variant((c) => (c.compositional_deconstruction.background = "A café wall with a hand-painted sign."));
    expect(leanProblems(sign)[0]).toMatch(/draws lettering/);
    const poster = variant((c) => {
      c.compositional_deconstruction.background = "A café wall with a hand-painted sign.";
      c.compositional_deconstruction.elements.push({ type: "text", text: "NO LIMITS, NOT EVER, SHEER", desc: "Gold serif letters on the sign." });
      for (let i = 0; i < 6; i++) c.compositional_deconstruction.elements.push({ type: "text", text: `Line ${i}`, desc: "Small gold letters." });
    });
    expect(leanProblems(poster)).toEqual([]);
    expect(leanProblems("a red fox")).toEqual(["it is not a caption in the schema (JSON with compositional_deconstruction)"]);
  });

  it("writes a caption with the LLM, and uses a good one as it is", async () => {
    const asked: string[] = [];
    const out = await writeCaption("a model on a villa terrace", { width: 1776, height: 1328 }, async (r) => {
      asked.push(r);
      return `\`\`\`json\n${JSON.stringify(GOOD, null, 2)}\n\`\`\``;
    });
    expect(out).toBe(good);
    expect(asked).toEqual(["Idea: a model on a villa terrace\nPicture: 1776 × 1328 px, landscape"]);
  });

  it("asks once more with the problems listed, and falls back to the first answer, then to the wrapper", async () => {
    const bad = variant((c) => {
      c.compositional_deconstruction.background = "A terrace with no people.";
    });
    const asked: string[] = [];
    const answers = [bad, good];
    const ask = async (r: string) => {
      asked.push(r);
      return answers.shift() ?? null;
    };
    expect(await writeCaption("a model on a terrace", {}, ask)).toBe(good);
    expect(asked[1]).toBe(captionRequest("a model on a terrace", {}, { caption: bad, problems: leanProblems(bad) }));
    expect(asked[1]).toContain("It breaks these rules:\n- it says no: describe only what is in the picture");
    expect(asked[1]).toContain("Picture: square");
    // Neither answer is a caption: the wrapper.
    expect(await writeCaption("a model on a terrace", {}, async () => "Sorry, I can't.")).toBe(captionFromWords("a model on a terrace"));
    // A second answer that isn't a caption: the first one, with its problems, beats the plain wrapper.
    const twice = [bad, "Sorry, I can't."];
    expect(await writeCaption("a model on a terrace", {}, async () => twice.shift() ?? null)).toBe(bad);
    // No LLM, or one that fails: the wrapper, without asking again.
    let calls = 0;
    const none = async () => {
      calls++;
      return null;
    };
    expect(await writeCaption("a red fox", {}, none)).toBe(captionFromWords("a red fox"));
    expect(await writeCaption("a red fox", {}, async () => Promise.reject(new Error("down")))).toBe(captionFromWords("a red fox"));
    expect(calls).toBe(1);
  });

  it("asks the local LLM for JSON with its own instructions, and wraps the words when none answers", async () => {
    setSetting("enhanceProvider", "local");
    llm.answers = [good];
    expect(await ideogramCaption("a model on a villa terrace", { width: 1536, height: 1536 })).toBe(good);
    expect(llm.seen).toHaveLength(1);
    expect(llm.seen[0]).toMatchObject({ json: "object", user: "Idea: a model on a villa terrace\nPicture: 1536 × 1536 px, square" });
    expect(llm.seen[0].system).toMatch(/Ideogram 4/);
    expect(llm.seen[0].system).toMatch(/neutral white balance/);
    expect(llm.seen[0].system).toMatch(/late twenties/);
    // An empty answer is no answer.
    llm.answers = [""];
    expect(await ideogramCaption("a red fox")).toBe(captionFromWords("a red fox"));
    setSetting("enhanceProvider", "none");
    expect(await ideogramCaption("a red fox")).toBe(captionFromWords("a red fox"));
    expect(llm.seen).toHaveLength(2);
  });

  it("never asks Claude, even with a key and the AI helper set to Anthropic: a run on your GPU stays free", async () => {
    setSetting("enhanceProvider", "anthropic");
    setSetting("anthropicKey", "sk-ant-not-a-key");
    try {
      llm.answers = [good];
      expect(await ideogramCaption("a model on a villa terrace")).toBe(good);
      expect(llm.seen).toHaveLength(1);
    } finally {
      setSetting("anthropicKey", "");
      setSetting("enhanceProvider", "none");
    }
  });
});

describe("Ideogram 4 on the open engine", () => {
  it("is the owner's int8 graph: dual-model guidance, the fp8 Qwen3-VL encoder, the preset table on Quality", () => {
    const wf = entry()!;
    expect(wf).toMatchObject({ capability: "t2i", customNodes: [], defaults: { width: 1024, height: 1024, preset: "Quality" }, limits: { maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 } });
    expect(Object.keys(wf.bindings).sort()).toEqual(["filenamePrefix", "height", "preset", "prompt", "seed", "width"]);
    expect(wf.models.map((m) => `${m.folder}/${m.file}`).sort()).toEqual([
      "diffusion_models/ideogram4_int8_convrot.safetensors",
      "diffusion_models/ideogram4_unconditional_int8_convrot.safetensors",
      "text_encoders/qwen3vl_8b_fp8_scaled.safetensors",
      "vae/flux2-vae.safetensors",
    ]);
    // The library's flux2-vae pin, not a second build of the same name.
    expect(wf.models.find((m) => m.file === "flux2-vae.safetensors")?.url).toContain("/Comfy-Org/flux2-dev/");
    const g = graph();
    const by = (cls: string) => Object.entries(g).filter(([, n]) => n.class_type === cls);
    expect(by("UNETLoader").map(([, n]) => n.inputs.unet_name).sort()).toEqual(["ideogram4_int8_convrot.safetensors", "ideogram4_unconditional_int8_convrot.safetensors"]);
    expect(by("CLIPLoader")[0][1].inputs).toMatchObject({ clip_name: "qwen3vl_8b_fp8_scaled.safetensors", type: "ideogram4" });
    const [[, guider]] = by("DualModelGuider");
    expect(guider.inputs.cfg).toBe(7);
    expect(g[(guider.inputs.model_negative as [string, number])[0]].inputs.unet_name).toBe("ideogram4_unconditional_int8_convrot.safetensors");
    expect(g[(guider.inputs.negative as [string, number])[0]].class_type).toBe("ConditioningZeroOut");
    expect(g[(guider.inputs.model as [string, number])[0]].inputs).toMatchObject({ cfg: 3, start_percent: 0.7, end_percent: 1 });
    expect(by("KSamplerSelect")[0][1].inputs.sampler_name).toBe("euler");
    expect(g["98:156"].inputs.choice).toBe("Quality");
    const table = JSON.parse(String(by("JsonExtractString").find(([, n]) => typeof n.inputs.json_string === "string")![1].inputs.json_string));
    expect(table).toMatchObject({ Quality: { num_steps: 48, mu: 0, std: 1.5 }, Default: { num_steps: 20, mu: 0, std: 1.75 }, Turbo: { num_steps: 12, mu: 0.5, std: 1.75 } });
    expect(by("ComfyMathExpression").map(([, n]) => n.inputs.expression)).toEqual(["max(((a + 15) // 16) * 16, 256)", "max(((a + 15) // 16) * 16, 256)"]);
    // Non-commercial weights, said as information.
    expect(licenceTerms(wf.license!).flags).toEqual(["non-commercial"]);
    expect(licenceInfo(wf.license!)).toMatchObject({ name: "Ideogram Non-Commercial Model Agreement", class: "non-commercial" });
  });

  it("is the open engine's text-to-image model for typography, with the preset control the graph runs when left alone", () => {
    const m = getModel("oss-ideogram-4")!;
    expect(m).toMatchObject({ engine: "open", kind: "image", family: "ideogram", options: { promptFormat: "ideogram4", seed: true } });
    expect(m.badges).toEqual(expect.arrayContaining(["open", "new", "top"]));
    expect(m.routes.map((r) => [r.op, r.provider, r.endpoint])).toEqual([["t2i", "comfyui", "ideogram4-t2i"]]);
    expect(m.tagline).toMatch(/24 GB GPU · non-commercial weights/);
    // First among the open-source text-to-image models, after the Originals (the owner's order: Ideogram 4, Qwen-Image 2.1,
    // Krea 2, MOSS, FIBO 2).
    expect(MODELS.find((x) => x.id.startsWith("oss-") && x.routes.some((r) => r.op === "t2i"))?.id).toBe("oss-ideogram-4");
    const [preset] = m.options.controls!;
    expect(preset).toMatchObject({ param: "preset", values: ["Quality", "Default", "Turbo"], default: graph()["98:156"].inputs.choice });
    expect(Object.keys(entry()!.bindings)).toContain(preset.param);
    // Text to image only: a picture added doesn't make it an edit.
    const plan = (r: Record<string, unknown>) => planGeneration({ feature: "image", modelId: "oss-ideogram-4", ...r } as Parameters<typeof planGeneration>[0], getModel, getPreset);
    expect(plan({ prompt: "a red fox" }).op).toBe("t2i");
    expect(plan({ prompt: "a red fox", inputs: { images: ["/a.png"] } }).op).toBe("t2i");
    expect(() => plan({})).toThrow("Write a prompt first");
    expect(plan({ prompt: "a red fox" }).params).toMatchObject({ aspectRatio: "1:1", resolution: "1.5K" });
  });

  it("fills the caption, the size on the 16-pixel grid, the seed and the preset", async () => {
    const wf = await prepare({ prompt: good, aspectRatio: "4:3", resolution: "1.5K" });
    expect(wf["98:24"].inputs.text).toBe(good);
    const want = computeDimensions("4:3", "1.5K", {}, 16);
    expect([wf["98:27"].inputs.value, wf["98:28"].inputs.value]).toEqual([want.width, want.height]);
    expect(wf["98:18"].inputs.noise_seed).toBe(7);
    expect(wf["98:156"].inputs.choice).toBe("Quality");
    expect((await prepare({ prompt: good, extra: { preset: "Turbo" } }))["98:156"].inputs.choice).toBe("Turbo");
    // Every shape lands on the grid within 2048 px a side.
    for (const ar of ["1:1", "16:9", "9:16", "21:9", "4:5"]) {
      for (const res of ["1K", "1.5K", "2K"]) {
        const p = await prepare({ prompt: good, aspectRatio: ar, resolution: res });
        const [w, h] = [Number(p["98:27"].inputs.value), Number(p["98:28"].inputs.value)];
        expect([w % 16, h % 16, w <= 2048 && h <= 2048], `${ar} ${res}`).toEqual([0, 0, true]);
      }
    }
  });
});

describe("Ideogram 4 runs", () => {
  /** A demo run of Ideogram 4; what the provider was handed comes back too. */
  async function run(prompt: string, params: Record<string, unknown> = {}) {
    const submit = mockProvider.submit;
    const handed: GenInput[] = [];
    mockProvider.submit = async (ctx) => {
      if (ctx.model.id === "oss-ideogram-4") handed.push(ctx.input);
      return submit(ctx);
    };
    try {
      const [g] = createGenerations({ feature: "image", modelId: "oss-ideogram-4", prompt, params });
      return { g: await settled(g.id), handed };
    } finally {
      mockProvider.submit = submit;
    }
  }

  it("writes the caption before the run and keeps it as the run's prompt, in place of Enhance", async () => {
    setSetting("enhanceProvider", "local");
    llm.answers = [JSON.stringify(GOOD, null, 2)];
    const { g, handed } = await run("a model on a villa terrace", { enhancePrompt: true });
    expect(g.status).toBe("succeeded");
    expect(g.prompt).toBe(good);
    expect(handed[0].prompt).toBe(good);
    // One call, the caption writer's (the generic Enhance didn't run first).
    expect(llm.seen).toHaveLength(1);
    expect(llm.seen[0].system).toMatch(/Ideogram 4/);
    expect(llm.seen[0].user).toBe("Idea: a model on a villa terrace\nPicture: 1536 × 1536 px, square");
  });

  it("keeps a caption it is given (a reused run) without asking the LLM", async () => {
    setSetting("enhanceProvider", "local");
    const { g } = await run(JSON.stringify({ aspect_ratio: "1:1", ...GOOD }));
    expect(g.prompt).toBe(good);
    expect(llm.seen).toEqual([]);
  });

  it("wraps the words when no LLM is set up", async () => {
    setSetting("enhanceProvider", "none");
    const { g, handed } = await run("a red fox in deep snow");
    expect(g.prompt).toBe(captionFromWords("a red fox in deep snow"));
    expect(handed[0].prompt).toBe(g.prompt);
  });
});

describe("Ideogram 4's grey safety card", () => {
  /** A picture drawn pixel by pixel, as a PNG. */
  const png = (w: number, h: number, at: (x: number, y: number) => [number, number, number]) => {
    const data = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...at(x, y), 255], (y * w + x) * 4);
    return encodePng({ width: w, height: h, data });
  };
  // The card: flat, slightly warm mid-grey, one line of dark type across the middle.
  const card = png(640, 480, (x, y) => (y > 232 && y < 248 && x > 180 && x < 460 && x % 4 < 2 ? [58, 58, 57] : [120, 118, 116]));
  const gradient = png(640, 480, (x, y) => [Math.round((x / 639) * 255), Math.round((y / 479) * 255), 128]);
  const greyWall = png(640, 480, (_x, y) => {
    const v = 60 + Math.round((y / 479) * 130);
    return [v, v, v];
  });

  it("finds the card, and leaves pictures alone, a grey one too", () => {
    expect(looksBlocked(card)).toBe(true);
    expect(looksBlocked(gradient)).toBe(false);
    expect(looksBlocked(greyWall)).toBe(false);
    expect(looksBlocked(Buffer.from("not a picture"))).toBe(false);
  });

  /** A demo run of Ideogram 4 whose GPU answers with this picture. */
  async function answered(picture: Buffer) {
    const poll = mockProvider.poll;
    mockProvider.poll = async (ctx) => (ctx.model.id === "oss-ideogram-4" ? { state: "succeeded", outputs: [{ url: `data:image/png;base64,${picture.toString("base64")}`, kind: "image" }] } : poll(ctx));
    try {
      setSetting("enhanceProvider", "none");
      const [g] = createGenerations({ feature: "image", modelId: "oss-ideogram-4", prompt: "a red fox in deep snow" });
      return await settled(g.id);
    } finally {
      mockProvider.poll = poll;
    }
  }

  it("fails the run with what to try, and keeps no file of it", async () => {
    const g = await answered(card);
    expect(g.status).toBe("failed");
    expect(g.error).toBe("Ideogram 4's safety filter blocked this picture and sent its grey card instead. Run it again for a new seed, or try Qwen-Image 2.1 or Krea 2 Realism.");
    expect(g.outputs).toEqual([]);
    expect(listAssets({ source: "generation", limit: 1000 }).filter((a) => a.generationId === g.id)).toEqual([]);
  });

  it("keeps a real picture", async () => {
    const g = await answered(gradient);
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(g.outputs).toHaveLength(1);
  });
});
