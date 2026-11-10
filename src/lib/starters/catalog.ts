/**
 * The ready-made starters of Assist, the Library, Cinema Studio, Storyboard, Elements, Faceless Studio, Content Factory,
 * Explainer, Ads Studio, Click to Ad and Marketing Studio (Canvas's are its templates: src/lib/catalog/canvas.ts). Server only: a page gets its few slim cards
 * (starterCards), and the words, settings and sample files stay here. What the owner's "Use template" makes is in
 * src/server/starters.ts.
 *
 * Built once, when the module loads: a starter that names a style, a preset, a template or a sample file that isn't
 * there throws, so the build fails rather than a page (tests/starters-catalog.test.ts checks the same and more).
 */
import "server-only";
import { getPreset } from "@/lib/catalog";
import { ASSIST_PROMPT_MAX } from "@/lib/assist";
import { getTemplate } from "@/lib/catalog/canvas";
import { CAMERA_MOVES, type DirectorSettings, type DirectorShot } from "@/lib/catalog/cinema";
import { ELEMENT_KINDS, MAX_ELEMENT_PHOTOS, type ElementKind } from "@/lib/catalog/elements";
import { MAX_FRAMES, STORYBOARD_ASPECTS } from "@/lib/catalog/storyboard";
import { CF_LENGTH_VALUES, getPreset as getCfPreset } from "@/lib/catalog/content-factory";
import { EXPLAINER_STYLE_IDS, FACELESS_LENGTHS, FACELESS_STYLE_IDS, GENRES, type FacelessGenre } from "@/lib/catalog/faceless";
import { TEMPLATE_INDEX } from "@/lib/catalog/marketing";
import { exampleById, exampleSurfaceOf } from "@/lib/examples/catalog";
import { EXAMPLE_MEDIA } from "@/lib/examples/media.generated";
import { presetCover } from "@/lib/preset-covers";
import { thumbOf } from "@/lib/preset-cards";
import { PRESET_PEAKS } from "@/lib/preset-peaks.generated";
import { TEMPLATE_GROUPS, templateCover, type TemplateCover, type TemplateGroup } from "@/lib/template-covers";
import { AD_STARTERS } from "./ads";
import { ASSIST_STARTERS } from "./assist";
import { CINEMA_STARTERS } from "./cinema";
import { CONTENT_FACTORY_STARTERS } from "./content-factory";
import { ELEMENT_STARTERS } from "./elements";
import { EXPLAINER_STARTERS } from "./explainer";
import { FACELESS_STARTERS } from "./faceless";
import { LIBRARY_STARTERS } from "./library";
import { STORYBOARD_STARTERS } from "./storyboard";
import { cinemaLook, storyboardLook } from "./look";
import { STARTER_SURFACES, type StarterCardData, type StarterFill, type StarterInput, type StarterLookItem, type StarterSurface } from "./types";

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

/**
 * A cover borrowed until the starter's own (starters/<id>) is made: another tile's ("<group>/<id>" in the covers
 * manifest), an example's result, or the starter's own published pictures side by side (an element's).
 */
export type StarterCoverRef = { template: string } | { example: string } | { files: string[] };

/** What the owner's tap makes or fills. */
export type StarterSeed =
  /** Assist: the composer gets "/skill words" (nothing is sent). */
  | { kind: "assist"; skill?: string; prompt: string }
  /** The Library's row: another studio's page with its example or starter loaded, for everyone. */
  | { kind: "link"; href: string; ownerHref?: string }
  /** Cinema Studio: a project with its look, its brief and the Director's shots, opened with shot 1 in the prompt bar. */
  | { kind: "cinema"; project: { name: string; description: string }; director: DirectorSettings; brief: { title: string; body: string }; shots: DirectorShot[] }
  /** Storyboard: the composer's story, frame count, shape and look. */
  | { kind: "storyboard"; story: string; frames: number; aspectRatio: string; look?: string }
  /** Elements: a saved element made from the starter's own files (`samples`). */
  | { kind: "element"; element: { name: string; kind: ElementKind; description: string } }
  | { kind: "faceless"; channel: { idea: string; genre: FacelessGenre; name: string }; episode: { topic: string; styleId: string; length: number } }
  | { kind: "fill"; fill: Extract<StarterFill, { kind: "content-factory" | "explainer" }> }
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
  /** Or another published cover that shows the same thing (see StarterCoverRef). */
  coverOf?: StarterCoverRef;
  /** Published files it starts with (an element's pictures or recording), shown on its page and stored on the owner's tap. */
  samples?: { label: string; src: string }[];
  /**
   * The app (or the Video studio's effect or camera move) that makes the same thing from the same photo, with that
   * example loaded (`/apps/<app>?example=<example>`, `/video?preset=<id>&example=<example>`): where a guest or an
   * account goes from the starter's page, and the "More to try" tile its studio leaves out.
   */
  tryIn?: { app: string; example: string };
  seed: StarterSeed;
}

