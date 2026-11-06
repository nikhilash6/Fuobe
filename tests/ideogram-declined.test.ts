import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GenInput, Generation } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

// An Ideogram 4 run whose every picture is its grey "blocked" card is made again in its place by Auto's fallbacks in order
// (Krea 2 Realism, FIBO 2 Dev, MOSS-Image; never Ideogram 4 again), and only then does it fail. A run with some real
// pictures keeps them, as before. The cards are kept for the owner only. (Runs on this install's GPUs, and their limits:
// tests/ideogram-declined-pool.test.ts.)
vi.setConfig({ testTimeout: 60_000 });
const dir = tempDir("fuobe-ideogram-declined-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9"; // nothing listens here: runs fall back to the demo
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.ANTHROPIC_API_KEY;

const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration } = await import("@/server/generations");
const { mockProvider } = await import("@/server/providers/mock");
const { BLOCKED_CARD_MESSAGE, blockedMeasures, declinedNotice } = await import("@/server/safety-card");
const { encodePng } = await import("@/server/png");
const { getAsset, listAssets } = await import("@/server/storage");
const { db } = await import("@/server/db");
const { fileAccount, HELD_FILE } = await import("@/server/account-library");
const { captionFromWords } = await import("@/lib/ideogram-caption");
const { MadeNote } = await import("@/components/studio/made-note");

/** A picture drawn pixel by pixel, as a PNG. */
const png = (w: number, h: number, at: (x: number, y: number) => [number, number, number]) => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...at(x, y), 255], (y * w + x) * 4);
  return encodePng({ width: w, height: h, data });
};
// The card: flat, slightly warm mid-grey, one line of dark type across the middle.
const card = png(640, 480, (x, y) => (y > 232 && y < 248 && x > 180 && x < 460 && x % 4 < 2 ? [58, 58, 57] : [120, 118, 116]));
const gradient = png(640, 480, (x, y) => [Math.round((x / 639) * 255), Math.round((y / 479) * 255), 128]);
const dataUri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

/** Ideogram 4's answer to each job it is sent, in order (its pictures); the fallbacks make their own, or fail. */
let ideogram: Buffer[][] = [];
let failing = new Set<string>();
/** Meta the next Ideogram 4 job is sent with (a run declined before the change, still going). */
let sentMeta: Record<string, unknown> | undefined;
/** Each job handed to the provider: which model, what it got, and how the run read at that moment. */
let handed: { model: string; input: GenInput; run: Generation }[] = [];
const submit = mockProvider.submit;
const poll = mockProvider.poll;
const answers = new Map<string, Buffer[]>();

