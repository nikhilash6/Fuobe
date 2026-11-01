/**
 * What the Shorts Studio and Mixed Media restyle models can take, read from their routes (field
 * maps), and slim rows for the pages. Uses the full catalog, so it runs on the server (pages and
 * src/server/shorts.ts, src/server/mixed-media.ts); the browser gets the rows. A Fuobe Original runs on
 * both engines: each answer is for the engine asked about (its default engine when none is named).
 */
import { sourceSeconds } from "./clip-windows";
import { onEngine } from "./engines";
import { getModel } from "./index";
import { routesFor } from "./plan";
import { pricingOn } from "./promo";
import { SHORTS, SHORTS_ORIGINAL } from "./shorts";
import type { Engine, ModelDef } from "./types";

/** The model as it runs on `engine` (an Original keeps that engine's routes only). */
function view(modelId: string, engine?: Engine): ModelDef | undefined {
  const m = getModel(modelId);
  return m && engine ? onEngine(m, engine) : m;
}

/** How many reference images a restyle model takes on every route (0: it restyles from words only). */
export function maxRefsFor(modelId: string, engine?: Engine): number {
  const m = view(modelId, engine);
  if (!m) return 0;
  // The open chain and Fuobe Shorts (both engines) send them to the first frame's edit, as images 2 and 3.
  if (m.engine === "open" || modelId === SHORTS_ORIGINAL) return SHORTS.openReferences;
  const routes = routesFor(m, "v2v");
  if (!routes.length || !routes.every((r) => r.map?.images)) return 0;
  return Math.min(SHORTS.maxReferences, m.options.maxImages ?? 4);
}

/** Whether every v2v route of a cloud model reads an image (LTX: the first frame; Kling, Happy Horse: references). */
export function takesImage(modelId: string, engine?: Engine): boolean {
  const m = view(modelId, engine);
  if (!m || m.engine !== "cloud") return false;
  const routes = routesFor(m, "v2v");
  return routes.length > 0 && routes.every((r) => r.map?.image || r.map?.images);
}

/** Whether every v2v route can be asked for an aspect ratio (else the output keeps the clip's shape). */
export function reframes(modelId: string, engine?: Engine): boolean {
  const m = view(modelId, engine);
  if (!m) return false;
  if (m.engine === "open") return true;
  const routes = routesFor(m, "v2v");
  return routes.length > 0 && routes.every((r) => r.map?.aspectRatio);
}

/** How long a clip each restyle model takes (./clip-windows): a cut outside it is paid for and then refused by the provider. */
export { sourceSeconds };

/** The cloud model's 720p setting, when it has one (Higgsfield renders Shorts at 720p). */
export function resolutionFor(modelId: string, engine?: Engine): string | undefined {
  const m = view(modelId, engine);
  return m?.engine === "cloud" && m.options.resolutions?.includes("720p") ? "720p" : undefined;
}

export interface RestyleModelInfo {
  id: string;
  name: string;
  vendor: string;
  tagline: string;
  engine: Engine;
  /** Reference images it takes (0: words only). */
  refs: number;
  /** Takes a still (first frame or style reference). */
  image: boolean;
  /** Can be asked for 9:16 / 16:9. */
  reframes: boolean;
  price: string | null;
  resolutions?: string[];
  /** Shortest and longest clip it takes, in seconds. */
  minSeconds?: number;
  maxSeconds?: number;
}

/**
 * What one unit costs at the resolution the studios ask for. Fuobe Shorts in the cloud bills frames ÷ 16 as seconds:
 * a second of a 30 fps clip, the common case, is shown. Read for the studio pages, prerendered at build time, so the
 * clock isn't (`now` null by default): a launch-priced model's unit price is unknown there (./promo).
 */
export function unitPrice(m: ModelDef, now: number | null = null): number | null {
  const p = m.pricing && pricingOn(m.pricing, now);
  if (!p) return null;
  const res = resolutionFor(m.id, m.engine) ?? m.defaults?.resolution;
  const usd = (res && p.byResolution?.[res]) || p.usd;
  if (m.id === SHORTS_ORIGINAL && p.unit === "second") return (usd * SHORTS.original.maxFps) / SHORTS.original.billFps;
  return usd;
}

const UNIT: Record<string, string> = { second: "s", megapixel: "MP" };

function priceLine(m: ModelDef): string | null {
  if (m.engine === "open") return "Free · your GPU";
  const p = m.pricing;
  const v = unitPrice(m);
  if (!p || v === null) return null;
  const usd = v < 0.1 ? v.toFixed(3).replace(/0$/, "") : v.toFixed(2);
  return `$${usd} / ${UNIT[p.unit] ?? p.unit}${m.id === SHORTS_ORIGINAL ? " at 30 fps" : ""}`;
}

/** Slim model rows for a studio page (so the browser needs no catalog), as each runs on `engine`. */
export function modelInfos(ids: string[], engine?: Engine): RestyleModelInfo[] {
  return ids.flatMap((id) => {
    const found = getModel(id);
    if (!found) return [];
    const m = engine ? onEngine(found, engine) : found;
    return [
      {
        id,
        name: m.name,
        vendor: m.vendor,
        tagline: m.tagline,
        engine: m.engine,
        refs: maxRefsFor(id, m.engine),
        image: takesImage(id, m.engine),
        reframes: reframes(id, m.engine),
        price: priceLine(m),
        ...(m.options.resolutions ? { resolutions: m.options.resolutions } : {}),
        ...(sourceSeconds(id).min ? { minSeconds: sourceSeconds(id).min } : {}),
        ...(sourceSeconds(id).max ? { maxSeconds: sourceSeconds(id).max } : {}),
      },
    ];
  });
}
