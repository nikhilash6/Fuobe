/*
 * "Plan layout" (N7-8): a sentence ("a sale poster for my candle shop, 30% off") becomes a starting layout to adjust.
 * A text model writes a pixel draft (the instructions below, adapted with the Assist skill skills/layout-poster from
 * OpenMOSS's Apache-2.0 prompt-enhancer skill); parseLayout reads it, validateLayout checks it. With no text model, or
 * when its answer can't be used, planByRules lays out a poster from the sentence itself. Pure: the server's route and
 * the tests share it.
 */
import { aspectOf, parseLayout, validateLayout, type LayoutBox, type LayoutDraft, type LayoutItem } from "./layout-prompt";

/** The longest sentence the planner takes. */
export const PLAN_WORDS_MAX = 1000;

/**
 * The planner's instructions. Adapted from OpenMOSS MOSS-Image's prompt-enhancer skill (skills/moss-image-prompt-enhancer
 * SKILL.md and references/layout.md at 2b46b1e0e13b5aaec253879e0d006a42564b8b27), Copyright OpenMOSS, Apache License 2.0.
 */
export const LAYOUT_PLAN_SYSTEM = `You plan image layouts for a picture model that places boxes. Answer with ONE JSON object and nothing else: no code fence, no words before or after it.
The schema: {"width": W, "height": H, "bbox_coord_space": "abs", "bbox_format": "xyxy", "summary": {"caption": "...", "meta": ["..."], "canvas": "single"}, "items": [{"label": "object" | "character" | "text", "caption": "...", "text": "...", "bbox": [x_min, y_min, x_max, y_max]}]}
Rules:
- Use exactly the width and height given. Boxes are whole pixels from the top-left corner: x from 0 to width, y from 0 to height. Never use 0-1 fractions.
- summary.caption describes the whole picture: subject, setting, medium, lighting, palette and mood, in plain sentences.
- One box per coherent visible unit: a headline, a product, a person, a price tag, a button. Usually 3 to 6 boxes. Boxes may overlap where the picture needs it.
- A "text" item carries the exact visible words in "text" (keep the user's wording, spelling and language) and its caption describes the lettering: size, weight, colour, typeface style. Write real copy, never "headline here".
- An "object" or "character" item's caption describes what it looks like. A box is a placement, not a border or a panel to draw.
- Establish a reading order and hierarchy: the headline large, supporting words smaller, enough room for the words to read at this size.
- Keep the user's subject, counts, style and any words they want shown. Don't invent facts such as dates, addresses or prices they didn't give.`;

/** What the planner is asked: the sentence and the canvas it draws on. */
export function planRequest(words: string, width: number, height: number): string {
  return `Canvas: ${width} × ${height} pixels (width × height).\nPlan the layout for: ${words.trim()}`;
}

/** A model's answer as a draft on this canvas, when it is one that runs (no errors from validateLayout). */
export function readPlanned(text: string | null | undefined, width: number, height: number): LayoutDraft | null {
  if (!text?.trim()) return null;
  const parsed = parseLayout(text, { width, height });
  if (!parsed || !parsed.draft.items.length) return null;
  const draft: LayoutDraft = { ...parsed.draft, aspect: aspectOf(width, height) ?? parsed.draft.aspect };
  return validateLayout(draft, width, height).some((i) => i.level === "error") ? null : draft;
}

// ---------------------------------------------------------------------------
// The rules (no text model)

const OFFER = /(\d{1,3}\s?%\s?off|half price|buy one,? get one(?: free)?|free shipping|[$£€]\s?\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s?(?:usd|eur|gbp|€|£))/i;
const QUOTED = /["“”«‘']([^"“”«»‘’']{2,80})["”»’']/;
const FOR_WHOM = /\bfor (?:my|our|the|a|an)\s+([\p{L}\p{N}'&-]+(?:\s+[\p{L}\p{N}'&-]+){0,3})/iu;
const STOP = /\s+(?:with|and|that|which|in|on|at|for)\b.*$/i;

const title = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 2 || /^[A-Z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

const box = (x0: number, y0: number, x1: number, y1: number): LayoutBox => [x0, y0, x1, y1];

/**
 * A poster from the sentence alone: the words in quotes (or an offer such as "30% off", or who it is for) as the
 * headline, the offer under it when the headline is something else, the subject in the middle and a button. Portrait
 * and square canvases stack them; a wide one puts the words in a column beside the subject.
 */
export function planByRules(words: string, width: number, height: number): LayoutDraft {
  const said = words.trim().replace(/\s+/g, " ");
  const quoted = QUOTED.exec(said)?.[1]?.trim();
  const offer = OFFER.exec(said)?.[1]?.trim();
  const whom = FOR_WHOM.exec(said)?.[1]?.replace(STOP, "").trim();
  const headline =
    quoted ??
    (offer
      ? offer.toUpperCase()
      : whom
        ? title(whom)
        : title(
            said
              .split(/[,.;:!?]/)[0]
              .split(" ")
              .slice(0, 5)
              .join(" "),
          ));
  const second = quoted && offer ? offer.toUpperCase() : !quoted && offer && whom ? title(whom) : "";
  const subject =
    said
      .replace(QUOTED, "")
      .replace(OFFER, "")
      .replace(/[,\s]+$/, "")
      .trim() || said;
  const wide = width > height * 1.2;
  const items: LayoutItem[] = wide
    ? [
        { label: "text", caption: "A large, bold headline in clean lettering, high contrast against the background", text: headline, box: box(0.06, 0.18, 0.48, 0.44) },
        ...(second ? [{ label: "text" as const, caption: "Smaller supporting words under the headline, bold and easy to read", text: second, box: box(0.06, 0.48, 0.44, 0.6) }] : []),
        { label: "text", caption: "A rounded button with a short call to action in bold letters", text: "Shop now", box: box(0.06, 0.7, 0.28, 0.82) },
        { label: "object", caption: `The hero of the picture: ${subject}`, box: box(0.52, 0.1, 0.94, 0.9) },
      ]
    : [
        { label: "text", caption: "A large, bold headline in clean lettering, high contrast against the background", text: headline, box: box(0.08, 0.05, 0.92, 0.2) },
        ...(second ? [{ label: "text" as const, caption: "Smaller supporting words under the headline, bold and easy to read", text: second, box: box(0.2, 0.21, 0.8, 0.29) }] : []),
        { label: "object", caption: `The hero of the picture: ${subject}`, box: box(0.14, 0.32, 0.86, 0.82) },
        { label: "text", caption: "A rounded button with a short call to action in bold letters", text: "Shop now", box: box(0.3, 0.86, 0.7, 0.95) },
      ];
  const caption = said ? said[0].toUpperCase() + said.slice(1).replace(/[.\s]*$/, ".") : "";
  const aspect = aspectOf(width, height);
  return { summary: { caption, meta: ["poster", "graphic design"], canvas: "single" }, items, ...(aspect && { aspect }) };
}
