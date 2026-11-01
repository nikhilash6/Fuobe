/**
 * Ideogram 4's prompt: a JSON caption in the schema the model was trained on (Ideogram's caption schema, key order
 * included: ideogram-oss/ideogram4 docs/prompting.md and its CaptionVerifier). Plain sentences often come back as the grey
 * "Image blocked by safety filter" card, so the server writes a caption from the words before the run
 * (src/server/enhance.ts ideogramCaption): an LLM's, checked here and asked once more when it breaks the rules, else a
 * fixed wrapper around the words.
 *
 * The house style is "lean JSON", which won a blind test of 48 renders on 8 hard cards (2026-10-24): about 120–150 words.
 * The lead names everything the picture pays off on in 25–35 words; the main element takes up to 45 words plus "Her whole
 * head is inside the frame."; lighting up to 18 words ending "neutral white balance"; photo up to 13; background up to 35;
 * a palette of 5–7 colours. Only what is in the picture: a thing that is named gets drawn, even when it is negated.
 */

type Box = [number, number, number, number];

export interface CaptionElement {
  type: "obj" | "text";
  /** [top, left, bottom, right], 0–1000 from the top left. */
  bbox?: Box;
  /** The lettering a text element draws, exactly. */
  text?: string;
  desc: string;
  color_palette?: string[];
}

export interface IdeogramCaption {
  high_level_description?: string;
  /** `photo` for a photograph, `art_style` (after `medium`) for anything else: never both. */
  style_description?: { aesthetics?: string; lighting?: string; photo?: string; medium?: string; art_style?: string; color_palette?: string[] };
  compositional_deconstruction: { background: string; elements: CaptionElement[] };
}

const HEX = /^#[0-9A-F]{6}$/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const words = (s: string | undefined) => (s ?? "").split(/\s+/).filter(Boolean).length;

/** Uppercase #RRGGBB colours, at most `max` (the schema: 16 for the picture, 5 for an element). */
function palette(v: unknown, max: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((c) => String(c).trim().toUpperCase()).filter((c) => HEX.test(c)).slice(0, max);
  return out.length ? out : undefined;
}

/** A box of four whole numbers in 0–1000, top before bottom and left before right; anything else is left out. */
function box(v: unknown): Box | undefined {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  const b = v.map((n: number) => Math.min(1000, Math.max(0, Math.round(n)))) as Box;
  return b[0] <= b[2] && b[1] <= b[3] ? b : undefined;
}

