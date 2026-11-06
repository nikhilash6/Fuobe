import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GenInput, Generation } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

// Auto's runs: each is planned on the model Auto picks (Ideogram 4, Krea 2 Realism for the owner's patterns, Qwen-Image 2.1
// for an edit) and keeps Auto with its pick. When Ideogram 4 answers a run of Auto with its grey card, Krea 2 Realism, then
// FIBO 2 Dev, then MOSS-Image make the same run (never Ideogram 4 again), and only then does it fail. A model picked by
// name keeps today's way (tests/ideogram-declined.test.ts). Its rules alone: tests/auto-image.test.ts.
vi.setConfig({ testTimeout: 60_000 });
const dir = tempDir("fuobe-auto-image-runs-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: runs fall back to the demo
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.ANTHROPIC_API_KEY;

const { setSetting, getSetting, validateSetting } = await import("@/server/settings");
const { createGenerations, getGeneration, previewGeneration } = await import("@/server/generations");
const { mockProvider } = await import("@/server/providers/mock");
const { changeAccess } = await import("@/server/model-access");
const { BLOCKED_CARD_MESSAGE, DECLINED_NOTICE } = await import("@/server/safety-card");
const { encodePng } = await import("@/server/png");
const { db } = await import("@/server/db");
const { AUTO_IMAGE, DEFAULT_AUTO_PATTERNS } = await import("@/lib/auto-image");
const { MadeNote } = await import("@/components/studio/made-note");

const png = (w: number, h: number, at: (x: number, y: number) => [number, number, number]) => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...at(x, y), 255], (y * w + x) * 4);
  return encodePng({ width: w, height: h, data });
};
// Ideogram 4's grey card, and a real picture.
const card = png(640, 480, (x, y) => (y > 232 && y < 248 && x > 180 && x < 460 && x % 4 < 2 ? [58, 58, 57] : [120, 118, 116]));
const gradient = png(640, 480, (x, y) => [Math.round((x / 639) * 255), Math.round((y / 479) * 255), 128]);
const dataUri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

/** Ideogram 4's answer to each job, in order; the models that fail; each job handed over, with its run as it read then. */
let ideogram: Buffer[][] = [];
let failing = new Set<string>();
let handed: { model: string; input: GenInput; run: Generation }[] = [];
const submit = mockProvider.submit;
const poll = mockProvider.poll;
const answers = new Map<string, Buffer[]>();

const CAT = "a cat in an antique-gold paillette gown, studio light, her hair lifting in the wind";

beforeAll(() => setSetting("demoMode", "auto"));
beforeEach(() => {
  setSetting("enhanceProvider", "none");
  setSetting("autoImagePatterns", "");
  changeAccess([{ kind: "reset" }]);
  ideogram = [];
  failing = new Set();
  handed = [];
  answers.clear();
  mockProvider.submit = async (ctx) => {
    handed.push({ model: ctx.model.id, input: ctx.input, run: getGeneration(ctx.generationId)! });
    return submit(ctx);
  };
  mockProvider.poll = async (ctx) => {
    if (failing.has(ctx.model.id)) return { state: "failed", error: "Out of memory on the GPU" };
    if (ctx.model.id === "oss-ideogram-4") {
      let pics = answers.get(ctx.externalId);
      if (!pics) answers.set(ctx.externalId, (pics = ideogram.shift() ?? [gradient]));
      return { state: "succeeded", outputs: pics.map((p) => ({ url: dataUri(p), kind: "image" as const })) };
    }
    return poll(ctx);
  };
});
afterEach(() => {
  mockProvider.submit = submit;
  mockProvider.poll = poll;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settled(id: string, ms = 30_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`${id} is still ${g.status}`);
    await sleep(50);
  }
}
async function run(prompt: string, more: Record<string, unknown> = {}, modelId: string = AUTO_IMAGE) {
  const made = createGenerations({ feature: "image", modelId, prompt, ...more });
  expect(made).toHaveLength(1);
  return settled(made[0].id);
}
const rowsSince = (id: string) => db().prepare("SELECT COUNT(*) FROM generations WHERE created_at >= (SELECT created_at FROM generations WHERE id = ?)").pluck().get(id) as number;
const line = (g: Generation) => renderToStaticMarkup(MadeNote({ g })!);

