import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BrandKit, Product } from "@/lib/catalog/marketing";
import type { Generation, GenInput } from "@/lib/catalog/types";
import type { ComfyWorkflow, ManifestWorkflow } from "@/lib/comfy";
import type { MediaInfo } from "@/lib/media-probe";

// Click to Ad's logo end card (r4/marketing-mixed): the plan per engine (cloud ken-burns + merge-videos,
// open video-append-endcard or still-to-clip + the sound-keeping join), how it hangs off the ad, a demo run,
// and the two open workflows bound through the ComfyUI provider.

vi.setConfig({ testTimeout: 90_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-endcard-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const mk = await import("@/server/marketing");
const gens = await import("@/server/generations");
const { readRef, saveFile } = await import("@/server/storage");
const { decodePng } = await import("@/server/png");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel } = await import("@/lib/catalog");
const { END_CARD, END_CARD_MODELS, endCardSteps } = await import("@/lib/catalog/marketing");
const { planEndCard, siteLabel } = await import("@/components/marketing/end-card");
const { themeFrom } = await import("@/components/ads/layout");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => {
  // The database stays open until the worker exits (Windows won't delete it before).
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 7)]);
const upload = (name = "p.png") => saveFile({ data: PNG, contentType: "image/png", name, source: "upload" }).url;
const product = (): Product => ({ id: "p1", brandId: null, name: "Barrier Cream", sellingPoints: ["Calms red skin overnight"], images: [upload()], createdAt: 0, updatedAt: 0 });
const kit = (over: Partial<BrandKit> = {}): BrandKit =>
  ({ id: "b1", name: "Dermaco", colors: ["#c1121f", "#fdf0d5"], fonts: {}, values: [], aesthetics: [], tone: [], sellingPoints: [], competitors: [], socials: [], images: [], details: [], status: "ready", source: "manual", createdAt: 0, updatedAt: 0, ...over }) as BrandKit;
const SCRIPT = "Okay so this cream fixed my skin in a week and I am not even joking about it at all honestly.";

