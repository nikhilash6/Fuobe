import fs from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { buildPayload } from "@/lib/catalog/payload";
import { planGeneration } from "@/lib/catalog/plan";
import type { GenerationRequest, ModelRoute } from "@/lib/catalog/types";
import {
  applyFilmLook,
  FILM_LOOK_GROUPS,
  FILM_LOOKS,
  filmLook,
  filmLookGroups,
  filmLookThumb,
  hasColourWords,
  joinNegatives,
  MOSS_BASE_NEGATIVE,
  scrubColourWords,
  takesFilmLooks,
} from "@/lib/film-looks";
import { tempDir } from "./helpers/temp-dir";

// MOSS-Image's film looks (src/lib/film-looks.ts): the sandwich, the negatives, the colour scrub of a monochrome look, the
// plan that carries the look without sending it, and the run that applies it while the person's words stay as typed.
process.env.FUOBE_DATA_DIR = tempDir("fuobe-film-");
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const llm = vi.hoisted(() => ({ answer: null as string | null, calls: [] as { system: string; user: string }[] }));
vi.mock("@/server/enhance", async (orig) => ({
  ...(await orig<typeof import("@/server/enhance")>()),
  llmText: async (system: string, user: string) => {
    llm.calls.push({ system, user });
    return llm.answer;
  },
}));

const SCENE = "A fashion model in her late twenties with long auburn waves and green eyes stands beside a tall arched window, wearing an emerald silk evening gown and gold drop earrings. Soft daylight falls across her face.";

describe("the looks", () => {
  it("are grouped in the picker's order, each with a unique id, a name, a blurb and its thumbnails", () => {
    expect(new Set(FILM_LOOKS.map((l) => l.id)).size).toBe(FILM_LOOKS.length);
    for (const l of FILM_LOOKS) {
      expect(FILM_LOOK_GROUPS, l.id).toContain(l.group);
      expect(l.name && l.blurb && l.recipe && l.negative, l.id).toBeTruthy();
      for (const w of [320, 640] as const) {
        const t = filmLookThumb(l.id, w);
        for (const file of [t.avif, t.webp]) expect(fs.existsSync(`public${file}`), file).toBe(true);
      }
    }
    const groups = filmLookGroups();
    expect(groups.map((g) => g.group)).toEqual(FILM_LOOK_GROUPS.filter((g) => FILM_LOOKS.some((l) => l.group === g)));
    expect(groups.flatMap((g) => g.looks)).toHaveLength(FILM_LOOKS.length);
  });

  it("say what shows, never a film or camera brand, and name nothing unwanted in the words MOSS-Image draws", () => {
    const brands = /\b(kodak|fuji(?:film)?|portra|velvia|ektar|ektachrome|kodachrome|cinestill|vision ?3|ilford|tri-?x|t-?max|hp5|polaroid|instax|holga|diana|lomo(?:graphy)?|lomochrome|leica|hasselblad|canon|nikon|agfa|instamatic|classic chrome)\b/i;
    const negated = /\b(no|not|without|never|none|free of|avoid)\b/i;
    for (const l of FILM_LOOKS) {
      expect(`${l.name} ${l.blurb} ${l.recipe}`, l.id).not.toMatch(brands);
      expect(l.recipe, l.id).not.toMatch(negated);
    }
  });

  it("is only MOSS-Image's, on both engines", () => {
    expect(["oss-moss-image", "moss-image"].map((id) => takesFilmLooks(getModel(id)))).toEqual([true, true]);
    expect(["oss-ideogram4", "nano-banana-pro", "oss-krea2-turbo"].map((id) => takesFilmLooks(getModel(id)))).toEqual([false, false, false]);
    expect(filmLook("night-halation")?.name).toBeTruthy();
    expect(filmLook("nope")).toBeUndefined();
    expect(filmLook(7)).toBeUndefined();
  });
});

