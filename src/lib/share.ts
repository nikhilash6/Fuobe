/**
 * Read-only share links and published pages (R4-28). Fuobe has one owner and no accounts, so
 * sharing is a link: an unguessable token that opens one public page (/s/<token>) and the files
 * that page shows (/s/<token>/f/<path>), nothing else. Pure: the proxy, the server
 * (src/server/share-access.ts, src/server/shares.ts) and the UI share these rules.
 */
import type { MediaKind } from "./catalog/types";

/** What a link shares: one result, a Library folder (with its subfolders), a Cinema project, or a published selection. */
export type ShareKind = "result" | "folder" | "cinema" | "publish";

/** How the page lays the pieces out: a plain grid, or one of the Publish wizard's layouts. */
export type ShareLayout = "grid" | "feature" | "series" | "carousel";

export const SHARE_KINDS: readonly ShareKind[] = ["result", "folder", "cinema", "publish"];

export const KIND_LABELS: Record<ShareKind, string> = {
  result: "Result",
  folder: "Folder",
  cinema: "Cinema project",
  publish: "Published page",
};

/** The Publish wizard's Assets step (the parity studio's Feature / Series / Carousel). */
export const PUBLISH_LAYOUTS: { id: Exclude<ShareLayout, "grid">; label: string; hint: string; cover: string }[] = [
  { id: "feature", label: "Feature", hint: "The first piece large on top, the rest under it.", cover: "Its piece goes large on top" },
  { id: "series", label: "Series", hint: "Numbered episodes, one after another, in your order.", cover: "It sits beside the title, above the episodes" },
  { id: "carousel", label: "Carousel", hint: "One piece at a time; viewers swipe or click through.", cover: "The carousel opens on it" },
];

export const SHARE_LAYOUTS: readonly ShareLayout[] = ["grid", "feature", "series", "carousel"];

/** A published page holds up to 100 picked results (a folder or project page shows its newest 200). */
export const MAX_PUBLISH_ITEMS = 100;

/** A link as the owner sees it (Library → Shared). The token itself is never stored, only its hash. */
export interface ShareInfo {
  /** The token's first characters: names the link in the owner's API, opens nothing on its own. */
  id: string;
  kind: ShareKind;
  /** The result, folder or Cinema project shared; null for a published selection. */
  targetId: string | null;
  title: string;
  description: string;
  tags: string[];
  layout: ShareLayout;
  /** A published selection's generation ids, in page order. */
  items: string[];
  /** The cover the Publish wizard picked (an item's output); null: the first piece. */
  cover: { generationId: string; index: number } | null;
  /** Prompts on the page ("With prompts"), with the Recreate button; off: results and model names only. */
  showPrompts: boolean;
  /** Stops working at (null: until revoked). */
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Page views by people other than the signed-in owner. */
  views: number;
  lastViewedAt: number | null;
}

/** The list's extras: how many pieces the page shows now, a thumbnail for the owner, and whether what it shares still exists. */
export interface ShareListItem extends ShareInfo {
  count: number;
  /** The cover as the owner's own file URL (/api/files/…), for the list. */
  thumb: { url: string; kind: MediaKind; poster?: string } | null;
  /** The result, folder or project was deleted: the link answers 404. */
  gone: boolean;
}

/** POST /api/shares: a new link. */
export interface ShareRequest {
  kind: ShareKind;
  /** The result, folder or Cinema project (not for a published selection). */
  targetId?: string | null;
  /** A published selection's results, in page order. */
  items?: string[];
  title?: string;
  description?: string;
  tags?: string[] | string;
  layout?: ShareLayout;
  cover?: { generationId: string; index: number } | null;
  showPrompts?: boolean;
  /** Days until the link stops working; null or left out: until revoked. */
  expiresInDays?: number | null;
}

/** PATCH /api/shares/[id]. */
export interface SharePatch {
  title?: string;
  description?: string;
  tags?: string[] | string;
  layout?: ShareLayout;
  showPrompts?: boolean;
  /** Days from now; null: never expires. */
  expiresInDays?: number | null;
  /** A new token: the old link stops working. */
  newLink?: true;
}