describe("what Auto runs on", () => {
  it("plain words: Ideogram 4, and the run keeps Auto with its pick", async () => {
    const g = await run("a red fox in deep snow", { params: { aspectRatio: "16:9" } });
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4"]);
    expect(g.modelId).toBe("oss-ideogram-4");
    expect(g.request.modelId).toBe(AUTO_IMAGE);
    expect(g.request.auto).toEqual({ model: "oss-ideogram-4", why: "plain" });
    expect(handed[0].input.aspectRatio).toBe("16:9");
    expect(line(g)).toContain("Auto · made with Ideogram 4");
    expect(g.request.notice).toBeUndefined();
  });

  it("lettering: Ideogram 4", async () => {
    const g = await run("a poster that says GRAND OPENING in gold letters");
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4"]);
    expect(g.request.auto).toEqual({ model: "oss-ideogram-4", why: "text" });
  });

  it("a prompt the patterns match: Krea 2 Realism straight away, with no Ideogram 4 job", async () => {
    const g = await run(CAT);
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-krea2-realism"]);
    expect(g.modelId).toBe("oss-krea2-realism");
    expect(g.request.auto).toEqual({ model: "oss-krea2-realism", why: "trigger" });
    expect(handed[0].input.prompt).toBe(CAT);
    expect(line(g)).toContain("Auto · made with Krea 2 Realism");
    expect(line(g)).not.toContain("declined");
  });

  it("a picture to work from: Qwen-Image 2.1's edit, never Ideogram 4", async () => {
    const g = await run("make it golden hour", { inputs: { images: [dataUri(gradient)] } });
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-qwen-image-21"]);
    expect(g.op).toBe("edit");
    expect(g.request.auto).toEqual({ model: "oss-qwen-image-21", why: "edit" });
  });

  it("the owner's own patterns decide, and a model switched off is passed over", async () => {
    setSetting("autoImagePatterns", "koi");
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: "a koi pond at night" }).model.id).toBe("oss-krea2-realism");
    // The built-in list is gone with it: the cat goes to Ideogram 4 now.
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: CAT }).model.id).toBe("oss-ideogram-4");
    setSetting("autoImagePatterns", "");
    expect(getSetting("autoImagePatterns")).toBe(DEFAULT_AUTO_PATTERNS.join("\n"));
    changeAccess([{ kind: "model", id: "oss-ideogram-4", on: false }]);
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: "a koi pond at night" }).model.id).toBe("oss-krea2-realism");
  });

  it("is priced before Run as the model it would pick (free on a GPU), and a pick it carries stays", () => {
    const p = previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: "a koi pond at night" });
    expect(p.model.id).toBe("oss-ideogram-4");
    expect(p.costUsd).toBe(0);
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: CAT }).model.id).toBe("oss-krea2-realism");
    // A run planned again (a resend, a run that waited to enter the line) keeps the model it was made with.
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: CAT, auto: { model: "oss-fibo2-dev", why: "declined" } }).model.id).toBe("oss-fibo2-dev");
    // A pick that isn't one of Auto's is planned again.
    expect(previewGeneration({ feature: "image", modelId: AUTO_IMAGE, prompt: CAT, auto: { model: "nano-banana-pro", why: "plain" } }).model.id).toBe("oss-krea2-realism");
  });

  it("a model picked by name always runs on that model", async () => {
    const krea = await run("a koi pond at night", {}, "oss-krea2-realism");
    expect(krea.modelId).toBe("oss-krea2-realism");
    const ideo = await run(CAT, {}, "oss-ideogram-4");
    expect(ideo.modelId).toBe("oss-ideogram-4");
    expect(ideo.request.auto).toBeUndefined();
    expect(line(ideo)).toBe("");
    expect(handed.map((h) => h.model)).toEqual(["oss-krea2-realism", "oss-ideogram-4"]);
  });
});

