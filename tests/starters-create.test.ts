import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EpisodeSettings, EpisodeView } from "@/lib/catalog/faceless";

// Every ready-made starter of Faceless Studio, Content Factory, Explainer, Ads Studio, Click to Ad and Marketing Studio,
// made as the owner's "Use template" makes it, on a fresh data dir, then run on the demo provider to the end: the
// channel's first episode, the series, the explainer, the ads, the video ad and the product shot.

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
  after: (task: unknown) => void Promise.resolve(typeof task === "function" ? (task as () => unknown)() : task).catch(() => {}),
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-starters-"));
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
const explainerRoute = await import("@/app/api/explainer/route");
const { STARTERS, facelessTopic, getStarter } = await import("@/lib/starters/catalog");
const { getPreset } = await import("@/lib/catalog/content-factory");
const { defaultSettings, genreInfo } = await import("@/lib/catalog/faceless");
const { TEMPLATE_INDEX } = await import("@/lib/catalog/marketing");

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const use = async (id: string, engine: "cloud" | "open" = "cloud") => {
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
    expect((await use("faceless.nope")).status).toBe(404);
    const fill = await use("cf.underwater-fashion-week");
    expect(fill.status).toBe(400);
    expect(fill.body.error).toMatch(/opens in its studio/);
  });

  it("Faceless: makes the channel with its name and look, opens its first episode's setup, and the episode renders", async () => {
    const runs = of("faceless").map(async (s) => {
      const seed = s.seed.kind === "faceless" ? s.seed : null;
      if (!seed) throw new Error(s.id);
      const { status, body } = await use(s.id);
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
      const { status, body } = await use(s.id);
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
    const again = await use("mk.bag-packshot");
    expect(again.status).toBe(201);
    expect(again.body.href).toContain(`product=${bag.id}`);
    expect(brand.listProducts(marlow.id)).toHaveLength(1);
    expect(brand.listProducts(marlow.id)[0].images).toHaveLength(1);
  });

  it("Ads Studio: the ready brand makes its ads on the demo provider", async () => {
    for (const s of of("ads")) {
      const { body } = await use(s.id);
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
      const { body } = await use(s.id);
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
      const { body } = await use(s.id);
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
