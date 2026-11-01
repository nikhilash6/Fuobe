import "server-only";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  BRAND_LANGUAGES,
  emptyKit,
  isHex,
  MAX_PRODUCT_IMAGES,
  MAX_SELLING_POINTS,
  RESEARCH_LABELS,
  type BrandKit,
  type BrandKitFields,
  type BrandProgress,
  type BrandSocial,
  type BrandStatus,
  type Product,
} from "@/lib/catalog/marketing";
import { db } from "./db";
import { llmText } from "./enhance";
import { fetchRemote } from "./remote-fetch";
import { saveFile } from "./storage";
import { normalizeWebsite } from "@/lib/website";

/**
 * Brand kits and products, shared by Marketing Studio, Ads Studio and Click to Ad.
 *
 * Brand research: the site's HTML through the SSRF-safe fetch (remote-fetch.ts), then plain code
 * reads what's machine-readable (OpenGraph, JSON-LD Organization/Product, Shopify /products.json,
 * CSS colour variables, font families, logo, hero images) and an LLM (llmText: Claude, else a local model)
 * writes the soft fields (tagline, overview, tone, values, audience…). With no LLM, rule-based
 * heuristics fill them, so a kit always comes back. Progress uses Higgsfield's 14 labels.
 */

// ---------------------------------------------------------------------------
// HTML helpers (regex-based: no DOM on the server, and pages are untrusted input)

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*|#39);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Attributes of one start tag (`<a href="x" class='y' hidden>` → {href, class, hidden}). */
export function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = tag.replace(/^<[\w:-]+/, "").replace(/\/?>$/, "");
  for (const m of body.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

function tags(html: string, name: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => attrs(m[0]));
}

const strip = (html: string) =>
  decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

const clean = (s: string | undefined | null, max = 400) => (s ? decodeEntities(s).replace(/\s+/g, " ").trim().slice(0, max) : "");

function resolve(href: string | undefined, base: string): string | null {
  if (!href || href.startsWith("data:") || href.startsWith("javascript:") || href.startsWith("#")) return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function meta(html: string, ...keys: string[]): string {
  const all = tags(html, "meta");
  for (const k of keys) {
    const hit = all.find((a) => (a.property ?? a.name ?? a.itemprop ?? "").toLowerCase() === k.toLowerCase() && a.content);
    if (hit) return clean(hit.content, 1000);
  }
  return "";
}

function metaAll(html: string, key: string): string[] {
  return tags(html, "meta")
    .filter((a) => (a.property ?? a.name ?? "").toLowerCase() === key && a.content)
    .map((a) => a.content.trim());
}

// ---------------------------------------------------------------------------
// JSON-LD

type Json = Record<string, unknown>;

export function jsonLd(html: string): Json[] {
  const out: Json[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Json;
      out.push(o);
      if (Array.isArray(o["@graph"])) walk(o["@graph"]);
      if (o.itemListElement) walk(o.itemListElement);
      if (o.item && typeof o.item === "object") walk(o.item);
    }
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      // Malformed blocks are common; skip them.
    }
  }
  return out;
}

const typeOf = (o: Json): string[] => (Array.isArray(o["@type"]) ? (o["@type"] as string[]) : [String(o["@type"] ?? "")]).map((t) => t.toLowerCase());
const str = (v: unknown): string => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as Json).name === "string" ? ((v as Json).name as string) : "");

function urlsOf(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(urlsOf);
  if (typeof v === "object") {
    const o = v as Json;
    return urlsOf(o.url ?? o.contentUrl ?? o["@id"]);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Colours

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const toHex = ({ r, g, b }: Rgb) => `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

/** A CSS colour literal as #rrggbb (null for transparent/unknown/very translucent). */
export function normalizeColor(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length === 8 && parseInt(h.slice(6, 8), 16) < 128) return null;
    return h.length >= 6 ? `#${h.slice(0, 6)}` : null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const alpha = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
    if (alpha < 0.5) return null;
    return toHex({ r: +m[1], g: +m[2], b: +m[3] });
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const alpha = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
    if (alpha < 0.5) return null;
    return toHex(hslToRgb(+m[1], +m[2] / 100, +m[3] / 100));
  }
  return null;
}

/** Hue-agnostic facts about a colour: lightness and saturation in 0–1. */
export function colorStats(hex: string): { l: number; s: number } {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return { l, s };
}

const distance = (a: string, b: string) => {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return Math.sqrt(2 * (x.r - y.r) ** 2 + 4 * (x.g - y.g) ** 2 + 3 * (x.b - y.b) ** 2);
};

const BRANDY = /primary|brand|accent|main|secondary|highlight|button|btn|cta|link|theme/;
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

/**
 * The brand palette from CSS and the theme colour: named custom properties (--brand, --primary…)
 * count most, then how often a colour is used. Returns up to `max` distinct colours, the main
 * (most brand-like chromatic) one first, plus a dark and a light neutral when the site uses them.
 */
export function extractColors(css: string[], themeColor?: string | null, max = 6): string[] {
  const score = new Map<string, number>();
  const add = (hex: string | null, n: number) => hex && score.set(hex, (score.get(hex) ?? 0) + n);
  if (themeColor) add(normalizeColor(themeColor), 12);
  for (const sheet of css) {
    for (const m of sheet.matchAll(/--([\w-]+)\s*:\s*([^;}{]+)/g)) {
      const name = m[1].toLowerCase();
      if (/shadow|overlay|backdrop|scrim|border|disabled|muted|placeholder/.test(name)) continue;
      for (const c of m[2].match(COLOR_LITERAL) ?? []) add(normalizeColor(c), BRANDY.test(name) ? 6 : 1.5);
    }
    for (const m of sheet.matchAll(/(?:^|[;{\s])(color|background(?:-color)?|fill|border-color)\s*:\s*([^;}{]+)/g)) {
      for (const c of m[2].match(COLOR_LITERAL) ?? []) add(normalizeColor(c), m[1].startsWith("background") ? 0.6 : 0.4);
    }
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
  const chromatic = ranked.filter((h) => {
    const { l, s } = colorStats(h);
    return s >= 0.25 && l > 0.12 && l < 0.88;
  });
  const out: string[] = [];
  const push = (h: string | undefined) => h && out.length < max && !out.some((o) => distance(o, h) < 70) && out.push(h);
  chromatic.slice(0, 4).forEach(push);
  push(ranked.find((h) => colorStats(h).l < 0.18));
  push(ranked.find((h) => colorStats(h).l > 0.92));
  ranked.forEach(push);
  return out;
}

// ---------------------------------------------------------------------------
// Fonts

const GENERIC_FONTS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "inherit", "initial", "unset",
  "-apple-system", "blinkmacsystemfont", "segoe ui", "helvetica neue", "helvetica", "arial", "apple color emoji", "segoe ui emoji", "segoe ui symbol", "noto color emoji",
  "emoji", "math", "fangsong", "sans", "revert", "var", "times new roman", "times", "courier new", "courier", "georgia", "verdana", "tahoma",
]);