describe("Auto after Ideogram 4 declines", () => {
  it("Krea 2 Realism makes the same run at once (no second Ideogram 4 try), and the run says so", async () => {
    ideogram = [[card]];
    const g = await run("a red fox in deep snow", { params: { aspectRatio: "4:5", resolution: "1.5K" } });
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-krea2-realism"]);
    expect(g.modelId).toBe("oss-krea2-realism");
    expect(g.request.modelId).toBe(AUTO_IMAGE);
    expect(g.request.auto).toEqual({ model: "oss-krea2-realism", why: "declined" });
    expect(g.request.notice).toBeUndefined();
    expect(g.outputs).toHaveLength(1);
    // The same words in plain text, the shape and size asked; Working, saying which model makes it.
    expect(handed[1].input.prompt).toBe("a red fox in deep snow");
    expect(handed[1].input.aspectRatio).toBe("4:5");
    expect(handed[1].run.status).toBe("running");
    expect(handed[1].run.message).toBe("Making it with Krea 2 Realism");
    expect(rowsSince(g.id)).toBe(1);
    expect(line(g)).toContain("Auto · made with Krea 2 Realism · Ideogram 4 declined this one");
    expect(line(g)).not.toContain(DECLINED_NOTICE);
    // The owner's own run: the card, the words, and Add a pattern.
    expect(g.declinedCards).toHaveLength(1);
    expect(line(g)).toContain("Words: “a red fox in deep snow”");
    expect(line(g)).toContain("Add a pattern");
  });

  it("each next model only when the one before fails: FIBO 2 Dev, then MOSS-Image", async () => {
    ideogram = [[card]];
    failing = new Set(["oss-krea2-realism"]);
    const fibo = await run("a red fox in deep snow");
    expect(fibo.status, fibo.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-krea2-realism", "oss-fibo2-dev"]);
    expect(fibo.modelId).toBe("oss-fibo2-dev");
    expect(handed[2].run.message).toBe("Making it with FIBO 2 Dev");
    expect(line(fibo)).toContain("Auto · made with FIBO 2 Dev · Ideogram 4 declined this one");

    handed = [];
    ideogram = [[card]];
    failing = new Set(["oss-krea2-realism", "oss-fibo2-dev"]);
    const moss = await run("a lighthouse at dusk");
    expect(moss.status, moss.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-krea2-realism", "oss-fibo2-dev", "oss-moss-image"]);
    expect(moss.modelId).toBe("oss-moss-image");
    expect(rowsSince(moss.id)).toBe(1);
  });

  it("when all three fail too, the run fails as Ideogram 4's, in the words it always had, and Retry runs Auto again", async () => {
    ideogram = [[card]];
    failing = new Set(["oss-krea2-realism", "oss-fibo2-dev", "oss-moss-image"]);
    const g = await run("a red fox in deep snow");
    expect(g.status).toBe("failed");
    expect(g.error).toBe(BLOCKED_CARD_MESSAGE);
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-krea2-realism", "oss-fibo2-dev", "oss-moss-image"]);
    expect(g.modelId).toBe("oss-ideogram-4");
    expect(g.request.modelId).toBe(AUTO_IMAGE);
    expect(g.request.auto).toEqual({ model: "oss-ideogram-4", why: "plain" });
    expect(g.outputs).toEqual([]);
    expect(g.declinedCards).toHaveLength(1);
    expect(rowsSince(g.id)).toBe(1);
    expect(line(g)).toContain("Auto · tried Ideogram 4");
  });

  it("a fallback switched off is passed over", async () => {
    changeAccess([{ kind: "model", id: "oss-krea2-realism", on: false }]);
    ideogram = [[card]];
    const g = await run("a red fox in deep snow");
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-fibo2-dev"]);
  });

  it("Ideogram 4 picked by name keeps its own way: once more, then Qwen-Image 2.1", async () => {
    ideogram = [[card], [card]];
    const g = await run("a red fox in deep snow", {}, "oss-ideogram-4");
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-ideogram-4", "oss-qwen-image-21"]);
    expect(g.request.notice).toBe(DECLINED_NOTICE);
    expect(g.request.auto).toBeUndefined();
  });
});

describe("the setting", () => {
  it("is checked on save: a line that can't be read, or that matches every prompt, is refused", () => {
    expect(() => validateSetting("autoImagePatterns", "bikini\n(oops", "api")).toThrow(/Line 2 isn't a pattern/);
    expect(() => setSetting("autoImagePatterns", ".*")).toThrow(/matches every prompt/);
    expect(() => validateSetting("autoImagePatterns", "bikini\n# a note\nvelvet cape", "api")).not.toThrow();
    expect(getSetting("autoImagePatterns")).toBe(DEFAULT_AUTO_PATTERNS.join("\n"));
  });
});
