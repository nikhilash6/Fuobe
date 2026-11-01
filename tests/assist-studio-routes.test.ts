import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.setConfig({ testTimeout: 120_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-assist-studios-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: open models run on the demo provider, and there's no LLM (offline writers run).
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const tools = await import("@/server/assist/tools");
const studio = await import("@/server/assist/studio-tools");
const agent = await import("@/server/assist/agent");
const { handleMcp } = await import("@/server/mcp");
const { db } = await import("@/server/db");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const gens = await import("@/server/generations");
const layers = await import("@/server/layers");
const shorts = await import("@/server/shorts");
const dub = await import("@/server/dub");
const faceless = await import("@/server/faceless");
const ads = await import("@/server/ads");
const brand = await import("@/server/brand");
const { decomposeCost } = await import("@/lib/layers");
const { burnPricePerMinute } = await import("@/lib/av/captions");
const { defaultSettings, genreInfo, PART_LABELS, STYLES } = await import("@/lib/catalog/faceless");
const { imageSize } = await import("@/lib/image-size");
const { dubLanguageFor, facelessStyleFor, shortsPresetFor } = await import("@/lib/assist-studios");
const dubRoute = await import("@/app/api/dub/route");
const adsEstimateRoute = await import("@/app/api/ads/estimate/route");

type Engine = "cloud" | "open";
const json = (method: string, body?: unknown) => new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const plan = (name: string, input: unknown, engine: Engine = "cloud") => tools.planFor(name, input, { engine });
const run = (name: string, input: unknown, engine: Engine = "cloud") => tools.executeTool(name, input, { engine });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body = (out: { content: unknown }) => JSON.parse(out.content as string) as Record<string, any>;
const gen = (id: string) => gens.getGeneration(id)!;
const rpc = (method: string, params?: unknown) => handleMcp({ jsonrpc: "2.0", id: 9, method, params });

/** Paid routes priced as if connected (a fal key); nothing runs with it. */
async function priced<T>(fn: () => T | Promise<T>): Promise<T> {
  setSetting("falKey", "test-key");
  try {
    return await fn();
  } finally {
    setSetting("falKey", "");
  }
}

/** Claude connected as the LLM (nothing is called while pricing). */
async function withLlm<T>(fn: () => T | Promise<T>): Promise<T> {
  setSetting("anthropicKey", "test-key");
  setSetting("enhanceProvider", "auto");
  try {
    return await fn();
  } finally {
    setSetting("anthropicKey", "");
    setSetting("enhanceProvider", "none");
  }
}

type Est = { result: { structuredContent: { studio?: string; href?: string; fallback?: string; jobs: { error?: string }[] }; isError: boolean } };
const estimate = async (tool: string, args: unknown) => (await rpc("tools/call", { name: "estimate_job", arguments: { tool, arguments: args } })) as Est;

const fixture = path.join(__dirname, "fixtures/shorts-12s.mp4");
let png = "";
let clip = "";
let notAnImage = "";

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
  png = saveFile({ data: encodePng({ width: 64, height: 48, data: Buffer.alloc(64 * 48 * 4, 200) }), contentType: "image/png", source: "upload", name: "poster.png" }).url;
  // A 12 s, 16 fps clip with a sound track.
  clip = saveFile({ data: fs.readFileSync(fixture), contentType: "video/mp4", source: "upload", name: "beach day.mp4" }).url;
  notAnImage = saveFile({ data: Buffer.from("not a picture at all"), contentType: "image/png", source: "upload", name: "broken.png" }).url;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const scenes = [
  { narration: "Tea began as medicine in the mountains of China.", visual: "A misty mountain tea garden at dawn" },
  { narration: "Then it became a ritual shared between friends.", visual: "Hands pouring tea in a quiet wooden room" },
  { narration: "Today it's in every café on every street.", visual: "A busy café counter with steaming cups" },
];

describe("words → a studio's own choices", () => {
  it("reads image sizes from PNG, JPEG, WebP, GIF and SVG headers", () => {
    expect(imageSize(encodePng({ width: 7, height: 3, data: Buffer.alloc(7 * 3 * 4) }))).toEqual({ width: 7, height: 3 });
    // JPEG: SOI, an APP0 segment, then SOF0 with height 300 and width 400.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03]);
    expect(imageSize(jpeg)).toEqual({ width: 400, height: 300 });
    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([0x20, 0x03, 0x58, 0x02])]);
    expect(imageSize(gif)).toEqual({ width: 800, height: 600 });
    const vp8x = Buffer.alloc(30);
    vp8x.write("RIFF", 0);
    vp8x.write("WEBP", 8);
    vp8x.write("VP8X", 12);
    vp8x.writeUIntLE(1023, 24, 3);
    vp8x.writeUIntLE(767, 27, 3);
    expect(imageSize(vp8x)).toEqual({ width: 1024, height: 768 });
    expect(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect/></svg>'))).toEqual({ width: 1200, height: 675 });
    expect(imageSize(Buffer.from('<?xml version="1.0"?><svg viewBox="0 0 90 160"></svg>'))).toEqual({ width: 90, height: 160 });
    expect(imageSize(Buffer.from("hello"))).toBeNull();
  });

  it("matches styles, presets and languages, and says when nothing matches", () => {
    for (const s of STYLES) expect(facelessStyleFor(s.name), s.name).toBe(s.id);
    expect(facelessStyleFor("flat 2D illustration, muted palette")).toBe("pastel-flat-2d");
    expect(facelessStyleFor("watercolour storybook")).toBe("watercolor-chronicle");
    expect(facelessStyleFor("chunky clay figures, stop motion")).toBe("claymotion");
    expect(facelessStyleFor("pixel-art")).toBe("pixel-art");
    expect(facelessStyleFor("cinematic photoreal drone shots")).toBeNull();
    expect(shortsPresetFor("Claymation")?.id).toBe("shorts-claymation");
    expect(shortsPresetFor("pencil sketch")?.id).toBe("shorts-pencil-sketch");
    expect(shortsPresetFor("claymation, warm studio light")).toBeUndefined();
    expect(dubLanguageFor("Spanish (Mexico)")?.code).toBe("es");
    expect(dubLanguageFor("de")?.name).toBe("German");
    expect(dubLanguageFor("Mandarin")?.code).toBe("zh");
    expect(dubLanguageFor("Klingon")).toBeUndefined();
  });
});

describe("Layers", () => {
  it("prices a decomposition per layer, as the editor does", async () => {
    const p = await priced(() => plan("split_layers", { image: png }));
    expect(p).toMatchObject({ studio: "Layers", href: "/layers" });
    expect(p.jobs).toEqual([expect.objectContaining({ op: "layers", modelId: "seedream-5-layers", costUsd: decomposeCost("seedream-5-layers", 8), demo: false, note: "Layer decomposition · up to 8 layers" })]);
    expect(plan("split_layers", { image: png, layers: 3 }, "open").jobs[0]).toMatchObject({ modelId: "oss-qwen-layered", note: "Layer decomposition · up to 3 layers", demo: true });
  });

  it("opens a project on the image and decomposes it there", async () => {
    const out = await run("split_layers", { image: png, focus: "the poster's headline" }, "open");
    expect(out.isError).toBeFalsy();
    const b = body(out);
    expect(b.href).toBe(`/layers/${b.project}`);
    const view = layers.projectView(b.project)!;
    expect(view.project).toMatchObject({ sourceUrl: png, width: 64, height: 48, name: "Poster" });
    expect(view.jobs).toEqual([expect.objectContaining({ tool: "decompose", state: "pending", generationIds: b.results })]);
    expect(gen(b.results[0])).toMatchObject({ op: "layers", modelId: "oss-qwen-layered", provider: "mock" });
    expect(gen(b.results[0]).request).toMatchObject({ feature: "layers", prompt: "the poster's headline", inputs: { images: [png] } });
    expect(out.items?.[0]).toEqual({ id: "", role: "tool", text: "Opened a Layers project", href: b.href, studio: "Layers" });
  });

  it("falls back to a plain pipeline when it can't read the picture, and says so", async () => {
    const p = plan("split_layers", { image: notAnImage }, "open");
    expect(p.studio).toBeUndefined();
    expect(p.fallback).toMatch(/couldn't read that image's size.*Library/);
    expect(p.jobs).toEqual([expect.objectContaining({ op: "layers", modelId: "oss-qwen-layered" })]);
    const out = await run("split_layers", { image: notAnImage }, "open");
    expect(body(out)).toMatchObject({ ranIn: "Library", why: expect.stringMatching(/image's size/) });
    expect(out.items?.at(-1)).toMatchObject({ role: "notice", tone: "info" });
    expect(db().prepare("SELECT COUNT(*) AS n FROM layer_projects WHERE source_url = ?").get(notAnImage)).toEqual({ n: 0 });
  });
});

describe("Shorts Studio", () => {
  const info = () => shorts.sourceInfo(fs.readFileSync(fixture));

  it("prices the session with the studio's estimate, sound and all", async () => {
    const p = await priced(() => plan("restyle_footage", { video: clip, style: "Claymation" }));
    expect(p).toMatchObject({ studio: "Shorts Studio", href: "/shorts" });
    const i = info();
    const est = await priced(() =>
      shorts.estimateWith(
        { engine: "cloud", presetId: "shorts-claymation", source: { url: clip, duration: i.duration, width: i.width, height: i.height }, range: { start: 0, end: i.duration! }, aspectRatio: i.width! > i.height! ? "16:9" : "9:16", language: "auto" },
        i,
      ),
    );
    // Fuobe Shorts (O9) is Shorts Studio's default on both engines, priced as the studio prices it.
    expect(p.jobs).toEqual([expect.objectContaining({ modelId: "fuobe-shorts", op: "v2v", costUsd: est.costUsd, demo: false, atomic: true })]);
    expect(est.costUsd).toBeGreaterThan(0);
    expect(p.jobs[0].note).toMatch(/^2 segments of 12 s, stitched under the original sound/);
  });

  it("starts a session with the agent's own look", async () => {
    const out = await run("restyle_footage", { video: clip, style: "claymation, warm studio light", references: [png] }, "open");
    expect(out.isError).toBeFalsy();
    const b = body(out);
    expect(b.href).toBe(`/shorts/${b.session}`);
    const s = shorts.getSession(b.session);
    expect(s.look).toMatchObject({ look: "claymation, warm studio light", references: [png], custom: true, described: true });
    expect(s.title).toMatch(/beach day/);
    expect(s.segments.length).toBe(b.segments);
    expect(s.segments.length).toBeGreaterThanOrEqual(3);
    expect(b.results).toEqual([s.stitches[0].final]);
    expect(Object.values(s.generations).every((g) => g.provider === "mock")).toBe(true);
    expect(shorts.listSessions().map((x) => x.id)).toContain(b.session);
  });

  it("falls back for a model it doesn't restyle with", () => {
    const p = plan("restyle_footage", { video: clip, style: "anime", model_id: "kling-o3" });
    expect(p.fallback).toMatch(/isn't one of Shorts Studio's restyle models/);
    expect(p.jobs).toEqual([expect.objectContaining({ modelId: "kling-o3", op: "v2v" })]);
  });
});

describe("Translate & dub", () => {
  const preview = async (b: unknown) =>
    (await (await dubRoute.POST(new Request("http://x/api/dub?preview=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }))).json()) as { costUsd: number; steps: number };

  it("prices the first stage like the studio's preview, and one-go dubs too", async () => {
    const p = await withLlm(() => priced(() => plan("dub_video", { video: clip, languages: ["Spanish", "German"] })));
    const route = await withLlm(() => priced(() => preview({ engine: "cloud", mode: "steps", video: clip, targets: ["es", "de"] })));
    expect(p).toMatchObject({ studio: "Translate & dub", href: "/audio/translate" });
    expect(p.jobs).toEqual([expect.objectContaining({ op: "translate", costUsd: route.costUsd, prompt: "Into Spanish, German", count: 2, demo: false })]);
    expect(p.jobs[0].error).toBeUndefined();
    expect(route.costUsd).toBeGreaterThan(0);
    expect(p.jobs[0].note).toMatch(/review every line and voice it in Translate & dub/);
    const oneGo = await priced(() => plan("dub_video", { video: clip, languages: ["Spanish"], review: false }));
    const oneRoute = await priced(() => preview({ engine: "cloud", mode: "oneshot", model: "heygen-translate", video: clip, targets: ["es"] }));
    expect(oneGo.jobs).toEqual([expect.objectContaining({ modelId: "heygen-translate", op: "dub", costUsd: oneRoute.costUsd })]);
    expect(oneRoute.costUsd).toBeGreaterThan(1); // 12 s at $0.10 a second
  });

  it("opens a dub to review in Audio → Translate", async () => {
    const out = await run("dub_video", { video: clip, languages: ["spanish"] }, "open");
    expect(out.isError).toBeFalsy();
    const b = body(out);
    expect(b.href).toBe(`/audio/translate?dub=${b.dub}`);
    const s = dub.getDubSession(b.dub)!;
    expect(s).toMatchObject({ mode: "steps", engine: "open", targets: ["es"], title: "beach day" });
    expect(b.results).toEqual([s.prepare!["translate:es"]]);
    expect(gen(s.prepare!.stems)).toMatchObject({ op: "separate-audio", provider: "mock" });
    expect(b.next).toMatch(/reviews every line/);
  });

  it("dubs in one go on the cloud when asked, without lip sync", async () => {
    const b = body(await run("dub_video", { video: clip, languages: ["French"], review: false, lipsync: false }));
    const s = dub.getDubSession(b.dub)!;
    expect(s).toMatchObject({ mode: "oneshot", model: "elevenlabs-dubbing", targets: ["fr"] });
    expect(b.results).toEqual(Object.values(s.oneshot!));
    expect(gen(b.results[0])).toMatchObject({ modelId: "elevenlabs-dubbing", op: "dub" });
  });

  it("with a fal key but no Claude or local model, dubs in one go rather than plan a review that can't start", async () => {
    // The review's translation would run as a demo among real steps, which createPipeline refuses.
    const p = await priced(() => plan("dub_video", { video: clip, languages: ["Spanish"] }));
    expect(p).toMatchObject({ studio: "Translate & dub", href: "/audio/translate" });
    expect(p.jobs).toEqual([expect.objectContaining({ modelId: "heygen-translate", op: "dub", demo: false })]);
    expect(p.jobs[0].error).toBeUndefined();
    expect(p.jobs[0].note).toMatch(/Reviewing the lines can't start: Translate · Spanish would run as a demo \(it needs Claude or a local model\).*dubs in one go with HeyGen Translate/);
    expect((await priced(() => estimate("dub_video", { video: clip, languages: ["Spanish"] }))).result.isError).toBe(false);
    // A review asked for outright isn't swapped: the card says why it can't start, and nothing is made.
    const asked = await priced(() => plan("dub_video", { video: clip, languages: ["Spanish"], review: true }));
    expect(asked.jobs[0].error).toMatch(/^Reviewing the lines can't start: Translate · Spanish would run as a demo.*connect it in Settings, or dub in one go \(review: false\)/);
    expect((await priced(() => estimate("dub_video", { video: clip, languages: ["Spanish"], review: true }))).result.isError).toBe(true);
    const before = dub.listDubSessions(100).length;
    const out = await priced(() => run("dub_video", { video: clip, languages: ["Spanish"], review: true }));
    expect(out).toMatchObject({ isError: true, content: expect.stringMatching(/Reviewing the lines can't start/) });
    expect(dub.listDubSessions(100)).toHaveLength(before);
    // With Claude connected too, the review runs as planned.
    expect((await withLlm(() => priced(() => plan("dub_video", { video: clip, languages: ["Spanish"], review: true })))).jobs[0]).toMatchObject({ op: "translate", demo: false });
  });

  it("reads a video's length once, however often a call is checked and priced", () => {
    const fresh = saveFile({ data: fs.readFileSync(fixture), contentType: "video/mp4", source: "upload", name: "read once.mp4" }).url;
    // Its header only (storage.ts storedMedia opens it and reads the start and the index), and only the first time.
    const spy = vi.spyOn(fs, "openSync");
    try {
      for (let k = 0; k < 3; k++) {
        expect(plan("dub_video", { video: fresh, languages: ["German"] }, "open").studio).toBe("Translate & dub");
        expect(plan("add_captions", { video: fresh }, "open").studio).toBe("Captions");
      }
      expect(spy.mock.calls.filter(([f]) => String(f).endsWith(path.basename(fresh)))).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back for a language the studio doesn't list", () => {
    const p = plan("dub_video", { video: clip, languages: ["Klingon"] });
    expect(p.fallback).toMatch(/doesn't list Klingon/);
    expect(p.jobs[0]).toMatchObject({ tool: "dub_video", modelId: "heygen-translate" });
  });
});

describe("Faceless Studio", () => {
  it("prices the episode part by part with the studio's estimate", async () => {
    const p = await priced(() => plan("faceless_episode", { scenes, style: "watercolour storybook", aspect_ratio: "16:9" }));
    expect(p).toMatchObject({ studio: "Faceless Studio", href: "/faceless" });
    const settings = { ...defaultSettings("cloud", genreInfo("education")), aspect: "16:9" as const, styleId: "watercolor-chronicle" };
    const est = await priced(() => faceless.estimateEpisode({ kind: "faceless", settings, blocks: scenes, genre: "education" }));
    expect(p.jobs.map((j) => [j.modelName, j.costUsd])).toEqual(Object.entries(est.estimate.parts).map(([part, usd]) => [PART_LABELS[part as keyof typeof PART_LABELS], usd]));
    expect(p.jobs.every((j) => j.atomic && !j.demo && !j.error)).toBe(true);
    expect(p.total).toBeGreaterThan(0);
  });

  it("renders an episode on the Assist channel, made once and without an avatar", async () => {
    const out = await run("faceless_episode", { title: "A short history of tea", scenes, style: "paper", style_id: "paper-collage" }, "open");
    expect(out.isError).toBeFalsy();
    const b = body(out);
    expect(b.href).toBe(`/faceless/${b.channel}/${b.episode}`);
    await faceless.channelReady(b.channel);
    expect(faceless.getChannel(b.channel)).toMatchObject({ name: "Assist", avatarJob: null });
    const v = faceless.episodeView(b.episode);
    expect(v.episode).toMatchObject({ title: "A short history of tea", status: "rendering", channelId: b.channel, settings: { styleId: "paper-collage", aspect: "9:16", engine: "open" } });
    expect(v.episode.script.blocks.map((x) => x.narration)).toEqual(scenes.map((x) => x.narration));
    expect(b.results).toHaveLength(3);
    expect(b.results.every((id: string) => gen(id).op === "t2i")).toBe(true);
    // A second episode goes to the same channel.
    const again = body(await run("faceless_episode", { scenes, style: "stickman cartoon" }, "open"));
    expect(again.channel).toBe(b.channel);
    expect(faceless.listChannels().filter((c) => c.name === "Assist")).toHaveLength(1);
    expect(faceless.episodeView(again.episode).episode.settings.styleId).toBe("stickman-cartoon");
  });

  it("falls back when no style fits, and for square episodes", () => {
    const p = plan("faceless_episode", { scenes, style: "cinematic photoreal drone shots" }, "open");
    expect(p.fallback).toMatch(/isn't one of Faceless Studio's styles \(pass style_id/);
    expect(p.jobs.some((j) => j.note === "Narration")).toBe(true);
    expect(plan("faceless_episode", { scenes, style: "watercolour", aspect_ratio: "1:1" }).fallback).toMatch(/16:9 and 9:16/);
  });
});

describe("Ads Studio", () => {
  it("prices a batch for a saved brand and product like the studio's estimate", async () => {
    const kit = await brand.createManualBrand({ description: "Oat milk for runners — creamy, high protein", name: "Oat Run" });
    const product = brand.createProduct({ name: "Oat Run Original", brandId: kit.id, images: [png] });
    const p = await priced(() => plan("create_ads", { brief: "Spring race season", brand_id: kit.id, product_id: product.id, count: 3 }));
    const est = await priced(async () => (await adsEstimateRoute.POST(json("POST", { brandId: kit.id, engine: "cloud", items: [{ productId: product.id, count: 3 }], direction: "Spring race season", ratio: "4:5" }))).json());
    expect(p).toMatchObject({ studio: "Ads Studio", href: "/ads" });
    // The picture is Fuobe Marketing Image's (build plan O10), priced as the studio prices it.
    expect(p.jobs).toEqual([expect.objectContaining({ modelId: "fuobe-marketing-image", op: "edit", count: 3, costUsd: est.costUsd, demo: false })]);
    expect(est.costUsd).toBeGreaterThan(0);
    // A product from another brand isn't taken.
    expect(plan("create_ads", { brief: "x", brand_id: "nope" }).fallback).toMatch(/brand kit isn't in Ads Studio/);
  });

  it("makes a brand kit and product from the brief, then the batch with the exact headline", async () => {
    const brief = "Cold brew coffee for night owls, smooth and strong";
    const out = await run("create_ads", { brief, product_image: png, count: 2, aspect_ratios: ["1:1", "9:16"], headline: "Stay up", cta: "Shop now" });
    expect(out.isError).toBeFalsy();
    const b = body(out);
    expect(b.href).toBe(`/ads/${b.brand}`);
    expect(brand.getBrand(b.brand)).toMatchObject({ source: "manual", status: "ready", origin: "assist", name: b.brandName });
    expect(brand.getProduct(b.product)).toMatchObject({ name: "Cold brew coffee for night owls", brandId: b.brand, images: [png] });
    const creatives = ads.listCreatives({ brandId: b.brand, batchId: b.batch });
    expect(creatives).toHaveLength(2);
    expect(creatives.every((c) => c.headline === "Stay up" && c.cta === "Shop now")).toBe(true);
    expect(b.results).toEqual(creatives.map((c) => c.generationId));
    expect(gen(b.results[0])).toMatchObject({ op: "edit", provider: "mock" });
    expect(gen(b.results[0]).request.feature).toBe("ads");
    // The same product again goes back to its kit.
    const again = body(await run("create_ads", { brief, count: 1 }));
    expect([again.brand, again.product]).toEqual([b.brand, b.product]);
  });

  it("never takes over the user's own kits or changes their products", async () => {
    const acme = await brand.createManualBrand({ description: "Acme makes running gear", name: "Acme" });
    const shoes = brand.createProduct({ name: "Running shoes", brandId: acme.id });
    const photo = saveFile({ data: encodePng({ width: 32, height: 32, data: Buffer.alloc(32 * 32 * 4, 90) }), contentType: "image/png", source: "upload", name: "shoe.png" }).url;
    // No brand_id: a kit of Assist's own, even though Acme has a product of that name.
    const b = body(await run("create_ads", { brief: "Running shoes, light and fast", product_image: photo, count: 1 }));
    expect(b.brand).not.toBe(acme.id);
    expect(brand.getBrand(b.brand)?.origin).toBe("assist");
    expect(brand.getProduct(shoes.id)?.images).toEqual([]);
    // Acme named: the ads are Acme's, and the new photo makes a second "Running shoes" rather than replacing Acme's.
    const named = body(await run("create_ads", { brief: "Running shoes, light and fast", product_image: photo, brand_id: acme.id, count: 1 }));
    expect(named.brand).toBe(acme.id);
    expect(named.product).not.toBe(shoes.id);
    expect(brand.getProduct(shoes.id)?.images).toEqual([]);
    expect(brand.getProduct(named.product)).toMatchObject({ name: "Running shoes", brandId: acme.id, images: [photo] });
    // The same photo again goes to that product; no photo, to the first of that name.
    expect(body(await run("create_ads", { brief: "Running shoes", product_image: photo, brand_id: acme.id, count: 1 })).product).toBe(named.product);
    expect(brand.listProducts(acme.id).filter((p) => p.name === "Running shoes")).toHaveLength(2);
  });

  it("makes every ad on Fuobe's compositor, with or without a given headline", async () => {
    const own = await priced(() => plan("create_ads", { brief: "Sneakers for city runs", aspect_ratios: ["4:5"] }));
    expect(own.jobs[0].note).toMatch(/each in 1:1, 4:5 and 9:16/);
    const fixed = await priced(() => plan("create_ads", { brief: "Sneakers for city runs", aspect_ratios: ["4:5"], headline: "Run the city" }));
    expect(fixed.jobs[0].modelName).toBe(own.jobs[0].modelName);
    expect(fixed.jobs[0].note).toMatch(/each in 1:1, 4:5 and 9:16/);
  });

  it("falls back for formats it doesn't make", () => {
    const p = plan("create_ads", { brief: "Sneakers", aspect_ratios: ["16:9"] });
    expect(p.fallback).toMatch(/1:1, 4:5 and 9:16 ads \(not 16:9\)/);
    expect(p.jobs[0]).toMatchObject({ modelId: "nano-banana-pro", op: "t2i" });
  });
});

describe("Captions", () => {
  it("prices the burn at the studio's rate per minute", async () => {
    const p = await priced(() => plan("add_captions", { video: clip }));
    expect(p).toMatchObject({ studio: "Captions", href: "/video-tools/captions" });
    expect(p.jobs.map((j) => j.modelId)).toEqual(["scribe-v2", "auto-subtitle"]);
    expect(p.jobs[1].costUsd).toBe(Math.round(burnPricePerMinute("auto", "clean") * (12 / 60) * 1000) / 1000);
    expect(p.jobs[0].costUsd).toBeGreaterThan(0);
    // VEED translating as it burns: its basic rate plus the translation's $0.20 a minute.
    const translated = await priced(() => plan("add_captions", { video: clip, translate_to: "Spanish" }));
    expect(translated.jobs).toEqual([expect.objectContaining({ modelId: "veed-subtitles", costUsd: Math.round(0.3 * (12 / 60) * 1000) / 1000 })]);
    expect(burnPricePerMinute("veed", "clean", true)).toBeCloseTo(0.3);
    expect(burnPricePerMinute("veed", "clean")).toBeCloseTo(0.1);
  });

  it("burns them in and opens the editor on the video with its lines", async () => {
    const out = await run("add_captions", { video: clip, translate_to: "Spanish" }, "open");
    expect(out.isError).toBeFalsy();
    const b = body(out);
    const burn = gen(b.results[0]);
    expect(burn).toMatchObject({ op: "captions", modelId: "oss-captions-burnin" });
    expect(burn.request.feature).toBe("captions");
    const translation = (db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(burn.id) as { depends_on: string }).depends_on;
    expect(gen(translation)).toMatchObject({ op: "translate", modelId: "oss-text-llm" });
    expect(b.href).toBe(`/video-tools/captions?video=${encodeURIComponent(clip)}&transcript=${translation}`);
    // Cloud: the quick karaoke burn, and the transcript the editor opens with.
    const cloud = body(await run("add_captions", { video: clip, spoken_language: "English" }));
    expect(gen(cloud.results[0])).toMatchObject({ modelId: "auto-subtitle" });
    const words = new URL(cloud.href, "http://x").searchParams.get("transcript")!;
    expect(gen(words)).toMatchObject({ op: "transcribe", modelId: "scribe-v2" });
    expect(gen(words).request).toMatchObject({ feature: "captions", params: { sourceLanguage: "en" } });
  });

  it("falls back for a video that isn't saved in Fuobe", () => {
    const p = plan("add_captions", { video: "https://example.com/a.mp4" }, "open");
    expect(p.fallback).toMatch(/videos saved in Fuobe/);
    expect(p.jobs.map((j) => j.modelId)).toEqual(["oss-qwen3-asr", "oss-captions-burnin"]);
  });
});

describe("MCP", () => {
  it("names katana and the studio links in its instructions", async () => {
    const init = (await rpc("initialize", { protocolVersion: "2025-11-25" })) as { result: { instructions: string; serverInfo: { version: string } } };
    expect(init.result.instructions).toMatch(/katana/);
    expect(init.result.instructions).toMatch(/href/);
    expect(init.result.serverInfo.version).toBe("1.2.0");
  });

  it("estimate_job says where the job opens, or why it runs in the Library", async () => {
    const est = (await rpc("tools/call", { name: "estimate_job", arguments: { tool: "dub_video", arguments: { video: clip, languages: ["Spanish"] } } })) as Est;
    expect(est.result.isError).toBe(false);
    expect(est.result.structuredContent).toMatchObject({ studio: "Translate & dub", href: "/audio/translate" });
    const k = (await rpc("tools/call", { name: "estimate_job", arguments: { tool: "katana", arguments: { reference: clip, photos: [png] } } })) as Est;
    expect(k.result.structuredContent).toMatchObject({ studio: "Katana", href: "/katana" });
    const off = (await rpc("tools/call", { name: "estimate_job", arguments: { tool: "create_ads", arguments: { brief: "x", aspect_ratios: ["16:9"] } } })) as Est;
    expect(off.result.structuredContent.studio).toBeUndefined();
    expect(off.result.structuredContent.fallback).toMatch(/Library/);
  });

  it("tool arguments name what each studio takes", async () => {
    const list = (await rpc("tools/list")) as { result: { tools: { name: string; inputSchema: { properties: Record<string, { description?: string; items?: unknown }> } }[] } };
    const arg = (tool: string, key: string) => list.result.tools.find((t) => t.name === tool)!.inputSchema.properties[key].description ?? "";
    expect(arg("restyle_footage", "model_id")).toMatch(/fuobe-shorts, gemini-omni-flash.*fuobe-shorts \(open source\).*outside Shorts Studio/);
    expect(arg("split_layers", "model_id")).toMatch(/seedream-5-layers.*oss-qwen-layered.*outside Layers/);
    expect(arg("create_ads", "aspect_ratios")).toMatch(/16:9 runs outside Ads Studio/);
  });

  it("tools/call returns the job's page", async () => {
    const r = (await rpc("tools/call", { name: "split_layers", arguments: { image: png } })) as { result: { content: { text: string }[]; isError: boolean } };
    expect(r.result.isError).toBe(false);
    const b = JSON.parse(r.result.content[0].text) as { studio: string; href: string; project: string };
    expect(b).toMatchObject({ studio: "Layers", href: `/layers/${b.project}` });
    expect(layers.projectView(b.project)).toBeTruthy();
  });
});

describe("Assist chat", () => {
  type Msg = Anthropic.Beta.BetaMessage;
  const use = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as unknown as Anthropic.Beta.BetaContentBlock;
  const reply = (content: Anthropic.Beta.BetaContentBlock[], stop: Anthropic.Beta.BetaStopReason) => ({ content, stop_reason: stop, stop_details: null }) as Msg;
  const said = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.Beta.BetaContentBlock;
  const scripted = (...turns: Msg[]): import("@/server/assist/agent").ModelCall => async () => turns.shift() ?? reply([said("Done.")], "end_turn");

  it("the approval card names the studio; the started job links to it", async () => {
    const t = agent.createThread({ engine: "open", agent: "offline", autoApprove: false });
    agent.addMessage(t.id, "Split this poster into layers");
    await agent.run(t.id, scripted(reply([use("u1", "split_layers", { image: png })], "tool_use")));
    const card = agent.getThread(t.id)!.thread.items.find((i) => i.role === "approval");
    expect(card).toMatchObject({ opens: ["Layers"] });
    await agent.answerApproval(t.id, true);
    await agent.run(t.id, scripted(reply([said("It's in Layers.")], "end_turn")));
    const link = agent.getThread(t.id)!.thread.items.find((i) => i.role === "tool" && i.studio);
    expect(link).toMatchObject({ studio: "Layers", href: expect.stringMatching(/^\/layers\/[\w-]+$/) });
  });

  it("a call the studio can't take says why on the card", async () => {
    const t = agent.createThread({ engine: "open", agent: "offline", autoApprove: false });
    agent.addMessage(t.id, "A square tea episode");
    // Two square episodes in one turn: the reason is said once.
    const square = { scenes, style: "watercolour", aspect_ratio: "1:1" };
    await agent.run(t.id, scripted(reply([use("u1", "faceless_episode", square), use("u2", "faceless_episode", { ...square, title: "Again" })], "tool_use")));
    const card = agent.getThread(t.id)!.thread.items.find((i) => i.role === "approval");
    expect(card).toMatchObject({ notes: [expect.stringMatching(/16:9 and 9:16 episodes — so it runs as separate steps in your Library\./)] });
    expect(card && "notes" in card ? card.notes : []).toHaveLength(1);
    expect(card && "opens" in card ? card.opens : undefined).toBeUndefined();
  });

  it("names katana and every studio tool in the system prompt", async () => {
    let system = "";
    const t = agent.createThread({ engine: "cloud", agent: "offline", autoApprove: true });
    agent.addMessage(t.id, "hello");
    await agent.run(t.id, async (req) => {
      system = req.system.stable;
      return reply([said("Hi.")], "end_turn");
    });
    for (const n of [...studio.STUDIO_TOOLS.map((x) => x.name), "katana"]) expect(system, n).toContain(n);
  });
});