const firstFamily = (stack: string): string | null => {
  for (const part of stack.split(",")) {
    const name = part.trim().replace(/^["']|["']$/g, "").trim();
    if (!name || name.startsWith("var(") || name.startsWith("--") || GENERIC_FONTS.has(name.toLowerCase())) continue;
    if (!/^[\p{L}\p{N} _.-]{2,40}$/u.test(name)) continue;
    return name;
  }
  return null;
};

/** Google Fonts families named in links or @imports ("Playfair Display", "Inter"). */
export function googleFonts(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/fonts\.googleapis\.com\/css2?\?([^"')\s>]+)/g)) {
    for (const fam of decodeEntities(m[1]).split("&").filter((p) => p.startsWith("family="))) {
      for (const one of decodeURIComponent(fam.slice(7).replace(/\+/g, " ")).split("|")) {
        const name = one.split(":")[0].trim();
        if (name && !out.includes(name)) out.push(name);
      }
    }
  }
  return out;
}

/** Heading and body families: Google Fonts links, CSS variables (--font-heading), then h1–h3 and body rules. */
export function extractFonts(html: string, css: string[]): { heading?: string; body?: string; all: string[] } {
  const google = googleFonts(html + "\n" + css.join("\n"));
  const count = new Map<string, number>();
  let heading: string | undefined;
  let body: string | undefined;
  const all = css.join("\n") + "\n" + [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  for (const m of all.matchAll(/--([\w-]*font[\w-]*)\s*:\s*([^;}{]+)/gi)) {
    const fam = firstFamily(m[2]);
    if (!fam) continue;
    if (!heading && /head|display|title|serif-display|h1/.test(m[1].toLowerCase())) heading = fam;
    else if (!body && /body|text|base|sans|primary|default/.test(m[1].toLowerCase())) body = fam;
  }
  for (const m of all.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const fm = /font-family\s*:\s*([^;}]+)/i.exec(m[2]);
    if (!fm) continue;
    const fam = firstFamily(fm[1]);
    if (!fam) continue;
    count.set(fam, (count.get(fam) ?? 0) + 1);
    const sel = m[1].toLowerCase();
    if (!heading && /(^|[\s,])h[1-3]\b|heading|headline|display|title/.test(sel)) heading = fam;
    if (!body && /(^|[\s,])(body|html|:root)\b/.test(sel)) body = fam;
  }
  for (const m of all.matchAll(/@font-face\s*\{[^}]*font-family\s*:\s*([^;}]+)/gi)) {
    const fam = firstFamily(m[1]);
    if (fam) count.set(fam, (count.get(fam) ?? 0) + 0.5);
  }
  const ranked = [...new Set([...google, ...[...count.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f)])];
  heading ??= google[0] ?? ranked[0];
  body ??= ranked.find((f) => f !== heading) ?? heading;
  return { heading, body, all: ranked.slice(0, 8) };
}

// ---------------------------------------------------------------------------
// Products

export interface ProductDraft {
  name: string;
  description?: string;
  price?: number | null;
  currency?: string | null;
  url?: string;
  /** Remote image URLs (downloaded on save). */
  images: string[];
  brand?: string;
  sellingPoints?: string[];
  audience?: string;
}

const priceOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v.replace(/[^\d.,]/g, "").replace(/,(\d{2})$/, ".$1").replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

function offerOf(v: unknown): { price: number | null; currency: string | null } {
  const o = (Array.isArray(v) ? v[0] : v) as Json | undefined;
  if (!o || typeof o !== "object") return { price: null, currency: null };
  return { price: priceOf(o.price ?? o.lowPrice ?? (o.priceSpecification as Json | undefined)?.price), currency: str(o.priceCurrency) || null };
}

/** Text from HTML with its line breaks kept (list items and paragraphs stay apart for selling points). */
const stripHtml = (s: string, max = 600) =>
  strip(s)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, max)
    .trim();

/** Like clean(), but keeps line breaks (a product description's bullet lines). */
const cleanLines = (s: string | undefined | null, max = 2000) =>
  s
    ? decodeEntities(s)
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n")
        .slice(0, max)
    : "";

/** Products in JSON-LD (Product, ProductGroup, and Products inside an ItemList). */
export function jsonLdProducts(blocks: Json[], base: string): ProductDraft[] {
  const out: ProductDraft[] = [];
  for (const o of blocks) {
    const types = typeOf(o);
    if (!types.some((t) => t === "product" || t === "productgroup")) continue;
    const name = clean(str(o.name), 140);
    if (!name || out.some((p) => p.name === name)) continue;
    const { price, currency } = offerOf(o.offers);
    out.push({
      name,
      description: stripHtml(str(o.description)),
      price,
      currency,
      url: resolve(str(o.url) || undefined, base) ?? undefined,
      images: urlsOf(o.image)
        .map((u) => resolve(u, base))
        .filter((u): u is string => !!u)
        .slice(0, MAX_PRODUCT_IMAGES),
      brand: clean(str(o.brand), 80) || undefined,
    });
  }
  return out;
}

interface ShopifyProduct {
  title?: string;
  body_html?: string;
  handle?: string;
  vendor?: string;
  variants?: { price?: string | number }[];
  images?: { src?: string }[];
}

/** Shopify's public /products.json (a store's catalogue) or /products/<handle>.json (one product). */
export function shopifyProducts(json: unknown, origin: string): ProductDraft[] {
  const j = json as { products?: ShopifyProduct[]; product?: ShopifyProduct };
  const list = j?.products ?? (j?.product ? [j.product] : []);
  return list
    .filter((p) => p?.title)
    .map((p) => ({
      name: clean(p.title, 140),
      description: stripHtml(p.body_html ?? ""),
      price: priceOf(p.variants?.[0]?.price),
      currency: null,
      url: p.handle ? `${origin.replace(/\/+$/, "")}/products/${p.handle}` : undefined,
      images: (p.images ?? [])
        .map((i) => resolve(i.src, origin))
        .filter((u): u is string => !!u)
        .slice(0, MAX_PRODUCT_IMAGES),
      brand: p.vendor ? clean(p.vendor, 80) : undefined,
    }));
}

const isShopify = (html: string) => /cdn\.shopify\.com|Shopify\.shop|shopify-section/i.test(html);

// ---------------------------------------------------------------------------
// The whole page

export interface SiteFacts {
  url: string;
  host: string;
  name: string;
  title: string;
  description: string;
  themeColor: string | null;
  lang: string | null;
  /** Candidate logo URLs, best first (an inline SVG logo comes as `svg`). */
  logos: string[];
  svgLogo: string | null;
  images: string[];
  headings: string[];
  text: string;
  socials: BrandSocial[];
  stylesheets: string[];
  inlineCss: string[];
  products: ProductDraft[];
  shopify: boolean;
  organization: { name?: string; description?: string; logo?: string; sameAs: string[] } | null;
}

const SOCIAL_HOSTS: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)facebook\.com$/, "Facebook"],
  [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/(^|\.)pinterest\.[a-z.]+$/, "Pinterest"],
  [/(^|\.)(x\.com|twitter\.com)$/, "X"],
  [/(^|\.)threads\.(net|com)$/, "Threads"],
  [/(^|\.)snapchat\.com$/, "Snapchat"],
  [/(^|\.)(t\.me|telegram\.me)$/, "Telegram"],
  [/(^|\.)(discord\.gg|discord\.com)$/, "Discord"],
];

