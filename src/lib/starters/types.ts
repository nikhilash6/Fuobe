/**
 * Ready-made starters outside Canvas (client-safe: no catalog). A starter is a real piece of work, a channel, a series,
 * an explainer, a brand kit or a product with its photo, filled with its own words and settings, so it runs as it is.
 * The list lives on the server (src/lib/starters/catalog.ts); pages get these slim cards as props.
 */
import type { TemplateCover } from "@/lib/template-covers";

export type StarterSurface = "faceless" | "content-factory" | "explainer" | "ads" | "click-to-ad" | "marketing";

/** Where each surface lives, and where its starters' pages are (`<base>/start/<id>`). */
export const STARTER_SURFACES: Record<StarterSurface, { base: string; name: string; section: string; note: string; unavailable: string }> = {
  faceless: { base: "/faceless", name: "Faceless Studio", section: "Start from a ready channel", note: "Each one comes with its idea, its first episode and its look, so it runs as it is.", unavailable: "Faceless channels aren't available here." },
  "content-factory": { base: "/content-factory", name: "Content Factory", section: "Start from a ready series", note: "A style and an idea, ready to make. Change anything before you start.", unavailable: "Content Factory isn't available here." },
  explainer: { base: "/explainer", name: "Explainer", section: "Start from a ready explainer", note: "A topic, a style and a length, ready to make.", unavailable: "Explainer videos aren't available here." },
  ads: { base: "/ads", name: "Ads Studio", section: "Start from a ready brand", note: "A brand kit with a product and its photo, ready for ads.", unavailable: "Brand kits aren't available here." },
  "click-to-ad": { base: "/marketing/click-to-ad", name: "Click to Ad", section: "Start from a ready product", note: "A product with its photo and words, ready for a video ad.", unavailable: "Click to Ad isn't available here." },
  marketing: { base: "/marketing", name: "Marketing Studio", section: "Start from a ready shoot", note: "A product photo and a scene, ready to make.", unavailable: "Marketing Studio isn't available here." },
};

/** What goes in, as a starter's page shows it: its words, or its photo. */
export interface StarterInput {
  label: string;
  text?: string;
  image?: { thumb: string; name: string };
}

/** What the owner's "Use template" does: make it on the server (POST /api/starters/<id>), or fill the composer on this page. */
export type StarterUse = { kind: "create" } | { kind: "fill"; href: string };

/** A starter as its card and its page show it. Its words are visitor words: no model names. */
export interface StarterCardData {
  id: string;
  surface: StarterSurface;
  rank: number;
  name: string;
  description: string;
  /** lucide icon name (StarterIcon). */
  icon: string;
  hue: number;
  /** The steps as a word or two each, over the cover's corner. */
  flow: string[];
  /** The steps in plain words (its page's "The steps"). */
  steps: string[];
  /** What comes out, in plain words. */
  makes: string;
  inputs: StarterInput[];
  /** Its real cover, when it has one: visitors only see starters that have it. */
  cover?: TemplateCover;
  /** The cover's key, for one-clip-at-a-time playback. */
  coverKey: string;
  use: StarterUse;
  /** The app that makes the same from the same photo, its example loaded: a visitor's next step from the page. */
  tryIn?: { href: string; label: string; example: string };
}

/**
 * The composer a "fill" starter loads (Content Factory, Explainer): small enough to pass to the page, read when the
 * page opens with `?starter=<id>` or when the owner taps "Use template" on its card.
 */
export type StarterFill =
  | { kind: "content-factory"; presetId: string; prompt: string; length: number; episodes: number }
  | { kind: "explainer"; prompt: string; styleId: string; duration: "auto" | number; aspect: "9:16" | "16:9"; voice?: string };

/** The starter's page (`<base>/start/<id>`). */
export const starterHref = (s: Pick<StarterCardData, "id" | "surface">) => `${STARTER_SURFACES[s.surface].base}/start/${s.id}`;

/** Who sees a starter's card: a visitor only one with its real cover (the owner sees all, marked). */
export const starterShown = (s: Pick<StarterCardData, "cover">, visitor: boolean) => !visitor || !!s.cover;
