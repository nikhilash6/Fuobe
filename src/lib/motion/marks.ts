/**
 * Highlights the person marks in a typed field (pure): a pair of stars round a word or a run of words ("*radiance*")
 * marks it, and the stars are not drawn. Every other star is part of the words and is kept exactly as typed: a lone
 * one ("Rated 5* by guests", "Free delivery*"), one inside a word ("a*b"), an empty pair ("**"), or a pair whose
 * inside starts or ends with a space ("5 * 4 *").
 */

/** A pair: a star, then words that neither start nor end with a space and hold no star, then a star. */
const PAIR = /\*([^\s*](?:[^*]*[^\s*])?)\*/gu;

/** The text to set (the pairs' stars removed, every other star kept) and the marked spans in it. */
export function marked(text: string): { text: string; marks: [number, number][] } {
  const marks: [number, number][] = [];
  let out = "";
  let from = 0;
  for (const m of text.matchAll(PAIR)) {
    out += text.slice(from, m.index);
    marks.push([out.length, out.length + m[1].length]);
    out += m[1];
    from = m.index + m[0].length;
  }
  return { text: out + text.slice(from), marks };
}

/** The words as they are set: the marking stars gone, every other star kept. */
export const unmarked = (text: string): string => marked(text).text;
