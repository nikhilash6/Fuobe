/**
 * Every example a page shows before the visitor has made anything (types.ts): what went in, what came out, and the
 * request the composer gets from one tap. Built from plan.json (one row per example, hand-edited) and the manifest of
 * published files (media.generated.ts, written by scripts/examples/publish-examples.mjs). Server only: a page gets its
 * few slim cards (examplesFor, exampleRow), and the catalog stays here.
 *
 * Built once, when the module loads: a row that names a preset, a setting or a file that isn't there throws, so the
 * build fails rather than a page (tests/examples-catalog.test.ts checks the same and more).
 */
import "server-only";
import { getModel, getPreset } from "@/lib/catalog";
import type { InputSlot, Preset } from "@/lib/catalog/types";
import type { StudioConfig } from "@/components/studio/studio-context";
import { homeCard } from "@/lib/home-showcase";
import { PRESET_BEFORE_AFTER } from "@/lib/preset-before-after.generated";
import { STUDIO_EXAMPLES, studioExamples, type ExampleStudio } from "@/lib/studio-examples";
import {
  EDIT_STUDIO,
  IMAGE_STUDIO,
  INPAINT_STUDIO,
  UPSCALE_STUDIO,
  VIDEO_STUDIO,
} from "@/lib/studios";
import { getMaker, GENJUTSU_MODES, modeOpen, requestFeatures, type FeatureCheck, type GenjutsuMode } from "@/lib/catalog/genjutsu";
import { exampleSettings, genjutsuSurface, recipeProblem, type GenjutsuExampleCard, type ModeExamples } from "./genjutsu";
import { EXAMPLE_MEDIA, type ExampleMediaFile } from "./media.generated";
import plan from "./plan.json";
import {
  EXAMPLE_CAPTION_MAX,
  EXAMPLE_WORDS_MAX,
  EXAMPLES_HEADING,
  MORE_HEADING,
  type ExampleCard,
  type ExampleInput,
  type ExampleMedia,
  type ExampleRequest,
  type ExampleRowData,
  type ExampleSurface,
  type GenjutsuExampleLoad,
  type GenjutsuRecipe,
} from "./types";

/** One row of plan.json. */
export interface PlanRow {
  id: string;
  surface: ExampleSurface;
  /** Ascending: premium first. */
  rank: number;
  caption: string;
  words?: string;
  /** "draft" (the default): the composer's own path. "look": a sheet to look at. "genjutsu": a Genjutsu mode's example. */
  load?: "draft" | "look" | "genjutsu";
  /** A Genjutsu mode's example (load "genjutsu"): its loop's layout, what went in, the recipe, and the example's own inputs. */
  genjutsu?: {
    layout: GenjutsuExampleLoad["layout"];
    went: string;
    recipe: GenjutsuRecipe;
    /** The fields about the example's own clip and photos (who is who): never on the card, used by the tests' exact remake. */
    own?: Record<string, unknown>;
  };
  presetId?: string;
  modelId?: string;
  /** App settings, option key → choice value. */
  options?: Record<string, string>;
  params?: Record<string, unknown>;
  /** What went in: slot → public path (image, image2, image3, endImage, mask, sketch, video, audio, voiceAudio). */
  inputs: Record<string, string>;
  /** What came out: a public path, "cover:<preset id>" (its published cover) or "ba:<preset id>" (its after still). */
  output: string;
  /** A clip's still where the change shows, and where it plays from (cut-example-peaks.mjs): for a cover with no peak of its own. */
  rest?: { src: string; at: number; from: number };
}

export const PLAN = plan as unknown as PlanRow[];

/** The composer each studio and hub mode has, for its slots' labels. */
const SURFACE_CONFIG: Partial<Record<string, StudioConfig>> = {
  "studio:image": IMAGE_STUDIO,
  "studio:video": VIDEO_STUDIO,
  "studio:edit": EDIT_STUDIO,
  "studio:inpaint": INPAINT_STUDIO,
  "hub:upscale": UPSCALE_STUDIO,
};

