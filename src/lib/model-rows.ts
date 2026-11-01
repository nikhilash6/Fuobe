/** Slim rows for the Models page: what the table shows, computed on the server from the catalog. */
import { formatCost } from "./format";
import { enginesOf, providerEngine } from "./catalog/engines";
import { launchHolds, pricingOn, type PriceClock } from "./catalog/promo";
import { OPERATION_LABELS, type Engine, type MediaKind, type ModelDef } from "./catalog/types";

export interface ModelRow {
  id: string;
  name: string;
  vendor: string;
  tagline: string;
  /** The engine it shows first (a Fuobe Original's is open: it's free there). */
  engine: Engine;
  /** Every engine it runs on: a Fuobe Original runs on both (ComfyUI on your GPU, hosted open weights in the cloud). */
  engines: Engine[];
  kind: MediaKind;
  /** Display badges ("New", "Top"…), without the redundant "open". */
  badges: string[];
  /** What it can do, as labels ("Text to image", "Edit"…). */
  ops: string[];
  /** Provider routes ("fal: fal-ai/flux/dev"), shown in the row's details popover. */
  routes: string[];
  /** The list price ("$0.17 / second", "Free · …" for a Fuobe Original, "Free"). */
  price: string;
  /**
   * A launch price and its last day (UTC): the price through the end of that day, `price` after (rowPrice). The row
   * carries both, so the Models page, prerendered at build time, shows the one of the day it is looked at.
   */
  launch?: { until: string; price: string };
  /** Where it runs when that's not the obvious place ("Runs on the isolated ComfyUI worker"). */
  note?: string;
  /** Where it opens: a studio, app or tool with ?model= (the Models page adds it, from palette-index's modelHref). */
  href?: string;
}

/** The picker's and the Models page's note on models that run on the isolated ComfyUI worker. */
export const ISOLATED_NOTE = "Runs on the isolated ComfyUI worker";

const BADGE_LABEL: Record<string, string> = {
  new: "New",
  top: "Top",
  fast: "Fast",
  audio: "Audio",
  "4k": "4K",
  hd: "1080p",
  pro: "Pro",
  uncensored: "Uncensored",
  beta: "Beta",
};

export function toModelRow(m: ModelDef): ModelRow {
  // A Fuobe Original's view on one engine (onEngine) keeps only that engine's routes: it lists that engine alone.
  const engines = enginesOf(m).filter((e) => e === m.engine || m.routes.some((r) => providerEngine(r.provider) === e));
  // A Fuobe Original is free on your GPU and priced on the cloud.
  const shown = (cloud: string) => (engines.length > 1 ? `Free · ${cloud}` : m.engine === "open" ? "Free" : cloud);
  const p = m.pricing;
  return {
    id: m.id,
    name: m.name,
    vendor: m.vendor,
    tagline: m.tagline,
    engine: m.engine,
    engines,
    kind: m.kind,
    badges: (m.badges ?? []).filter((b) => b !== "open").map((b) => BADGE_LABEL[b] ?? b),
    ops: [...new Set(m.routes.map((r) => OPERATION_LABELS[r.op] ?? r.op))],
    routes: [...new Set(m.routes.map((r) => `${r.provider}: ${r.endpoint}`))],
    price: shown(p ? `${formatCost(p.usd)} / ${p.unit}` : "—"),
    // A launch price on the cloud (FLUX 3 Max): the browser picks it or the list price by the day (rowPrice).
    ...(p?.promo && engines.includes("cloud") && { launch: { until: p.promo.until, price: shown(`${formatCost(p.promo.usd)} / ${p.unit}`) } }),
    ...(m.worker === "isolated" && { note: ISOLATED_NOTE }),
  };
}

/**
 * The price a row shows at `now`: its launch price through the end of the launch's last day (UTC), then the list price.
 * Nothing for a row with a launch price while `now` is null (the page prerendering or hydrating: the day isn't known).
 */
export function rowPrice(r: Pick<ModelRow, "price" | "launch">, now: number | null): string {
  if (!r.launch) return r.price;
  if (now === null) return "";
  return launchHolds(r.launch.until, now) ? r.launch.price : r.price;
}

/**
 * The price a row shows when the install runs one engine only (`only`): a Fuobe Original is "Free" on the open engine,
 * and only its cloud price ("Free · $0.08 / second" without "Free · ") on the cloud. Otherwise rowPrice.
 */
export function rowPriceOn(r: Pick<ModelRow, "price" | "launch" | "engines">, now: number | null, only?: Engine): string {
  if (only === "open" && r.engines.includes("open")) return "Free";
  const price = rowPrice(r, now);
  return only === "cloud" && r.engines.length > 1 ? price.replace(/^Free · /, "") : price;
}

const PICKER_UNIT = { image: "/image", second: "/sec", video: "/video", request: "/run", megapixel: "/MP", minute: "/min" } as const;

/**
 * The model picker's short price ("$0.05/sec", "Free"), at `now` (./catalog/promo): the launch price while it holds,
 * nothing for a launch-priced model while no clock may be read (null).
 */
export function pickerPrice(m: ModelDef, now: PriceClock): string {
  if (m.engine === "open") return "Free";
  const p = m.pricing && pricingOn(m.pricing, now);
  return p ? `${formatCost(p.usd)}${PICKER_UNIT[p.unit]}` : "";
}

/** "Open source", "Cloud", or both for a Fuobe Original. */
export const enginesLabel = (engines: Engine[]): string =>
  engines.length > 1 ? "Open source + cloud" : engines[0] === "open" ? "Open source" : "Cloud";

/** Lower-cased text the Models search matches against. */
export const modelSearchText = (r: ModelRow) => `${r.name} ${r.vendor} ${r.tagline} ${r.ops.join(" ")} ${r.id} ${r.note ?? ""}`.toLowerCase();