// ---------------------------------------------------------------------------
// The starters, one file per studio

export const STARTERS: Starter[] = [
  ...ASSIST_STARTERS,
  ...LIBRARY_STARTERS,
  ...CINEMA_STARTERS,
  ...STORYBOARD_STARTERS,
  ...ELEMENT_STARTERS,
  ...FACELESS_STARTERS,
  ...CONTENT_FACTORY_STARTERS,
  ...EXPLAINER_STARTERS,
  ...AD_STARTERS,
];

/** The skills Assist's starters may name: built-in ones (tests/starters-studios.test.ts checks each is there). */
export const ASSIST_STARTER_SKILLS = ["short-film", "faceless-video", "visual-studio"] as const;

/**
 * Skills that start from the person's own photo (a product's, a creator's) and ask for one when none is attached: a
 * starter types words only, so it never names one of these (tests/starters-studios.test.ts reads each SKILL.md).
 */
export const PHOTO_SKILLS = ["product-photoshoot", "ugc-video"] as const;

/** A starter's published file: an example input, or one of Fuobe's samples. */
const published = (src: string) => (src.startsWith("/examples/") ? EXAMPLE_MEDIA[src]?.role === "in" : /^\/samples\/[a-z0-9-]+\/[a-z0-9.-]+$/.test(src));

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
    } else if (seed.kind === "assist") {
      if (seed.skill && (PHOTO_SKILLS as readonly string[]).includes(seed.skill)) throw new Error(`Starter ${s.id}: ${seed.skill} asks for the person's own photo`);
      if (seed.skill && !(ASSIST_STARTER_SKILLS as readonly string[]).includes(seed.skill)) throw new Error(`Starter ${s.id}: no Assist skill ${seed.skill}`);
      if (`/${seed.skill ?? ""} ${seed.prompt}`.length > ASSIST_PROMPT_MAX) throw new Error(`Starter ${s.id}: its words are too long for Assist`);
    } else if (seed.kind === "link") {
      for (const href of [seed.href, ...(seed.ownerHref ? [seed.ownerHref] : [])]) {
        const canvas = /^\/canvas\/start\/([a-z0-9-]+)$/.exec(href);
        const example = /[?&]example=([^&]+)/.exec(href);
        const starter = /[?&]starter=([^&]+)/.exec(href);
        const preset = /[?&]preset=([^&]+)/.exec(href);
        if (canvas && !getTemplate(canvas[1])) throw new Error(`Starter ${s.id}: no Canvas template ${canvas[1]}`);
        if (example && !exampleById(decodeURIComponent(example[1]))) throw new Error(`Starter ${s.id}: no example ${example[1]}`);
        if (preset && !getPreset(decodeURIComponent(preset[1]))) throw new Error(`Starter ${s.id}: no preset ${preset[1]}`);
        if (starter && !list.some((x) => x.id === decodeURIComponent(starter[1]))) throw new Error(`Starter ${s.id}: no starter ${starter[1]}`);
        if (!canvas && !example && !starter) throw new Error(`Starter ${s.id}: a link opens a ready board, an example or a starter`);
      }
    } else if (seed.kind === "cinema") {
      if (seed.shots.length < 2 || seed.shots.length > 6) throw new Error(`Starter ${s.id}: a film has 2 to 6 shots`);
      for (const shot of seed.shots) for (const m of shot.moves ?? []) if (!CAMERA_MOVES.some((c) => c.slug === m)) throw new Error(`Starter ${s.id}: no camera move ${m}`);
    } else if (seed.kind === "storyboard") {
      if (seed.frames < 2 || seed.frames > MAX_FRAMES) throw new Error(`Starter ${s.id}: ${seed.frames} frames`);
      if (!(STORYBOARD_ASPECTS as readonly string[]).includes(seed.aspectRatio)) throw new Error(`Starter ${s.id}: no Storyboard shape ${seed.aspectRatio}`);
    } else if (seed.kind === "element") {
      if (!ELEMENT_KINDS.some((k) => k.kind === seed.element.kind)) throw new Error(`Starter ${s.id}: no element kind ${seed.element.kind}`);
      const files = s.samples ?? [];
      if (!files.length || files.length > MAX_ELEMENT_PHOTOS) throw new Error(`Starter ${s.id}: an element starts with 1 to ${MAX_ELEMENT_PHOTOS} files`);
    } else {
      if (!EXAMPLE_MEDIA[seed.kit.product.image.src]) throw new Error(`Starter ${s.id}: ${seed.kit.product.image.src} isn't a published example file`);
      if (seed.open.to === "marketing" && !TEMPLATE_INDEX.get(seed.open.template)) throw new Error(`Starter ${s.id}: no Marketing template ${seed.open.template}`);
    }
    if (s.coverFrom && (!presetCover(s.coverFrom) || !PRESET_PEAKS[s.coverFrom])) throw new Error(`Starter ${s.id}: no preset cover with a finished frame ${s.coverFrom}`);
    for (const f of s.samples ?? []) if (!published(f.src)) throw new Error(`Starter ${s.id}: ${f.src} isn't a published example input or sample`);
    const ref = s.coverOf;
    if (ref && "template" in ref && !TEMPLATE_GROUPS.includes(ref.template.split("/")[0] as TemplateGroup)) throw new Error(`Starter ${s.id}: no cover group in ${ref.template}`);
    if (ref && "example" in ref && !exampleById(ref.example)) throw new Error(`Starter ${s.id}: no example ${ref.example}`);
    if (ref && "files" in ref && ref.files.some((f) => !EXAMPLE_MEDIA[f])) throw new Error(`Starter ${s.id}: a cover file isn't a published example file`);
    if (s.tryIn) {
      if (!getPreset(s.tryIn.app)) throw new Error(`Starter ${s.id}: no app ${s.tryIn.app}`);
      const of = exampleSurfaceOf(s.tryIn.example);
      if (of !== `app:${s.tryIn.app}` && of !== `preset:${s.tryIn.app}`) throw new Error(`Starter ${s.id}: ${s.tryIn.example} isn't an example of ${s.tryIn.app}`);
    }
  }
}

