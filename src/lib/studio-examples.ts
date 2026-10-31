/**
 * What the empty Image, Video and Edit studios show under the composer: four real covers each, so a first visit sees
 * what the studio makes before it types anything. Server only, like Home's showcase it borrows from: the page gets
 * four slim cards, and the catalog stays here (tests/studio-examples.test.ts checks every id, cover and line).
 */
import "server-only";
import { getPreset } from "@/lib/catalog";
import { HOME_EFFECTS, HOME_MOTIONS, HOME_REVEALS, HOME_WALL, homeCard, presetHref } from "@/lib/home-showcase";
import type { PresetType } from "@/lib/catalog/types";
import type { PresetCardData } from "@/lib/preset-cards";

export type ExampleStudio = "image" | "video" | "edit";

/**
 * Each studio's row: the line above it, and its four in the order they show. A line of its own where Home has none
 * for that preset, else Home's (HOME_CAPTION_MAX.card holds either whole on a phone's tile). Video's tiles pick their
 * move in the studio itself; Image's and Edit's are apps, each on a page of its own, and their heading says so.
 */
export const STUDIO_EXAMPLES: Record<ExampleStudio, { heading: string; tiles: { id: string; caption?: string }[] }> = {
  image: {
    heading: "Or start from an app",
    tiles: [
      { id: "app-sketch-to-real", caption: "A rough sketch, made a real photo" },
      { id: "app-style-transfer", caption: "Any photo, redrawn as anime" },
      { id: "app-virtual-try-on" },
      { id: "app-product-shot" },
    ],
  },
  video: {
    heading: "See what it makes",
    tiles: [{ id: "motion-fpv-drone" }, { id: "effect-flame-on" }, { id: "motion-bullet-time" }, { id: "effect-angel-wings" }],
  },
  edit: {
    heading: "Or start from an app",
    tiles: [
      { id: "app-relight" },
      { id: "app-colorize", caption: "Black & white photos, in full color" },
      { id: "app-outfit-swap" },
      { id: "app-hairstyle-try-on" },
    ],
  },
};

/** A tile of the studio's row: its cover, what kind of preset it is, its line, and where it opens. */
export interface StudioExample {
  card: PresetCardData;
  kind: string;
  caption: string;
  href: string;
}

/** A studio's row: the line above it and its tiles. */
export interface StudioExampleRow {
  heading: string;
  tiles: StudioExample[];
}

const homeCaptions = new Map<string, string>([...HOME_WALL, ...HOME_EFFECTS, ...HOME_MOTIONS, ...HOME_REVEALS].map((t) => [t.id, t.caption]));

/** The kind a tile names (from xl, as Home's wall does): the apps here all wipe from a before to an after. */
const KIND: Record<PresetType, string> = { app: "App · before → after", motion: "Camera motion", effect: "Effect" };

/** The studio's row, as cards (each resting on its peak frame, as on Home). */
export function studioExamples(studio: ExampleStudio): StudioExampleRow {
  const { heading, tiles } = STUDIO_EXAMPLES[studio];
  return {
    heading,
    tiles: tiles.map(({ id, caption }) => {
      // homeCard throws for an id the catalog doesn't have, so the build fails rather than the page.
      const card = homeCard(id);
      const line = caption ?? homeCaptions.get(id);
      if (!line) throw new Error(`The ${studio} studio's example ${id} has no line`);
      return { card, kind: KIND[getPreset(id)!.type], caption: line, href: presetHref(id) };
    }),
  };
}
