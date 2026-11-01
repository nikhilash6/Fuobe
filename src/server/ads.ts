import "server-only";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  AD_ANGLES,
  AD_RATIOS,
  brandLine,
  MAX_ADS_PER_PRODUCT,
  MAX_PRODUCTS_PER_RUN,
  adVisualModel,
  MARKETING_IMAGE_MODEL,
  type AdConcept,
  type AdCreative,
  type BrandKit,
  type CreativeStatus,
  type Product,
} from "@/lib/catalog/marketing";
import type { Engine, Generation, GenerationRequest, OutputFile } from "@/lib/catalog/types";
import { getModel } from "@/lib/catalog";
import { getBrand, getProduct, listProducts, parseJsonObject } from "./brand";
import { db } from "./db";
import { llmText } from "./enhance";
import { createGenerations, getGeneration, previewGeneration, recordLocalGeneration } from "./generations";
import { llmBackends } from "./providers/llm";
import { engineMode } from "./settings";

/**
 * Ads Studio: brand → products → "How many ads?" → a grid that fills as ads render.
 * Each ad = a selling angle with headline, body copy and CTA (LLM, or rules offline) + one visual
 * from an image model (product photo as reference, no text in it). The finished creative is
 * composited in the browser (canvas) in 1:1, 4:5 and 9:16 with the brand's logo, colours and fonts.
 * Ads drawn whole in one call (words included) before build plan O7 stay as they were ("baked"); a retry makes
 * them the Fuobe way.
 */

export const BatchBody = z.object({
  brandId: z.string().min(1).max(40),
  engine: z.enum(["cloud", "open"]),
  items: z
    .array(z.object({ productId: z.string().min(1).max(40), count: z.number().int().min(1).max(MAX_ADS_PER_PRODUCT) }))
    .min(1)
    .max(MAX_PRODUCTS_PER_RUN),
  /** What the user asked for in the chat ("holiday setting for our winter sale"). */
  direction: z.string().max(1000).optional(),
  /** The visual model (AD_VISUAL_MODELS); Fuobe Marketing Image when left out or not offered on this engine. */
  modelId: z.string().max(80).optional(),
});
export type BatchInput = z.infer<typeof BatchBody>;

export class AdsError extends Error {}

// ---------------------------------------------------------------------------
// Copy

const COPY_SYSTEM = `You are a senior performance-marketing copywriter writing static social ads (Instagram, TikTok, Meta).
Answer with ONE JSON object and nothing else:
{"ads": [{"angle": string (one of the angle ids given), "headline": string (at most 7 words), "body": string (at most 20 words), "cta": string (1–3 words), "visual": string (one sentence describing the photo to shoot; it must contain no text, words or logos)}]}
Write exactly the number of ads asked for. Vary the angles, headlines and pictures; never repeat a headline. Use the brand's tone and language. No hashtags, no emojis, no quotation marks in headlines.`;

// The answers as JSON Schemas, for local models that decode to one; the prompts ask for the same JSON.
const objectOf = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const S = { type: "string" };
const copySchema = (count: number) => ({
  name: "ads",
  schema: objectOf({ ads: { type: "array", minItems: count, maxItems: count, items: objectOf({ angle: { type: "string", enum: AD_ANGLES.map((a) => a.id) }, headline: S, body: S, cta: S, visual: S }) } }),
});

const ctaFor: Record<string, string[]> = {
  benefit: ["Shop now", "Discover more"],
  "pain-point": ["Fix it today", "Try it"],
  "real-life": ["See how", "Shop now"],
  offer: ["Get the deal", "Claim offer"],
  material: ["See inside", "Learn more"],
  "how-to": ["Watch how", "Try it"],
  lifestyle: ["Discover", "Shop the look"],
  "social-proof": ["Read reviews", "Join them"],
  comparison: ["Switch today", "Compare now"],
};

const short = (s: string, words: number) => {
  const w = s.replace(/\s+/g, " ").trim().replace(/[.!\s]+$/, "").split(" ");
  return w.length <= words ? w.join(" ") : `${w.slice(0, words).join(" ")}`;
};

