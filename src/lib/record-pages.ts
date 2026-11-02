/**
 * Pages whose URL names a stored record (/cinema/<id>, /faceless/<channel>/<episode>…), so an
 * unknown id can get a real 404. The page's own notFound() can't send one: the studio's loading
 * skeleton (and with Cache Components, the prerendered shell) has already streamed with a 200 by
 * the time the page looks the id up. The proxy checks first (src/proxy.ts → recordExists in
 * src/server/records.ts) and rewrites unknown ids to the not-found page with a 404.
 * Pure, so the route table is tested without a server.
 */
import { HUB_MODES, type HubKind } from "./hubs";
import { STARTER_IDS } from "./starters/ids";
import type { StarterSurface } from "./starters/types";

export type RecordKind = "cinema" | "canvas" | "assist-project" | "layers" | "shorts" | "brand" | "element" | "channel" | "episode" | "explainer" | "series" | "swap-project";

/** A record a page needs, with its ids in the order the lookup takes them. */
export interface RecordRef {
  kind: RecordKind;
  ids: string[];
}

const SEG = "([^/]+)";

/** Path patterns → the record they name. Fixed sub-pages (/faceless/<id>/new) come before the catch-alls. */
const PAGES: [RegExp, (m: string[]) => RecordRef][] = [
  [new RegExp(`^/cinema/${SEG}$`), ([id]) => ({ kind: "cinema", ids: [id] })],
  [new RegExp(`^/canvas/${SEG}$`), ([id]) => ({ kind: "canvas", ids: [id] })],
  [new RegExp(`^/assist/projects/${SEG}$`), ([id]) => ({ kind: "assist-project", ids: [id] })],
  [new RegExp(`^/layers/${SEG}$`), ([id]) => ({ kind: "layers", ids: [id] })],
  [new RegExp(`^/shorts/${SEG}$`), ([id]) => ({ kind: "shorts", ids: [id] })],
  [new RegExp(`^/ads/${SEG}$`), ([id]) => ({ kind: "brand", ids: [id] })],
  [new RegExp(`^/elements/${SEG}$`), ([id]) => ({ kind: "element", ids: [id] })],
  [new RegExp(`^/faceless/${SEG}/new$`), ([id]) => ({ kind: "channel", ids: [id] })],
  [new RegExp(`^/faceless/${SEG}/${SEG}$`), ([id, episode]) => ({ kind: "episode", ids: [id, episode] })],
  [new RegExp(`^/faceless/${SEG}$`), ([id]) => ({ kind: "channel", ids: [id] })],
  [new RegExp(`^/explainer/${SEG}$`), ([id]) => ({ kind: "explainer", ids: [id] })],
  [new RegExp(`^/content-factory/${SEG}$`), ([id]) => ({ kind: "series", ids: [id] })],
  [new RegExp(`^/character-swap/${SEG}$`), ([id]) => ({ kind: "swap-project", ids: [id] })],
];

/** Static pages that a record pattern would also match (/ads/multiplier is not a brand). */
const FIXED = new Set(["/ads/multiplier"]);

/** A ready-made starter's page (/faceless/start/<id>…): catalog data, not a stored record. */
const STARTER_PAGE = /^\/(faceless|content-factory|explainer|ads|marketing|marketing\/click-to-ad)\/start\/([^/]+)$/;
const STARTER_BASE: Record<string, StarterSurface> = { faceless: "faceless", "content-factory": "content-factory", explainer: "explainer", ads: "ads", marketing: "marketing", "marketing/click-to-ad": "click-to-ad" };

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The record a page path names (null for every other page). A trailing slash is ignored. */
export function recordForPath(pathname: string): RecordRef | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (FIXED.has(path) || STARTER_PAGE.test(path)) return null;
  for (const [re, ref] of PAGES) {
    const m = re.exec(path);
    if (m) return ref(m.slice(1).map(decode));
  }
  return null;
}

/** A starter page (/faceless/start/<id>…) whose id isn't one of that studio's starters. A trailing slash is ignored. */
export function unknownStarterPage(pathname: string): boolean {
  const m = STARTER_PAGE.exec(pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname);
  return !!m && !STARTER_IDS[STARTER_BASE[m[1]]].includes(decode(m[2]));
}

/** /audio/<mode>, /video-tools/<mode> and /upscale/<mode> with a mode the hub doesn't have. */
export function unknownHubMode(pathname: string): boolean {
  const m = /^\/(audio|video-tools|upscale)\/([^/]+)\/?$/.exec(pathname);
  if (!m) return false;
  const mode = decode(m[2]);
  return !HUB_MODES[m[1] as HubKind].some((x) => x.id === mode);
}
