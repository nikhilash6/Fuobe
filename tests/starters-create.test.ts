import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { EpisodeSettings, EpisodeView } from "@/lib/catalog/faceless";
import { tempDir } from "./helpers/temp-dir";

// Every ready-made starter of Faceless Studio, Content Factory, Explainer, Ads Studio, Click to Ad and Marketing Studio,
// made as the owner's "Use template" makes it, on a fresh data dir, then run on the demo provider to the end: the
// channel's first episode, the series, the explainer, the ads, the video ad and the product shot.

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: unknown) => void Promise.resolve(typeof task === "function" ? (task as () => unknown)() : task).catch(() => {}),
}));

const dir = tempDir("fuobe-starters-");
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: models run on the demo provider, and there's no LLM (the offline writers run).
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const faceless = await import("@/server/faceless");
const cf = await import("@/server/content-factory");
const brand = await import("@/server/brand");
const mk = await import("@/server/marketing");
const ads = await import("@/server/ads");
const { absolutePath, filesRel, listAssets } = await import("@/server/storage");
const { sampleFile } = await import("@/server/canvas-samples");
const route = await import("@/app/api/starters/[id]/route");
const listRoute = await import("@/app/api/starters/route");
const explainerRoute = await import("@/app/api/explainer/route");
const { STARTERS, facelessTopic, getStarter } = await import("@/lib/starters/catalog");
const { getPreset } = await import("@/lib/catalog/content-factory");
const { defaultSettings, genreInfo } = await import("@/lib/catalog/faceless");
const { TEMPLATE_INDEX } = await import("@/lib/catalog/marketing");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const applyTemplate = async (id: string, engine: "cloud" | "open" = "cloud") => {
  const res = await route.POST(new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine }) }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as { href?: string; error?: string } };
};
const view = (id: string): EpisodeView => JSON.parse(JSON.stringify(faceless.episodeView(id)));

/** Follow an episode until it's finished (demo jobs: a few seconds a step). */
async function finished(id: string, ms = 150_000): Promise<EpisodeView> {
  const end = Date.now() + ms;
  for (;;) {
    const v = view(id);
    if (v.episode.status === "review" && !v.episode.error) faceless.renderEpisode(id);
    if (["done", "failed", "write-failed"].includes(v.episode.status) || (v.episode.status === "review" && v.episode.error)) return v;
    if (Date.now() > end) throw new Error(`timed out: ${v.episode.status} ${Math.round(v.progress * 100)}%`);
    await sleep(500);
  }
}

async function settled(id: string, ms = 120_000) {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await sleep(300);
  }
}

const of = (surface: string) => STARTERS.filter((s) => s.surface === surface);

