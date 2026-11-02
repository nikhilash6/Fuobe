/**
 * The ready-made starters of Faceless Studio, Content Factory, Explainer, Ads Studio, Click to Ad and Marketing Studio
 * (Canvas's are its templates: src/lib/catalog/canvas.ts). Server only: a page gets its few slim cards
 * (starterCards), and the words, settings and sample files stay here. What the owner's "Use template" makes is in
 * src/server/starters.ts.
 *
 * Built once, when the module loads: a starter that names a style, a preset, a template or a sample file that isn't
 * there throws, so the build fails rather than a page (tests/starters-catalog.test.ts checks the same and more).
 */
import "server-only";
import { getPreset } from "@/lib/catalog";
import { CF_LENGTH_VALUES, getPreset as getCfPreset } from "@/lib/catalog/content-factory";
import { EXPLAINER_STYLE_IDS, FACELESS_LENGTHS, FACELESS_STYLE_IDS, GENRES, type FacelessGenre } from "@/lib/catalog/faceless";
import { TEMPLATE_INDEX } from "@/lib/catalog/marketing";
import { exampleSurfaceOf } from "@/lib/examples/catalog";
import { EXAMPLE_MEDIA } from "@/lib/examples/media.generated";
import { presetCover } from "@/lib/preset-covers";
import { thumbOf } from "@/lib/preset-cards";
import { PRESET_PEAKS } from "@/lib/preset-peaks.generated";
import { templateCover, type TemplateCover } from "@/lib/template-covers";
import { AD_STARTERS } from "./ads";
import { CONTENT_FACTORY_STARTERS } from "./content-factory";
import { EXPLAINER_STARTERS } from "./explainer";
import { FACELESS_STARTERS } from "./faceless";
import type { StarterCardData, StarterFill, StarterInput, StarterSurface } from "./types";

/** A sample file a starter brings: a published example input (src/lib/examples/media.generated.ts). */
export interface StarterSample {
  src: string;
  name: string;
}

/** A brand kit with one product and its photo (Ads Studio, Click to Ad, Marketing Studio share them by name). */
export interface StarterProduct {
  brand: { name: string; description: string; colors: string[] };
  product: { name: string; description: string; sellingPoints: string[]; price: number; currency: string; image: StarterSample };
}

/** What the owner's tap makes or fills. */
export type StarterSeed =
  | { kind: "faceless"; channel: { idea: string; genre: FacelessGenre; name: string }; episode: { topic: string; styleId: string; length: number } }
  | { kind: "fill"; fill: StarterFill }
  | { kind: "product"; kit: StarterProduct; open: { to: "brand" } | { to: "click-to-ad" } | { to: "marketing"; template: string } };

export interface Starter {
  id: string;
  surface: StarterSurface;
  /** Ascending inside its surface: the most premium first. */
  rank: number;
  name: string;
  description: string;
  icon: string;
  hue: number;
  flow: string[];
  steps: string[];
  makes: string;
  /** The words that go in, shown on its page (a photo is added from the seed's sample). */
  words: { label: string; text: string }[];
  /** Until its own cover (starters/<id>) is made: a published preset cover that shows the same product. */
  coverFrom?: string;
  /**
   * The app that makes the same thing from the same photo, with that example loaded (`/apps/<app>?example=<example>`):
   * where a guest or an account goes from the starter's page, and the "More to try" tile its studio leaves out.
   */
  tryIn?: { app: string; example: string };
  seed: StarterSeed;
}

// ---------------------------------------------------------------------------
// The starters, one file per studio

export const STARTERS: Starter[] = [...FACELESS_STARTERS, ...CONTENT_FACTORY_STARTERS, ...EXPLAINER_STARTERS, ...AD_STARTERS];

// ---------------------------------------------------------------------------
// Checks, once, when the module loads

export function assertStarters(list: Starter[] = STARTERS): void {
  const ids = new Set<string>();
  for (const s of list) {
    if (ids.has(s.id)) throw new Error(`Starter ${s.id}: listed twice`);
    ids.add(s.id);
    if (!/^[a-z0-9]+\.[a-z0-9-]+$/.test(s.id)) throw new Error(`Starter ${s.id}: an id is <surface>.<slug>`);
    const seed = s.seed;
    if (seed.kind === "faceless") {
      if (!GENRES.some((g) => g.id === seed.channel.genre)) throw new Error(`Starter ${s.id}: no genre ${seed.channel.genre}`);
      if (!FACELESS_STYLE_IDS.includes(seed.episode.styleId)) throw new Error(`Starter ${s.id}: no Faceless style ${seed.episode.styleId}`);
      if (!FACELESS_LENGTHS.includes(seed.episode.length)) throw new Error(`Starter ${s.id}: ${seed.episode.length} s isn't a Faceless length`);
    } else if (seed.kind === "fill") {
      const f = seed.fill;
      if (f.kind === "content-factory") {
        if (!getCfPreset(f.presetId)) throw new Error(`Starter ${s.id}: no Content Factory preset ${f.presetId}`);
        if (!CF_LENGTH_VALUES.includes(f.length)) throw new Error(`Starter ${s.id}: ${f.length} s isn't a Content Factory length`);
      } else if (!EXPLAINER_STYLE_IDS.includes(f.styleId)) throw new Error(`Starter ${s.id}: no Explainer style ${f.styleId}`);
    } else {
      if (!EXAMPLE_MEDIA[seed.kit.product.image.src]) throw new Error(`Starter ${s.id}: ${seed.kit.product.image.src} isn't a published example file`);
      if (seed.open.to === "marketing" && !TEMPLATE_INDEX.get(seed.open.template)) throw new Error(`Starter ${s.id}: no Marketing template ${seed.open.template}`);
    }
    if (s.coverFrom && !presetCover(s.coverFrom)) throw new Error(`Starter ${s.id}: no preset cover ${s.coverFrom}`);
    if (s.tryIn) {
      if (!getPreset(s.tryIn.app)) throw new Error(`Starter ${s.id}: no app ${s.tryIn.app}`);
      if (exampleSurfaceOf(s.tryIn.example) !== `app:${s.tryIn.app}`) throw new Error(`Starter ${s.id}: ${s.tryIn.example} isn't an example of ${s.tryIn.app}`);
    }
  }
}

