/**
 * Canvas's template sections and who sees which card (client-safe: no catalog). The template cards themselves are
 * built on the server (src/lib/canvas-template-cards.ts) and passed to the page as props.
 */
import type { CanvasNodeType, Outline } from "@/lib/catalog/canvas";
import type { Engine } from "@/lib/catalog/types";
import type { CoverFrame, TemplateCover } from "@/lib/template-covers";

/** The sections in order, with the words visitors read (a template's `group` is the key). */
export const TEMPLATE_SECTIONS = [
  { key: "", title: "Films and campaigns", note: "Ready boards that make a finished piece. Each one runs as it is." },
  { key: "effect-films", title: "Effect films", note: "Your photo, a new scene, then a moving shot." },
] as const;

export type TemplateSectionKey = Exclude<(typeof TEMPLATE_SECTIONS)[number]["key"], "">;

/** A template as the list shows it: its board outline and model names per engine (the model names are the owner's). */
export interface TemplateCardData {
  id: string;
  name: string;
  description: string;
  icon: string;
  hue: number;
  section: TemplateSectionKey | "";
  rank: number;
  /** The steps as a word or two each: the small flow over the card's cover. */
  flow: string[];
  /** false: no ready board of its own: the owner's "More templates" only. */
  starter?: false;
  /** ifOff: a model's name and the one its node falls back to when the model is off on this install. */
  byEngine: Record<Engine, { outline: Outline; models: string[]; ifOff?: { id: string; name: string; instead: string }[] }>;
}

/** An input of a template's board, as its page shows it. */
export interface TemplateInput {
  id: string;
  type: CanvasNodeType;
  label: string;
  hint?: string;
  /** A prompt's or a script's words. */
  text?: string;
  table?: { columns: string[]; rows: string[][] };
  /** The file the board starts with here (its sample): a picture's small copy, or what kind of file it is. */
  sample?: { kind: "image" | "video" | "audio"; thumb?: string; name: string };
}

/** A template's page (/canvas/start/<id>). */
export interface TemplateDetail extends TemplateCardData {
  makes: string;
  steps: string[];
  inputs: TemplateInput[];
  oneStep?: { href: string; label: string };
}

/** "What's a canvas?": one effect film as the photo that went in, then its cover (the scene, then the moving shot). */
export interface CanvasIntro {
  templateId: string;
  photo: CoverFrame;
  film: TemplateCover;
}

export interface Viewing {
  /** A guest or an account (or not known yet): they see ready boards with a real cover only. */
  visitor: boolean;
  hasCover: (id: string) => boolean;
}

/** Whether a template's card shows: to a visitor only a ready board with its real cover, to the owner every one. */
export const shownTo = (t: TemplateCardData, { visitor, hasCover }: Viewing) => !visitor || (t.starter !== false && hasCover(t.id));

/** Covered cards first, then by rank. */
const order = (hasCover: Viewing["hasCover"]) => (a: TemplateCardData, b: TemplateCardData) => Number(!hasCover(a.id)) - Number(!hasCover(b.id)) || a.rank - b.rank;

export interface TemplateSection {
  key: TemplateSectionKey | "";
  title: string;
  note: string;
  items: TemplateCardData[];
}

/** The ready boards by section, as the viewer sees them; a section with nothing to show is left out. */
export function templateSections(templates: TemplateCardData[], v: Viewing): TemplateSection[] {
  return TEMPLATE_SECTIONS.map((s) => ({
    key: s.key,
    title: s.title,
    note: s.note,
    items: templates.filter((t) => t.section === s.key && t.starter !== false && shownTo(t, v)).sort(order(v.hasCover)),
  })).filter((s) => s.items.length > 0);
}

/** The owner's other templates (no ready board of their own); none for a visitor. */
export const moreTemplates = (templates: TemplateCardData[], v: Viewing) => (v.visitor ? [] : templates.filter((t) => t.starter === false));

/** The short row under a person's own boards: the first few ready boards, covered first, sections in order. */
export function firstTemplates(templates: TemplateCardData[], v: Viewing, n = 3): TemplateCardData[] {
  const covered = templateSections(templates, v).flatMap((s) => s.items);
  return [...covered.filter((t) => v.hasCover(t.id)), ...covered.filter((t) => !v.hasCover(t.id))].slice(0, n);
}
