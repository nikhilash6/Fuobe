import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GenerationRequest, ModelDef } from "@/lib/catalog/types";
import type { StudioConfig } from "@/components/studio/studio-context";

/**
 * Launch prices (Pricing.promo): H3 Max camera controls at $0.052/s (768P) through 2026-10-31, then $0.08/s; FLUX 3 Max
 * at $0.0425/s (720p) through 2026-11-07, then $0.17/s. The catalog keeps both prices. The server prices a run on the
 * day it runs, even when it started before a launch price ended; the browser shows the price of the day it is looked at;
 * nothing a page prerenders at build time reads the clock (Next.js stops the build on Date.now() while prerendering).
 */

// The server starts on 2026-10-30, the day before H3 Max's launch price ends, and loads the catalog then.
vi.useFakeTimers({ now: Date.parse("2026-10-30T10:00:00Z"), toFake: ["Date"] });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-launch-prices-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { previewGeneration } = await import("@/server/generations");
const { APPS, getModel, MODELS } = await import("@/lib/catalog");
const { estimateCost } = await import("@/lib/catalog/plan");
const { launchHolds, pricingOn } = await import("@/lib/catalog/promo");
const { slimModel, studioCatalog } = await import("@/lib/studio-catalog");
const studios = await import("@/lib/studios");
const { pickerPrice, rowPrice, toModelRow } = await import("@/lib/model-rows");
const { toModelInfo } = await import("@/lib/model-list");
const { startQuotes, starterPriceLine } = await import("@/lib/starter-prices");
const { modelInfos } = await import("@/lib/catalog/shorts-models");
const { SHORTS_MODELS } = await import("@/lib/catalog/shorts");
const { startOfDayUtc, useToday } = await import("@/hooks/use-today");

const H3 = "minimax-h3-max-camera";
const FLUX = "flux-3-max";
const at = (iso: string) => vi.setSystemTime(Date.parse(iso));
/** The day the browser's useToday gives at that moment. */
const day = (iso: string) => startOfDayUtc(Date.parse(iso));

/** Calls to Date.now() while `fn` runs (the fake clock's Date is the global one, so it is the one spied on). */
function clockReads(fn: () => void): number {
  const spy = vi.spyOn(Date, "now");
  try {
    fn();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
  // A fal key: runs are real (priced), not demo (free).
  setSetting("falKey", "fal_test_key_123456");
});
afterEach(() => at("2026-10-30T10:00:00Z"));
afterAll(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the catalog keeps both prices", () => {
  it("H3 Max camera controls and FLUX 3 Max carry the list price and the launch price, as plain data", () => {
    const h3 = getModel(H3)!.pricing!;
    expect(h3).toMatchObject({ unit: "second", usd: 0.08, byResolution: { "768P": 0.08 }, promo: { until: "2026-10-31", usd: 0.052, byResolution: { "768P": 0.052 } } });
    expect(Object.getOwnPropertyDescriptor(getModel(H3)!, "pricing")).toMatchObject({ writable: true });
    expect(getModel(FLUX)!.pricing).toMatchObject({ usd: 0.17, promo: { until: "2026-11-07", usd: 0.0425 } });
    expect(launchHolds("2026-10-31", Date.parse("2026-10-31T23:59:59.999Z"))).toBe(true);
    expect(launchHolds("2026-10-31", Date.parse("2026-11-01T00:00:00Z"))).toBe(false);
  });
});

describe("the server prices a run on the day it runs", () => {
  it("H3 Max camera controls (Cinema's fly path): the launch rate today and through 2026-10-31 (UTC), the list rate from November", () => {
    const m = getModel(H3)!;
    const cost = () => estimateCost(m, { duration: 5, resolution: "768P" }, 1, "camera-path");
    expect(cost()).toBe(0.26);
    at("2026-10-31T23:59:59Z");
    expect(cost()).toBe(0.26);
    // Same process, same catalog: the run after midnight is priced at the list rate.
    at("2026-11-01T00:00:00Z");
    expect(cost()).toBe(0.4);
  });

  it("FLUX 3 Max through previewGeneration (the price POST /api/generations quotes and records): $0.0425/s through 2026-11-07, $0.17/s after", () => {
    const req: GenerationRequest = { feature: "video", modelId: FLUX, engine: "cloud", prompt: "a paper boat drifts across a pond", params: { duration: 10, resolution: "720p" } };
    const quote = () => {
      const p = previewGeneration(req);
      expect(p.demo).toBe(false);
      return p.costUsd;
    };
    expect(quote()).toBe(0.425);
    at("2026-11-07T23:59:00Z");
    expect(quote()).toBe(0.425);
    at("2026-11-08T00:00:01Z");
    expect(quote()).toBe(1.7);
  });
});