/** Ad concepts from facts alone (no LLM): one angle after another, headlines from selling points. */
export function heuristicConcepts(brand: Pick<BrandKit, "name" | "tagline" | "aesthetics" | "sellingPoints">, product: Pick<Product, "name" | "description" | "sellingPoints" | "price" | "currency">, count: number, direction?: string, offset = 0): AdConcept[] {
  const points = [...product.sellingPoints, ...brand.sellingPoints].filter(Boolean);
  const name = product.name;
  const price = product.price != null ? `${product.currency && product.currency.length <= 3 ? `${product.currency} ` : "$"}${product.price}` : null;
  const look = brand.aesthetics.slice(0, 2).join(", ");
  const dir = direction?.trim();
  const headlines: Record<string, (i: number) => string> = {
    benefit: (i) => short(points[i % Math.max(1, points.length)] ?? `Meet ${name}`, 7),
    "pain-point": () => `The fix you've been waiting for`,
    "real-life": () => `Made for your every day`,
    offer: () => (price ? `${name}, just ${price}` : `Treat yourself today`),
    material: () => `Only the good stuff inside`,
    "how-to": () => `Seconds to use. Days to love.`,
    lifestyle: () => short(brand.tagline || `Your new favourite moment`, 7),
    "social-proof": () => `Loved by thousands`,
    comparison: () => `Why people switch to ${short(name, 3)}`,
  };
  return Array.from({ length: count }, (_, k) => {
    const i = k + offset;
    const a = AD_ANGLES[i % AD_ANGLES.length];
    const body = points.length ? `${points[(i + 1) % points.length].replace(/[.\s]+$/, "")}.` : (product.description?.split(/(?<=[.!?])\s/)[0] ?? `${name} by ${brand.name}.`);
    return {
      angle: a.id,
      headline: headlines[a.id](i),
      body: short(body, 20) + (body.trim().endsWith(".") ? "" : "."),
      cta: ctaFor[a.id][Math.floor(i / AD_ANGLES.length) % 2],
      visual: [`${a.visual}: ${name}`, look && `${look} look`, dir].filter(Boolean).join(", "),
    };
  });
}

/** Validate an LLM's concepts; missing or broken ones are filled by the rules. */
export function conceptsFrom(text: string | null, fallback: AdConcept[]): AdConcept[] {
  const j = parseJsonObject(text);
  const raw = Array.isArray(j?.ads) ? (j!.ads as Record<string, unknown>[]) : [];
  const ids = new Set(AD_ANGLES.map((a) => a.id));
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim().slice(0, max) : "");
  return fallback.map((f, i) => {
    const r = raw[i];
    if (!r || typeof r !== "object") return f;
    const headline = s(r.headline, 90);
    const visual = s(r.visual, 400);
    if (!headline || !visual) return f;
    return { angle: ids.has(s(r.angle, 30)) ? s(r.angle, 30) : f.angle, headline, body: s(r.body, 220) || f.body, cta: s(r.cta, 30) || f.cta, visual };
  });
}

export async function writeConcepts(brand: BrandKit, product: Product, count: number, direction?: string, offset = 0): Promise<AdConcept[]> {
  const fallback = heuristicConcepts(brand, product, count, direction, offset);
  const user = [
    `Write ${count} ad concepts.`,
    `Brand: ${brand.name}${brand.tagline ? ` — ${brand.tagline}` : ""}`,
    brand.overview && `About the brand: ${brand.overview}`,
    brand.tone.length && `Tone of voice: ${brand.tone.join(", ")}`,
    brand.aesthetics.length && `Look and feel: ${brand.aesthetics.join(", ")}`,
    brand.audience && `Audience: ${brand.audience}`,
    `Product: ${product.name}${product.price != null ? ` (${product.price}${product.currency ? ` ${product.currency}` : ""})` : ""}`,
    product.description && `Product description: ${product.description.slice(0, 700)}`,
    product.sellingPoints.length && `Selling points: ${product.sellingPoints.join("; ")}`,
    product.audience && `Product audience: ${product.audience}`,
    `Angles (ids): ${AD_ANGLES.map((a) => `${a.id} = ${a.copy}`).join("; ")}`,
    direction && `The client asked for: ${direction}`,
    `Language: ${brand.language ?? "English"}`,
  ]
    .filter(Boolean)
    .join("\n");
  return conceptsFrom(await llmText(COPY_SYSTEM, user, { json: copySchema(count) }), fallback);
}

