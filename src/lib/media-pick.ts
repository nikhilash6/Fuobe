/**
 * Which copy of a picture or clip a box needs, for the media that come in several widths (Home's first screen,
 * src/components/home/bento-islands.tsx). A `<picture>`'s srcset lets the browser choose; a `<video>` has no srcset,
 * so its tile chooses with these.
 */

/** One copy of a picture or clip, and its width in pixels. */
export interface Sized {
  src: string;
  w: number;
}

/**
 * The device pixels of width a box asks of media `aspect` (width / height) wide when it covers the box
 * (`object-fit: cover`): the box's width, or more when the box is the taller shape and the media is cropped at its sides.
 */
export function coverWidth(boxW: number, boxH: number, aspect: number, dpr: number): number {
  return Math.ceil(Math.max(boxW, boxH * aspect) * dpr);
}

/** The narrowest copy at least `need` pixels wide, or the widest there is (a copy is never shown past its own size). */
export function pickWidth<T extends Sized>(copies: readonly T[], need: number): T {
  const byWidth = [...copies].sort((a, b) => a.w - b.w);
  return byWidth.find((c) => c.w >= need) ?? byWidth[byWidth.length - 1];
}