assertStarters();

// ---------------------------------------------------------------------------
// Cards and pages

export const getStarter = (id: string): Starter | undefined => STARTERS.find((s) => s.id === id);

/**
 * A preset's cover as a starter's: its peak frame alone (the finished shot), never its clip. The clip is the app's
 * before → after reveal, which opens on the plain photo and wipes across it: a starter shows what it makes.
 */
function presetAsCover(id: string): TemplateCover | undefined {
  const c = presetCover(id);
  const peak = PRESET_PEAKS[id];
  if (!c || !peak) return undefined;
  const poster = `/previews/presets/peak/${id}.jpg?v=${peak.v}`;
  const thumb = thumbOf(poster);
  return { poster, thumb, frames: [{ src: poster, thumb }] };
}

/** A published example file's display URL (its content version), and its small copy. */
function exampleFrame(src: string) {
  const f = EXAMPLE_MEDIA[src];
  if (!f) return undefined;
  const url = `${src}?v=${f.v}`;
  return { src: url, thumb: f.thumb ?? f.poster ?? url };
}

/** A borrowed cover (StarterCoverRef), or undefined while that one isn't published either. */
function borrowedCover(ref: StarterCoverRef): TemplateCover | undefined {
  if ("template" in ref) {
    const [group, id] = ref.template.split("/");
    return templateCover(group as TemplateGroup, id);
  }
  if ("example" in ref) {
    const out = exampleById(ref.example)?.output;
    if (!out) return undefined;
    const poster = out.rest?.src ?? out.poster ?? out.src;
    const still = out.kind === "image" ? out.src : poster;
    return {
      poster: still,
      thumb: out.poster ?? still,
      ...(out.kind === "video" && { video: out.src, ...(out.rest && { at: out.rest.at }) }),
      frames: [{ src: still, thumb: out.poster ?? still }],
    };
  }
  const frames = ref.files.map(exampleFrame);
  if (!frames.length || frames.some((f) => !f)) return undefined;
  const all = frames as NonNullable<ReturnType<typeof exampleFrame>>[];
  return { poster: all[0].src, thumb: all[0].thumb, frames: all };
}

/** A starter's real cover: its own (starters/<id>), else the published cover that shows the same thing. */
export function starterCover(s: Pick<Starter, "id" | "coverFrom" | "coverOf">): TemplateCover | undefined {
  return templateCover("starters", s.id) ?? (s.coverFrom ? presetAsCover(s.coverFrom) : undefined) ?? (s.coverOf ? borrowedCover(s.coverOf) : undefined);
}

const AUDIO = /\.(m4a|mp3|wav|ogg|aac)$/i;

function inputs(s: Starter): StarterInput[] {
  const seed = s.seed;
  const photo = seed.kind === "product" ? seed.kit.product.image : undefined;
  return [
    ...(photo ? [{ label: "Product photo", image: { thumb: EXAMPLE_MEDIA[photo.src]?.thumb ?? photo.src, name: photo.name } }] : []),
    ...(s.samples ?? []).map((f) =>
      AUDIO.test(f.src) ? { label: f.label, audio: { src: f.src, name: "A recording" } } : { label: f.label, image: { thumb: exampleFrame(f.src)?.thumb ?? f.src, name: "A photo" } },
    ),
    ...s.words.map((w) => {
      // A film's shot, by its words: its page makes that shot alone, in the film's look.
      const shot = seed.kind === "cinema" ? seed.shots.findIndex((x) => x.prompt === w.text) + 1 : 0;
      return { label: w.label, text: w.text, ...(shot > 0 && { shot }) };
    }),
  ];
}

