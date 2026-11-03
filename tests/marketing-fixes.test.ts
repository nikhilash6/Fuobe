import { beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * The review fixes of the marketing suite: open joins keep the voice, plans on fal and Replicate alone,
 * offline scripts that keep the call to action and the instructions, chat directions without "@"
 * leftovers, a research bar that never goes back, and the sound-keeping join workflows bound for real.
 */

const dir = tempDir("fuobe-marketing-fixes-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const mk = await import("@/server/marketing");
const ads = await import("@/server/ads");
const brand = await import("@/server/brand");
const { saveFile } = await import("@/server/storage");
const { prepareWorkflow, loadManifest } = await import("@/server/providers/comfyui");
const cat = await import("@/lib/catalog/marketing");
const { getModel } = await import("@/lib/catalog");
const mention = await import("@/components/ads/mention");
const render = await import("@/components/ads/render");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4000, 7)]);
const upload = (name = "p.png") => saveFile({ data: PNG, contentType: "image/png", name, source: "upload" }).url;

/** A tiny MP4 header: ftyp + moov with one video trak (and an audio trak when `sound`), enough for probeMedia. */
function mp4(sound: boolean, w = 1080, h = 1920): Buffer {
  const box = (type: string, ...body: Buffer[]) => {
    const data = Buffer.concat(body);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + data.length);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, data]);
  };
  const mvhd = (() => {
    const b = Buffer.alloc(100);
    b.writeUInt32BE(1000, 12); // timescale
    b.writeUInt32BE(8000, 16); // 8 s
    return box("mvhd", b);
  })();
  const trak = (handler: "vide" | "soun") => {
    const hdlr = Buffer.alloc(24);
    hdlr.write(handler, 8, "latin1");
    const tkhd = Buffer.alloc(84);
    if (handler === "vide") {
      tkhd.writeUInt32BE(0x10000, 40); // identity matrix (not rotated)
      tkhd.writeUInt32BE(0x10000, 56);
      tkhd.writeUInt32BE(w << 16, 76);
      tkhd.writeUInt32BE(h << 16, 80);
    }
    const mdhd = Buffer.alloc(24);
    mdhd.writeUInt32BE(1000, 12);
    mdhd.writeUInt32BE(8000, 16);
    return box("trak", box("tkhd", tkhd), box("mdia", box("mdhd", mdhd), box("hdlr", hdlr)));
  };
  const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0isomiso2mp41", "latin1"));
  return Buffer.concat([ftyp, box("moov", mvhd, trak("vide"), ...(sound ? [trak("soun")] : []))]);
}
const clip = (sound: boolean, w?: number, h?: number) => saveFile({ data: mp4(sound, w, h), contentType: "video/mp4", name: sound ? "ad.mp4" : "silent.mp4", source: "upload" }).url;

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});

const product = (over: Partial<import("@/lib/catalog/marketing").Product> = {}): import("@/lib/catalog/marketing").Product => ({
  id: "p1",
  brandId: null,
  name: "Barrier Cream",
  sellingPoints: ["Calms red, reactive skin overnight", "Fragrance-free and vegan"],
  images: [upload()],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});
const SCRIPT = "Okay so this cream fixed my skin in a week and I am not even joking about it at all honestly.";

// ---------------------------------------------------------------------------