describe("the browser shows the price of the day it is", () => {
  it("a studio's slice keeps both prices, for the composer to pick from", () => {
    const flux = studioCatalog(studios.VIDEO_STUDIO).models.find((m) => m.id === FLUX)!;
    expect(flux.pricing).toEqual(getModel(FLUX)!.pricing);
    // What the page passes to the browser (an RSC prop) is data: a JSON round trip keeps the launch price.
    expect(JSON.parse(JSON.stringify(flux)).pricing.promo).toEqual(getModel(FLUX)!.pricing!.promo);
  });

  it("the composer's price: the launch rate through the last day, the list rate after, none while the page prerenders", () => {
    const flux = slimModel(getModel(FLUX)!);
    const price = (today: number | null) => estimateCost(flux, { duration: 10, resolution: "1080p" }, 1, "t2v", false, today);
    expect(price(day("2026-10-30T10:00:00Z"))).toBe(0.725);
    expect(price(day("2026-11-07T23:59:59Z"))).toBe(0.725);
    expect(price(day("2026-11-08T00:00:00Z"))).toBe(2.9);
    // While the page prerenders or hydrates (useToday's null) no clock is read and the launch-priced model shows no price.
    let unknown: number | null = 0;
    expect(clockReads(() => (unknown = price(null)))).toBe(0);
    expect(unknown).toBeNull();
    // A model without a launch price is priced as ever, without the clock.
    const plain = slimModel(getModel(studios.VIDEO_STUDIO.defaultModels.cloud)!);
    let usd: number | null = null;
    expect(clockReads(() => (usd = estimateCost(plain, { ...plain.defaults }, 1, undefined, false, null)))).toBe(0);
    expect(usd).toBe(estimateCost(plain, { ...plain.defaults }));
    expect(usd).toBeGreaterThan(0);
  });

  it("the fly path's price in the browser: H3 Max at $0.052/s on 2026-10-31, $0.08/s on 2026-11-01", () => {
    const h3 = slimModel(getModel(H3)!);
    expect(estimateCost(h3, { duration: 5, resolution: "1080P" }, 1, "camera-path", false, day("2026-10-31T12:00:00Z"))).toBe(0.52);
    expect(estimateCost(h3, { duration: 5, resolution: "1080P" }, 1, "camera-path", false, day("2026-11-01T12:00:00Z"))).toBe(0.8);
  });

  it("the model picker's price", () => {
    const flux = slimModel(getModel(FLUX)!);
    expect(pickerPrice(flux, day("2026-11-07T08:00:00Z"))).toBe("$0.043/sec");
    expect(pickerPrice(flux, day("2026-11-08T08:00:00Z"))).toBe("$0.17/sec");
    expect(pickerPrice(flux, null)).toBe("");
    expect(pickerPrice(slimModel(getModel(H3)!), day("2026-10-30T08:00:00Z"))).toBe("$0.052/sec");
    expect(pickerPrice(slimModel(getModel(H3)!), day("2026-11-01T08:00:00Z"))).toBe("$0.08/sec");
  });

  it("the Models page: each row carries the launch price, and the browser picks it or the list price by the day", () => {
    const row = toModelRow(getModel(FLUX)!);
    expect(row).toMatchObject({ price: "$0.17 / second", launch: { until: "2026-11-07", price: "$0.043 / second" } });
    expect(rowPrice(row, day("2026-11-07T22:00:00Z"))).toBe("$0.043 / second");
    expect(rowPrice(row, day("2026-11-08T00:00:00Z"))).toBe("$0.17 / second");
    expect(rowPrice(row, null)).toBe("");
    const plain = toModelRow(getModel(studios.VIDEO_STUDIO.defaultModels.cloud)!);
    expect(plain.launch).toBeUndefined();
    expect(rowPrice(plain, null)).toBe(plain.price);
    // GET /api/models (a request, so it may read the clock) says the price of the day asked.
    const info = toModelInfo(getModel(H3)!);
    expect(rowPrice(info, Date.parse("2026-10-30T10:00:00Z"))).toBe("$0.052 / second");
    expect(rowPrice(info, Date.parse("2026-11-01T00:00:00Z"))).toBe("$0.08 / second");
  });

  it("useToday: no clock and no day while a page renders on the server (prerender, SSR); the day once the browser hydrates", () => {
    const Probe = () => String(useToday());
    let html = "";
    expect(clockReads(() => (html = renderToString(createElement(Probe))))).toBe(0);
    expect(html).toBe("null");
    expect(startOfDayUtc(Date.parse("2026-10-31T23:59:59.999Z"))).toBe(Date.parse("2026-10-31T00:00:00Z"));
    // The day's midnight is inside the launch's last day: the launch price holds all of it.
    expect(pricingOn(getModel(H3)!.pricing!, day("2026-10-31T23:59:59Z"))!.usd).toBe(0.052);
    expect(pricingOn(getModel(H3)!.pricing!, day("2026-11-01T00:00:00Z"))!.usd).toBe(0.08);
  });
});

describe("what pages prerender at build time reads no clock", () => {
  it("every studio's slice (the studio pages, /apps/[id], the Audio, Upscale and Video tools hubs)", () => {
    const configs = [
      ...Object.values(studios).filter((v): v is StudioConfig => typeof v === "object" && v !== null && "defaultModels" in v && "kind" in v),
      ...APPS.map((a) => studios.appStudio(a)),
    ];
    expect(configs.length).toBeGreaterThan(APPS.length + 20);
    let slices: ReturnType<typeof studioCatalog>[] = [];
    expect(clockReads(() => (slices = configs.map((c) => studioCatalog(c))))).toBe(0);
    // The launch-priced models are in them (FLUX 3 Max is in the video studios' pickers).
    expect(slices.some((s) => s.models.some((m: ModelDef) => m.id === FLUX && m.pricing?.promo))).toBe(true);
  });

  it("the Models page rows, Home's and Settings' first-run quotes, and the Shorts and Mixed Media model rows", () => {
    expect(
      clockReads(() => {
        MODELS.map(toModelRow);
        starterPriceLine();
        startQuotes();
        modelInfos(SHORTS_MODELS.cloud, "cloud");
        modelInfos(SHORTS_MODELS.open, "open");
      }),
    ).toBe(0);
  });
});