/** The look a starter is made in, as its studio names it: a film's Director settings, a story's look and shape. */
function lookOf(s: Starter): StarterLookItem[] | undefined {
  if (s.seed.kind === "cinema") return cinemaLook(s.seed.director);
  if (s.seed.kind === "storyboard") return storyboardLook(s.seed);
  return undefined;
}

export function starterCard(s: Starter): StarterCardData {
  const cover = starterCover(s);
  const look = lookOf(s);
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
    ...(look && { look }),
    ...(cover && { cover }),
    coverKey: `starters/${s.id}`,
    ...(s.seed.kind === "element" && s.seed.element.kind === "character" && { coverTop: true }),
    ...(s.tryIn && {
      tryIn: { href: tryInHref(s.tryIn), label: getPreset(s.tryIn.app)?.name ?? "the app", example: s.tryIn.example },
    }),
    // A guest or an account sees the story in Storyboard's composer, with its price (Generate is the owner's).
    ...(s.seed.kind === "storyboard" && { tryIn: { href: fillHref(s), label: "Storyboard", text: "See it in Storyboard" } }),
    use: starterUse(s),
  };
}

/** An app's page, or the Video studio with an effect or a camera move, with its example loaded. */
const tryInHref = ({ app, example }: { app: string; example: string }) =>
  app.startsWith("app-") ? `/apps/${app}?example=${encodeURIComponent(example)}` : `/video?preset=${app}&example=${encodeURIComponent(example)}`;

/** Where a "fill" starter opens: its studio, with `?starter=<id>`. */
const fillHref = (s: Starter) => `${STARTER_SURFACES[s.surface].base}?starter=${encodeURIComponent(s.id)}`;

function starterUse(s: Starter): StarterCardData["use"] {
  switch (s.seed.kind) {
    case "fill":
    case "assist":
    case "storyboard":
      return { kind: "fill", href: fillHref(s) };
    case "link":
      return { kind: "link", href: s.seed.href, ...(s.seed.ownerHref && { ownerHref: s.seed.ownerHref }) };
    default:
      return { kind: "create" };
  }
}

/**
 * A surface's starters as cards, covered first, then by rank. A page's props (prerendered, the same for everyone) get
 * only the covered ones: a starter with no cover yet is the owner's, who loads the rest from GET /api/starters, so its
 * words never reach a visitor's page. `all`: every one (that route's answer).
 */
export function starterCards(surface: StarterSurface, { all = false }: { all?: boolean } = {}): StarterCardData[] {
  return STARTERS.filter((s) => s.surface === surface)
    .map(starterCard)
    .filter((c) => all || !!c.cover)
    .sort((a, b) => Number(!a.cover) - Number(!b.cover) || a.rank - b.rank);
}

/** Studios whose starters speak through a narrator (Faceless, Content Factory, Explainer). */
const NARRATED: ReadonlySet<StarterSurface> = new Set(["faceless", "content-factory", "explainer"]);

/**
 * A narrated starter's narrator sample: a short neutral read, published at /starters/<id>/<v>/voice.m4a once it is made
 * (the open engine's narrator clones a voice, and a starter must run as it is). Until the file is there, nothing.
 */
export function starterVoice(s: Pick<Starter, "id" | "surface">): StarterSample | undefined {
  return NARRATED.has(s.surface) ? { src: `/starters/${s.id}/1/voice.m4a`, name: "Narrator" } : undefined;
}

/** What a "fill" starter puts into its studio's composer. */
function fillOf(s: Starter): StarterFill | undefined {
  const seed = s.seed;
  if (seed.kind === "fill") return seed.fill;
  if (seed.kind === "assist") return { kind: "assist", text: `${seed.skill ? `/${seed.skill} ` : ""}${seed.prompt}` };
  if (seed.kind === "storyboard") return { kind: "storyboard", story: seed.story, frames: seed.frames, aspectRatio: seed.aspectRatio, ...(seed.look && { look: seed.look }) };
  return undefined;
}

/** The studios whose starters fill a composer on the page. */
export type FillSurface = "assist" | "storyboard" | "content-factory" | "explainer";

/** The composers' fills of a surface, by starter id (small: the page gets them all), the covered ones unless `all`. */
export function starterFills(surface: FillSurface, { all = false }: { all?: boolean } = {}): Record<string, StarterFill> {
  return Object.fromEntries(
    STARTERS.flatMap((s) => {
      const fill = s.surface === surface && (all || starterCover(s)) ? fillOf(s) : undefined;
      return fill ? [[s.id, fill] as const] : [];
    }),
  );
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