describe("open joins keep the voice", () => {
  const filmOf = (plan: import("@/server/marketing").RunPlan) => plan.steps.find((s) => s.key === "film")!;

  it("UGC with a hook: the presenter's own sound starts after the silent hook (sound of clip 2)", () => {
    const plan = mk.planMarketing(
      { engine: "open", format: "ugc-talking", templateId: "ugc-honest-review", hookId: "camera-bump", voiceSample: upload("v.png") },
      { product: product(), script: SCRIPT },
    );
    const film = filmOf(plan);
    expect(plan.finals).toEqual(["film"]);
    expect(film.request.modelId).toBe(cat.OPEN_SOUND_JOIN.second);
    // Clip order: hook, the captioned (voiced) presenter, the product close-up.
    expect(film.after).toEqual(["hook", "captions", "broll"]);
    // The voiced clip carries the TTS: talk takes the voice, captions take talk (and keep its sound).
    expect(plan.steps.find((s) => s.key === "talk")!.after).toEqual(["still", "voice"]);
    expect(plan.steps.find((s) => s.key === "captions")!.after).toEqual(["talk"]);
    expect(getModel(film.request.modelId)!.routes[0].endpoint).toBe("video-concat-sound2-{n}");
    expect(plan.notes.join(" ")).not.toMatch(/without the voiceover|without sound/);
  });

  it("UGC without a hook and Click to Ad's presenter: the first clip's sound from the start", () => {
    const ugc = mk.planMarketing({ engine: "open", format: "ugc-talking", hookId: null, voiceSample: upload("v.png") }, { product: product(), script: SCRIPT });
    expect(filmOf(ugc).request.modelId).toBe(cat.OPEN_SOUND_JOIN.first);
    expect(filmOf(ugc).after).toEqual(["captions", "broll"]);
    const c2a = mk.planClickToAd({ engine: "open", productId: "p1", styleId: "simple-ugc", voiceSample: upload("v.png"), quality: "720p" }, { product: product(), script: SCRIPT });
    expect(filmOf(c2a).request).toMatchObject({ modelId: cat.OPEN_SOUND_JOIN.first, params: { aspectRatio: "9:16", resolution: "720p" } });
    expect(filmOf(c2a).after).toEqual(["captions", "broll"]);
    // Cloud keeps fal's merge (it keeps the clips' audio).
    const cloud = mk.planClickToAd({ engine: "cloud", productId: "p1", styleId: "simple-ugc" }, { product: product(), script: SCRIPT });
    expect(filmOf(cloud).request.modelId).toBe("join-clips");
  });

  it("Click to Ad product-only: joined first, the voice muxed on after the join, captions last", () => {
    const plan = mk.planClickToAd({ engine: "open", productId: "p1", styleId: "clean-minimal", voiceSample: upload("v.png") }, { product: product(), script: SCRIPT });
    const keys = plan.steps.map((s) => s.key);
    expect(keys.indexOf("mux")).toBeGreaterThan(keys.indexOf("film"));
    expect(plan.steps.find((s) => s.key === "mux")!.after).toEqual(["film", "voice"]);
    expect(plan.finals).toEqual(["captions"]);
  });

  it("Ad Multiplier hook / CTA: the reference's own sound when it has one, the plain join otherwise", () => {
    const base = { engine: "open" as const, video: upload("ref.png"), duration: 12, mode: "sections" as const, quality: "1080p" as const, firstFrame: upload("f.png"), lastFrame: upload("l.png") };
    const both = mk.planMultiplier({ ...base, hook: "Wait", cta: "Shop" }, { referenceSound: true, referenceAspect: "9:16" });
    const film = filmOf(both);
    expect(film.request).toMatchObject({ modelId: cat.OPEN_SOUND_JOIN.second, inputs: { videos: [base.video] }, params: { aspectRatio: "9:16", resolution: "720p" } });
    expect(both.steps.find((s) => s.key === "hook")!.request.params).toMatchObject({ aspectRatio: "9:16" });
    const ctaOnly = mk.planMultiplier({ ...base, hook: null, cta: "Shop" }, { referenceSound: true });
    expect(filmOf(ctaOnly).request.modelId).toBe(cat.OPEN_SOUND_JOIN.first);
    const silent = mk.planMultiplier({ ...base, hook: "Wait", cta: null }, { referenceSound: false });
    expect(filmOf(silent).request.modelId).toBe("oss-join-clips");
    expect(silent.notes).toEqual([]);
    const unknown = mk.planMultiplier({ ...base, hook: "Wait", cta: null }, {});
    expect(filmOf(unknown).request.modelId).toBe("oss-join-clips");
    expect(unknown.notes.join(" ")).toMatch(/soundtrack couldn't be read/);
  });

  it("Ad Multiplier prompt mode: no 'Original sound' step for a silent reference", () => {
    const base = { engine: "open" as const, video: upload("ref.png"), duration: 12, mode: "prompt" as const, quality: "720p" as const, images: [upload("star.png")], prompt: "Recreate with @image_1" };
    expect(mk.planMultiplier(base, { referenceSound: true }).steps.map((s) => s.key)).toEqual(["edit", "sound"]);
    const silent = mk.planMultiplier(base, { referenceSound: false });
    expect(silent.steps.map((s) => s.key)).toEqual(["edit"]);
    expect(silent.steps[0].request).toMatchObject({ feature: "ad-multiplier", title: silent.title });
  });

  it("reads the reference's sound and shape from its header (cached per file)", async () => {
    expect(await mk.referenceFacts(clip(true))).toEqual({ sound: true, aspect: "9:16" });
    expect(await mk.referenceFacts(clip(false, 1920, 1080))).toEqual({ sound: false, aspect: "16:9" });
    expect(await mk.referenceFacts(upload("not-a-video.png"))).toEqual({ sound: null });
    // Through the estimate: a voiced 9:16 reference keeps its sound on the open join.
    const est = await mk.estimateMultiplier({ engine: "open", video: clip(true), duration: 8, mode: "sections", hook: "Wait", cta: null, quality: "720p", firstFrame: upload("f.png") });
    expect(est.steps.find((s) => s.key === "film")!.modelId).toBe(cat.OPEN_SOUND_JOIN.second);
  });
});

describe("the sound-keeping join workflows", () => {
  it("are in the library, validated, and bind every clip, the size and the frame rate", async () => {
    const byId = new Map(loadManifest().workflows.map((w) => [w.id, w]));
    for (const id of ["video-concat-sound1-2", "video-concat-sound1-3", "video-concat-sound1-4", "video-concat-sound2-2", "video-concat-sound2-3", "video-concat-sound2-4"]) {
      expect(byId.get(id)?.validated, id).toBe(true);
      expect(byId.get(id)?.defaults.fps, id).toBe(25);
    }
    const res = await prepareWorkflow("video-concat-sound2-{n}", { videos: ["hook.mp4", "talk.mp4", "broll.mp4"], aspectRatio: "9:16", resolution: "480p" }, { generationId: "g1", op: "concat", upload: async (_d, _t, n) => n });
    expect(res.manifest.id).toBe("video-concat-sound2-3");
    const wf = res.workflow;
    expect([wf["1"].inputs.video, wf["4"].inputs.video, wf["7"].inputs.video]).toEqual(["hook.mp4", "talk.mp4", "broll.mp4"]);
    // Every clip is resampled to the film's rate; clip 1's length is the silence before clip 2's sound.
    expect([wf["1"].inputs.force_rate, wf["4"].inputs.force_rate, wf["7"].inputs.force_rate, wf["21"].inputs.fps]).toEqual([25, 25, 25, 25]);
    expect(wf["31"].inputs.duration).toEqual(["30", 2]);
    expect(wf["32"].inputs).toMatchObject({ audio1: ["31", 0], audio2: ["4", 2], direction: "after" });
    expect(wf["21"].inputs.audio).toEqual(["32", 0]);
    const { width, height } = wf["2"].inputs as { width: number; height: number };
    expect(width / height).toBeCloseTo(9 / 16, 1);
    expect(wf["22"].inputs.filename_prefix).toBe("fuobe/g1");
    const first = await prepareWorkflow("video-concat-sound1-{n}", { videos: ["talk.mp4", "broll.mp4"], aspectRatio: "9:16" }, { generationId: "g2", op: "concat", upload: async (_d, _t, n) => n });
    expect(first.manifest.id).toBe("video-concat-sound1-2");
    expect(first.workflow["21"].inputs.audio).toEqual(["1", 2]);
  });
});

// ---------------------------------------------------------------------------

describe("plans on fal and Replicate alone", () => {
  it("the Multiplier recreates on Kling O3 edit by default, or Happy Horse's edit with your images", () => {
    expect(mk.multiplierModel({ engine: "cloud" }).id).toBe("kling-o3");
    expect(mk.multiplierModel({ engine: "cloud", modelId: "happy-horse-video-edit" }).id).toBe("happy-horse-video-edit");
    // An old pick (Seedance 2.5's edit, which no longer has a route) falls back to the default.
    expect(mk.multiplierModel({ engine: "cloud", modelId: "seedance-2-5" }).id).toBe("kling-o3");
    const plan = mk.planMultiplier({ engine: "cloud", video: upload("ref.png"), duration: 10, mode: "prompt", quality: "720p", modelId: "happy-horse-video-edit", images: [upload("a.png")], prompt: "Swap the bottle for @image_1" }, {});
    expect(plan.steps[0].request).toMatchObject({ modelId: "happy-horse-video-edit", op: "v2v", inputs: { images: [expect.any(String)] } });
    expect(getModel("happy-horse-video-edit")!.routes.every((r) => r.provider === "fal")).toBe(true);
  });

  it("says the rules write the copy when no LLM is reachable", () => {
    const kit = brand.kitForSite("https://copy.example/p/1", { name: "Copy Co", colors: [], fonts: {} });
    const p = brand.createProduct({ name: "Mug", brandId: kit.id, images: [upload()] });
    const est = ads.estimateBatch({ brandId: kit.id, engine: "cloud", items: [{ productId: p.id, count: 2 }] });
    expect(est.demo).toBe(true);
    expect(est.copyBy).toBe("rules");
    brand.deleteBrand(kit.id);
  });

  it("lists a batch's ads in the order they were asked for, newest batch first", async () => {
    const kit = brand.kitForSite("https://order.example/p/1", { name: "Order Co", colors: [], fonts: {} });
    const a = brand.createProduct({ name: "First", brandId: kit.id, images: [upload()] });
    const b = brand.createProduct({ name: "Second", brandId: kit.id, images: [upload()] });
    const one = ads.createBatch({ brandId: kit.id, engine: "open", items: [{ productId: a.id, count: 2 }, { productId: b.id, count: 1 }] });
    await one.run;
    await new Promise((r) => setTimeout(r, 5));
    const two = ads.createBatch({ brandId: kit.id, engine: "open", items: [{ productId: b.id, count: 1 }] });
    await two.run;
    const list = ads.listCreatives({ brandId: kit.id });
    expect(list.map((c) => [c.batchId, c.productId, c.position])).toEqual([
      [two.batchId, b.id, 0],
      [one.batchId, a.id, 0],
      [one.batchId, a.id, 1],
      [one.batchId, b.id, 2],
    ]);
    brand.deleteBrand(kit.id);
  });
});

// ---------------------------------------------------------------------------

describe("offline scripts keep the call to action and the instructions", () => {
  const p = product({ name: "Barrier Cream" });
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

  it.each([8, 11.4, 12, 15])("at %s s", (seconds) => {
    const s = mk.heuristicScript({ product: p, seconds, instructions: "mention free shipping over $40" });
    expect(words(s)).toBeLessThanOrEqual(cat.wordBudget(seconds));
    expect(s).toContain("Free shipping over $40.");
    expect(s).toMatch(/(Go try it for yourself|Go try it today)\.$/);
    expect(s).not.toMatch(/Honestly\?$/);
  });

  it("ends on the brand's link when it has a website, and trims long instructions instead of the end", () => {
    const b = { ...cat.emptyKit("Dew Theory"), website: "https://dew.example/" } as import("@/lib/catalog/marketing").BrandKit;
    expect(mk.heuristicScript({ product: p, brand: b, seconds: 12 })).toMatch(/link's in my bio\.$/i);
    const long = mk.heuristicScript({ product: p, seconds: 8, instructions: "say that it is fragrance free and vegan and made with ceramides and oat extract and that dermatologists helped make it for reactive skin" });
    expect(words(long)).toBeLessThanOrEqual(cat.wordBudget(8));
    expect(long).toMatch(/Go try it today\.$/);
    expect(long).toMatch(/It is fragrance free/);
  });

  it("turns instructions into lines to say", () => {
    expect(mk.spokenInstructions("highlight eco-friendly materials, mention free shipping")).toEqual(["Eco-friendly materials.", "Free shipping."]);
    expect(mk.spokenInstructions("it saved my 7 a.m. meetings")).toEqual(["It saved my 7 a.m. meetings."]);
    expect(mk.spokenInstructions("Please mention that it ships free; focus on the scent")).toEqual(["It ships free.", "The scent."]);
    expect(mk.spokenInstructions("  ")).toEqual([]);
  });

  it("fitScript drops middle sentences before the closing call to action", () => {
    const s = "This is the opening line about the cream. Here is a long middle sentence that goes on and on about texture. Another middle bit. Shop now at the link.";
    const out = cat.fitScript(s, 6); // 15 words
    expect(out.endsWith("Shop now at the link.")).toBe(true);
    expect(out.split(" ").length).toBeLessThanOrEqual(15);
    expect(out.startsWith("This is the opening line")).toBe(true);
    // Fits already: unchanged.
    expect(cat.fitScript("Short and sweet.", 8)).toBe("Short and sweet.");
  });

  it("sizes a UGC script to the talking part: the length minus the hook and the close-up", () => {
    const shot = cat.snapDuration(4, getModel(cat.UGC_MODELS.cloud.clip)!.options.durations);
    expect(mk.presenterSeconds({ engine: "cloud", format: "ugc-talking", duration: 20, hookId: "camera-bump" }, { product: product() })).toBe(20 - 2 * shot);
    expect(mk.presenterSeconds({ engine: "cloud", format: "ugc-talking", duration: 20, hookId: null }, { product: null })).toBe(20);
    expect(mk.presenterSeconds({ engine: "cloud", format: "tiktok", duration: 8, hookId: "camera-bump" }, { product: product() })).toBe(5);
  });
});

describe("chat directions", () => {
  const products = [
    { id: "a", name: "Night Serum" },
    { id: "b", name: "Day Cream" },
  ];
  it("drop a stray '@' and the words left dangling by a mention", () => {
    expect(ads.offlineProposal("Make five playful ads for @ @Night Serum", products)).toEqual({ count: 5, productIds: ["a"], direction: "playful" });
    expect(ads.offlineProposal("Make 2 ads for @Nght with a holiday theme", products)).toEqual({ count: 2, productIds: [], direction: "with a holiday theme" });
    expect(ads.offlineProposal("3 bold ads of @Day Cream and @Night Serum", products)?.direction).toBe("bold");
    expect(ads.offlineProposal("Make 4 ads for @Night Serum with a holiday theme", products)?.direction).toBe("with a holiday theme");
  });
});

describe("@product mentions in the chat box", () => {
  const products = [
    { id: "a", name: "Night Serum" },
    { id: "b", name: "Day Cream" },
    { id: "c", name: "Serum Duo" },
  ];
  it("find the '@query' being typed and filter by it", () => {
    expect(mention.mentionQuery("Make five playful ads for @", 27)).toEqual({ start: 26, query: "" });
    expect(mention.mentionQuery("ads for @Ser", 12)).toEqual({ start: 8, query: "Ser" });
    expect(mention.mentionQuery("mail me@home", 12)).toBeNull(); // not after a space
    expect(mention.mentionQuery("for @Night Serum now", 20)).toBeNull();
    expect(mention.mentionMatches(products, "ser").map((p) => p.id)).toEqual(["c", "a"]);
    expect(mention.mentionMatches(products, "")).toHaveLength(3);
  });
  it("replace the typed '@' (and query) with the product instead of appending", () => {
    const t = "Make five playful ads for @";
    expect(mention.insertMention(t, t.length, "Night Serum")).toEqual({ text: "Make five playful ads for @Night Serum ", caret: 39 });
    expect(mention.insertMention("ads for @Ni and more", 11, "Night Serum").text).toBe("ads for @Night Serum and more");
    // From the button, at the caret.
    expect(mention.insertMention("Make ads", 8, "Day Cream").text).toBe("Make ads @Day Cream ");
    // The result reads back cleanly offline.
    const msg = mention.insertMention(t, t.length, "Night Serum").text;
    expect(ads.offlineProposal(msg, products)).toEqual({ count: 5, productIds: ["a"], direction: "playful" });
  });
});

describe("composer details", () => {
  it("a template opens in its own shape, else the format's when the format changes", () => {
    // Hero Headline (Ads) after a 3:4 product shot opens 4:5, the Ads default.
    expect(cat.openingAspect({ format: "product-standalone", aspectRatio: "3:4" }, cat.TEMPLATE_INDEX.get("ad-hero-headline"), "ads")).toBe("4:5");
    // A talking head after it opens 9:16.
    expect(cat.openingAspect({ format: "ads", aspectRatio: "3:4" }, cat.TEMPLATE_INDEX.get("ugc-honest-review"), "ugc-talking")).toBe("9:16");
    // Same format: the ratio in use stays.
    expect(cat.openingAspect({ format: "ads", aspectRatio: "1:1" }, cat.TEMPLATE_INDEX.get("ad-offer-burst"), "ads")).toBe("1:1");
  });
  it("checks a website or social link", () => {
    expect(cat.looksLikeWebsite("www.example.com")).toBe(true);
    expect(cat.looksLikeWebsite("https://instagram.com/acme")).toBe(true);
    expect(cat.looksLikeWebsite("acme")).toBe(false);
    expect(cat.looksLikeWebsite("my site.com")).toBe(false);
  });
  it("SaaS motion uses the brand kit's website when no link or product is given", () => {
    const b = { ...cat.emptyKit("Northbound"), id: "b1", website: "https://northbound.example/" } as import("@/lib/catalog/marketing").BrandKit;
    const plan = mk.planMarketing({ engine: "cloud", format: "motion-saas" }, { brand: b });
    expect(plan.steps[0].request.prompt).toMatch(/For the product at https:\/\/northbound\.example\//);
    expect(() => mk.planMarketing({ engine: "cloud", format: "motion-saas" }, {})).toThrow(/website/);
  });
  it("open posters and ads ask for room where the words go", () => {
    const ad = mk.planMarketing({ engine: "open", format: "ads", templateId: "ad-hero-headline", productImages: [upload()] }, {});
    expect(cat.overlayLayout("ads")).toBe("overlay");
    expect(ad.steps[0].request.prompt).toMatch(/lower third/);
    const poster = mk.planMarketing({ engine: "open", format: "poster", prompt: "A summer concert" }, {});
    expect(cat.overlayLayout("poster")).toBe("frame");
    expect(poster.steps[0].request.prompt).not.toMatch(/third/);
  });
  it("keeps the browser's own composite on the run once (a second automatic one returns it)", () => {
    const plan = mk.planMarketing({ engine: "open", format: "poster", prompt: "A summer concert", headline: "Live at dusk" }, {});
    const run = mk.launch(plan);
    expect(run.meta.overlay).toEqual({ headline: "Live at dusk" });
    const first = mk.saveRunComposite(run.id, { url: upload("c1.png"), ratio: "3:4", text: "Live at dusk", auto: true });
    const again = mk.saveRunComposite(run.id, { url: upload("c2.png"), ratio: "3:4", text: "Live at dusk", auto: true });
    expect(again.id).toBe(first.id);
    expect(mk.getRun(run.id)!.meta.composed).toEqual({ id: first.id, url: first.outputs[0].url });
    // An edit from "Edit text" replaces it and keeps the new words.
    const edited = mk.saveRunComposite(run.id, { url: upload("c3.png"), ratio: "3:4", text: "Tonight", overlay: { headline: "Tonight" } });
    expect(edited.id).not.toBe(first.id);
    expect(mk.getRun(run.id)!.meta).toMatchObject({ composed: { id: edited.id }, overlay: { headline: "Tonight" } });
  });

  it("baked ads are letterboxed, never cropped", () => {
    expect(render.containRect(1080, 1350, 1080, 1080)).toEqual({ x: 108, y: 0, w: 864, h: 1080 });
    expect(render.containRect(1080, 1350, 1080, 1350)).toEqual({ x: 0, y: 0, w: 1080, h: 1350 });
    expect(render.containRect(1080, 1351, 1080, 1350)).toMatchObject({ w: 1080, h: 1350 });
  });
});

describe("research progress", () => {
  it("never goes back while the writing-stage labels rotate", () => {
    const p = { index: cat.LLM_STAGE.from, startedAt: 0 };
    let last = 0;
    for (let t = 0; t < 120_000; t += 700) {
      const v = cat.researchProgress(p, t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(last).toBeLessThan(cat.researchProgress({ index: 11, startedAt: 0 }, 0));
    expect(cat.researchProgress({ index: 0, startedAt: 0 }, 0)).toBeCloseTo(100 / cat.RESEARCH_LABELS.length);
    expect(cat.researchProgress(null, 0)).toBeGreaterThan(0);
  });
});