assertStarters();

// ---------------------------------------------------------------------------
// Cards and pages

export const getStarter = (id: string): Starter | undefined => STARTERS.find((s) => s.id === id);

/** A preset's cover as a starter's, resting on its peak frame (the finished shot) where it has one. */
function presetAsCover(id: string): TemplateCover | undefined {
  const c = presetCover(id);
  if (!c) return undefined;
  const peak = PRESET_PEAKS[id];
  const poster = peak && c.video ? `/previews/presets/peak/${id}.jpg?v=${peak.v}` : c.poster;
  const thumb = peak && c.video ? thumbOf(poster) : c.thumb;
  return { poster, thumb, ...(c.video && { video: c.video }), ...(peak && c.video && { at: peak.at }), frames: [{ src: poster, thumb }] };
}

/** A starter's real cover: its own (starters/<id>), else the preset cover that shows the same thing. */
export function starterCover(s: Pick<Starter, "id" | "coverFrom">): TemplateCover | undefined {
  return templateCover("starters", s.id) ?? (s.coverFrom ? presetAsCover(s.coverFrom) : undefined);
}

function inputs(s: Starter): StarterInput[] {
  const photo = s.seed.kind === "product" ? s.seed.kit.product.image : undefined;
  return [
    ...(photo ? [{ label: "Product photo", image: { thumb: EXAMPLE_MEDIA[photo.src]?.thumb ?? photo.src, name: photo.name } }] : []),
    ...s.words.map((w) => ({ label: w.label, text: w.text })),
  ];
}

export function starterCard(s: Starter): StarterCardData {
  const cover = starterCover(s);
  return {
    id: s.id,
    surface: s.surface,
    rank: s.rank,
    name: s.name,
    description: s.description,
    icon: s.icon,
    hue: s.hue,
    flow: s.flow,
    steps: s.steps,
    makes: s.makes,
    inputs: inputs(s),
    ...(cover && { cover }),
    coverKey: `starters/${s.id}`,
    ...(s.tryIn && {
      tryIn: { href: `/apps/${s.tryIn.app}?example=${encodeURIComponent(s.tryIn.example)}`, label: getPreset(s.tryIn.app)?.name ?? "the app", example: s.tryIn.example },
    }),
    use: s.seed.kind === "fill" ? { kind: "fill", href: `${s.surface === "content-factory" ? "/content-factory" : "/explainer"}?starter=${encodeURIComponent(s.id)}` } : { kind: "create" },
  };
}

/** A surface's starters as cards, covered first, then by rank (a visitor's list drops the ones with no cover). */
export function starterCards(surface: StarterSurface): StarterCardData[] {
  return STARTERS.filter((s) => s.surface === surface)
    .map(starterCard)
    .sort((a, b) => Number(!a.cover) - Number(!b.cover) || a.rank - b.rank);
}

/** The composers' fills of a surface, by starter id (small: the page gets them all). */
export function starterFills(surface: "content-factory" | "explainer"): Record<string, StarterFill> {
  return Object.fromEntries(STARTERS.flatMap((s) => (s.surface === surface && s.seed.kind === "fill" ? [[s.id, s.seed.fill] as const] : [])));
}

/** Every starter page of a surface, prerendered. */
export const starterIds = (surface: StarterSurface) => STARTERS.filter((s) => s.surface === surface).map((s) => s.id);

/** The starter a page shows, or undefined (not this surface's). */
export function starterOn(surface: StarterSurface, id: string): StarterCardData | undefined {
  const s = getStarter(id);
  return s && s.surface === surface ? starterCard(s) : undefined;
}

/** A Faceless starter's first episode topic, for its new channel's episode setup (`?starter=`). */
export function facelessTopic(id: string | undefined): string | undefined {
  const s = id ? getStarter(id) : undefined;
  return s?.seed.kind === "faceless" ? s.seed.episode.topic : undefined;
}