/** The first JSON object in a text (an LLM's answer may wrap it in a code fence or a sentence). */
function jsonObject(text: string): Record<string, unknown> | null {
  const body = text.replace(/```(?:json)?/gi, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(body.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * A caption read from a text: JSON with a `compositional_deconstruction`, rebuilt in the schema's key order with the
 * schema's keys only (an `aspect_ratio` key, which the model wasn't trained on, is dropped). Null when the text isn't one.
 */
export function readCaption(text: string): IdeogramCaption | null {
  const c = jsonObject(text);
  const cd = c?.compositional_deconstruction;
  if (!c || !isObject(cd)) return null;
  const elements = (Array.isArray(cd.elements) ? cd.elements : []).flatMap((e): CaptionElement[] => {
    if (!isObject(e)) return [];
    const desc = str(e.desc);
    const text = typeof e.text === "string" && e.text.trim() ? e.text : undefined;
    const lettering = e.type === "text" && text !== undefined;
    if (!desc && !lettering) return [];
    const bbox = box(e.bbox);
    const colours = palette(e.color_palette, 5);
    return [{ type: lettering ? "text" : "obj", ...(bbox && { bbox }), ...(lettering && { text }), desc, ...(colours && { color_palette: colours }) }];
  });
  const caption: IdeogramCaption = { compositional_deconstruction: { background: str(cd.background), elements } };
  const lead = str(c.high_level_description);
  const style = isObject(c.style_description) ? styleOf(c.style_description) : undefined;
  return { ...(lead ? { high_level_description: lead } : {}), ...(style && { style_description: style }), ...caption };
}

/** A style block in the schema's order: aesthetics, lighting, photo, medium (or aesthetics, lighting, medium, art_style), palette. */
function styleOf(s: Record<string, unknown>): IdeogramCaption["style_description"] {
  const photo = str(s.photo);
  const art = str(s.art_style);
  const medium = str(s.medium);
  // Exactly one of photo and art_style: the medium decides when both came.
  const asPhoto = !!photo && (!art || !medium || medium === "photograph");
  const out: NonNullable<IdeogramCaption["style_description"]> = {};
  if (str(s.aesthetics)) out.aesthetics = str(s.aesthetics);
  if (str(s.lighting)) out.lighting = str(s.lighting);
  if (asPhoto) out.photo = photo;
  if (medium) out.medium = medium;
  if (!asPhoto && art) out.art_style = art;
  const colours = palette(s.color_palette, 16);
  if (colours) out.color_palette = colours;
  return Object.keys(out).length ? out : undefined;
}

/** The compact caption string the model reads (the schema's encoding: no spaces, non-ASCII as it is). */
export const captionText = (c: IdeogramCaption): string => JSON.stringify(c);

/** A prompt that already is a caption (pasted, or a run reused), as the model reads it; null for plain words. */
export function parseCaption(text: string): string | null {
  const c = readCaption(text);
  return c ? captionText(c) : null;
}

/**
 * The caption when no LLM can write one: the words as the lead and as one element. No style block (a style is never
 * invented) and one element, since a caption without elements invites the safety card.
 */
export function captionFromWords(text: string): string {
  const w = text.trim().replace(/\s+/g, " ");
  return JSON.stringify({ high_level_description: w, compositional_deconstruction: { background: "", elements: [{ type: "obj", desc: w }] } });
}

/** Words that age a face or turn a fitted garment see-through. */
const DROP_LIST = /\b(stubble|weathered|rugged|gaunt|wrinkl\w*|crow.s feet|medium format|visible pores|sheer|translucent|see-through|mesh|illusion)\b/gi;
/** A negated thing is still drawn: "no tourists" brings tourists. */
const NEGATIONS = /\b(no|not|without|never|none|nothing|free of|unmarked|unbranded|logo-free|lettering-free|absent)\b/gi;
/** Words that draw lettering. */
const TEXT_WORDS = /\b(text|logo|label|sign|signage|letters|lettering|words|brand|typography|caption|watermark)\b/i;
const found = (s: string, re: RegExp) => [...new Set((s.match(re) ?? []).map((x) => x.toLowerCase()))];

/**
 * What a caption does against the lean rules, in words an LLM can act on; empty when nothing. Lettering itself (a text
 * element's `text`) is never judged.
 */
export function leanProblems(caption: string | IdeogramCaption): string[] {
  const c = typeof caption === "string" ? readCaption(caption) : caption;
  if (!c) return ["it is not a caption in the schema (JSON with compositional_deconstruction)"];
  const p: string[] = [];
  const s = c.style_description ?? {};
  const cd = c.compositional_deconstruction;
  const els = cd.elements;
  const cap = (what: string, n: number, max: number) => {
    if (n > max) p.push(`${what} has ${n} words (at most ${max})`);
  };
  cap("high_level_description", words(c.high_level_description), 35);
  cap("background", words(cd.background), 35);
  if (s.photo !== undefined) {
    cap("lighting", words(s.lighting), 18);
    cap("photo", words(s.photo), 13);
    if (s.lighting && !/neutral(\s+daylight)?\s+white balance\.?$/i.test(s.lighting)) p.push('lighting does not end with "neutral white balance"');
  }
  const objects = els.filter((e) => e.type === "obj");
  const lengths = objects.map((e) => words(e.desc));
  const hero = Math.max(0, ...lengths);
  // 45 words, plus the sentence that keeps the head inside the frame.
  if (hero > 52) p.push(`the main element's desc has ${hero} words (at most 45, plus "Her whole head is inside the frame.")`);
  lengths.forEach((n, i) => {
    if (n !== hero && n > 22) p.push(`element "${objects[i].desc.slice(0, 30)}…" has ${n} words (at most 20 beside the main one)`);
  });
  if (!els.length) p.push("there are no elements (a caption without them invites the safety card)");
  // Lettering is one text element per line, so only the things in the picture are counted.
  if (objects.length > 5) p.push(`there are ${objects.length} object elements (at most 5)`);
  const prose = [c.high_level_description, s.aesthetics, s.lighting, s.photo, s.art_style, cd.background, ...els.map((e) => e.desc)].filter(Boolean).join(" ");
  const drop = found(prose, DROP_LIST);
  if (drop.length) p.push(`it says ${drop.join(", ")}: these age faces or turn fitted garments see-through`);
  const neg = found(prose, NEGATIONS);
  if (neg.length) p.push(`it says ${neg.join(", ")}: describe only what is in the picture, a negated thing is still drawn`);
  if (/\bsexy\b/i.test(prose)) p.push('it says "sexy", which trips the safety filter: describe the styling and pose instead');
  if (/\bempty\b/i.test(prose)) p.push('it says "empty", which invites the safety card: name what is there');
  // A picture without lettering: a word about text draws some.
  if (!els.some((e) => e.type === "text") && TEXT_WORDS.test(prose)) p.push("it mentions text, a logo or a sign, which draws lettering: leave it out, or add the words as a text element");
  return p;
}

/** A picture size in words for the caption writer ("1536 × 1152 px, landscape"). */
const shapeOf = ({ width, height }: { width?: number; height?: number }) =>
  width && height ? `${width} × ${height} px, ${width > height ? "landscape" : width < height ? "portrait" : "square"}` : "square";

/** What the caption writer is asked: the idea and the picture's shape, and the second time, its caption and what to fix. */
export function captionRequest(text: string, size: { width?: number; height?: number }, retry?: { caption: string; problems: string[] }): string {
  const ask = `Idea: ${text.trim()}\nPicture: ${shapeOf(size)}`;
  if (!retry) return ask;
  return `${ask}\n\nYour caption:\n${retry.caption}\n\nIt breaks these rules:\n${retry.problems.map((x) => `- ${x}`).join("\n")}\nWrite it again within the rules.`;
}

/**
 * The caption for some words: the LLM's (`ask` answers a request, null when no LLM answers), checked against the schema
 * and the lean rules and asked once more with the problems listed; the first answer when the second isn't a caption; the
 * wrapper when neither is.
 */
export async function writeCaption(text: string, size: { width?: number; height?: number }, ask: (request: string) => Promise<string | null>): Promise<string> {
  const first = await ask(captionRequest(text, size)).catch(() => null);
  if (first === null) return captionFromWords(text);
  const caption = readCaption(first);
  const problems = leanProblems(caption ?? first);
  if (caption && !problems.length) return captionText(caption);
  const again = await ask(captionRequest(text, size, { caption: caption ? captionText(caption) : first.slice(0, 4000), problems })).catch(() => null);
  const second = again ? readCaption(again) : null;
  return second ? captionText(second) : caption ? captionText(caption) : captionFromWords(text);
}