describe("applying a look", () => {
  const look = FILM_LOOKS.find((l) => !l.mono)!;

  it("sandwiches the scene between the look said twice", () => {
    const a = applyFilmLook(look, "a model on a terrace in the afternoon sun.");
    const recipe = `${look.recipe.charAt(0).toUpperCase()}${look.recipe.slice(1)}.`;
    expect(a.prompt).toBe(`${recipe} A model on a terrace in the afternoon sun. ${recipe}`);
    expect(a.prompt.startsWith(recipe) && a.prompt.endsWith(recipe)).toBe(true);
  });

  it("puts the person's negative first, then the look's opposite, then MOSS-Image's base negative, without repeats", () => {
    const a = applyFilmLook(look, "a scene", "blurry, Watermark");
    expect(a.negative.startsWith("blurry, Watermark, ")).toBe(true);
    expect(a.negative).toContain(look.negative.split(",")[0].trim());
    expect(a.negative.endsWith("nsfw, worst quality, bad anatomy, jpeg artifact")).toBe(true);
    expect(a.negative.match(/watermark/gi)).toHaveLength(1);
    expect(applyFilmLook(look, "a scene").negative).toBe(joinNegatives(look.negative, MOSS_BASE_NEGATIVE));
  });

  it("gives a monochrome look's negative the colours, and its words none", () => {
    const mono = FILM_LOOKS.filter((l) => l.mono);
    expect(mono.length).toBeGreaterThan(0);
    for (const l of mono) {
      expect(l.negative, l.id).toMatch(/\bcolou?r/i);
      expect(applyFilmLook(l, scrubColourWords(SCENE)).prompt, l.id).not.toMatch(/auburn|green|emerald|\bgold\b/i);
    }
  });
});

describe("taking the colour words out", () => {
  it("removes hues, shades and -coloured words, keeps tones, and keeps hair, eyes and jewellery as tones and metal", () => {
    expect(scrubColourWords(SCENE)).toBe(
      "A fashion model in her late twenties with long dark waves and light eyes stands beside a tall arched window, wearing a silk evening gown and metal drop earrings. Soft daylight falls across her face.",
    );
    expect(scrubColourWords("An open-collar cream linen shirt, tailored sand-coloured trousers and brown suede loafers. Behind him, a deep blue sea, terracotta rooftops and a pale sky."))
      .toBe("An open-collar linen shirt, tailored trousers and suede loafers. Behind him, a sea, rooftops and a pale sky.");
    expect(scrubColourWords("A black turtleneck, a white wall and grey stone in golden hour light, in vivid colours.")).toBe("A black turtleneck, a white wall and grey stone in low late-day sun.");
    expect(scrubColourWords("A refined campaign in sand, sage, ivory and gold.")).toBe("A refined campaign.");
    expect(scrubColourWords("She wears an orange dress, a #FF8800 scarf and holds an orange.")).toBe("She wears a dress, a scarf and holds an orange.");
  });

  it("leaves things that only share a colour's name", () => {
    const things = "A camel walks across the sand holding a glass of champagne and a sprig of sage.";
    expect(scrubColourWords(things)).toBe(things);
    expect(hasColourWords(things)).toBe(false);
    expect(hasColourWords(SCENE)).toBe(true);
  });
});

describe("the plan", () => {
  const plan = (modelId: string, extra: Record<string, unknown>, prompt = "a model on a terrace") =>
    planGeneration({ feature: "image", modelId, op: "t2i", prompt, params: { aspectRatio: "3:4", extra } } as GenerationRequest, getModel, getPreset);

  it("carries the look on MOSS-Image without sending it, and keeps the person's words", () => {
    const p = plan("oss-moss-image", { filmLook: "bw-grain", quality: "standard" });
    expect(p.film).toEqual({ look: "bw-grain", mono: true });
    expect(p.prompt).toBe("a model on a terrace");
    expect(p.params.extra).not.toHaveProperty("filmLook");
    expect(p.params.extra).toMatchObject({ steps: 25, cfg: 2.5, sampler: "er_sde" });
    expect(plan("oss-moss-image", { filmLook: "night-halation" }).film).toEqual({ look: "night-halation", mono: false });
  });

  it("turns fal's own prompt expansion off for a look in the cloud, so the look's words reach MOSS-Image as written", () => {
    const p = plan("moss-image", { filmLook: "night-halation" });
    const route = getModel("moss-image")!.routes[0] as ModelRoute & { map: NonNullable<ModelRoute["map"]> };
    const out = buildPayload(route.map, { prompt: p.prompt, ...p.params });
    expect(out.enable_prompt_expansion).toBe(false);
    expect(out).not.toHaveProperty("filmLook");
    expect(out).not.toHaveProperty("promptHelper");
  });

  it("runs another model, or a layout, without the look and says so", () => {
    const other = plan("oss-krea2-turbo", { filmLook: "night-halation" });
    expect(other.film).toBeUndefined();
    expect(other.params.extra ?? {}).not.toHaveProperty("filmLook");
    expect(other.notes?.join(" ")).toMatch(/MOSS-Image film look/);
    const layout = { summary: { caption: "A poster", meta: [], canvas: "single" }, items: [{ label: "text", caption: "Bold", text: "SALE", box: [0.1, 0.1, 0.9, 0.3] }] };
    const laid = plan("oss-moss-image", { filmLook: "night-halation", layout }, "A poster");
    expect(laid.film).toBeUndefined();
    expect(laid.notes?.join(" ")).toMatch(/layout runs without the film look/);
    // An id Fuobe doesn't have is dropped quietly.
    expect(plan("oss-moss-image", { filmLook: "nope" }).film).toBeUndefined();
  });
});