// ---------------------------------------------------------------------------
// Visual requests

const NO_TEXT = "No text, letters, words, logos or watermarks anywhere in the picture; leave calm space for a headline";

export function visualRequest(c: Pick<AdConcept, "visual" | "headline">, product: Product | null, brand: BrandKit, engine: Engine, asked?: string | null): GenerationRequest {
  const hero = product?.images[0];
  const modelId = adVisualModel(engine, asked);
  const model = getModel(modelId);
  const aspect = model?.options.aspectRatios?.includes("4:5") ? "4:5" : model?.options.aspectRatios?.includes("3:4") ? "3:4" : undefined;
  return {
    feature: "ads",
    modelId,
    // Fuobe Marketing Image runs on both engines: the batch's engine picks its half.
    ...(modelId === MARKETING_IMAGE_MODEL && { engine }),
    op: hero ? "edit" : "t2i",
    prompt: [
      `Advertising photograph: ${c.visual.replace(/[.\s]+$/, "")}`,
      hero && "Keep the product exactly as in the reference photo: shape, label, logo, text and colours",
      brandLine(brand),
      NO_TEXT,
    ]
      .filter(Boolean)
      .join(". ")
      .concat("."),
    inputs: hero ? { images: [hero] } : undefined,
    params: { aspectRatio: aspect, numOutputs: 1 },
    title: c.headline,
    batchTitle: `${brand.name} · ads`,
  };
}

// ---------------------------------------------------------------------------
// Batches