describe("Use template", () => {
  it("answers 404 for an unknown starter, and 400 for one that only fills its studio's composer", async () => {
    expect((await applyTemplate("faceless.nope")).status).toBe(404);
    const fill = await applyTemplate("cf.underwater-fashion-week");
    expect(fill.status).toBe(400);
    expect(fill.body.error).toMatch(/opens in its studio/);
  });

  it("Faceless: makes the channel with its name and look, opens its first episode's setup, and the episode renders", async () => {
    const runs = of("faceless").map(async (s) => {
      const seed = s.seed.kind === "faceless" ? s.seed : null;
      if (!seed) throw new Error(s.id);
      const { status, body } = await applyTemplate(s.id);
      expect(status, s.id).toBe(201);
      const m = /^\/faceless\/([^/]+)\/new\?starter=(.+)$/.exec(body.href ?? "");
      expect(m, body.href).toBeTruthy();
      const channel = faceless.getChannel(m![1])!;
      expect(channel).toMatchObject({ name: seed.channel.name, genre: seed.channel.genre, settings: { styleId: seed.episode.styleId, length: seed.episode.length } });
      // The episode setup reads the topic from the address, then posts what the page would.
      const topic = facelessTopic(decodeURIComponent(m![2]));
      expect(topic).toBe(seed.episode.topic);
      const settings: EpisodeSettings = { ...channel.settings, styleRefs: [], elements: [], engine: "cloud" };
      const ep = faceless.createEpisode({ kind: "faceless", channelId: channel.id, topic: topic!, settings });
      await faceless.scriptWritten(ep.id);
      const v = await finished(ep.id);
      expect(v.episode.status, `${s.id}: ${v.episode.error ?? ""}`).toBe("done");
      expect(v.episode.settings.styleId).toBe(seed.episode.styleId);
    });
    await Promise.all(runs);
  }, 300_000);

  it("Faceless: Use template again opens the same channel, not a second one with the same name", async () => {
    const s = of("faceless")[0];
    const first = await applyTemplate(s.id);
    const again = await applyTemplate(s.id);
    expect(again.status).toBe(201);
    expect(again.body.href).toBe(first.body.href);
    const seed = s.seed.kind === "faceless" ? s.seed : null;
    expect(faceless.listChannels().filter((c) => c.name === seed!.channel.name)).toHaveLength(1);
  });

  it("Faceless and Explainer on the open engine: the starter's own narrator sample is in place, and the episode runs", async () => {
    // A starter whose narrator sample is published (here a copy of Fuobe's clean voice sample, at the starter's place).
    const s = of("faceless")[1];
    const ex = of("explainer")[0];
    const made: string[] = [];
    for (const id of [s.id, ex.id]) {
      const dirOf = path.join(process.cwd(), "public", "starters", id);
      if (!fs.existsSync(dirOf)) made.push(dirOf);
      fs.mkdirSync(path.join(dirOf, "1"), { recursive: true });
      fs.copyFileSync(path.join(process.cwd(), "public", "samples", "clean-voice", "clean.m4a"), path.join(dirOf, "1", "voice.m4a"));
    }
    try {
      const { status, body } = await applyTemplate(s.id, "open");
      expect(status, body.error).toBe(201);
      const channel = faceless.getChannel(/^\/faceless\/([^/]+)\/new/.exec(body.href!)![1])!;
      expect(channel.settings.voice).toMatchObject({ kind: "sample", url: expect.stringMatching(/^\/api\/files\//) });
      const topic = facelessTopic(s.id)!;
      const ep = faceless.createEpisode({ kind: "faceless", channelId: channel.id, topic, settings: { ...channel.settings, styleRefs: [], elements: [], engine: "open" } });
      await faceless.scriptWritten(ep.id);
      const v = await finished(ep.id);
      expect(v.episode.status, `${s.id}: ${v.episode.error ?? ""}`).toBe("done");
      expect(v.episode.settings.voice?.kind).toBe("sample");

      // The owner's list carries the explainer's sample, stored, in its fill; a page's props never do.
      const res = await listRoute.GET(new Request("http://x/api/starters?surface=explainer"));
      expect(res.status).toBe(200);
      const owner = (await res.json()) as { starters: { id: string }[]; fills: Record<string, { voiceSample?: string }> };
      expect(owner.starters.map((x) => x.id).sort()).toEqual(of("explainer").map((x) => x.id).sort());
      expect(owner.fills[ex.id]?.voiceSample).toMatch(/^\/api\/files\//);
      const f = ex.seed.kind === "fill" && ex.seed.fill.kind === "explainer" ? ex.seed.fill : null;
      const base = defaultSettings("open", genreInfo("education"), { explainer: true });
      const settings: EpisodeSettings = { ...base, engine: "open", styleId: f!.styleId, aspect: f!.aspect, voice: { kind: "sample", url: owner.fills[ex.id].voiceSample!, name: "Narrator" } };
      const made2 = await explainerRoute.POST(new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: f!.prompt, sources: [], settings }) }));
      expect(made2.status).toBe(201);
      const exEp = (await made2.json()) as { id: string };
      await faceless.scriptWritten(exEp.id);
      const ev = await finished(exEp.id);
      expect(ev.episode.status, `${ex.id}: ${ev.episode.error ?? ""}`).toBe("done");
    } finally {
      for (const d of made) fs.rmSync(d, { recursive: true, force: true });
      const root = path.join(process.cwd(), "public", "starters");
      if (fs.existsSync(root) && !fs.readdirSync(root).length) fs.rmdirSync(root);
    }
    expect((await listRoute.GET(new Request("http://x/api/starters?surface=nope"))).status).toBe(400);
  }, 300_000);

  it("on the open engine before a starter's own narrator exists: Fuobe's clean voice sample narrates, and the episode runs", async () => {
    const s = of("faceless")[2];
    expect(fs.existsSync(path.join(process.cwd(), "public", "starters", s.id, "1", "voice.m4a"))).toBe(false);
    const { status, body } = await applyTemplate(s.id, "open");
    expect(status, body.error).toBe(201);
    const channel = faceless.getChannel(/^\/faceless\/([^/]+)\/new/.exec(body.href!)![1])!;
    expect(channel.settings.voice).toMatchObject({ kind: "sample", url: expect.stringMatching(/^\/api\/files\//) });
    const ep = faceless.createEpisode({ kind: "faceless", channelId: channel.id, topic: facelessTopic(s.id)!, settings: { ...channel.settings, styleRefs: [], elements: [], engine: "open" } });
    await faceless.scriptWritten(ep.id);
    const v = await finished(ep.id);
    expect(v.episode.status, `${s.id}: ${v.episode.error ?? ""}`).toBe("done");

    // Every Content Factory and Explainer fill carries a narrator for the owner, so each runs on the open engine too.
    for (const surface of ["content-factory", "explainer"] as const) {
      const owner = (await (await listRoute.GET(new Request(`http://x/api/starters?surface=${surface}`))).json()) as { fills: Record<string, { voiceSample?: string }> };
      for (const x of of(surface)) expect(owner.fills[x.id]?.voiceSample, x.id).toMatch(/^\/api\/files\//);
    }
  }, 300_000);

  it("Content Factory: each ready series plans on its trending style and makes its episode", async () => {
    const runs = of("content-factory").map(async (s) => {
      const f = s.seed.kind === "fill" && s.seed.fill.kind === "content-factory" ? s.seed.fill : null;
      if (!f) throw new Error(s.id);
      const preset = getPreset(f.presetId)!;
      const series = await cf.createSeries({ reference: { kind: "preset", presetId: f.presetId }, engine: "cloud" });
      const made = await cf.generateSeries(series.id, {
        prompt: f.prompt,
        settings: { engine: "cloud", length: f.length, episodes: f.episodes, animation: preset.brief.animation, genre: preset.genre, aspect: preset.brief.aspect },
      });
      expect(made.episodes, s.id).toHaveLength(f.episodes);
      for (const e of made.episodes) {
        const v = await finished(e.id);
        expect(v.episode.status, `${s.id}: ${v.episode.error ?? ""}`).toBe("done");
      }
    });
    await Promise.all(runs);
  }, 300_000);

  it("Explainer: each ready explainer renders with its style, length, shape and voice", async () => {
    const runs = of("explainer").map(async (s) => {
      const f = s.seed.kind === "fill" && s.seed.fill.kind === "explainer" ? s.seed.fill : null;
      if (!f) throw new Error(s.id);
      const base = defaultSettings("cloud", genreInfo("education"), { explainer: true });
      const settings: EpisodeSettings = { ...base, styleId: f.styleId, aspect: f.aspect, length: f.duration === "auto" ? base.length : f.duration, auto: f.duration === "auto", ...(f.voice && { voice: { kind: "preset" as const, id: f.voice } }) };
      const res = await explainerRoute.POST(new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: f.prompt, sources: [], settings }) }));
      expect(res.status, s.id).toBe(201);
      const ep = (await res.json()) as { id: string };
      await faceless.scriptWritten(ep.id);
      const v = await finished(ep.id);
      expect(v.episode.status, `${s.id}: ${v.episode.error ?? ""}`).toBe("done");
      expect(v.episode.settings).toMatchObject({ styleId: f.styleId, aspect: f.aspect });
    });
    await Promise.all(runs);
  }, 300_000);

  it("Ads, Click to Ad and Marketing: one brand kit and product per brand, its photo stored once, out of the Library", async () => {
    for (const s of STARTERS.filter((x) => x.seed.kind === "product")) {
      const { status, body } = await applyTemplate(s.id);
      expect(status, `${s.id} ${body.error ?? ""}`).toBe(201);
      expect(body.href, s.id).toMatch(s.surface === "ads" ? /^\/ads\/[^/?]+\?step=new$/ : s.surface === "click-to-ad" ? /^\/marketing\/click-to-ad\?product=/ : /^\/marketing\?template=[^&]+&product=/);
    }
    // Two brands, one product each, whichever surface made them; the photo is the published sample's bytes.
    const brands = brand.listBrands();
    expect(brands.map((b) => b.name).sort()).toEqual(["Maison Verre", "Studio Marlow"]);
    for (const b of brands) {
      const products = brand.listProducts(b.id);
      expect(products, b.name).toHaveLength(1);
      const kit = STARTERS.map((x) => (x.seed.kind === "product" ? x.seed.kit : null)).find((k) => k?.brand.name === b.name)!;
      expect(products[0]).toMatchObject({ name: kit.product.name, price: kit.product.price, currency: kit.product.currency });
      const stored = fs.readFileSync(absolutePath(filesRel(products[0].images[0])!));
      expect(stored.equals(fs.readFileSync(sampleFile(kit.product.image.src)!)), b.name).toBe(true);
      expect(b.colors).toEqual(kit.brand.colors);
      // The stored photo is a starter's file: the Library's lists don't show it.
      expect(listAssets({ limit: 1000 }).some((a) => a.url === products[0].images[0]), b.name).toBe(false);
    }
    // A product whose photo was taken off gets it back on the next Use template: still one product, not a second.
    const marlow = brands.find((b) => b.name === "Studio Marlow")!;
    const bag = brand.listProducts(marlow.id)[0];
    brand.updateProduct(bag.id, { images: [] });
    const again = await applyTemplate("mk.bag-packshot");
    expect(again.status).toBe(201);
    expect(again.body.href).toContain(`product=${bag.id}`);
    expect(brand.listProducts(marlow.id)).toHaveLength(1);
    expect(brand.listProducts(marlow.id)[0].images).toHaveLength(1);
  });

  it("Ads Studio: the ready brand makes its ads on the demo provider", async () => {
    for (const s of of("ads")) {
      const { body } = await applyTemplate(s.id);
      const brandId = new URL(body.href!, "http://x").pathname.split("/").pop()!;
      const product = brand.listProducts(brandId)[0];
      const { creatives, run } = ads.createBatch({ brandId, engine: "cloud", items: [{ productId: product.id, count: 2 }] });
      await run;
      const made = ads.listCreatives({ brandId }).filter((c) => creatives.some((x) => x.id === c.id));
      expect(made, s.id).toHaveLength(2);
      for (const c of made) {
        const g = await settled(c.generationId!);
        expect(g.status, `${s.id}: ${g.message ?? ""}`).toBe("succeeded");
      }
    }
  }, 180_000);

  it("Click to Ad: the ready product makes its 9:16 video ad on the demo provider", async () => {
    for (const s of of("click-to-ad")) {
      const { body } = await applyTemplate(s.id);
      const productId = new URL(body.href!, "http://x").searchParams.get("product")!;
      const { run, script } = await mk.runClickToAd({ engine: "cloud", productId, styleId: "clean-minimal" });
      expect(script.length, s.id).toBeGreaterThan(10);
      for (const id of run.finalIds) {
        const g = await settled(id, 180_000);
        expect(g.status, `${s.id}: ${g.message ?? ""}`).toBe("succeeded");
      }
    }
  }, 400_000);

  it("Marketing Studio: the ready shoot runs its template on its product", async () => {
    for (const s of of("marketing")) {
      const { body } = await applyTemplate(s.id);
      const q = new URL(body.href!, "http://x").searchParams;
      const template = TEMPLATE_INDEX.get(q.get("template")!)!;
      const product = brand.getProduct(q.get("product")!)!;
      const { runs } = await mk.runMarketing({ engine: "cloud", format: template.format, templateId: template.id, productId: product.id, brandId: product.brandId ?? undefined });
      for (const r of runs)
        for (const id of r.finalIds) {
          const g = await settled(id);
          expect(g.status, `${s.id}: ${g.message ?? ""}`).toBe("succeeded");
        }
      expect(getStarter(s.id)).toBeTruthy();
    }
  }, 180_000);
});