async function settle(id: string, ms = 80_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe("the end card's steps per engine", () => {
  const base = { ad: "captions", feature: "click-to-ad", title: "Clean Minimal · Barrier Cream", aspectRatio: "9:16", resolution: "480p" };

  it("uses real, hidden models", () => {
    for (const id of [...Object.values(END_CARD_MODELS.cloud), ...Object.values(END_CARD_MODELS.open)]) expect(getModel(id), id).toBeDefined();
    for (const id of ["overlay-image", "ken-burns", "oss-append-endcard", "oss-still-to-clip"]) expect(getModel(id)!.hidden, id).toBe(true);
    expect(getModel("oss-append-endcard")!.routes).toEqual([expect.objectContaining({ op: "concat", provider: "comfyui", endpoint: "video-append-endcard" })]);
    expect(getModel("oss-still-to-clip")!.routes).toEqual([expect.objectContaining({ op: "still-motion", provider: "comfyui", endpoint: "still-to-clip" })]);
  });

  it("cloud: the drawn card → a 2.5 s push-in (zoom 1 → 1.05) → a silent track under it → merge-videos after the ad", () => {
    const { steps, final } = endCardSteps({ ...base, engine: "cloud", card: "/api/files/card.png", silence: "/api/files/silence.wav" });
    expect(final).toBe("endcard");
    expect(steps.map((s) => s.key)).toEqual(["endcardClip", "endcardSound", "endcard"]);
    expect(steps[0].request).toMatchObject({
      feature: "click-to-ad-step",
      modelId: "ken-burns",
      op: "still-motion",
      inputs: { images: ["/api/files/card.png"] },
      params: { duration: 2.5, fps: 24, zoomFrom: 1, zoomTo: 1.05, easing: "ease-in-out" },
    });
    // Both clips merge-videos joins carry sound, so the ad's voiceover goes through the join.
    expect(steps[1]).toMatchObject({ after: ["endcardClip"], chain: [{ slot: "video" }], request: { feature: "click-to-ad-step", modelId: "merge-audio-video", op: "mux", inputs: { audio: "/api/files/silence.wav" } } });
    expect(steps[2]).toMatchObject({ after: ["captions", "endcardSound"], chain: [{ slot: "videos" }, { slot: "videos" }], request: { feature: "click-to-ad", title: base.title, modelId: "join-clips", op: "concat" } });
    expect(() => endCardSteps({ ...base, engine: "cloud", card: "/api/files/card.png" })).toThrow(/needs its silent sound track/);
  });

  it("cloud without a drawn card: overlay-image puts the logo on the brand colour first", () => {
    const { steps } = endCardSteps({ ...base, engine: "cloud", background: "/api/files/bg.png", logo: "/api/files/logo.png", seconds: 9, silence: "/api/files/silence.wav" });
    expect(steps.map((s) => s.key)).toEqual(["endcardArt", "endcardClip", "endcardSound", "endcard"]);
    expect(steps[0].request).toMatchObject({ modelId: "overlay-image", op: "overlay", inputs: { images: ["/api/files/bg.png", "/api/files/logo.png"] }, params: { position: { x: 0.5, y: 0.45 }, scale: 1 } });
    expect(steps[1]).toMatchObject({ after: ["endcardArt"], chain: [{ slot: "images" }], request: { params: { duration: 3 } } });
    expect(steps[1].request.inputs).toBeUndefined();
    expect(() => endCardSteps({ ...base, engine: "cloud", silence: "/api/files/silence.wav" })).toThrow(/Add a logo to the brand kit/);
  });

  it("open: the card appended to the ad keeping its sound, or still-to-clip + the join that keeps the first clip's sound", () => {
    const own = endCardSteps({ ...base, engine: "open", card: "/api/files/card.png", seconds: 1 });
    expect(own.steps).toHaveLength(1);
    expect(own.steps[0]).toMatchObject({
      key: "endcard",
      after: ["captions"],
      chain: [{ slot: "video" }],
      request: { feature: "click-to-ad", title: base.title, modelId: "oss-append-endcard", op: "concat", inputs: { images: ["/api/files/card.png"] }, params: { duration: 2 } },
    });
    const foreign = endCardSteps({ ...base, engine: "open", card: "/api/files/card.png", adEncodedBy: "other" });
    expect(foreign.steps.map((s) => s.request.modelId)).toEqual(["oss-still-to-clip", "oss-join-sound1"]);
    expect(foreign.steps[0].request.params).toMatchObject({ duration: END_CARD.seconds, fps: 25, aspectRatio: "9:16", resolution: "480p" });
    expect(foreign.steps[1]).toMatchObject({ after: ["captions", "endcardClip"], request: { feature: "click-to-ad", params: { aspectRatio: "9:16", resolution: "480p" } } });
    expect(() => endCardSteps({ ...base, engine: "open" })).toThrow(/needs the end card drawn on the page/);
  });
});

describe("Click to Ad with an end card", () => {
  it("ends the product-only ad on the card: captions become a helper, the card's join is the result", () => {
    const card = upload("card.png");
    const plan = mk.planClickToAd({ engine: "cloud", productId: "p1", styleId: "clean-minimal", endCard: { image: card } }, { product: product(), script: SCRIPT, silence: "/api/files/silence.wav" });
    expect(plan.finals).toEqual(["endcard"]);
    const by = Object.fromEntries(plan.steps.map((s) => [s.key, s]));
    expect(by.captions.request.feature).toBe("click-to-ad-step");
    expect(by.captions.request.title).toBeUndefined();
    expect(by.endcard).toMatchObject({ after: ["captions", "endcardSound"], request: { feature: "click-to-ad", title: plan.title } });
    expect(plan.meta.endCard).toBe(card);
    expect(plan.notes).toContain("Ends on your logo card for 2.5 s");
    // Prices: the card's three fal steps are about free; every step is valid.
    const est = mk.estimatePlan(plan);
    expect(est.steps.map((s) => s.key).slice(-3)).toEqual(["endcardClip", "endcardSound", "endcard"]);
  });

  it("no card asked for: the plan is as before", () => {
    const plan = mk.planClickToAd({ engine: "cloud", productId: "p1", styleId: "clean-minimal" }, { product: product(), script: SCRIPT });
    expect(plan.finals).toEqual(["captions"]);
    expect(plan.steps.some((s) => s.key.startsWith("endcard"))).toBe(false);
  });

  it("cloud, no drawn card: the kit's raster logo on the background; an SVG logo can't be placed", () => {
    const logo = upload("logo.png");
    const plan = mk.planClickToAd({ engine: "cloud", productId: "p1", styleId: "clean-minimal", endCard: {} }, { product: product(), brand: kit({ logo }), script: SCRIPT, background: "/api/files/bg.png", silence: "/api/files/silence.wav" });
    expect(plan.steps.find((s) => s.key === "endcardArt")!.request.inputs).toEqual({ images: ["/api/files/bg.png", logo] });
    expect(plan.notes.join(" ")).toMatch(/the kit's logo on its main colour/);
    expect(() => mk.planClickToAd({ engine: "cloud", productId: "p1", styleId: "clean-minimal", endCard: {} }, { product: product(), brand: kit({ logo: "/api/files/logo.svg" }), script: SCRIPT, background: "/api/files/bg.png", silence: "/api/files/silence.wav" })).toThrow(
      /Add a logo to the brand kit for the end card, or turn End card off/,
    );
  });

  it("cloud, no drawn card: the background is the colour the page's card uses, not the kit's first colour", async () => {
    // A white first colour under a white logo would hide it; the page's card takes the kit's accent.
    const url = mk.cardBackground(kit({ colors: ["#ffffff", "#0a7d4f"] }));
    const png = decodePng((await readRef(url)).data);
    expect([png.width, png.height]).toEqual([END_CARD.size.w, END_CARD.size.h]);
    expect([...png.data.subarray(0, 4)]).toEqual([0x0a, 0x7d, 0x4f, 255]);
    expect(themeFrom({ colors: ["#ffffff", "#0a7d4f"] }).accent).toBe("#0a7d4f");
  });

  it("cloud: the card's silent sound track is a WAV as long as the card", () => {
    const wav = mk.silentWav(2.5);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(44100);
    expect(wav.readUInt32LE(40) / (44100 * 4)).toBeCloseTo(2.5, 5);
    expect(wav.subarray(44).every((b) => b === 0)).toBe(true);
  });

  it("open: reads who encodes the ad from its last step (append for ComfyUI, still-to-clip + join for anything else)", () => {
    const card = upload("card.png");
    const plan = mk.planClickToAd({ engine: "open", productId: "p1", styleId: "clean-minimal", voiceSample: upload("v.png"), endCard: { image: card } }, { product: product(), script: SCRIPT });
    // Every open Click to Ad ends on a ComfyUI step today: the card is appended to it.
    expect(plan.steps.at(-1)!.request.modelId).toBe("oss-append-endcard");
    expect(mk.adEncoder({ request: { feature: "t", modelId: "oss-captions-burnin", op: "captions" } })).toBe("comfyui");
    // A clip made in the browser (or by anything but ComfyUI) can't have its packets copied.
    expect(mk.adEncoder({ request: { feature: "t", modelId: "local-ad-compose", op: "edit" } })).toBe("other");
    expect(mk.adEncoder({ request: { feature: "t", modelId: "no-such-model", op: "concat" } })).toBe("other");
    expect(mk.adEncoder(undefined)).toBe("other");
  });

  it("open: appended after the presenter film (ComfyUI-encoded), and needs the drawn card", () => {
    const card = upload("card.png");
    const plan = mk.planClickToAd({ engine: "open", productId: "p1", styleId: "simple-ugc", voiceSample: upload("v.png"), endCard: { image: card, seconds: 3 } }, { product: product(), script: SCRIPT });
    expect(plan.finals).toEqual(["endcard"]);
    expect(plan.steps.find((s) => s.key === "film")!.request.feature).toBe("click-to-ad-step");
    expect(plan.steps.at(-1)).toMatchObject({ key: "endcard", after: ["film"], request: { modelId: "oss-append-endcard", inputs: { images: [card] }, params: { duration: 3 } } });
    mk.estimatePlan(plan);
    expect(() => mk.planClickToAd({ engine: "open", productId: "p1", styleId: "simple-ugc", voiceSample: upload("v.png"), endCard: {} }, { product: product(), script: SCRIPT })).toThrow(mk.PlanError);
  });

  it("runs end to end on the demo provider (open: the ad, then the card appended)", async () => {
    const card = upload("card.png");
    const plan = mk.planClickToAd({ engine: "open", productId: "p1", styleId: "clean-minimal", voiceSample: upload("v.png"), endCard: { image: card } }, { product: product(), script: SCRIPT });
    const run = mk.launch(plan);
    expect(run.finalIds).toHaveLength(1);
    const final = await settle(run.finalIds[0]);
    expect(final, final.error ?? "").toMatchObject({ status: "succeeded", modelId: "oss-append-endcard", feature: "click-to-ad", kind: "video" });
    const captions = mk.getRun(run.id)!.generations.find((g) => g.modelId === "oss-captions-burnin")!;
    expect(final.request.inputs).toMatchObject({ video: captions.outputs[0].url, images: [card] });
  });
});

describe("the open end-card workflows through the ComfyUI provider", () => {
  async function prepare(id: string, input: GenInput, op: "concat" | "still-motion", media: Record<string, MediaInfo> = {}) {
    return prepareWorkflow(id, { seed: 7, ...input }, { generationId: "gen1", op, upload: async (_d, _t, name) => `up_${name}`, media: (name) => media[name], serverRam: async () => undefined });
  }
  const at = (wf: ComfyWorkflow, m: ManifestWorkflow, key: string) => (m.bindings[key] ?? []).map((t) => wf[t.node].inputs[t.input]);
  const ad = (hasAudio: boolean): MediaInfo => ({ container: "mp4", hasVideo: true, hasAudio, duration: 12, videoDuration: 12, width: 480, height: 848, fps: 25 });

  it("video-append-endcard: the ad's own size and frame rate, the card's seconds, the ad read twice (picture and sound)", async () => {
    const { workflow: wf, manifest: m } = await prepare("video-append-endcard", { video: "ad.mp4", images: ["card.png"], duration: 2.5 }, "concat", { "ad.mp4": ad(true) });
    expect(at(wf, m, "video")).toEqual(["ad.mp4", "ad.mp4"]);
    expect(at(wf, m, "image")).toEqual(["card.png"]);
    expect([at(wf, m, "width"), at(wf, m, "height"), at(wf, m, "fps"), at(wf, m, "duration")]).toEqual([[480], [848], [25], [2.5]]);
    expect(wf["14"].inputs.complete_audio).toEqual(["13", 0]);
    expect(at(wf, m, "filenamePrefix")).toEqual(["fuobe/gen1"]);
  });

  it("a silent ad: no LoadAudio, no padding, no complete_audio (the result has no sound track)", async () => {
    const { workflow: wf } = await prepare("video-append-endcard", { video: "ad.mp4", images: ["card.png"], duration: 2 }, "concat", { "ad.mp4": ad(false) });
    for (const id of ["2", "12", "13"]) expect(wf[id], id).toBeUndefined();
    expect(wf["14"].inputs.complete_audio).toBeUndefined();
    expect(wf["14"].inputs["videos.video0"]).toEqual(["1", 0]);
    expect(Object.keys(wf).sort()).toEqual(["1", "10", "11", "14", "15", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("refuses an ad whose size and frame rate it can't read", async () => {
    await expect(prepare("video-append-endcard", { video: "ad.mp4", images: ["card.png"] }, "concat")).rejects.toThrow(/Couldn't read the ad's size and frame rate/);
  });

  it("still-to-clip: the card at the clip size for its seconds", async () => {
    const { workflow: wf, manifest: m } = await prepare("still-to-clip", { images: ["card.png"], aspectRatio: "9:16", resolution: "480p", duration: 2.5, fps: 25 }, "still-motion");
    expect(at(wf, m, "image")).toEqual(["card.png"]);
    expect([at(wf, m, "duration"), at(wf, m, "fps")]).toEqual([[2.5], [25]]);
    const [w] = at(wf, m, "width") as number[];
    const [h] = at(wf, m, "height") as number[];
    expect(w % 2 + (h % 2)).toBe(0);
    expect(h / w).toBeCloseTo(16 / 9, 1);
  });
});

describe("the end card the page draws", () => {
  // A stand-in for canvas text metrics: half the font size per character.
  const measure = (text: string, font: string) => text.length * Number(/(\d+)px/.exec(font)![1]) * 0.5;
  const theme = themeFrom({ colors: ["#c1121f", "#fdf0d5"], fonts: { heading: "Playfair Display" } });
  const inside = (r: { x: number; y: number; w?: number; h?: number }, W = END_CARD.size.w, H = END_CARD.size.h) => {
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + (r.w ?? 0)).toBeLessThanOrEqual(W);
    expect(r.y + (r.h ?? 0)).toBeLessThanOrEqual(H);
  };

  it("centres the logo, the product name and the CTA pill on the brand colour, the address at the foot", () => {
    const plan = planEndCard({ theme, content: { brand: "Dermaco", product: "Barrier Cream", cta: "Shop now", website: "dermaco.com" }, logo: { w: 800, h: 200 }, measure });
    expect(plan).toMatchObject({ w: 720, h: 1280, bg: "#c1121f", image: null });
    expect(plan.brand).toBeUndefined();
    const { logo, headline, cta, body } = plan;
    expect(logo!.x + logo!.w / 2).toBeCloseTo(360, 0);
    expect(logo!.w / logo!.h).toBeCloseTo(4, 1);
    expect(headline).toMatchObject({ lines: ["Barrier Cream"], align: "center", x: 360, color: theme.onAccent });
    expect(headline.y).toBeGreaterThan(logo!.y + logo!.h);
    expect(cta!.x + cta!.w / 2).toBeCloseTo(360, 0);
    expect(cta!.y).toBeGreaterThan(headline.y + headline.lineHeight);
    expect(cta!.color).toBe(theme.onAccent);
    expect(cta!.text.lines).toEqual(["Shop now"]);
    expect(body!.lines).toEqual(["dermaco.com"]);
    expect(body!.y).toBeGreaterThan(cta!.y + cta!.h);
    for (const r of [logo!, cta!, { x: 0, y: body!.y, h: body!.lineHeight }]) inside(r);
  });

  it("writes the brand's name as typed when there is no logo, and leaves out a CTA nobody wrote", () => {
    const plan = planEndCard({ theme, content: { brand: "Dermaco", product: "A very long product name that keeps going and going for a while" }, logo: null, measure });
    expect(plan.logo).toBeUndefined();
    expect(plan.brand!.lines).toEqual(["Dermaco"]);
    expect(plan.cta).toBeUndefined();
    expect(plan.headline.lines.length).toBeLessThanOrEqual(2);
    for (const l of plan.headline.lines) expect(measure(l, plan.headline.font)).toBeLessThanOrEqual(720 - 144 + 1);
  });

  it("names the shop by its address", () => {
    expect(siteLabel("https://www.dermaco.com/products/cream")).toBe("dermaco.com");
    expect(siteLabel("shop.example.org")).toBe("shop.example.org");
    expect(siteLabel(undefined)).toBeUndefined();
    expect(siteLabel("not a url at all")).toBeUndefined();
  });
});