describe("the run", () => {
  let sent: { prompt?: string; negativePrompt?: string }[] = [];
  beforeAll(async () => {
    const { setSetting } = await import("@/server/settings");
    setSetting("demoMode", "auto");
    const { PROVIDERS } = await import("@/server/providers");
    const submit = PROVIDERS.mock.submit.bind(PROVIDERS.mock);
    vi.spyOn(PROVIDERS.mock, "submit").mockImplementation(async (a) => {
      sent.push({ prompt: a.input.prompt, negativePrompt: a.input.negativePrompt });
      return submit(a);
    });
  });

  const run = async (req: Partial<GenerationRequest>) => {
    sent = [];
    const { createGenerations, getGeneration } = await import("@/server/generations");
    const [g] = createGenerations({ feature: "image", modelId: "moss-image", ...req } as GenerationRequest);
    await vi.waitFor(() => expect(getGeneration(g.id)?.status).not.toBe("queued"), { timeout: 5000 });
    return getGeneration(g.id)!;
  };

  it("sends the sandwich and the negatives, and keeps the person's prompt as typed", async () => {
    const look = filmLook("night-halation")!;
    const done = await run({ prompt: "a model on a wet street at night", negativePrompt: "blurry", params: { aspectRatio: "3:4", extra: { filmLook: look.id } } });
    expect(sent).toHaveLength(1);
    expect(sent[0].prompt).toBe(applyFilmLook(look, "a model on a wet street at night").prompt);
    expect(sent[0].negativePrompt).toBe(joinNegatives("blurry", look.negative, MOSS_BASE_NEGATIVE));
    expect(done.prompt).toBe("a model on a wet street at night");
    expect(done.request.params?.extra?.filmLook).toBe(look.id);
  });

  it("takes the colour words out for a monochrome look: the LLM's rewrite, cleaned; the word list when it gives none", async () => {
    const look = FILM_LOOKS.find((l) => l.mono)!;
    llm.answer = "A fashion model in her late twenties with long dark waves and light eyes stands beside a tall arched window, wearing a silk evening gown with a deep blue sash and metal drop earrings. Soft daylight falls across her face.";
    llm.calls = [];
    await run({ prompt: SCENE, params: { aspectRatio: "3:4", extra: { filmLook: look.id } } });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].user).toBe(SCENE);
    // The LLM's leftover colour ("deep blue") is cleaned by the word list.
    expect(sent[0].prompt).toContain("wearing a silk evening gown with a sash and metal drop earrings");
    expect(sent[0].prompt).not.toMatch(/blue|auburn|emerald/);

    llm.answer = null;
    const other = `${SCENE} A red rose lies on the sill.`;
    await run({ prompt: other, params: { aspectRatio: "3:4", extra: { filmLook: look.id } } });
    expect(sent[0].prompt).toBe(applyFilmLook(look, scrubColourWords(other)).prompt);
  });

  it("leaves a scene with no colour words as it is, without asking the LLM", async () => {
    const look = FILM_LOOKS.find((l) => l.mono)!;
    llm.calls = [];
    await run({ prompt: "a model in a black coat on a grey street", params: { aspectRatio: "3:4", extra: { filmLook: look.id } } });
    expect(llm.calls).toEqual([]);
    expect(sent[0].prompt).toBe(applyFilmLook(look, "a model in a black coat on a grey street").prompt);
  });
});