beforeAll(() => setSetting("demoMode", "auto"));
beforeEach(() => {
  setSetting("enhanceProvider", "none");
  ideogram = [];
  failing = new Set();
  sentMeta = undefined;
  handed = [];
  answers.clear();
  mockProvider.submit = async (ctx) => {
    handed.push({ model: ctx.model.id, input: ctx.input, run: getGeneration(ctx.generationId)! });
    const res = await submit(ctx);
    const meta = ctx.model.id === "oss-ideogram-4" ? sentMeta : undefined;
    sentMeta = undefined;
    return meta ? { ...res, meta: { ...res.meta, ...meta } } : res;
  };
  mockProvider.poll = async (ctx) => {
    if (ctx.model.id === "oss-ideogram-4") {
      let pics = answers.get(ctx.externalId);
      if (!pics) answers.set(ctx.externalId, (pics = ideogram.shift() ?? [gradient]));
      return { state: "succeeded", outputs: pics.map((p) => ({ url: dataUri(p), kind: "image" as const })) };
    }
    if (failing.has(ctx.model.id)) return { state: "failed", error: "Out of memory on the GPU" };
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
async function run(params: Record<string, unknown> = {}) {
  const made = createGenerations({ feature: "image", modelId: "oss-ideogram-4", prompt: "a red fox in deep snow", params });
  expect(made).toHaveLength(1);
  return settled(made[0].id);
}
/** The run's files, as stored. */
const filesOf = (id: string) => db().prepare("SELECT id FROM assets WHERE generation_id = ?").pluck().all(id) as string[];
const rowsLike = (id: string) => (db().prepare("SELECT COUNT(*) FROM generations WHERE created_at >= (SELECT created_at FROM generations WHERE id = ?)").pluck().get(id) as number);

describe("Ideogram 4 that declines a run", () => {
  it("measures the card apart from real pictures", () => {
    expect(blockedMeasures(card)).toMatchObject({ blocked: true });
    expect(blockedMeasures(card)!.spread).toBeLessThan(20);
    expect(blockedMeasures(card)!.grey).toBeGreaterThan(0.85);
    expect(blockedMeasures(gradient)).toMatchObject({ blocked: false });
    expect(blockedMeasures(Buffer.from("not a picture"))).toBeNull();
  });

  it("Krea 2 Realism makes it at once, as the same run, from the same words, in the same shape, and the run says so", async () => {
    ideogram = [[card]];
    const g = await run({ aspectRatio: "16:9", resolution: "1.5K", seed: 41, extra: { preset: "Turbo" } });
    expect(g.status, g.error ?? "").toBe("succeeded");
    // No second Ideogram 4 try, and no Qwen-Image 2.1.
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-krea2-realism"]);
    expect(handed[0].input.prompt).toBe(captionFromWords("a red fox in deep snow"));
    expect(g.modelId).toBe("oss-krea2-realism");
    expect(g.modelName).toBe("Krea 2 Realism");
    expect(g.request.modelId).toBe("oss-krea2-realism");
    expect(g.request.auto).toBeUndefined();
    expect(g.request.notice).toBe("Made with Krea 2 Realism · Ideogram 4 declined this one");
    expect(g.outputs).toHaveLength(1);
    expect(rowsLike(g.id)).toBe(1);
    // Plain words (never the caption), the shape and size asked, none of Ideogram 4's own settings.
    const krea = handed[1];
    expect(krea.input.prompt).toBe("a red fox in deep snow");
    expect(krea.input.aspectRatio).toBe("16:9");
    expect(krea.input.resolution).toBe("1.5K");
    expect(krea.input.extra?.preset).toBeUndefined();
    expect(krea.run.status).toBe("running");
    expect(krea.run.message).toBe("Making it with Krea 2 Realism");
    // The card stays with the run for the owner: held (no account and no link serves it), out of every file list.
    expect(g.declinedCards).toHaveLength(1);
    const kept = filesOf(g.id).map((id) => getAsset(id)!).find((a) => a.url === g.declinedCards![0].url)!;
    expect(kept.source).toBe("derived");
    expect(fileAccount(kept.relPath)).toBe(HELD_FILE);
    expect(listAssets({ limit: 1000 }).some((a) => a.id === kept.id)).toBe(false);
    expect(g.outputs.some((o) => o.url === kept.url)).toBe(false);
    // The tile's one plain line, and the owner's line with what Ideogram 4 returned.
    const html = renderToStaticMarkup(MadeNote({ g })!);
    expect(html).toContain("Made with Krea 2 Realism · Ideogram 4 declined this one");
    expect(html).toContain("Ideogram 4 declined: what it returned");
    // Someone else's eyes (an account's own run never carries the cards): only the plain line.
    const theirs = renderToStaticMarkup(MadeNote({ g: { ...g, declinedCards: undefined } })!);
    expect(theirs).toContain(declinedNotice("Krea 2 Realism"));
    expect(theirs).not.toContain("what it returned");
  });

  it("each next fallback only when the one before fails, and the notice names the one that made it", async () => {
    ideogram = [[card]];
    failing = new Set(["oss-krea2-realism"]);
    const g = await run();
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-krea2-realism", "oss-fibo2-dev"]);
    expect(g.modelId).toBe("oss-fibo2-dev");
    expect(g.request.notice).toBe(declinedNotice("FIBO 2 Dev"));
    expect(handed[2].input.prompt).toBe("a red fox in deep snow");
    expect(handed[2].run.message).toBe("Making it with FIBO 2 Dev");
    expect(rowsLike(g.id)).toBe(1);
  });

  it("when every fallback fails too, the run fails as Ideogram 4's, in the words it always had", async () => {
    ideogram = [[card]];
    failing = new Set(["oss-krea2-realism", "oss-fibo2-dev", "oss-moss-image"]);
    const g = await run();
    expect(g.status).toBe("failed");
    expect(g.error).toBe(BLOCKED_CARD_MESSAGE);
    expect(g.outputs).toEqual([]);
    // Put back as it was asked, so Retry runs Ideogram 4 again.
    expect(g.modelId).toBe("oss-ideogram-4");
    expect(g.request.modelId).toBe("oss-ideogram-4");
    expect(g.request.notice).toBeUndefined();
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-krea2-realism", "oss-fibo2-dev", "oss-moss-image"]);
    expect(rowsLike(g.id)).toBe(1);
    // No result kept; the card stays for the owner, and goes with the run.
    expect(g.declinedCards).toHaveLength(1);
    expect(listAssets({ source: "generation", limit: 1000 }).filter((a) => a.generationId === g.id)).toEqual([]);
  });

  it("a run declined before the change, on its second Ideogram 4 try: declined again, it goes to the first fallback", async () => {
    ideogram = [[card]];
    sentMeta = { declined: { stage: "retry", cards: [] } };
    const g = await run();
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4", "oss-krea2-realism"]);
    expect(g.modelId).toBe("oss-krea2-realism");
    expect(g.request.notice).toBe(declinedNotice("Krea 2 Realism"));
  });

  it("some real pictures and some cards: the real ones are kept and nothing runs again", async () => {
    ideogram = [[card, gradient]];
    const g = await run();
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(g.modelId).toBe("oss-ideogram-4");
    expect(g.outputs).toHaveLength(1);
    expect(g.request.notice).toBeUndefined();
    expect(handed.map((h) => h.model)).toEqual(["oss-ideogram-4"]);
    expect(g.declinedCards).toHaveLength(1);
  });

  it("a run with no card is left as it was", async () => {
    const g = await run();
    expect(g.status).toBe("succeeded");
    expect(g.declinedCards).toBeUndefined();
    expect(handed).toHaveLength(1);
  });
});