interface CreativeRow {
  id: string;
  batch_id: string;
  brand_id: string;
  product_id: string | null;
  position: number;
  status: CreativeStatus;
  angle: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  visual: string | null;
  generation_id: string | null;
  layout: string | null;
  meta_json: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface CreativeMeta {
  engine: Engine;
  modelId: string;
  /** "baked": drawn whole, words included, in one format by a one-shot ad model before build plan O7 (history). */
  route: "fuobe" | "baked";
  direction?: string;
  /** A baked ad's one format. */
  ratio?: string;
  /** Composited PNGs saved to the Library, by ratio. */
  saved?: Record<string, string>;
}

declare global {
  var __fuobeAdRuns: Set<string> | undefined;
}
const running = () => (globalThis.__fuobeAdRuns ??= new Set<string>());

export interface BatchEstimate {
  modelId: string;
  modelName: string;
  total: number;
  costUsd: number | null;
  perAd: number | null;
  demo: boolean;
  copyBy: "llm" | "rules";
}

/**
 * "Create N ads" with its price, before anything runs (the stepper shows it first). `draft` prices a
 * brand and product that don't exist yet (Assist, before its brand kit and product are saved).
 */
export function estimateBatch(input: BatchInput, draft?: { brand: BrandKit; product: Product | null }): BatchEstimate {
  const brand = draft?.brand ?? getBrand(input.brandId);
  if (!brand) throw new AdsError("That brand no longer exists");
  const total = input.items.reduce((n, i) => n + i.count, 0);
  const product = draft ? draft.product : getProduct(input.items[0].productId);
  const p = previewGeneration(visualRequest({ visual: "the product", headline: "Ad" }, product, brand, input.engine, input.modelId));
  let copy = 0;
  try {
    copy = previewGeneration({ feature: "ads", modelId: input.engine === "open" ? "oss-text-llm" : "text-llm", op: "write", prompt: "copy" }).costUsd ?? 0;
  } catch {
    copy = 0;
  }
  const perAd = p.costUsd;
  return {
    modelId: p.model.id,
    modelName: p.model.name,
    total,
    perAd,
    costUsd: perAd === null ? null : Math.round((perAd * total + copy * input.items.length) * 1000) / 1000,
    demo: p.demo,
    // Who writes the words: an LLM this install can reach (as llmText picks one), else the rules.
    copyBy: llmBackends({ endpoint: "claude" }).length ? "llm" : "rules",
  };
}

/** Words every ad of a batch uses as given (Assist: "Headline exactly …"), instead of the copywriter's. */
export interface FixedCopy {
  headline?: string;
  cta?: string;
}

/** Start a batch: creatives appear at once ("writing"), copy and visuals follow in the background. */
export function createBatch(input: BatchInput, fixed: FixedCopy = {}): { batchId: string; creatives: AdCreative[]; run: Promise<void> } {
  const mode = engineMode();
  if (mode !== "both" && mode !== input.engine) throw new AdsError(mode === "open" ? "This install is set to open source only (Settings → Engine mode)" : "This install is set to paid cloud APIs only (Settings → Engine mode)");
  const brand = getBrand(input.brandId);
  if (!brand) throw new AdsError("That brand no longer exists");
  if (brand.status === "researching") throw new AdsError("The brand research is still running");
  const products = input.items.map((i) => {
    const p = getProduct(i.productId);
    if (!p) throw new AdsError("This product is no longer available. Choose another one.");
    return { product: p, count: i.count };
  });
  const est = estimateBatch(input); // validates the model, engine mode and price now
  const route = "fuobe";
  const batchId = nanoid(10);
  const now = Date.now();
  db().prepare("INSERT INTO ad_batches (id, brand_id, engine, route, model_id, direction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(batchId, brand.id, input.engine, route, est.modelId, input.direction ?? null, now);
  const meta: CreativeMeta = { engine: input.engine, modelId: est.modelId, route, direction: input.direction };
  const insert = db().prepare(
    "INSERT INTO ad_creatives (id, batch_id, brand_id, product_id, position, status, generation_id, meta_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
  );
  const ids: { id: string; product: Product; index: number }[] = [];
  db().transaction(() => {
    let pos = 0;
    for (const { product, count } of products) {
      for (let k = 0; k < count; k++) {
        const id = nanoid(10);
        insert.run(id, batchId, brand.id, product.id, pos++, "writing", JSON.stringify(meta), now + pos, now + pos);
        ids.push({ id, product, index: k });
      }
    }
  })();
  running().add(batchId);
  const run = fillBatch(batchId, brand, ids, input, fixed).finally(() => running().delete(batchId));
  return { batchId, creatives: listCreatives({ brandId: brand.id, batchId }), run };
}

async function fillBatch(batchId: string, brand: BrandKit, ids: { id: string; product: Product; index: number }[], input: BatchInput, fixed: FixedCopy = {}): Promise<void> {
  const setGen = (id: string, g: Generation) => db().prepare("UPDATE ad_creatives SET generation_id = ?, status = 'queued', updated_at = ? WHERE id = ?").run(g.id, Date.now(), id);
  const fail = (id: string, error: string) => db().prepare("UPDATE ad_creatives SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(error, Date.now(), id);
  // Copy per product (one LLM call each), then one visual per ad.
  const byProduct = new Map<string, typeof ids>();
  for (const c of ids) byProduct.set(c.product.id, [...(byProduct.get(c.product.id) ?? []), c]);
  for (const list of byProduct.values()) {
    const product = list[0].product;
    let concepts: AdConcept[];
    try {
      concepts = await writeConcepts(brand, product, list.length, input.direction);
    } catch {
      concepts = heuristicConcepts(brand, product, list.length, input.direction);
    }
    const headline = fixed.headline?.trim().slice(0, 90);
    const cta = fixed.cta?.trim().slice(0, 30);
    list.forEach((c, i) => {
      const k = { ...concepts[i], ...(headline && { headline }), ...(cta && { cta }) };
      // A creative deleted meanwhile gets no visual.
      const ok = db()
        .prepare("UPDATE ad_creatives SET angle = ?, headline = ?, body = ?, cta = ?, visual = ?, status = 'queued', updated_at = ? WHERE id = ? AND status = 'writing'")
        .run(k.angle, k.headline, k.body, k.cta, k.visual, Date.now(), c.id).changes;
      if (!ok) return;
      try {
        setGen(c.id, createGenerations(visualRequest(k, product, brand, input.engine, input.modelId), { batchId })[0]);
      } catch (e) {
        fail(c.id, (e as Error).message);
      }
    });
  }
}

const parseMeta = (s: string | null): CreativeMeta => {
  try {
    return s ? (JSON.parse(s) as CreativeMeta) : { engine: "cloud", modelId: "", route: "fuobe" };
  } catch {
    return { engine: "cloud", modelId: "", route: "fuobe" };
  }
};

function statusFrom(r: CreativeRow, g: Generation | null): { status: CreativeStatus; error: string | null; image: string | null; costUsd: number | null } {
  if (!r.generation_id || r.status === "failed" || r.status === "writing") {
    return { status: r.status, error: r.error, image: null, costUsd: null };
  }
  if (!g) return { status: "failed", error: "Its picture was deleted", image: null, costUsd: null };
  const out = g.outputs.find((o: OutputFile) => o.kind === "image");
  const map: Record<Generation["status"], CreativeStatus> = { queued: "queued", running: "rendering", succeeded: "ready", failed: "failed", canceled: "canceled" };
  return { status: g.status === "succeeded" && !out ? "failed" : map[g.status], error: g.error ?? null, image: out?.url ?? null, costUsd: g.costUsd ?? null };
}

function toCreative(r: CreativeRow): AdCreative {
  const meta = parseMeta(r.meta_json);
  const g = r.generation_id ? getGeneration(r.generation_id, { includeDeleted: true }) : null;
  const s = statusFrom(r, g);
  return {
    id: r.id,
    batchId: r.batch_id,
    brandId: r.brand_id,
    productId: r.product_id,
    position: r.position,
    angle: r.angle ?? "",
    headline: r.headline ?? "",
    body: r.body ?? "",
    cta: r.cta ?? "",
    visual: r.visual ?? "",
    status: s.status,
    error: s.error,
    generationId: r.generation_id,
    image: s.image,
    baked: meta.route === "baked",
    ...(meta.route === "baked" && { ratio: (AD_RATIOS as readonly string[]).includes(meta.ratio ?? "") ? (meta.ratio as AdCreative["ratio"]) : "4:5" }),
    layout: r.layout,
    engine: meta.engine,
    modelId: meta.modelId,
    costUsd: s.costUsd,
    createdAt: r.created_at,
  };
}

/** Creatives whose copy step died with the server: settled as "Not made — the run ended early". */
function settle(rows: CreativeRow[]): CreativeRow[] {
  const now = Date.now();
  return rows.map((r) => {
    if (r.status !== "writing" || running().has(r.batch_id) || now - r.updated_at < 20_000) return r;
    const error = "Not made — the run ended early";
    db().prepare("UPDATE ad_creatives SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'writing'").run(error, now, r.id);
    return { ...r, status: "failed" as const, error };
  });
}

export function listCreatives(o: { brandId: string; batchId?: string; productId?: string; limit?: number }): AdCreative[] {
  const where = ["c.brand_id = ?"];
  const args: unknown[] = [o.brandId];
  if (o.batchId) {
    where.push("c.batch_id = ?");
    args.push(o.batchId);
  }
  if (o.productId) {
    where.push("c.product_id = ?");
    args.push(o.productId);
  }
  // Newest batch first; inside a batch, in the order the ads were asked for (product by product).
  const rows = db()
    .prepare(
      `SELECT c.* FROM ad_creatives c LEFT JOIN ad_batches b ON b.id = c.batch_id WHERE ${where.join(" AND ")} ORDER BY COALESCE(b.created_at, c.created_at) DESC, c.batch_id, c.position ASC LIMIT ?`,
    )
    .all(...args, Math.min(1000, o.limit ?? 400)) as CreativeRow[];
  return settle(rows).map(toCreative);
}

function getCreativeRow(id: string): CreativeRow | undefined {
  return db().prepare("SELECT * FROM ad_creatives WHERE id = ?").get(id) as CreativeRow | undefined;
}

export function getCreative(id: string): AdCreative | null {
  const r = getCreativeRow(id);
  return r ? toCreative(settle([r])[0]) : null;
}

export const CreativePatch = z.object({
  headline: z.string().max(140).optional(),
  body: z.string().max(400).optional(),
  cta: z.string().max(40).optional(),
  layout: z.enum(["overlay", "panel", "band", "frame"]).nullable().optional(),
});

export function updateCreative(id: string, patch: z.infer<typeof CreativePatch>): AdCreative | null {
  const r = getCreativeRow(id);
  if (!r) return null;
  db()
    .prepare("UPDATE ad_creatives SET headline = ?, body = ?, cta = ?, layout = ?, updated_at = ? WHERE id = ?")
    .run(patch.headline ?? r.headline, patch.body ?? r.body, patch.cta ?? r.cta, patch.layout === undefined ? r.layout : patch.layout, Date.now(), id);
  return getCreative(id);
}

export function deleteCreative(id: string): boolean {
  return db().prepare("DELETE FROM ad_creatives WHERE id = ?").run(id).changes > 0;
}

/** Make a failed or canceled ad again: new copy if it never got any, then a new visual. */
export async function retryCreative(id: string): Promise<AdCreative> {
  const r = getCreativeRow(id);
  if (!r) throw new AdsError("Not found");
  const brand = getBrand(r.brand_id);
  if (!brand) throw new AdsError("That brand no longer exists");
  const product = r.product_id ? getProduct(r.product_id) : null;
  const meta = parseMeta(r.meta_json);
  const mode = engineMode();
  if (mode !== "both" && mode !== meta.engine) throw new AdsError(`This ad was made on the ${meta.engine === "open" ? "open-source" : "cloud"} engine, which Settings has turned off`);
  // A baked ad (one drawn whole before build plan O7) is made again the Fuobe way: copy, a visual, your fonts.
  let concept: AdConcept = { angle: r.angle ?? "", headline: r.headline ?? "", body: r.body ?? "", cta: r.cta ?? "", visual: r.visual ?? "" };
  if (!concept.headline || !concept.visual) concept = (await writeConcepts(brand, product ?? fakeProduct(brand), 1, meta.direction, r.position))[0];
  // The batch's own visual model (a baked ad's one-shot model isn't one: Fuobe Marketing Image makes it).
  const g = createGenerations(visualRequest(concept, product, brand, meta.engine, meta.modelId), { batchId: r.batch_id })[0];
  const fresh: CreativeMeta = { ...meta, route: "fuobe", ratio: undefined };
  db()
    .prepare("UPDATE ad_creatives SET angle = ?, headline = ?, body = ?, cta = ?, visual = ?, meta_json = ? WHERE id = ?")
    .run(concept.angle, concept.headline, concept.body, concept.cta, concept.visual, JSON.stringify(fresh), id);
  db().prepare("UPDATE ad_creatives SET generation_id = ?, status = 'queued', error = NULL, updated_at = ? WHERE id = ?").run(g.id, Date.now(), id);
  return getCreative(id)!;
}

const fakeProduct = (brand: BrandKit): Product => ({ id: "", brandId: brand.id, name: brand.name, description: brand.overview, sellingPoints: brand.sellingPoints, images: [], createdAt: 0, updatedAt: 0 });

/** A composited creative (PNG uploaded by the browser) recorded in the Library. */
export function saveComposite(id: string, input: { url: string; ratio: string }): { generation: Generation; creative: AdCreative } {
  const r = getCreativeRow(id);
  if (!r) throw new AdsError("Not found");
  const c = toCreative(r);
  const generation = recordLocalGeneration({
    feature: "ads",
    modelId: "local-ad-compose",
    op: "edit",
    prompt: [c.headline, c.body, c.cta].filter(Boolean).join(" · ") || "Ad",
    inputs: c.image ? { images: [c.image] } : {},
    params: { aspectRatio: input.ratio },
    output: { url: input.url, kind: "image", contentType: "image/png" },
  });
  const meta = parseMeta(r.meta_json);
  meta.saved = { ...meta.saved, [input.ratio]: generation.id };
  db().prepare("UPDATE ad_creatives SET meta_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(meta), Date.now(), id);
  return { generation, creative: getCreative(id)! };
}

// ---------------------------------------------------------------------------
// Brand chat: "{name}, what ads should we make for {brand}?" — answers, and proposes runs to confirm

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  /** A run the assistant suggests; the user confirms it (it spends money). */
  proposal?: { items: { productId: string; count: number }[]; direction?: string } | null;
  /** The batch a confirmed proposal started. */
  batchId?: string;
}

const CHAT_SYSTEM = `You are the creative strategist for a brand inside an ad studio. You can make static image ads for its products.
Answer with ONE JSON object and nothing else:
{"reply": string (1–3 friendly sentences), "make": null or {"products": string[] (exact product names from the list; empty = all of them), "count": number (ads per product, 1–20), "direction": string (the creative direction in one sentence: theme, setting, offer, audience, language…)}}
Set "make" whenever the user asks for ads, variations, versions or changes to ads; otherwise answer the question and set "make" to null.`;

const CHAT_SCHEMA = {
  name: "reply",
  schema: objectOf({ reply: S, make: { anyOf: [{ type: "null" }, objectOf({ products: { type: "array", items: S }, count: { type: "integer" }, direction: S })] } }),
};

const mentionRe = (name: string) => new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s_]+")}`, "i");

/** Products named in a message with @ ("@Night Serum" or "@Night_Serum"), longest names first. */
export function mentionedProducts(text: string, products: Pick<Product, "id" | "name">[]): string[] {
  return [...products].sort((a, b) => b.name.length - a.name.length).filter((p) => mentionRe(p.name).test(text)).map((p) => p.id);
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
/** "2 ads", "three playful ad variations", "5 new versions": the number, the words between, the noun. */
const COUNT_RE = new RegExp(`\\b(\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})\\s+((?:[a-z'-]+\\s+){0,3}?)(?:new\\s+)?(?:ads?|variations?|versions?|creatives?)(?:\\s+(?:variations?|versions?|creatives?))?\\b`, "i");

/**
 * What to make from a message with no LLM: the count ("2 playful ads", "three ads"), the
 * @mentioned products, and the rest as the creative direction ("playful", "with a holiday theme").
 */
export function offlineProposal(text: string, products: Pick<Product, "id" | "name">[]): { count: number; productIds: string[]; direction: string } | null {
  if (!/\b(ads?|make|create|generate|variations?|versions?|more|another|locali[sz]e|change)\b/i.test(text)) return null;
  const m = COUNT_RE.exec(text);
  const n = m ? (NUMBER_WORDS[m[1].toLowerCase()] ?? parseInt(m[1], 10)) : 4;
  const count = Math.min(MAX_ADS_PER_PRODUCT, Math.max(1, n));
  const ids = mentionedProducts(text, products);
  // The direction keeps the describing words ("playful") and drops the count, the products and the verbs.
  let direction = m ? text.replace(m[0], m[2].replace(/\bads?\b/gi, "")) : text;
  for (const p of [...products].sort((a, b) => b.name.length - a.name.length)) direction = direction.replace(new RegExp(`(?:\\b(?:for|of|with|featuring)\\s+)?${mentionRe(p.name).source}`, "gi"), " ");
  direction = direction
    .replace(/\b(please|can you|could you|make|create|generate|write|me|some)\b/gi, " ")
    .replace(/\bfor (?:my|our|the|this) products?\b/gi, " ")
    // A stray "@" (or an @mention that names no product) is not part of the direction.
    .replace(/(?:\b(?:for|of|with|featuring)\s+)?(?<!\S)@\S*/gi, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // …nor a word left dangling once the products are gone ("playful for").
  for (let prev = ""; prev !== direction; ) {
    prev = direction;
    direction = direction
      .replace(/(?:^|\s+)(?:for|of|with|featuring|about|to|on|and|the|a|an)$/i, "")
      .replace(/^and\b\s*/i, "")
      .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "")
      .trim();
  }
  return { count, productIds: ids, direction };
}

interface BrandChatRow {
  chat_json: string;
}

export function getChat(brandId: string): ChatMessage[] {
  const r = db().prepare("SELECT chat_json FROM brand_kits WHERE id = ?").get(brandId) as BrandChatRow | undefined;
  try {
    return r ? (JSON.parse(r.chat_json) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveChat(brandId: string, chat: ChatMessage[]) {
  db().prepare("UPDATE brand_kits SET chat_json = ? WHERE id = ?").run(JSON.stringify(chat.slice(-60)), brandId);
}

export function clearChat(brandId: string) {
  saveChat(brandId, []);
}

export async function chat(brandId: string, text: string): Promise<ChatMessage[]> {
  const brand = getBrand(brandId);
  if (!brand) throw new AdsError("That brand no longer exists");
  const products = listProducts(brandId);
  const history = getChat(brandId);
  const userMsg: ChatMessage = { id: nanoid(8), role: "user", text: text.trim().slice(0, 2000), at: Date.now() };
  const context = [
    `Brand: ${brand.name}${brand.tagline ? ` — ${brand.tagline}` : ""}`,
    brand.overview && `About: ${brand.overview}`,
    brand.tone.length && `Tone: ${brand.tone.join(", ")}`,
    `Products: ${products.map((p) => p.name).join("; ") || "none yet"}`,
    history.length && `Conversation so far:\n${history.slice(-8).map((m) => `${m.role}: ${m.text}`).join("\n")}`,
    `User: ${userMsg.text}`,
  ]
    .filter(Boolean)
    .join("\n");
  const j = parseJsonObject(await llmText(CHAT_SYSTEM, context, { json: CHAT_SCHEMA }));
  let reply: ChatMessage;
  if (j && typeof j.reply === "string") {
    const make = j.make && typeof j.make === "object" ? (j.make as Record<string, unknown>) : null;
    const names = Array.isArray(make?.products) ? (make!.products as unknown[]).filter((x): x is string => typeof x === "string") : [];
    let ids = products.filter((p) => names.some((n) => n.toLowerCase() === p.name.toLowerCase())).map((p) => p.id);
    if (!ids.length) ids = mentionedProducts(userMsg.text, products);
    if (!ids.length) ids = products.slice(0, MAX_PRODUCTS_PER_RUN).map((p) => p.id);
    const count = Math.min(MAX_ADS_PER_PRODUCT, Math.max(1, Math.round(Number(make?.count) || 4)));
    reply = {
      id: nanoid(8),
      role: "assistant",
      text: j.reply.slice(0, 1200),
      at: Date.now(),
      proposal: make && ids.length ? { items: ids.map((productId) => ({ productId, count })), direction: typeof make.direction === "string" ? make.direction.slice(0, 600) : userMsg.text } : null,
    };
  } else {
    const p = offlineProposal(userMsg.text, products);
    const ids = p?.productIds.length ? p.productIds : products.slice(0, MAX_PRODUCTS_PER_RUN).map((x) => x.id);
    reply =
      p && ids.length
        ? {
            id: nanoid(8),
            role: "assistant",
            text: `Here's the plan: ${p.count} ad${p.count === 1 ? "" : "s"}${ids.length > 1 ? " each" : ""} for ${ids.map((id) => products.find((x) => x.id === id)?.name).join(", ")}${p.direction ? ` — ${p.direction.charAt(0).toLowerCase()}${p.direction.slice(1)}` : ""}. Create ${p.count * ids.length === 1 ? "it" : "them"}?`,
            at: Date.now(),
            proposal: { items: ids.map((productId) => ({ productId, count: p.count })), direction: p.direction || undefined },
          }
        : {
            id: nanoid(8),
            role: "assistant",
            text: products.length
              ? `I can make ads for you — try “Make 4 ads for @${products[0].name} with a holiday theme”. Connect Claude or a local model (Ollama, LM Studio or Unsloth Studio) in Settings and I can talk through ideas too.`
              : "Add a product first, then ask me for ads — e.g. “Make 4 ads with a summer theme”.",
            at: Date.now(),
            proposal: null,
          };
  }
  const next = [...history, userMsg, reply];
  saveChat(brandId, next);
  return next;
}

/** The user said yes to a proposal: run it and remember the batch on the message. */
export function confirmProposal(brandId: string, messageId: string, engine: Engine): { batchId: string; run: Promise<void>; chat: ChatMessage[] } {
  const history = getChat(brandId);
  const msg = history.find((m) => m.id === messageId);
  if (!msg?.proposal) throw new AdsError("That suggestion is no longer available");
  if (msg.batchId) throw new AdsError("Those ads are already on their way");
  const r = createBatch({ brandId, engine, items: msg.proposal.items, direction: msg.proposal.direction });
  const next = history.map((m) => (m.id === messageId ? { ...m, batchId: r.batchId } : m));
  saveChat(brandId, next);
  return { batchId: r.batchId, run: r.run, chat: next };
}