/** Where each surface's look-only covers come from until it has examples of its own (studio-examples.ts). */
export const FALLBACK_ROWS: Partial<Record<string, ExampleStudio>> = {
  "studio:image": "image",
  "studio:video": "video",
  "studio:edit": "edit",
  "studio:video-edit": "video-edit",
  "studio:extend": "extend",
  "studio:reframe": "reframe",
  "studio:inpaint": "inpaint",
  "studio:lipsync": "lipsync",
  "studio:motion-control": "motion-control",
  "hub:upscale": "upscale",
  "hub:video-tools": "video-tools",
  "hub:audio": "audio",
  "tool:layers": "layers",
  "tool:genjutsu": "genjutsu",
  "tool:character-swap": "character-swap",
  "tool:image-to-3d": "image-to-3d",
  "tool:katana": "katana",
  "suite:cinema": "cinema",
  "suite:ads": "ads",
};

/** The image slots of a request, in order. */
const IMAGE_SLOTS = ["image", "image2", "image3"] as const;
/** Slots a request names one file in. */
const SINGLE_SLOTS = ["endImage", "mask", "sketch", "video", "audio", "voiceAudio"] as const;

/** Words a visitor must never see on a card (model and provider names are checked in the tests too). */
export const FORBIDDEN_WORDS = [/<image/i, /picture 1/i, /\{option/i, /\[shot/i, /\bunverified\b/i, /not checked/i, /\btodo\b/i, /preview made with/i];

const fail = (row: { id: string }, why: string): never => {
  throw new Error(`Example ${row.id}: ${why}`);
};

/** A published file's display URL (its content version as ?v=, as the preview files have). */
const versioned = (path: string, f: ExampleMediaFile) => `${path}?v=${f.v}`;

function mediaKind(type: string): ExampleMedia["kind"] {
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("model/")) return "model";
  return "image";
}

/** A preset a surface or row names: the app of an app page, the motion or effect of a preset page, or the row's own. */
function surfacePreset(row: PlanRow): Preset | undefined {
  const [kind, rest] = splitSurface(row.surface);
  const id = row.presetId ?? (kind === "app" || kind === "preset" ? rest : undefined);
  if (!id) return undefined;
  const p = getPreset(id) ?? fail(row, `names ${id}, which isn't in the catalog`);
  if (kind === "app" && (p.type !== "app" || p.id !== rest)) fail(row, `an app page's example must run the app (${rest})`);
  if (kind === "preset" && (p.type === "app" || p.id !== rest)) fail(row, `a preset page's example must run its motion or effect (${rest})`);
  return p;
}

export function splitSurface(s: string): [string, string] {
  const i = s.indexOf(":");
  return [s.slice(0, i), s.slice(i + 1)];
}

/** The slots a row's inputs may fill: the preset's, else the studio's. */
function slotsFor(row: PlanRow, preset: Preset | undefined): InputSlot[] | undefined {
  if (preset && preset.type === "app") return preset.inputs;
  const config = SURFACE_CONFIG[row.surface];
  if (config) {
    // A studio's composer: its own slots, a picked motion's or effect's, its references (image2…) and its painted area.
    const extra: InputSlot[] = [
      ...(config.multiRef ? [{ key: "image2", label: "Reference", accept: "image" } as const, { key: "image3", label: "Reference", accept: "image" } as const] : []),
      ...(config.sketch?.includes("mask") ? [{ key: "mask", label: "Painted area", accept: "image" } as const, { key: "sketch", label: "Painted area", accept: "image" } as const] : []),
    ];
    return [...config.slots, ...(preset?.inputs ?? []), ...extra];
  }
  if (preset) return [...preset.inputs, { key: "endImage", label: "End frame", accept: "image" }];
  return undefined;
}

function inputMedia(row: PlanRow, path: string): ExampleMedia {
  const f = EXAMPLE_MEDIA[path] ?? fail(row, `${path} isn't a published example file (node scripts/examples/publish-examples.mjs)`);
  if (f.role !== "in") fail(row, `${path} is published as a display copy, not as a file a run reads`);
  return { src: path, kind: mediaKind(f.type), ...(f.thumb && { thumb: f.thumb }), ...(f.w && { w: f.w, h: f.h }) };
}

function restOf(row: PlanRow, rest: NonNullable<PlanRow["rest"]>): NonNullable<ExampleMedia["rest"]> {
  const f = EXAMPLE_MEDIA[rest.src] ?? fail(row, `its still ${rest.src} isn't a published example file`);
  return { src: versioned(rest.src, f), at: rest.at, from: rest.from };
}

function outputMedia(row: PlanRow): ExampleMedia {
  const out = row.output;
  if (out.startsWith("cover:")) {
    const id = out.slice(6);
    if (!getPreset(id)) fail(row, `its output names ${id}, which isn't in the catalog`);
    const { preview } = homeCard(id);
    if (!preview.video && !/^\/previews\//.test(preview.poster)) fail(row, `${id} has no published cover`);
    const rest = preview.rest ?? (row.rest && restOf(row, row.rest));
    return { src: preview.video ?? preview.poster, kind: preview.video ? "video" : "image", poster: preview.poster, ...(rest && { rest }) };
  }
  if (out.startsWith("ba:")) {
    const id = out.slice(3);
    const v = PRESET_BEFORE_AFTER[id] ?? fail(row, `${id} has no before/after stills`);
    return { src: `/previews/presets/ba/960/${id}-after.jpg?v=${v}`, kind: "image", poster: `/previews/presets/ba/512/${id}-after.jpg?v=${v}`, w: 960, h: 720 };
  }
  const f = EXAMPLE_MEDIA[out] ?? fail(row, `its output ${out} isn't a published example file`);
  return { src: versioned(out, f), kind: mediaKind(f.type), ...(f.poster && { poster: f.poster }), ...(f.w && { w: f.w, h: f.h }), ...(row.rest && { rest: restOf(row, row.rest) }) };
}

/** The request a row runs: its preset, model, words, settings and files, in a past run's shape. */
function requestOf(row: PlanRow, preset: Preset | undefined): ExampleRequest {
  const images = IMAGE_SLOTS.map((k) => row.inputs[k]).filter(Boolean);
  const inputs: ExampleRequest["inputs"] = {};
  if (images.length) inputs.images = images;
  for (const k of SINGLE_SLOTS) if (row.inputs[k]) inputs[k] = row.inputs[k];
  return {
    ...(preset && { presetId: preset.id }),
    ...(row.modelId && { modelId: row.modelId }),
    ...(row.words && { prompt: row.words }),
    ...(row.params && { params: row.params }),
    ...(row.options && { presetOptions: row.options }),
    inputs,
  };
}

/** The settings as the composer shows them: each option's choice label, in the preset's order, then the aspect. */
function chipsOf(row: PlanRow, preset: Preset | undefined): string[] | undefined {
  const chips: string[] = [];
  for (const [key, value] of Object.entries(row.options ?? {})) {
    const option = preset?.options?.find((o) => o.key === key) ?? fail(row, `has no option ${key}`);
    const choice = option.choices.find((c) => c.value === value) ?? fail(row, `option ${key} has no choice ${value}`);
    chips.push(choice.label);
  }
  if (row.options && preset?.options) chips.sort((a, b) => order(preset, a) - order(preset, b));
  const aspect = row.params?.aspect;
  if (typeof aspect === "string") chips.push(aspect);
  return chips.length ? chips : undefined;
}

const order = (preset: Preset, label: string) => preset.options!.findIndex((o) => o.choices.some((c) => c.label === label));

function buildCard(row: PlanRow): ExampleCard {
  if (!/^[a-z0-9-]+\.\d+$/.test(row.id)) fail(row, "an id is <slug>.<n>");
  if (!row.caption || row.caption.length > EXAMPLE_CAPTION_MAX) fail(row, `its caption must be 1 to ${EXAMPLE_CAPTION_MAX} characters`);
  if (row.words !== undefined && (!row.words.trim() || row.words.length > EXAMPLE_WORDS_MAX)) fail(row, `its words must be 1 to ${EXAMPLE_WORDS_MAX} characters`);
  for (const text of [row.caption, row.words ?? ""]) for (const bad of FORBIDDEN_WORDS) if (bad.test(text)) fail(row, `its words say ${bad}`);
  const preset = surfacePreset(row);
  const slots = slotsFor(row, preset);
  const inputs: ExampleInput[] = [];
  for (const [slot, path] of Object.entries(row.inputs)) {
    const def = slots?.find((s) => s.key === slot);
    if (slots && !def) fail(row, `${row.surface} has no ${slot} slot`);
    const media = inputMedia(row, path);
    if (def && def.accept !== media.kind) fail(row, `${slot} takes ${def.accept}, not ${media.kind}`);
    const label = row.load === "genjutsu" ? (GENJUTSU_INPUT_LABEL[slot.replace(/\d+$/, "")] ?? fail(row, `a Genjutsu example's inputs are clip, photo1… (not ${slot})`)) : def?.label;
    inputs.push({ slot, ...(label && { label }), media });
  }
  // An inpaint's picture with its painted area tinted shows what went in; the plain picture and the black-and-white
  // area it was made from stay out of the card (the request still has them).
  const shown = inputs.some((i) => i.slot === "sketch") ? inputs.filter((i) => i.slot !== "image" && i.slot !== "mask") : inputs;
  if (row.modelId && !getModel(row.modelId)) fail(row, `names model ${row.modelId}, which isn't in the catalog`);
  const load: ExampleCard["load"] = row.load === "genjutsu" ? genjutsuLoad(row) : row.load === "look" ? { via: "look" } : { via: "draft", request: requestOf(row, preset) };
  const chips = load.via === "genjutsu" ? exampleSettings(load.recipe) : chipsOf(row, preset);
  return {
    id: row.id,
    caption: row.caption,
    ...(row.words && { words: row.words }),
    ...(chips && { chips }),
    inputs: shown,
    output: outputMedia(row),
    load,
  };
}

/** What a Genjutsu example's inputs are called on its card ("What went in"). */
const GENJUTSU_INPUT_LABEL: Record<string, string> = { clip: "Clip", photo: "Photo", look: "Look", product: "Product" };

/** A Genjutsu mode's example: its surface names the mode, and its recipe passes the same checks a pasted setup does. */
function genjutsuLoad(row: PlanRow): GenjutsuExampleLoad {
  const [kind, name] = splitSurface(row.surface);
  const [tool, mode] = name.split("/");
  if (kind !== "tool" || tool !== "genjutsu" || !GENJUTSU_MODES.some((m) => m.id === mode)) fail(row, "a Genjutsu example's surface is tool:genjutsu/<mode>");
  const g = row.genjutsu ?? fail(row, "a Genjutsu example needs its recipe (genjutsu: { layout, went, recipe })");
  if (g.layout !== "inset" && g.layout !== "wipe") fail(row, `its layout ${g.layout} is neither inset nor wipe`);
  if (!g.went.trim() || g.went.length > 60) fail(row, "what went in is 1 to 60 characters");
  const problem = recipeProblem(g.recipe, mode as GenjutsuMode);
  if (problem) fail(row, problem);
  const r = g.recipe;
  const maker = getMaker(r.model, r.engine)!;
  const needs = requestFeatures({ mode: r.mode, maker, character: r.character, object: r.object, picture: r.picture ? { ...r.picture, stage: "frame" } : undefined, finish: r.finish });
  if (!row.output.endsWith(".mp4")) fail(row, "a Genjutsu example shows a clip (clip-show)");
  return { via: "genjutsu", layout: g.layout, went: g.went, recipe: r, needs };
}

/** Every example, by surface, ranked. */
function buildAll(): { bySurface: Map<string, ExampleCard[]>; byId: Map<string, { card: ExampleCard; surface: ExampleSurface }> } {
  const bySurface = new Map<string, { rank: number; card: ExampleCard }[]>();
  const byId = new Map<string, { card: ExampleCard; surface: ExampleSurface }>();
  for (const row of PLAN) {
    if (byId.has(row.id)) fail(row, "is in plan.json twice");
    const card = buildCard(row);
    byId.set(row.id, { card, surface: row.surface });
    const list = bySurface.get(row.surface) ?? [];
    list.push({ rank: row.rank, card });
    bySurface.set(row.surface, list);
  }
  return {
    bySurface: new Map([...bySurface].map(([s, list]) => [s, list.sort((a, b) => a.rank - b.rank).map((x) => x.card)])),
    byId,
  };
}

const ALL = buildAll();

/** The most cards a row shows. */
export const MAX_CARDS = 4;

/** A surface's examples, premium first: at most four slim cards. */
export function examplesFor(surface: ExampleSurface): ExampleCard[] {
  return (ALL.bySurface.get(surface) ?? []).slice(0, MAX_CARDS);
}

/** One example, by its id (the `?example=` link, the lazy fetch of a motion's or effect's). */
export function exampleById(id: string): ExampleCard | undefined {
  return ALL.byId.get(id)?.card;
}

/** The surface an example belongs to (a page applies a linked example only when it is the page's own). */
export function exampleSurfaceOf(id: string): ExampleSurface | undefined {
  return ALL.byId.get(id)?.surface;
}

/** Every surface that has examples of its own. */
export function exampleSurfaces(): string[] {
  return [...ALL.bySurface.keys()];
}

/**
 * A hub's other modes borrow only the hub's covers that fit them (a still photo's app has no place on Video upscale or
 * Export): the ids each may show. A mode not listed shows none until it has examples of its own.
 */
export const MODE_FALLBACK: Partial<Record<string, string[]>> = {
  "hub:video-tools/relight": ["app-relight", "app-match-colors"],
  "hub:video-tools/colors": ["app-match-colors", "app-relight"],
  "hub:audio/dialogue": ["app-talking-photo", "app-rap-god"],
  "hub:audio/voice-change": ["app-talking-photo", "app-rap-god"],
  "hub:audio/music": ["app-rap-god", "app-asmr-classic"],
  "hub:audio/sfx": ["app-asmr-classic", "app-rap-god"],
};

/** Covers from other pages, each opening its page, for a surface that has no examples of its own yet. */
function fallbackCards(studio: ExampleStudio, only?: string[]): ExampleCard[] {
  const tiles = studioExamples(studio).tiles;
  const shown = only ? only.flatMap((id) => tiles.filter((t) => t.card.id === id)) : tiles;
  return shown.map((t) => ({
    id: `more.${t.card.id}`,
    caption: t.caption,
    title: t.card.name,
    inputs: [],
    output: { src: t.card.preview.video ?? t.card.preview.poster, kind: t.card.preview.video ? "video" : "image", poster: t.card.preview.poster, ...(t.card.preview.rest && { rest: t.card.preview.rest }) },
    load: { via: "look", href: t.href },
  }));
}

/**
 * A surface's row: its own examples under "Start from an example", or (until it has some) covers from other pages under
 * "More to try", each opening its own page. Null when there is neither.
 */
export function exampleRow(surface: ExampleSurface): ExampleRowData | null {
  const cards = examplesFor(surface);
  if (cards.length) return { heading: EXAMPLES_HEADING, cards, surface };
  const own = FALLBACK_ROWS[surface];
  if (own && STUDIO_EXAMPLES[own]) return { heading: MORE_HEADING, cards: fallbackCards(own), surface };
  // A hub's mode borrows its hub's covers that fit it ("hub:video-tools/relight" → the relight app's).
  const hub = FALLBACK_ROWS[surface.split("/")[0]];
  const only = MODE_FALLBACK[surface];
  if (!hub || !only || !STUDIO_EXAMPLES[hub]) return null;
  const borrowed = fallbackCards(hub, only);
  return borrowed.length ? { heading: MORE_HEADING, cards: borrowed, surface } : null;
}

/**
 * Each Genjutsu mode's examples, best first (the page picks the one a viewer may see: exampleFor in ./genjutsu). With
 * `open`: only the examples whose mode and features it opens (what a page may send to every viewer).
 */
export function genjutsuExamples(open?: FeatureCheck): ModeExamples {
  const out: ModeExamples = {};
  for (const m of GENJUTSU_MODES) {
    if (open && !modeOpen(m.id, open)) continue;
    const all = (ALL.bySurface.get(genjutsuSurface(m.id)) ?? []) as GenjutsuExampleCard[];
    const cards = open ? all.filter((c) => c.load.needs.every(open)) : all;
    if (cards.length) out[m.id] = cards;
  }
  return out;
}

/** The surface of a camera motion's or effect's page in the Video studio (/video?preset=<id>). */
export const presetSurface = (id: string): ExampleSurface => (id.startsWith("app-") ? `app:${id}` : `preset:${id}`);

