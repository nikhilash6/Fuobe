/**
 * The name visitors read for this install's GPUs (hosted runs): "Runs on {place}", "Made on: {Place}", "Run on {Place}".
 * The code never names them: the name comes from the billing service's policy (`placeName`), else the install's own
 * setting (Settings → Workers → Name for your GPUs, or FUOBE_PLACE_NAME), else PLACE_NAME_DEFAULT
 * (src/server/place-name.ts reads them in that order; the browser gets it as `viewer.placeName`, only while hosted runs
 * are on).
 *
 * Every sentence is written so that no verb has to agree with the name ("Runs on {place}", never "{place} are…"), so any
 * name reads right.
 */

/** The name when nothing sets one. */
export const PLACE_NAME_DEFAULT = "Our GPUs";

/** The longest name kept (characters); a longer one is cut there. */
export const PLACE_NAME_MAX = 40;

/** The place name two ways: `label` as set ("Our GPUs", a heading or a button), `text` inside a sentence ("our GPUs"). */
export interface Place {
  label: string;
  text: string;
}

/**
 * A name as it is kept: control characters out, spaces folded, trimmed, at most PLACE_NAME_MAX characters (an emoji is
 * never cut in half). Null when nothing is left, or it isn't text.
 */
export function cleanPlaceName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const chars = Array.from(s);
  return chars.length <= PLACE_NAME_MAX ? s : chars.slice(0, PLACE_NAME_MAX).join("").trimEnd();
}

/** The place for a name (PLACE_NAME_DEFAULT when none): a leading "Our " reads "our " inside a sentence. */
export function placeOf(name?: string | null): Place {
  const label = cleanPlaceName(name) ?? PLACE_NAME_DEFAULT;
  return { label, text: label.replace(/^Our /, "our ") };
}

/** The last name the status gave this browser, for words made outside React (a toast's button). */
let known: string | null = null;

/** Note the name the status gave (GET /api/status `viewer.placeName`). */
export function notePlaceName(name: unknown): void {
  known = cleanPlaceName(name);
}

/** The place as this browser last heard it (the default before it heard one). */
export const knownPlace = (): Place => placeOf(known);