/** A link as created (or renewed): the token is in this answer only. */
export interface ShareCreated {
  share: ShareInfo;
  token: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Tokens and the public routes

/** A token is a 12-character id (looked up) and a 32-character secret (only its hash is kept), base64url. */
export const SHARE_ID_LENGTH = 12;
export const SHARE_TOKEN_LENGTH = 44;
const TOKEN = /^[A-Za-z0-9_-]{44}$/;

export const isShareToken = (s: string): boolean => TOKEN.test(s);

/** A stored file's path under the files folder ("outputs/2026-10-26/abc.png"): no dot segments, no encoding. */
const FILE_PATH = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const ROUTE = /^\/s\/([A-Za-z0-9_-]{44})(?:\/f\/(.+))?$/;

/**
 * The public routes a share opens, which the sign-in proxy lets through without a session: exactly
 * its page (/s/<token>) and a stored file under it (/s/<token>/f/<path>). Anything else is null.
 */
export function shareRoute(pathname: string): { token: string; file?: string } | null {
  const m = ROUTE.exec(pathname);
  if (!m) return null;
  if (m[2] === undefined) return { token: m[1] };
  return FILE_PATH.test(m[2]) && m[2].length <= 300 ? { token: m[1], file: m[2] } : null;
}

export const sharePath = (token: string) => `/s/${token}`;

/** Set by the sign-in proxy on a share page request that counts as a view (the page records it). */
export const SHARE_VIEW_HEADER = "x-fuobe-share-view";

/** Link checkers, unfurlers (Slack, iMessage, WhatsApp, Discord…), crawlers and scripts. */
const NOT_A_VISITOR =
  /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|facebot|embedly|iframely|whatsapp|telegram|skypeuripreview|slack|discord|linkedin|pinterest|vkshare|mastodon|bluesky|headless|curl\/|wget\/|python-|go-http|okhttp|axios|node-fetch|undici|httpclient|java\//i;

/**
 * Whether a request for a share page is someone looking at it: a GET from a browser opening the
 * page. Not a HEAD, a prefetch or prerender, a fetch from a script, or a link-preview bot (pasting
 * a link into a chat fetches it before anyone opens it).
 */
export function countsAsView(method: string, headers: { get(name: string): string | null }): boolean {
  if (method !== "GET") return false;
  const purpose = [headers.get("sec-purpose"), headers.get("purpose"), headers.get("x-purpose"), headers.get("x-moz")].join(" ");
  if (/prefetch|prerender|preview/i.test(purpose)) return false;
  if (headers.get("rsc") || headers.get("next-router-prefetch")) return false;
  const dest = headers.get("sec-fetch-dest");
  if (dest && dest !== "document") return false;
  const ua = headers.get("user-agent") ?? "";
  return !!ua && !NOT_A_VISITOR.test(ua);
}

/** A stored file's path from its URL (/api/files/<path>), or null for anything else (data: URIs, provider links). */
export function storedPath(url: string | undefined | null): string | null {
  if (!url || !url.startsWith("/api/files/")) return null;
  const rel = url.slice("/api/files/".length).split(/[?#]/)[0];
  return FILE_PATH.test(rel) ? rel : null;
}

/** The share-scoped URL of a stored file (/s/<token>/f/<path>), or null when it isn't one of Fuobe's files. */
export function shareFileUrl(token: string, url: string | undefined | null): string | null {
  const rel = storedPath(url);
  return rel ? `/s/${token}/f/${rel}` : null;
}

/** The files a result's output brings with it on a share page: the file, and its poster, thumbnail or preview. */
export function outputFiles(o: { url: string; meta?: Record<string, unknown> }): string[] {
  const out = [storedPath(o.url)];
  for (const k of ["poster", "thumbnail", "preview"]) {
    const v = o.meta?.[k];
    if (typeof v === "string") out.push(storedPath(v));
  }
  // A 3D result's preview: its stills and turntables (src/lib/preview3d.ts).
  const p = o.meta?.preview3d as { state?: unknown; poster?: Record<string, unknown>; clip?: Record<string, unknown>; webm?: Record<string, unknown> } | undefined;
  if (p?.state === "done") for (const set of [p.poster, p.clip, p.webm]) for (const v of Object.values(set ?? {})) if (typeof v === "string") out.push(storedPath(v));
  return out.filter((p): p is string => !!p);
}

// ---------------------------------------------------------------------------
// Expiry, tags, words

export const EXPIRY_CHOICES: { id: string; label: string; days: number | null }[] = [
  { id: "never", label: "Never", days: null },
  { id: "1d", label: "1 day", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
];

const DAY = 86_400_000;

export const MAX_EXPIRY_DAYS = 365;

export function expiryFrom(days: number | null | undefined, now = Date.now()): number | null {
  return days ? now + Math.min(days, MAX_EXPIRY_DAYS) * DAY : null;
}

export const isExpired = (s: Pick<ShareInfo, "expiresAt">, now = Date.now()) => s.expiresAt !== null && s.expiresAt <= now;

/** "Never expires", "Expires in 3 days", "Expires in 5 hours", "Expired 2 days ago". */
export function expiryLabel(expiresAt: number | null, now = Date.now()): string {
  if (expiresAt === null) return "Never expires";
  const left = expiresAt - now;
  const span = (ms: number) => {
    const days = Math.round(ms / DAY);
    if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
    const hours = Math.max(1, Math.round(ms / 3_600_000));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  };
  return left > 0 ? `Expires in ${span(left)}` : `Expired ${span(-left)} ago`;
}

export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24;

/** "#cinematic, Noir ,noir, portrait" → ["cinematic", "Noir", "portrait"]: trimmed, no #, unique (any case), at most 8. */
export function parseTags(input: string | string[]): string[] {
  const parts = Array.isArray(input) ? input : input.split(/[,\n]/);
  const out: string[] = [];
  for (const raw of parts) {
    const t = raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH).trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Where a Carousel opens: on the cover's slide (the first when there's none). */
export function coverSlide(items: { key: string }[], coverKey?: string | null): number {
  return Math.max(0, items.findIndex((i) => i.key === coverKey));
}

/** The picture a link preview (og:image) shows: the cover if it's a picture, else a clip's poster. */
export function previewImage(cover: PublicMedia | null): { url: string; width?: number; height?: number } | null {
  if (!cover) return null;
  if (cover.kind === "image") return { url: cover.url, ...(cover.width && { width: cover.width }), ...(cover.height && { height: cover.height }) };
  return cover.poster ? { url: cover.poster } : null;
}

/** Items in the order a layout shows them (Feature puts the cover's piece first). */
export function orderForLayout<T extends { key: string }>(items: T[], layout: ShareLayout, coverKey?: string | null): T[] {
  if (layout !== "feature" || !coverKey) return items;
  const at = items.findIndex((i) => i.key === coverKey);
  return at > 0 ? [items[at], ...items.slice(0, at), ...items.slice(at + 1)] : items;
}

/** Move item `from` to `to` (the wizard's reorder buttons). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

// ---------------------------------------------------------------------------
// The public page's data (built on the server, rendered by src/app/s/[token])

export interface PublicMedia {
  /** Share-scoped (/s/<token>/f/…). */
  url: string;
  kind: MediaKind;
  contentType?: string;
  width?: number;
  height?: number;
  poster?: string;
  /** A 3D model's turntable (one turn that loops) and its stills, on the light and the dark studio; poster is the light still. */
  turntable?: { light: string; dark: string; posterDark: string };
  /** A text output's words, inline. */
  text?: string;
  /** A file name for Download. */
  download: string;
}

export interface PublicItem {
  /** Position-based key (generation ids stay private). */
  key: string;
  title: string;
  model: string;
  kind: MediaKind;
  /** Only when the owner shares prompts. */
  prompt?: string;
  aspectRatio?: string | null;
  media: PublicMedia[];
  createdAt: number;
}

export interface PublicShare {
  kind: ShareKind;
  title: string;
  description: string;
  tags: string[];
  layout: ShareLayout;
  showPrompts: boolean;
  cover: PublicMedia | null;
  /** Key of the cover's item (Feature shows it first). */
  coverKey: string | null;
  items: PublicItem[];
  /** More pieces exist than the page shows (a folder or project over the limit). */
  truncated: boolean;
  updatedAt: number;
}

/** "a-neon-alley-at-night-2.png": a download name from a title, never empty. */
export function fileName(title: string, index: number, ext: string): string {
  const base = title.slice(0, 40).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "fuobe";
  return `${base}${index ? `-${index + 1}` : ""}.${ext || "bin"}`;
}

/** "12 pieces", "1 piece". */
export const pieces = (n: number) => `${n} piece${n === 1 ? "" : "s"}`;
