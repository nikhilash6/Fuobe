/**
 * The Image studio's framing tip: a wide scene with a person in it (an aerial shot, a full-length look, a model on a
 * dune) asked for as a small square comes out with a small figure and soft faces. The composer offers a wider, larger
 * frame in one tap; the run is never held back. Plain words, read in the browser as the prompt is typed.
 */

/** Words that frame a whole scene or a whole figure: a square at a small size leaves the face only a few pixels. */
const WIDE = /\b(aerial|drone|birds?['’]?[- ]eye|wide[- ](?:shot|angle)|extreme wide|establishing shot|full[- ](?:body|length)|head[- ]to[- ]toe|long shot|panoram(?:a|ic))\b/i;

/** A big place around the figure. */
const SCENE = /\b(vast|landscape|dunes?|desert|horizon|crest|ridge|mountains?|mountaintop|cliffs?|canyon|valley|beach|coastline|shoreline|meadow|skyline)\b/i;

/** Someone in the picture. */
const PERSON =
  /\b(model|models|woman|women|man|men|girl|girls|boy|boys|person|people|she|he|her|him|couple|dancer|figure|bride|groom|lady|actress|actor|rider|surfer|athlete|hiker|family)\b/i;

/** A close framing: the face is already big in a square. */
const CLOSE = /\b(close[- ]?up|headshot|head shot|portrait|macro|detail shot)\b/i;

/** A wide or full-length scene with a person in it. A close-up is left alone unless the words also ask for the wide frame. */
export function widePersonPrompt(prompt: string): boolean {
  const p = prompt.trim();
  if (!p || !PERSON.test(p)) return false;
  return WIDE.test(p) || (SCENE.test(p) && !CLOSE.test(p));
}

/** A size as a number of K ("1K" 1, "1.5K" 1.5, "4MP" 2, "1024" 1); NaN when it isn't one. */
export function sizeK(v: string | undefined): number {
  if (!v) return NaN;
  const k = /^(\d+(?:\.\d+)?)\s*k$/i.exec(v.trim());
  if (k) return Number(k[1]);
  const mp = /^(\d+(?:\.\d+)?)\s*mp$/i.exec(v.trim());
  if (mp) return Math.sqrt(Number(mp[1]));
  const px = /^(\d{3,4})(?:px)?$/i.exec(v.trim());
  return px ? Number(px[1]) / 1024 : NaN;
}

/** What one tap sets: the wide shape, and a larger size when the model offers one. */
export interface FramingFix {
  aspectRatio: string;
  resolution?: string;
}

/** The size a wide scene is offered at: up to 2K. */
const TARGET_K = 2;
/** A square this size or smaller is a small square. */
const SMALL_K = 1.5;
export const WIDE_ASPECT = "16:9";

/**
 * The tip for this prompt and these settings, or null. `aspects` and `resolutions` are what the model offers for this
 * run (null when the run's shape is not picked here, like an edit that follows its picture).
 */
export function framingSuggestion(input: { prompt: string; aspect: string | undefined; resolution: string | undefined; aspects: string[] | null; resolutions: string[] | null }): FramingFix | null {
  const { prompt, aspect, resolution, aspects, resolutions } = input;
  if (aspect !== "1:1" || !aspects?.includes(WIDE_ASPECT)) return null;
  const now = sizeK(resolution);
  if (now > SMALL_K) return null;
  if (!widePersonPrompt(prompt)) return null;
  // The largest size up to 2K that is larger than now.
  const bigger = (resolutions ?? [])
    .map((r) => ({ r, k: sizeK(r) }))
    .filter((x) => x.k <= TARGET_K && (Number.isNaN(now) || x.k > now))
    .sort((a, b) => b.k - a.k)[0];
  return { aspectRatio: WIDE_ASPECT, ...(bigger && { resolution: bigger.r }) };
}

/** The tap's words: "Use 16:9 · 2K". */
export const framingLabel = (fix: FramingFix) => `Use ${[fix.aspectRatio, fix.resolution].filter(Boolean).join(" · ")}`;
