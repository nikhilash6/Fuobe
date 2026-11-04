/**
 * "Start from an example": what a page shows before the visitor has made anything. Each example is what went in (a
 * picture, a clip, a recording, words) and what came out; one tap puts its own files, words and settings into the
 * page's composer. Client-safe types: the catalog that builds them is server only (catalog.ts).
 */
import type { GenjutsuFeature, GenjutsuSetup } from "@/lib/catalog/genjutsu";
import type { GenerationRequest } from "@/lib/catalog/types";

/** Where an example shows: an app, a camera motion or effect, a studio, a hub mode, a tool of its own, or a studio of the suite. */
export type ExampleSurface =
  | `app:${string}`
  | `preset:${string}`
  | `studio:${string}`
  | `hub:${string}`
  | `tool:${string}`
  | `suite:${string}`;

/** A picture, clip, recording or 3D model shown on a card (a public path; display copies carry their ?v=). */
export interface ExampleMedia {
  src: string;
  kind: "image" | "video" | "audio" | "model";
  /** A small copy for the corner inset (inputs, about 384 px). */
  thumb?: string;
  /** A clip's still, shown first (outputs, about 512 px). */
  poster?: string;
  /** Where a clip rests before it plays (a cover's peak frame), and where its loop starts. */
  rest?: { src: string; at: number; from: number };
  w?: number;
  h?: number;
}

/** What the composer receives: the same shape a past run has, so it loads as Reuse does. */
export interface ExampleRequest {
  presetId?: string;
  /** Left out: the composer keeps the model the visitor is on (the page's own default for the preset or engine). */
  modelId?: string;
  prompt?: string;
  params?: GenerationRequest["params"];
  presetOptions?: Record<string, string>;
  inputs: NonNullable<GenerationRequest["inputs"]>;
}

export type ExampleLoad =
  /** Every studio composer: the request goes into the draft. */
  | { via: "draft"; request: ExampleRequest }
  /** Look only: the card opens a sheet with what went in and what came out, or (a tile from another page) its page. */
  | { via: "look"; href?: string }
  /** A Genjutsu mode's example: its recipe goes into the Genjutsu form; the viewer's own clip and photos stay. */
  | GenjutsuExampleLoad;

/**
 * A Genjutsu mode's example (src/lib/examples/genjutsu.ts): one before → after loop, what went in, and the recipe that
 * made it. The recipe is a setup with the seed, the part's length and the sound, and none of the fields that point at
 * the example's own clip or photos (who is who, clicked points, the character's description).
 */
export interface GenjutsuExampleLoad {
  via: "genjutsu";
  /** "inset": the result fills the frame, the source plays in a corner window. "wipe": the source, then a line wipes to the result. */
  layout: "inset" | "wipe";
  /** What went in, in words ("A 5 s clip and two photos"). */
  went: string;
  recipe: GenjutsuRecipe;
  /** The features a viewer needs open to see it (src/server/genjutsu-live.ts); the owner sees every one. */
  needs: GenjutsuFeature[];
}

/** A Genjutsu setup as an example's recipe: the part's length is always in it, the example's own files never. */
export type GenjutsuRecipe = Omit<GenjutsuSetup, "references"> & { length: number };

export interface ExampleInput {
  /** The composer slot it fills: image, image2, endImage, mask, video, audio… */
  slot: string;
  /** The slot's visitor label ("Photo", "Face", "Start frame"). */
  label?: string;
  media: ExampleMedia;
}

/** What a page receives: one slim card per example (the catalog's rank and surface left out). */
export interface ExampleCard {
  /** "<surface slug>.<n>": app-relight.1, effect-levitation.1, video.2 */
  id: string;
  /** What happens, in 40 characters or less. */
  caption: string;
  /** A cover from another page names that page (its app, motion or effect): "More to try" rows only. */
  title?: string;
  /** The words the example ran with (only when it had any). */
  words?: string;
  /** Its settings, as the visitor sees them in the composer (option labels). */
  chips?: string[];
  inputs: ExampleInput[];
  output: ExampleMedia;
  load: ExampleLoad;
}

/** A row of cards and the line above it ("Start from an example", or "More to try" for tiles from other pages). */
export interface ExampleRowData {
  heading: string;
  cards: ExampleCard[];
  /** The page's own surface: a linked example (`?example=`) loads only when it belongs here. */
  surface?: ExampleSurface;
}

/**
 * Whether a linked example belongs on a page: the page's own, or (the Video studio, where any motion or effect can be
 * picked) a camera motion's, an effect's or a clip app's.
 */
export const exampleFits = (exampleSurface: string | undefined, pageSurface: string | undefined): boolean =>
  !!exampleSurface && !!pageSurface && (exampleSurface === pageSurface || (pageSurface === "studio:video" && /^(preset|app):/.test(exampleSurface)));

/** The line over a row of examples that load into this page. */
export const EXAMPLES_HEADING = "Start from an example";
/** The line over a row of covers from other pages (they open their own page). */
export const MORE_HEADING = "More to try";
/** A card's caption holds this many characters at most (HOME_CAPTION_MAX.card). */
export const EXAMPLE_CAPTION_MAX = 40;
/** And its words this many. */
export const EXAMPLE_WORDS_MAX = 240;
/**
 * What makes two cards the same example in the composer: their request (the Video studio's card for a motion and the
 * motion's own card load the same files), else the id.
 */
export const exampleKey = (card: ExampleCard): string => (card.load.via === "draft" ? JSON.stringify(card.load.request) : card.id);

/** The deep link that opens a page with one of its examples loaded. */
export const EXAMPLE_PARAM = "example";