export function socialOf(url: string): BrandSocial | null {
  try {
    const u = new URL(url);
    const hit = SOCIAL_HOSTS.find(([re]) => re.test(u.hostname.toLowerCase()));
    if (!hit || u.pathname.length < 2 || /\/(share|sharer|intent|dialog|plugins|embed)/.test(u.pathname)) return null;
    return { network: hit[1], url: `${u.origin}${u.pathname}`.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

const SKIP_IMAGE = /sprite|pixel|tracking|spacer|blank\.|1x1|favicon|\/icons?\/|placeholder|loader|spinner|badge|payment|flag/i;

/** Everything machine-readable on a page. */
export function parseSite(html: string, url: string): SiteFacts {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  const ld = jsonLd(html);
  const orgRaw = ld.find((o) => typeOf(o).some((t) => ["organization", "corporation", "brand", "localbusiness", "store", "onlinestore"].includes(t)));
  const site = ld.find((o) => typeOf(o).includes("website"));
  const organization = orgRaw
    ? {
        name: clean(str(orgRaw.name), 80) || undefined,
        description: clean(str(orgRaw.description), 600) || undefined,
        logo: urlsOf(orgRaw.logo).map((x) => resolve(x, url)).find(Boolean) ?? undefined,
        sameAs: urlsOf(orgRaw.sameAs),
      }
    : null;
  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], 200);
  const ogSite = meta(html, "og:site_name", "application-name", "apple-mobile-web-app-title");
  const titleParts = title.split(/\s+[|–—·:-]\s+/).map((s) => s.trim()).filter(Boolean);
  const name = organization?.name || ogSite || clean(str(site?.name), 80) || shortestBrandPart(titleParts, host) || hostName(host);
  const description = meta(html, "description", "og:description", "twitter:description") || organization?.description || "";

  const links = tags(html, "link");
  const icons = links
    .filter((l) => /(^|\s)(apple-touch-icon|icon|shortcut icon|mask-icon)(\s|$)/i.test(l.rel ?? ""))
    .map((l) => ({ href: resolve(l.href, url), size: parseInt((l.sizes ?? "").split("x")[0], 10) || (/apple/i.test(l.rel) ? 180 : 32) }))
    .filter((l): l is { href: string; size: number } => !!l.href)
    .sort((a, b) => b.size - a.size);
  const imgs = tags(html, "img");
  const logoImgs = imgs
    .filter((a) => /logo/i.test(`${a.class ?? ""} ${a.id ?? ""} ${a.alt ?? ""} ${a.src ?? ""}`))
    .map((a) => resolve(a.src ?? a["data-src"], url))
    .filter((x): x is string => !!x);
  const logos = [...new Set([organization?.logo, ...logoImgs, ...icons.filter((i) => i.size >= 96).map((i) => i.href), ...icons.map((i) => i.href)].filter((x): x is string => !!x))];
  // An inline <svg> logo: the first svg after an element whose class or id names a logo.
  let svgLogo: string | null = null;
  const at = html.search(/(class|id|aria-label)\s*=\s*["'][^"']*logo[^"']*["']/i);
  if (at >= 0) {
    const tail = html.slice(at, at + 40_000);
    const m = /<svg\b[\s\S]*?<\/svg>/i.exec(tail);
    if (m && m.index < 2000 && m[0].length < 30_000) svgLogo = m[0].includes("xmlns") ? m[0] : m[0].replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  const images = [
    ...metaAll(html, "og:image"),
    ...metaAll(html, "og:image:secure_url"),
    ...metaAll(html, "twitter:image"),
    ...imgs
      .filter((a) => {
        const w = parseInt(a.width ?? "", 10);
        const h = parseInt(a.height ?? "", 10);
        return !(w && w < 240) && !(h && h < 240) && !/logo/i.test(`${a.class ?? ""} ${a.alt ?? ""}`);
      })
      .map((a) => a.src ?? a["data-src"] ?? (a.srcset ?? a["data-srcset"] ?? "").split(",").pop()?.trim().split(" ")[0]),
  ]
    .map((x) => resolve(x, url))
    .filter((x): x is string => !!x && !SKIP_IMAGE.test(x) && !/\.svg(\?|$)/i.test(x));

  const socials: BrandSocial[] = [];
  for (const href of [...tags(html, "a").map((a) => a.href), ...(organization?.sameAs ?? [])]) {
    const s = href && socialOf(resolve(href, url) ?? "");
    if (s && !socials.some((x) => x.network === s.network)) socials.push(s);
  }

  const text = strip(html);
  return {
    url,
    host,
    name,
    title,
    description,
    themeColor: meta(html, "theme-color", "msapplication-TileColor") || null,
    lang: (/<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z-]+)/i.exec(html)?.[1] ?? null)?.toLowerCase() ?? null,
    logos,
    svgLogo,
    images: [...new Set(images)].slice(0, 16),
    headings: [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => clean(strip(m[2]), 140)).filter(Boolean).slice(0, 20),
    text: text.slice(0, 20_000),
    socials,
    stylesheets: links
      .filter((l) => /stylesheet/i.test(l.rel ?? "") && l.href)
      .map((l) => resolve(l.href, url))
      .filter((x): x is string => !!x && !/fonts\.googleapis\.com/.test(x)),
    inlineCss: [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]),
    products: jsonLdProducts(ld, url),
    shopify: isShopify(html),
    organization,
  };
}

function hostName(host: string): string {
  const label = host.split(".").filter((p) => !/^(www|shop|store|m)$/.test(p))[0] ?? host;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "Acme Coffee | Specialty beans roasted weekly" → the part that looks like a name (short, or matching the domain). */
function shortestBrandPart(parts: string[], host: string): string {
  if (!parts.length) return "";
  const label = host.split(".")[0].replace(/[^a-z0-9]/g, "");
  const matching = parts.find((p) => p.toLowerCase().replace(/[^a-z0-9]/g, "").includes(label) || label.includes(p.toLowerCase().replace(/[^a-z0-9]/g, "")));
  if (matching && matching.length <= 40) return matching;
  const short = [...parts].sort((a, b) => a.length - b.length)[0];
  return short.length <= 30 ? short : "";
}

// ---------------------------------------------------------------------------
// Product pages (Add product from link, Click to Ad)

/** Products on one page: JSON-LD, Shopify's product JSON is fetched separately; else OpenGraph and the page itself. */
export function productsFromPage(html: string, url: string): ProductDraft[] {
  const facts = parseSite(html, url);
  if (facts.products.length) return facts.products.map((p) => ({ ...p, url: p.url ?? url, images: p.images.length ? p.images : facts.images.slice(0, 5) }));
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const name = meta(html, "og:title", "twitter:title") || (h1 ? clean(strip(h1), 140) : "") || facts.title;
  if (!name) return [];
  return [
    {
      name: clean(name, 140),
      description: facts.description,
      price: priceOf(meta(html, "product:price:amount", "og:price:amount")),
      currency: meta(html, "product:price:currency", "og:price:currency") || null,
      url,
      images: facts.images.slice(0, 5),
    },
  ];
}

// ---------------------------------------------------------------------------
// Brand fields: LLM, with an offline fallback

export interface SoftFields {
  name?: string;
  tagline?: string;
  overview?: string;
  values?: string[];
  aesthetics?: string[];
  tone?: string[];
  audience?: string;
  sellingPoints?: string[];
  competitors?: string[];
  language?: string;
  colors?: string[];
  fonts?: { heading?: string; body?: string };
  products?: { name: string; audience?: string; sellingPoints?: string[] }[];
}

/** The first JSON object in a model's answer (tolerates code fences and chatter around it). */
export function parseJsonObject(text: string | null | undefined): Json | null {
  if (!text) return null;
  const body = text.replace(/```(?:json)?/gi, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(body.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
  } catch {
    return null;
  }
}

const list = (v: unknown, max: number, len = 80): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\n]/) : [])
    .map((x) => clean(typeof x === "string" ? x : str(x), len))
    .filter((x, i, a) => x && a.indexOf(x) === i)
    .slice(0, max);

/** Validate an LLM's brand answer into soft fields (drops anything malformed). */
export function softFieldsFrom(j: Json | null): SoftFields {
  if (!j) return {};
  const fonts = (j.fonts && typeof j.fonts === "object" ? j.fonts : {}) as Json;
  return {
    name: clean(str(j.name), 80) || undefined,
    tagline: clean(str(j.tagline), 140) || undefined,
    overview: clean(str(j.overview ?? j.description), 900) || undefined,
    values: list(j.values, 6),
    aesthetics: list(j.aesthetics, 6),
    tone: list(j.tone, 6, 40),
    audience: clean(str(j.audience), 300) || undefined,
    sellingPoints: list(j.sellingPoints ?? j.selling_points, MAX_SELLING_POINTS, 120),
    competitors: list(j.competitors, 5, 60),
    language: matchLanguage(str(j.language)),
    colors: list(j.colors, 6, 7)
      .map((c) => normalizeColor(c))
      .filter((c): c is string => !!c),
    fonts: { heading: firstFamily(str(fonts.heading)) ?? undefined, body: firstFamily(str(fonts.body)) ?? undefined },
    products: Array.isArray(j.products)
      ? (j.products as Json[])
          .filter((p) => p && typeof p === "object" && str(p.name))
          .map((p) => ({ name: clean(str(p.name), 140), audience: clean(str(p.audience), 300) || undefined, sellingPoints: list(p.sellingPoints ?? p.selling_points, MAX_SELLING_POINTS, 120) }))
      : undefined,
  };
}

const LANG_CODES: Record<string, string> = {
  ar: "Arabic", zh: "Chinese", cs: "Czech", da: "Danish", nl: "Dutch", en: "English", fi: "Finnish", fr: "French", de: "German", el: "Greek", he: "Hebrew", iw: "Hebrew",
  hi: "Hindi", hu: "Hungarian", id: "Indonesian", it: "Italian", ja: "Japanese", kk: "Kazakh", ko: "Korean", no: "Norwegian", nb: "Norwegian", pl: "Polish",
  pt: "Portuguese", ro: "Romanian", ru: "Russian", es: "Spanish", sv: "Swedish", th: "Thai", tr: "Turkish", uk: "Ukrainian", vi: "Vietnamese",
};

/** "en-GB" / "english" / "English" → "English" (one of BRAND_LANGUAGES), else undefined. */
export function matchLanguage(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  const byCode = LANG_CODES[s.split(/[-_]/)[0]];
  if (byCode) return byCode;
  return BRAND_LANGUAGES.find((l) => l.toLowerCase() === s);
}

const KEYWORDS: { re: RegExp; tone?: string; value?: string; aesthetic?: string }[] = [
  { re: /luxur|premium|exclusive|finest|crafted/i, tone: "Refined", aesthetic: "Premium, polished finish" },
  { re: /fun|play|joy|happy|colou?rful/i, tone: "Playful", aesthetic: "Bright and colourful" },
  { re: /sustainab|eco|recycl|planet|carbon|organic/i, value: "Sustainability", tone: "Conscious" },
  { re: /handmade|hand-made|small[- ]batch|artisan|craft/i, value: "Craftsmanship", aesthetic: "Handmade, tactile textures" },
  { re: /scien|clinical|dermatolog|research|lab-tested|proven/i, tone: "Expert", value: "Evidence-based" },
  { re: /communit|together|family/i, value: "Community", tone: "Warm" },
  { re: /innovat|smart|ai\b|technolog|future/i, value: "Innovation", tone: "Forward-looking" },
  { re: /natural|plant|botanical|clean ingredient/i, value: "Natural ingredients", aesthetic: "Natural light and textures" },
  { re: /afford|accessib|everyone|inclusive/i, value: "Accessibility", tone: "Inclusive" },
  { re: /quality|durable|built to last|lifetime/i, value: "Quality", tone: "Confident" },
  { re: /minimal|simple|essential|clean/i, aesthetic: "Minimal, lots of white space", tone: "Calm" },
];

const SELLING = /(free (?:shipping|delivery|returns)(?: (?:over|on orders over|worldwide|on) [^\s,.;]+)?|\d+[- ]day (?:money[- ]back )?(?:returns?|trial|guarantee)|money[- ]back guarantee|lifetime warranty|\d+[- ]year warranty|vegan|cruelty[- ]free|certified organic|made in [A-Z][a-z]+|handmade|dermatologist[- ]tested|gluten[- ]free|plastic[- ]free|carbon[- ]neutral)/gi;

/** Rule-based soft fields for installs with no LLM (and as the base the LLM's answer overrides). */
export function heuristicFields(f: Pick<SiteFacts, "name" | "title" | "description" | "text" | "lang" | "headings">, colors: string[], fonts: { heading?: string }): SoftFields {
  const blob = `${f.title}\n${f.description}\n${f.headings.join("\n")}\n${f.text.slice(0, 8000)}`;
  const hits = KEYWORDS.filter((k) => k.re.test(blob));
  const firstSentence = (f.description.split(/(?<=[.!?])\s/)[0] ?? "").trim();
  const tagline = firstSentence && firstSentence.length <= 90 ? firstSentence.replace(/[.\s]+$/, "") : f.headings.find((h) => h.length >= 8 && h.length <= 70);
  const lights = colors.map((c) => colorStats(c));
  const aesthetics = [
    ...hits.flatMap((h) => (h.aesthetic ? [h.aesthetic] : [])),
    lights.some((c) => c.l < 0.2) && lights.filter((c) => c.l < 0.2).length >= lights.length / 2 ? "Dark, moody palette" : "",
    lights.some((c) => c.s > 0.6) ? "Saturated accent colours" : "Muted, soft colours",
    fonts.heading && /serif|playfair|garamond|didot|bodoni|cormorant|lora|libre baskerville|dm serif|fraunces/i.test(fonts.heading) ? "Classic serif typography" : "Clean sans-serif typography",
  ].filter(Boolean);
  return {
    name: f.name,
    tagline: tagline || undefined,
    overview: f.description || undefined,
    values: [...new Set(hits.flatMap((h) => (h.value ? [h.value] : [])))].slice(0, 5),
    aesthetics: [...new Set(aesthetics)].slice(0, 5),
    tone: [...new Set([...hits.flatMap((h) => (h.tone ? [h.tone] : [])), "Friendly", "Clear"])].slice(0, 4),
    sellingPoints: [...new Set([...blob.matchAll(SELLING)].map((m) => m[0].replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase())))].slice(0, MAX_SELLING_POINTS),
    competitors: [],
    language: matchLanguage(f.lang) ?? "English",
  };
}

/**
 * The kit from what code read (name, logo, colours, fonts, images, socials) and the soft fields:
 * the LLM's answer wins over the heuristics field by field; empty answers never erase a fact.
 */
export function mergeKit(base: BrandKitFields, facts: Partial<BrandKitFields>, heuristic: SoftFields, llm: SoftFields): BrandKitFields {
  const pick = <T,>(...v: (T | undefined | null | "")[]) => v.find((x) => x !== undefined && x !== null && x !== "" && !(Array.isArray(x) && !x.length)) as T | undefined;
  return {
    ...base,
    name: pick(llm.name, facts.name, heuristic.name, base.name) ?? "",
    website: pick(facts.website, base.website),
    logo: pick(facts.logo, base.logo),
    tagline: pick(llm.tagline, heuristic.tagline, base.tagline),
    overview: pick(llm.overview, heuristic.overview, base.overview),
    colors: pick(facts.colors, llm.colors, base.colors) ?? [],
    fonts: { heading: pick(facts.fonts?.heading, llm.fonts?.heading, base.fonts.heading), body: pick(facts.fonts?.body, llm.fonts?.body, base.fonts.body) },
    values: pick(llm.values, heuristic.values, base.values) ?? [],
    aesthetics: pick(llm.aesthetics, heuristic.aesthetics, base.aesthetics) ?? [],
    tone: pick(llm.tone, heuristic.tone, base.tone) ?? [],
    audience: pick(llm.audience, heuristic.audience, base.audience),
    sellingPoints: (pick(llm.sellingPoints, heuristic.sellingPoints, base.sellingPoints) ?? []).slice(0, MAX_SELLING_POINTS),
    competitors: pick(llm.competitors, heuristic.competitors, base.competitors) ?? [],
    socials: pick(facts.socials, base.socials) ?? [],
    language: pick(llm.language, heuristic.language, base.language),
    images: pick(facts.images, base.images) ?? [],
    details: base.details,
  };
}

// The answers' JSON as JSON Schemas, for local models that decode to one (Ollama, LM Studio, Unsloth
// Studio); the prompts ask for the same JSON, which Claude and any other model follow.
const S = { type: "string" };
const STRINGS = { type: "array", items: S };
const objectOf = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const PRODUCT_FACTS = { type: "array", items: objectOf({ name: S, audience: S, sellingPoints: STRINGS }) };
const KIT_FIELDS = { name: S, tagline: S, overview: S, values: STRINGS, aesthetics: STRINGS, tone: STRINGS, audience: S, sellingPoints: STRINGS, competitors: STRINGS, language: S };
const BRAND_SCHEMA = { name: "brand_kit", schema: objectOf({ ...KIT_FIELDS, products: PRODUCT_FACTS }) };
const MANUAL_SCHEMA = { name: "brand_kit", schema: objectOf({ ...KIT_FIELDS, colors: STRINGS, fonts: objectOf({ heading: S, body: S }) }) };
const PRODUCTS_SCHEMA = { name: "products", schema: objectOf({ products: PRODUCT_FACTS }) };

const BRAND_SYSTEM = `You are a brand strategist. You read a company's website and write its brand kit for an ad team.
Answer with ONE JSON object and nothing else:
{"name": string, "tagline": string (at most 12 words), "overview": string (2–3 sentences: what it sells, who it's for, what makes it different), "values": string[] (3–5), "aesthetics": string[] (3–5 short look-and-feel phrases, e.g. "Muted earth tones"), "tone": string[] (3–5 single words), "audience": string (one sentence), "sellingPoints": string[] (3–5 short reasons to buy), "competitors": string[] (2–4 brand names), "language": string (the site's language in English, e.g. "German"), "products": [{"name": string, "audience": string, "sellingPoints": string[] (up to 5)}] (only for the products listed, same names)}
Use what the site says or clearly implies. Leave a field empty ("" or []) rather than invent facts.`;

function brandPrompt(f: SiteFacts | null, url: string, products: ProductDraft[]): string {
  if (!f) return `Website: ${url}\nThe site couldn't be read. Use what is publicly known about this brand; leave fields empty if you don't know it.`;
  return [
    `Website: ${f.url}`,
    `Title: ${f.title}`,
    f.description && `Description: ${f.description}`,
    f.headings.length && `Headings: ${f.headings.slice(0, 12).join(" · ")}`,
    products.length && `Products: ${products.slice(0, 10).map((p) => `${p.name}${p.price != null ? ` (${p.price}${p.currency ? ` ${p.currency}` : ""})` : ""}: ${(p.description ?? "").slice(0, 200)}`).join("\n")}`,
    `Page text:\n${f.text.slice(0, 5000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const MANUAL_SYSTEM = `You are a brand designer. From a short description of a business, create its brand kit.
Answer with ONE JSON object and nothing else:
{"name": string, "tagline": string (at most 12 words), "overview": string (2–3 sentences), "values": string[] (3–5), "aesthetics": string[] (3–5 short look-and-feel phrases), "tone": string[] (3–5 single words), "audience": string (one sentence), "sellingPoints": string[] (3–5), "competitors": string[] (0–3), "language": string, "colors": string[] (4–5 hex colours, the main brand colour first, including one dark and one light neutral), "fonts": {"heading": string, "body": string} (Google Fonts family names that suit the brand)}`;

// Palettes and fonts for a manual kit when no LLM answers, by what the business sounds like.
const MANUAL_LOOKS: { re: RegExp; colors: string[]; fonts: { heading: string; body: string }; aesthetics: string[]; tone: string[] }[] = [
  { re: /coffee|roast|bakery|granola|food|kitchen|tea|chocolate|snack/i, colors: ["#8a4b2a", "#d9a066", "#2b1d14", "#f6efe6"], fonts: { heading: "Fraunces", body: "Inter" }, aesthetics: ["Warm earth tones", "Natural textures", "Daylight photography"], tone: ["Warm", "Honest", "Inviting"] },
  { re: /skin|beauty|serum|cream|cosmetic|spa|wellness/i, colors: ["#d98c8c", "#f3d5c9", "#3b2a2f", "#fbf6f3"], fonts: { heading: "Cormorant Garamond", body: "DM Sans" }, aesthetics: ["Soft blush tones", "Clean minimal layouts", "Dewy close-ups"], tone: ["Gentle", "Expert", "Reassuring"] },
  { re: /fashion|wear|apparel|tailor|clothing|capsule|boutique/i, colors: ["#1f1f1f", "#c8b8a6", "#7a6a58", "#f7f4ef"], fonts: { heading: "Playfair Display", body: "Inter" }, aesthetics: ["Editorial photography", "Neutral palette", "Generous white space"], tone: ["Confident", "Considered", "Elegant"] },
  { re: /home|linen|candle|interior|decor|furniture|bedding/i, colors: ["#6b7f6a", "#d8cbb5", "#2f3a33", "#f5f1ea"], fonts: { heading: "DM Serif Display", body: "Nunito Sans" }, aesthetics: ["Cozy interiors", "Muted sage and sand", "Soft natural light"], tone: ["Calm", "Cozy", "Thoughtful"] },
  { re: /software|saas|studio|agency|digital|app|platform|develop|design/i, colors: ["#4f46e5", "#22d3ee", "#0f172a", "#f8fafc"], fonts: { heading: "Space Grotesk", body: "Inter" }, aesthetics: ["Crisp UI screenshots", "Bold gradients", "Geometric shapes"], tone: ["Clear", "Smart", "Direct"] },
  { re: /sport|fitness|gym|run|outdoor|bike|athlet/i, colors: ["#ff5a1f", "#111827", "#facc15", "#f3f4f6"], fonts: { heading: "Oswald", body: "Inter" }, aesthetics: ["High-contrast action shots", "Bold type", "Energetic angles"], tone: ["Energetic", "Bold", "Motivating"] },
];

/** A kit from a description when no LLM answers: name before the dash, a look by category. */
export function heuristicManualKit(description: string): SoftFields {
  const d = description.trim();
  const name = clean(d.split(/\s+[—–-]\s+|[,:.]/)[0], 60);
  const look = MANUAL_LOOKS.find((l) => l.re.test(d)) ?? { colors: ["#5d4bdb", "#f59e0b", "#1c1917", "#fafaf9"], fonts: { heading: "Fraunces", body: "Inter" }, aesthetics: ["Clean layouts", "Bold accent colour", "Natural light"], tone: ["Friendly", "Clear", "Confident"] };
  const rest = d.replace(/^[^—–-]*[—–-]\s*/, "");
  return {
    name: name && name.split(" ").length <= 5 ? name : name.split(" ").slice(0, 3).join(" "),
    tagline: clean(rest.split(/[.,;]/)[0], 90) || undefined,
    overview: d,
    values: heuristicFields({ name: "", title: "", description: d, text: d, lang: null, headings: [] }, [], {}).values,
    aesthetics: look.aesthetics,
    tone: look.tone,
    sellingPoints: [],
    competitors: [],
    language: "English",
    colors: look.colors,
    fonts: look.fonts,
  };
}

// ---------------------------------------------------------------------------
// Storage

interface BrandRow {
  id: string;
  name: string;
  website: string | null;
  status: BrandStatus;
  progress_json: string | null;
  kit_json: string;
  chat_json: string;
  created_at: number;
  updated_at: number;
  product_count?: number;
  ad_count?: number;
}

interface StoredKit extends BrandKitFields {
  source?: "website" | "manual";
  origin?: "assist";
  note?: string | null;
  error?: string | null;
}

interface ProductRow {
  id: string;
  brand_id: string | null;
  name: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  audience: string | null;
  selling_points_json: string;
  url: string | null;
  images_json: string;
  created_at: number;
  updated_at: number;
}

const parse = <T,>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

function toBrand(r: BrandRow): BrandKit {
  const kit = { ...emptyKit(r.name), ...parse<Partial<StoredKit>>(r.kit_json, {}) };
  return {
    ...kit,
    fonts: kit.fonts ?? {},
    id: r.id,
    name: r.name,
    website: r.website ?? kit.website,
    status: r.status,
    progress: parse<BrandProgress | null>(r.progress_json, null),
    note: kit.note ?? null,
    error: kit.error ?? null,
    source: kit.source ?? (r.website ? "website" : "manual"),
    productCount: r.product_count,
    adCount: r.ad_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toProduct(r: ProductRow): Product {
  return {
    id: r.id,
    brandId: r.brand_id,
    name: r.name,
    description: r.description ?? undefined,
    price: r.price,
    currency: r.currency,
    audience: r.audience ?? undefined,
    sellingPoints: parse<string[]>(r.selling_points_json, []),
    url: r.url ?? undefined,
    images: parse<string[]>(r.images_json, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

declare global {
  var __fuobeBrandRuns: Map<string, AbortController> | undefined;
}
const runs = () => (globalThis.__fuobeBrandRuns ??= new Map<string, AbortController>());

/** Research that died with the server (or a crashed run): settle it so the UI offers Retry. */
function settleStale(r: BrandRow): BrandRow {
  if (r.status !== "researching" || runs().has(r.id) || Date.now() - r.updated_at < 15_000) return r;
  const kit = parse<StoredKit>(r.kit_json, emptyKit(r.name));
  const error = `Research incomplete — something stopped the research of ${r.name}. Retry runs it again.`;
  const now = Date.now();
  db().prepare("UPDATE brand_kits SET status = 'failed', progress_json = NULL, kit_json = ?, updated_at = ? WHERE id = ? AND status = 'researching'").run(JSON.stringify({ ...kit, error }), now, r.id);
  return { ...r, status: "failed", progress_json: null, kit_json: JSON.stringify({ ...kit, error }), updated_at: now };
}

const BRAND_SELECT = `SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id) AS product_count,
  (SELECT COUNT(*) FROM ad_creatives c WHERE c.brand_id = b.id) AS ad_count FROM brand_kits b`;

export function listBrands(): BrandKit[] {
  return (db().prepare(`${BRAND_SELECT} ORDER BY b.updated_at DESC`).all() as BrandRow[]).map(settleStale).map(toBrand);
}

export function getBrand(id: string): BrandKit | null {
  const r = db().prepare(`${BRAND_SELECT} WHERE b.id = ?`).get(id) as BrandRow | undefined;
  return r ? toBrand(settleStale(r)) : null;
}

function writeKit(id: string, kit: StoredKit, status?: BrandStatus) {
  const now = Date.now();
  const name = kit.name.trim() || "Untitled brand";
  if (status) db().prepare("UPDATE brand_kits SET name = ?, website = ?, kit_json = ?, status = ?, progress_json = NULL, updated_at = ? WHERE id = ?").run(name, kit.website ?? null, JSON.stringify(kit), status, now, id);
  else db().prepare("UPDATE brand_kits SET name = ?, website = ?, kit_json = ?, updated_at = ? WHERE id = ?").run(name, kit.website ?? null, JSON.stringify(kit), now, id);
}

function storedKit(id: string): StoredKit | null {
  const r = db().prepare("SELECT name, kit_json FROM brand_kits WHERE id = ?").get(id) as { name: string; kit_json: string } | undefined;
  return r ? { ...emptyKit(r.name), ...parse<StoredKit>(r.kit_json, emptyKit(r.name)) } : null;
}

// The browser checks a link with the same rule before it sends one (src/lib/website.ts).
export { normalizeWebsite };

/** Start a brand from a website: the row exists at once, the research runs in the background. */
export function createBrandFromWebsite(website: string): { brand: BrandKit; run: Promise<void> } {
  const url = normalizeWebsite(website);
  if (!url) throw new Error("Enter a valid website URL");
  const id = nanoid(10);
  const now = Date.now();
  const name = hostName(new URL(url).hostname.replace(/^www\./, ""));
  const kit: StoredKit = { ...emptyKit(name), website: url, source: "website" };
  db()
    .prepare("INSERT INTO brand_kits (id, name, website, status, progress_json, kit_json, chat_json, created_at, updated_at) VALUES (?, ?, ?, 'researching', ?, ?, '[]', ?, ?)")
    .run(id, name, url, JSON.stringify(progressAt(0)), JSON.stringify(kit), now, now);
  return { brand: getBrand(id)!, run: startResearch(id) };
}

/** Run the research again (after a failure, a cancel, or to refresh). */
export function retryResearch(id: string): { brand: BrandKit; run: Promise<void> } {
  const b = getBrand(id);
  if (!b) throw new Error("Not found");
  if (!b.website) throw new Error("This brand has no website to research");
  if (runs().has(id)) return { brand: b, run: Promise.resolve() };
  const kit = storedKit(id)!;
  db().prepare("UPDATE brand_kits SET status = 'researching', progress_json = ?, kit_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(progressAt(0)), JSON.stringify({ ...kit, error: null, note: null }), Date.now(), id);
  return { brand: getBrand(id)!, run: startResearch(id) };
}

export function cancelResearch(id: string): BrandKit | null {
  runs().get(id)?.abort();
  runs().delete(id);
  db().prepare("UPDATE brand_kits SET status = 'canceled', progress_json = NULL, updated_at = ? WHERE id = ? AND status = 'researching'").run(Date.now(), id);
  return getBrand(id);
}

const progressAt = (index: number): BrandProgress => ({ index, total: RESEARCH_LABELS.length, label: RESEARCH_LABELS[index], startedAt: Date.now() });

function startResearch(id: string): Promise<void> {
  const ac = new AbortController();
  runs().set(id, ac);
  return research(id, ac.signal)
    .catch((e) => {
      if (ac.signal.aborted) return;
      const kit = storedKit(id);
      if (kit) writeKit(id, { ...kit, error: `Research incomplete — ${(e as Error).message}. Retry runs it again.` }, "failed");
    })
    .finally(() => {
      if (runs().get(id) === ac) runs().delete(id);
    });
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const IMAGE_MAGIC: [number[], string][] = [
  [[0xff, 0xd8, 0xff], "image/jpeg"],
  [[0x89, 0x50, 0x4e, 0x47], "image/png"],
  [[0x47, 0x49, 0x46, 0x38], "image/gif"],
  [[0x52, 0x49, 0x46, 0x46], "image/webp"],
];

/** Fetch a remote image (SSRF-safe) into the library's uploads; null when it isn't a usable picture. */
export async function saveRemoteImage(url: string, opts: { allowSvg?: boolean; minBytes?: number } = {}): Promise<string | null> {
  try {
    const res = await fetchRemote(url, { maxBytes: 15 * 1024 * 1024, timeoutMs: 20_000 });
    const sniff = IMAGE_MAGIC.find(([sig]) => sig.every((b, i) => res.data[i] === b))?.[1];
    const isSvg = /svg/.test(res.contentType ?? "") || res.data.subarray(0, 300).toString("utf8").includes("<svg");
    const type = sniff ?? (isSvg && opts.allowSvg ? "image/svg+xml" : null);
    if (!type || res.data.length < (opts.minBytes ?? 3000)) return null;
    const name = decodeURIComponent(new URL(res.url).pathname.split("/").pop() || "image").slice(0, 80);
    return saveFile({ data: res.data, contentType: type, name, source: "upload" }).url;
  } catch {
    return null;
  }
}

async function fetchText(url: string, maxBytes: number, timeoutMs: number): Promise<{ text: string; url: string; type: string | null } | null> {
  try {
    const r = await fetchRemote(url, { maxBytes, timeoutMs });
    return { text: r.data.toString("utf8"), url: r.url, type: r.contentType };
  } catch {
    return null;
  }
}

async function research(id: string, signal: AbortSignal): Promise<void> {
  const brand = getBrand(id);
  if (!brand?.website) throw new Error("No website");
  const step = (index: number) => {
    if (signal.aborted) throw new Error("canceled");
    db().prepare("UPDATE brand_kits SET progress_json = ?, updated_at = ? WHERE id = ? AND status = 'researching'").run(JSON.stringify(progressAt(index)), Date.now(), id);
  };
  const url = brand.website;
  const host = new URL(url).hostname.replace(/^www\./, "");

  step(0);
  let note: string | null = null;
  const page = await fetchText(url, 6 * 1024 * 1024, 25_000);
  const html = page && /html|xml|text/i.test(page.type ?? "text/html") ? page.text : "";
  if (!page) note = "We couldn't read the site, so this kit comes from what is known publicly. Check it, or retry the research.";

  step(1);
  const facts = html ? parseSite(html, page!.url) : null;
  if (facts && facts.text.length < 40 && !facts.description && !facts.title) note = `${host} returned an empty page. Fill in the brand kit manually.`;
  else if (facts && !facts.description && facts.text.length < 200) note = `${host} showed no brand text. Fill in the brand kit manually.`;

  step(2);
  const sheets = facts
    ? (await pool(facts.stylesheets.slice(0, 4), 3, (s) => fetchText(s, 2 * 1024 * 1024, 10_000))).filter((x): x is NonNullable<typeof x> => !!x).map((x) => x.text)
    : [];
  const css = [...(facts?.inlineCss ?? []), ...sheets];
  const colors = facts ? extractColors(css, facts.themeColor) : [];
  const fonts = facts ? extractFonts(html, css) : { all: [] };

  step(3);
  let products: ProductDraft[] = facts?.products ?? [];
  if (facts?.shopify) {
    const shop = await fetchText(`${new URL(facts.url).origin}/products.json?limit=12`, 4 * 1024 * 1024, 15_000);
    const found = shop ? shopifyProducts(parseJsonSafe(shop.text), new URL(facts.url).origin) : [];
    if (found.length) products = found;
  }
  const heuristic = facts ? heuristicFields(facts, colors, fonts) : { name: brand.name, language: "English" };
  const llm = softFieldsFrom(parseJsonObject(await llmText(BRAND_SYSTEM, brandPrompt(facts, url, products), { json: BRAND_SCHEMA })));
  if (signal.aborted) return;

  step(11);
  const logoUrl = facts?.svgLogo
    ? saveFile({ data: Buffer.from(facts.svgLogo), contentType: "image/svg+xml", name: `${host}-logo.svg`, source: "upload" }).url
    : await firstSaved(facts?.logos ?? [], { allowSvg: true, minBytes: 300 });
  const images = (await pool(facts?.images.slice(0, 10) ?? [], 4, (u) => saveRemoteImage(u, { minBytes: 8000 }))).filter((x): x is string => !!x).slice(0, 6);

  step(12);
  const kit = storedKit(id)!;
  const merged = mergeKit(
    kit,
    { name: facts?.name, website: url, logo: logoUrl ?? undefined, colors: colors.length ? colors : llm.colors, fonts, socials: facts?.socials, images },
    heuristic,
    llm,
  );
  writeKit(id, { ...merged, source: "website", note, error: null });

  step(13);
  const existing = listProducts(id);
  for (const p of products.slice(0, 12)) {
    if (signal.aborted) return;
    if (existing.some((e) => (p.url && e.url === p.url) || e.name.toLowerCase() === p.name.toLowerCase())) continue;
    const soft = llm.products?.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    const pics = (await pool(p.images.slice(0, 4), 4, (u) => saveRemoteImage(u))).filter((x): x is string => !!x);
    insertProduct({ ...p, audience: soft?.audience, sellingPoints: soft?.sellingPoints?.length ? soft.sellingPoints : sellingPointsFrom(p.description) }, id, pics);
  }
  if (signal.aborted) return;
  db().prepare("UPDATE brand_kits SET status = 'ready', progress_json = NULL, updated_at = ? WHERE id = ? AND status = 'researching'").run(Date.now(), id);
}

function parseJsonSafe(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function firstSaved(urls: string[], opts: { allowSvg?: boolean; minBytes?: number }): Promise<string | null> {
  for (const u of urls.slice(0, 4)) {
    const saved = await saveRemoteImage(u, opts);
    if (saved) return saved;
  }
  return null;
}

/** Short benefit-like sentences from a product description (a stand-in when no LLM writes them). */
export function sellingPointsFrom(description: string | undefined): string[] {
  if (!description) return [];
  return description
    .split(/(?<=[.!?])\s+|\n|•|·/)
    .map((s) => s.trim().replace(/[.\s]+$/, ""))
    .filter((s) => s.length >= 12 && s.length <= 90 && !/cookie|privacy|©|shipping policy/i.test(s))
    .slice(0, 3);
}

/** A manual kit from a description ("Describe your business") and optional product photos. `origin`: who made it (Assist). */
export async function createManualBrand(input: { description: string; name?: string; images?: string[]; colors?: string[]; origin?: "assist" }): Promise<BrandKit> {
  const description = input.description.trim();
  if (!description && !input.images?.length) throw new Error("Add a description or upload images");
  const llm = description ? softFieldsFrom(parseJsonObject(await llmText(MANUAL_SYSTEM, `Business: ${description}`, { json: MANUAL_SCHEMA }))) : {};
  const heur = heuristicManualKit(description || input.name || "My brand");
  const colors = (input.colors ?? []).filter(isHex);
  const kit: StoredKit = {
    ...mergeKit(emptyKit(input.name ?? ""), { name: input.name, colors: colors.length ? colors : undefined, images: input.images }, heur, llm),
    colors: colors.length ? colors : llm.colors?.length ? llm.colors : (heur.colors ?? []),
    fonts: { heading: llm.fonts?.heading ?? heur.fonts?.heading, body: llm.fonts?.body ?? heur.fonts?.body },
    source: "manual",
    ...(input.origin && { origin: input.origin }),
  };
  const id = nanoid(10);
  const now = Date.now();
  db()
    .prepare("INSERT INTO brand_kits (id, name, website, status, progress_json, kit_json, chat_json, created_at, updated_at) VALUES (?, ?, NULL, 'ready', NULL, ?, '[]', ?, ?)")
    .run(id, kit.name.trim() || "My brand", JSON.stringify(kit), now, now);
  return getBrand(id)!;
}

/** Edits from the review form: only known fields, cleaned and capped. */
export function updateBrand(id: string, patch: Partial<BrandKitFields>): BrandKit | null {
  const kit = storedKit(id);
  if (!kit) return null;
  const next: StoredKit = { ...kit };
  if (patch.name !== undefined) next.name = clean(patch.name, 80);
  if (patch.website !== undefined) next.website = patch.website ? (normalizeWebsite(patch.website) ?? kit.website) : undefined;
  if (patch.logo !== undefined) next.logo = patch.logo && patch.logo.startsWith("/api/files/") ? patch.logo : undefined;
  if (patch.tagline !== undefined) next.tagline = clean(patch.tagline, 140);
  if (patch.overview !== undefined) next.overview = clean(patch.overview, 1200);
  if (patch.audience !== undefined) next.audience = clean(patch.audience, 300);
  if (patch.language !== undefined) next.language = matchLanguage(patch.language) ?? kit.language;
  if (patch.colors) next.colors = patch.colors.map((c) => normalizeColor(c)).filter((c): c is string => !!c).slice(0, 8);
  if (patch.fonts) next.fonts = { heading: clean(patch.fonts.heading, 60) || undefined, body: clean(patch.fonts.body, 60) || undefined };
  if (patch.values) next.values = list(patch.values, 8);
  if (patch.aesthetics) next.aesthetics = list(patch.aesthetics, 8);
  if (patch.tone) next.tone = list(patch.tone, 8, 40);
  if (patch.sellingPoints) next.sellingPoints = list(patch.sellingPoints, MAX_SELLING_POINTS, 120);
  if (patch.competitors) next.competitors = list(patch.competitors, 8, 60);
  if (patch.details) next.details = list(patch.details, 12, 300);
  if (patch.images) next.images = patch.images.filter((u) => u.startsWith("/api/files/")).slice(0, 12);
  if (patch.socials) next.socials = patch.socials.map((s) => socialOf(s.url) ?? (s.network && s.url ? { network: clean(s.network, 20), url: clean(s.url, 300) } : null)).filter((s): s is BrandSocial => !!s).slice(0, 11);
  writeKit(id, next);
  return getBrand(id);
}

/** "“{name}” leaves the shelf with its kit and its products. Ads already made with it stay" (in the Library). */
export function deleteBrand(id: string): boolean {
  runs().get(id)?.abort();
  runs().delete(id);
  const r = db().transaction(() => {
    db().prepare("DELETE FROM products WHERE brand_id = ?").run(id);
    db().prepare("DELETE FROM ad_creatives WHERE brand_id = ?").run(id);
    db().prepare("DELETE FROM ad_batches WHERE brand_id = ?").run(id);
    return db().prepare("DELETE FROM brand_kits WHERE id = ?").run(id);
  })();
  return r.changes > 0;
}

// ---------------------------------------------------------------------------
// Products

export function listProducts(brandId?: string | null): Product[] {
  const rows =
    brandId === undefined
      ? db().prepare("SELECT * FROM products ORDER BY created_at DESC").all()
      : brandId === null
        ? db().prepare("SELECT * FROM products WHERE brand_id IS NULL ORDER BY created_at DESC").all()
        : db().prepare("SELECT * FROM products WHERE brand_id = ? ORDER BY created_at ASC").all(brandId);
  return (rows as ProductRow[]).map(toProduct);
}

export function getProduct(id: string): Product | null {
  const r = db().prepare("SELECT * FROM products WHERE id = ?").get(id) as ProductRow | undefined;
  return r ? toProduct(r) : null;
}

export interface ProductInput {
  name: string;
  brandId?: string | null;
  description?: string;
  price?: number | null;
  currency?: string | null;
  audience?: string;
  sellingPoints?: string[];
  url?: string;
  images?: string[];
}

function insertProduct(p: Omit<ProductDraft, "images"> & { sellingPoints?: string[]; audience?: string }, brandId: string | null, images: string[]): Product {
  const id = nanoid(10);
  const now = Date.now();
  db()
    .prepare(
      "INSERT INTO products (id, brand_id, name, description, price, currency, audience, selling_points_json, url, images_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      brandId,
      clean(p.name, 140) || "Untitled product",
      cleanLines(p.description, 2000) || null,
      p.price ?? null,
      p.currency ? clean(p.currency, 8) : null,
      clean(p.audience, 300) || null,
      JSON.stringify(list(p.sellingPoints ?? [], MAX_SELLING_POINTS, 120)),
      p.url ?? null,
      JSON.stringify(images.slice(0, MAX_PRODUCT_IMAGES)),
      now,
      now,
    );
  return getProduct(id)!;
}

/** A product from the form ("Product name" is required; up to five selling points). */
export const ProductFields = z.object({
  name: z.string().trim().min(1, "Give the product a name").max(140),
  brandId: z.string().max(40).nullish(),
  description: z.string().max(4000).optional(),
  price: z.number().nullish(),
  currency: z.string().max(8).nullish(),
  audience: z.string().max(400).optional(),
  sellingPoints: z.array(z.string().max(200)).max(5, "Add up to five selling points.").optional(),
  url: z.string().max(600).optional(),
  images: z.array(z.string().startsWith("/api/files/")).max(8).optional(),
});

export class DuplicateProductError extends Error {
  override name = "DuplicateProductError";
}

export function createProduct(input: ProductInput, opts: { force?: boolean } = {}): Product {
  const name = clean(input.name, 140);
  if (!name) throw new Error("Give the product a name");
  if (input.price != null && input.price < 0) throw new Error("Price cannot be negative.");
  if (input.url && !normalizeWebsite(input.url)) throw new Error("Use a valid product link.");
  if (input.brandId && !getBrand(input.brandId)) throw new Error("That brand no longer exists");
  if (!opts.force && input.brandId && listProducts(input.brandId).some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new DuplicateProductError(`«${name}» is already among this brand's products.`);
  }
  return insertProduct({ ...input, name, url: input.url ? (normalizeWebsite(input.url) ?? undefined) : undefined }, input.brandId ?? null, (input.images ?? []).filter((u) => u.startsWith("/api/files/")));
}

export function updateProduct(id: string, patch: Partial<ProductInput>): Product | null {
  const p = getProduct(id);
  if (!p) return null;
  if (patch.price != null && patch.price < 0) throw new Error("Price cannot be negative.");
  if (patch.url && !normalizeWebsite(patch.url)) throw new Error("Use a valid product link.");
  if (patch.brandId && !getBrand(patch.brandId)) throw new Error("That brand no longer exists");
  const next = {
    brand_id: patch.brandId !== undefined ? patch.brandId : p.brandId,
    name: patch.name !== undefined ? clean(patch.name, 140) || p.name : p.name,
    description: patch.description !== undefined ? cleanLines(patch.description, 2000) || null : (p.description ?? null),
    price: patch.price !== undefined ? patch.price : (p.price ?? null),
    currency: patch.currency !== undefined ? (patch.currency ? clean(patch.currency, 8) : null) : (p.currency ?? null),
    audience: patch.audience !== undefined ? clean(patch.audience, 300) || null : (p.audience ?? null),
    selling_points_json: JSON.stringify(patch.sellingPoints ? list(patch.sellingPoints, MAX_SELLING_POINTS, 120) : p.sellingPoints),
    url: patch.url !== undefined ? (patch.url ? normalizeWebsite(patch.url) : null) : (p.url ?? null),
    images_json: JSON.stringify(patch.images ? patch.images.filter((u) => u.startsWith("/api/files/")).slice(0, MAX_PRODUCT_IMAGES) : p.images),
  };
  db()
    .prepare("UPDATE products SET brand_id = @brand_id, name = @name, description = @description, price = @price, currency = @currency, audience = @audience, selling_points_json = @selling_points_json, url = @url, images_json = @images_json, updated_at = @now WHERE id = @id")
    .run({ ...next, now: Date.now(), id });
  return getProduct(id);
}

export function deleteProduct(id: string): boolean {
  return db().prepare("DELETE FROM products WHERE id = ?").run(id).changes > 0;
}

declare global {
  var __fuobeLinkReads: Set<string> | undefined;
}
const reading = () => (globalThis.__fuobeLinkReads ??= new Set<string>());

export interface LinkRead {
  products: Product[];
  /** How many the page listed (a collection page lists many; only the first `limit` are added). */
  found: number;
  /** Already among the brand's products (nothing new added). */
  duplicate?: Product;
  /** Brand bits the page carries: Click to Ad's product kit shows the logo and colours. */
  brand: { name?: string; logo?: string; colors: string[]; fonts: { heading?: string; body?: string } };
  /** The brand kit the products were added to (the site's own kit when read with its brand). */
  brandId?: string;
  message?: string;
}

const siteHost = (url: string | undefined) => {
  try {
    return url ? new URL(url).host.replace(/^www\./, "").toLowerCase() : "";
  } catch {
    return "";
  }
};

/**
 * The brand kit for a product page's site: the kit whose website is on the same host (missing logo,
 * colours and fonts filled from the page), else a new ready kit made from what the page showed.
 */
export function kitForSite(pageUrl: string, bits: LinkRead["brand"]): BrandKit {
  const host = siteHost(pageUrl);
  const existing = listBrands().find((b) => b.status !== "researching" && siteHost(b.website) === host);
  if (existing) {
    const patch: Partial<BrandKitFields> = {};
    if (!existing.logo && bits.logo) patch.logo = bits.logo;
    if (!existing.colors.length && bits.colors.length) patch.colors = bits.colors;
    if (!existing.fonts.heading && !existing.fonts.body && (bits.fonts.heading || bits.fonts.body)) patch.fonts = bits.fonts;
    return Object.keys(patch).length ? (updateBrand(existing.id, patch) ?? existing) : existing;
  }
  const website = new URL(pageUrl).origin + "/";
  const name = clean(bits.name, 80) || hostName(host);
  const kit: StoredKit = {
    ...emptyKit(name),
    website,
    logo: bits.logo,
    colors: bits.colors.filter(isHex).slice(0, 8),
    fonts: { heading: bits.fonts.heading, body: bits.fonts.body },
    source: "website",
    note: `Made from a product page on ${host}. Run the research for the rest of the brand kit (tone, audience, values…).`,
  };
  const id = nanoid(10);
  const now = Date.now();
  db()
    .prepare("INSERT INTO brand_kits (id, name, website, status, progress_json, kit_json, chat_json, created_at, updated_at) VALUES (?, ?, ?, 'ready', NULL, ?, '[]', ?, ?)")
    .run(id, name, website, JSON.stringify(kit), now, now);
  return getBrand(id)!;
}

/** What Click to Ad shows for a kit: its own logo, colours and fonts, else the page's. */
const kitBits = (kit: BrandKit, page: LinkRead["brand"]): LinkRead["brand"] => ({
  name: kit.name,
  logo: kit.logo ?? page.logo,
  colors: kit.colors.length ? kit.colors : page.colors,
  fonts: kit.fonts.heading || kit.fonts.body ? kit.fonts : page.fonts,
});

/**
 * Add products from a link ("Add product from link", Click to Ad): Shopify's product JSON when the
 * store is Shopify, else JSON-LD / OpenGraph on the page. Images are downloaded into the library.
 */
export async function readProductLink(input: { url: string; brandId?: string | null; limit?: number; withBrand?: boolean }): Promise<LinkRead> {
  const url = normalizeWebsite(input.url);
  if (!url) throw new Error("Use a valid product link.");
  if (reading().has(url)) throw new Error("That link is already being read.");
  const brandId = input.brandId ?? null;
  if (brandId) {
    const dup = listProducts(brandId).find((p) => p.url === url);
    if (dup) return { products: [], found: 1, duplicate: dup, brand: { colors: [], fonts: {} }, message: `«${dup.name}» is already among this brand's products.` };
  }
  reading().add(url);
  try {
    const page = await fetchText(url, 6 * 1024 * 1024, 25_000);
    if (!page) throw new Error(`${new URL(url).hostname} couldn't be read`);
    let drafts = productsFromPage(page.text, page.url);
    if (isShopify(page.text) && /\/products\//.test(new URL(page.url).pathname)) {
      const j = await fetchText(`${page.url.split(/[?#]/)[0].replace(/\/+$/, "")}.json`, 3 * 1024 * 1024, 12_000);
      const shop = j ? shopifyProducts(parseJsonSafe(j.text), new URL(page.url).origin) : [];
      if (shop.length) drafts = shop.map((p) => ({ ...p, url: page.url }));
    }
    if (!drafts.length) throw new Error("Paste the product's link — a description alone is not enough.");
    const limit = Math.max(1, input.limit ?? 1);
    const facts = input.withBrand ? parseSite(page.text, page.url) : null;
    // The page's brand bits (Click to Ad's product kit), read before the products so they can join that brand's kit.
    let brand: LinkRead["brand"] = { colors: [], fonts: {} };
    if (facts) {
      const sheets = (await pool(facts.stylesheets.slice(0, 3), 3, (s) => fetchText(s, 2 * 1024 * 1024, 10_000))).filter((x): x is NonNullable<typeof x> => !!x).map((x) => x.text);
      const css = [...facts.inlineCss, ...sheets];
      const logo = facts.svgLogo
        ? saveFile({ data: Buffer.from(facts.svgLogo), contentType: "image/svg+xml", name: `${facts.host}-logo.svg`, source: "upload" }).url
        : await firstSaved(facts.logos, { allowSvg: true, minBytes: 300 });
      const f = extractFonts(page.text, css);
      // A product page's title is the product ("Dew Theory Barrier Cream – 50 ml"): the product's own brand names the kit first.
      const productBrand = drafts.find((d) => d.brand)?.brand;
      brand = { name: facts.organization?.name ?? productBrand ?? facts.name, logo: logo ?? undefined, colors: extractColors(css, facts.themeColor), fonts: { heading: f.heading, body: f.body } };
    }
    // A product read with its brand (and no brand chosen) joins the kit for that site, made now if there's none,
    // so the logo and colours stay with the product and reach every flow that uses it.
    const kit = facts && !brandId ? kitForSite(page.url, brand) : null;
    const owner = brandId ?? kit?.id ?? null;
    if (kit) {
      const dup = listProducts(kit.id).find((p) => p.url === url || p.url === page.url);
      if (dup) return { products: [], found: 1, duplicate: dup, brand: kitBits(kit, brand), brandId: kit.id, message: `«${dup.name}» is already among ${kit.name}'s products.` };
    }
    const llm = softFieldsFrom(
      parseJsonObject(
        await llmText(
          `You write short product facts for ads. Answer with ONE JSON object: {"products":[{"name": string, "audience": string (one sentence), "sellingPoints": string[] (3–5 short reasons to buy)}]} for the products given, same names. Use only what the text says or clearly implies.`,
          drafts
            .slice(0, limit)
            .map((p) => `${p.name}: ${(p.description ?? "").slice(0, 800)}`)
            .join("\n"),
          { json: PRODUCTS_SCHEMA },
        ),
      ),
    );
    const products: Product[] = [];
    for (const d of drafts.slice(0, limit)) {
      const soft = llm.products?.find((x) => x.name.toLowerCase() === d.name.toLowerCase());
      const pics = (await pool(d.images.slice(0, 5), 4, (u) => saveRemoteImage(u))).filter((x): x is string => !!x);
      products.push(insertProduct({ ...d, audience: soft?.audience, sellingPoints: soft?.sellingPoints?.length ? soft.sellingPoints : sellingPointsFrom(d.description) }, owner, pics));
    }
    const found = drafts.length;
    return {
      products,
      found,
      brand: kit ? kitBits(getBrand(kit.id) ?? kit, brand) : brand,
      brandId: owner ?? undefined,
      message: found > products.length ? `Found ${found} products on that page and added the first ${products.length}. Paste a product's own link to add another.` : undefined,
    };
  } finally {
    reading().delete(url);
  }
}
