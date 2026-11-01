/**
 * Live edit's text rules (pure, shared by the tab and the server). A render is keyed by what the text means to the
 * model, not by every keystroke: runs of spaces, invisible characters and a trailing full stop change nothing, so they
 * cost no render. Case is kept, because quoted lettering depends on it.
 */

/** The longest live text (the graph check refuses more). */
export const MAX_LIVE_TEXT = 600;

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;
const LEADING = /^[\s.,;:!?…\-–—·•*]+/u;
const TRAILING = /[\s.,;:!?…]+$/u;

/** What the model is asked: NFC, no invisible characters, single spaces, no leading or trailing punctuation. */
export function normalize(s: string): string {
  return s.normalize("NFC").replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim().replace(LEADING, "").replace(TRAILING, "").slice(0, MAX_LIVE_TEXT);
}

/** The text up to its last word boundary: what can render while a word is still being typed. */
export function completedWords(s: string): string {
  const t = s.replace(ZERO_WIDTH, "");
  if (/[\s.,;:!?…]$/u.test(t)) return t;
  const at = Math.max(t.lastIndexOf(" "), t.lastIndexOf("\n"), t.lastIndexOf("\t"));
  return at < 0 ? "" : t.slice(0, at);
}

/** A typed character that ends a word: the moment to render the words so far. */
export const endsWord = (ch: string) => /^[\s.,;:!?…]$/u.test(ch);

export interface KeyParts {
  /** The base picture's input name (a master or the original), or "" for text to image. */
  base: string;
  refs?: string[];
  mask?: string;
  text: string;
  seed: number;
  size: number;
  aspect?: string;
  method?: string;
  /** "live" frames and "keep" masters of the same text are different pictures. */
  quality?: "live" | "keep";
}

/** A stable key for one render: equal keys make the same picture. */
export function renderKey(p: KeyParts): string {
  return JSON.stringify([p.base, p.refs ?? [], p.mask ?? "", normalize(p.text), p.seed >>> 0, p.size, p.base ? "" : (p.aspect ?? "1:1"), p.method ?? "hybrid", p.quality ?? "live"]);
}
