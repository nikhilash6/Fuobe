// The name of the closed studio Fuobe's parity research measures against, as a check that never spells it.
// The repo calls that studio "the parity studio" and never writes its name (tests/neutral-names.test.ts).
// Only the SHA-256 of the lower-case name and its length are kept here.
import { createHash } from "node:crypto";

const RETIRED_NAME_SHA256 = "50b2676afbe30c833f43fedf384f115302474c88365501ad94ba93aec48777c6";
const RETIRED_NAME_LENGTH = 10;

/**
 * The words of `text`, lower case: camelCase and PascalCase split apart, then split on everything that isn't a letter
 * (digits, spaces, hyphens, dots, underscores). "QuokkaBirdProvider" → quokka, bird, provider.
 */
export function wordsOf(text) {
  return String(text)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/**
 * A test for one word, known only by the SHA-256 of its lower-case spelling and its length. It looks at every word of
 * that length, every window of that length inside a longer word (a glued id), and every pair of neighbouring words
 * joined (the name split by a space, a hyphen or a capital). Each distinct candidate is hashed once.
 */
export function matcherFor(sha256Hex, length) {
  const seen = new Map();
  const hit = (candidate) => {
    let v = seen.get(candidate);
    if (v === undefined) {
      v = createHash("sha256").update(candidate).digest("hex") === sha256Hex;
      seen.set(candidate, v);
    }
    return v;
  };
  return function mentions(text) {
    const words = wordsOf(text);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.length === length) {
        if (hit(w)) return true;
      } else if (w.length > length) {
        for (let j = 0; j + length <= w.length; j++) if (hit(w.slice(j, j + length))) return true;
      }
      const next = words[i + 1];
      if (next && w.length + next.length === length && hit(w + next)) return true;
    }
    return false;
  };
}

/** True when `text` names the parity studio in any spelling: one word, two words, hyphenated, glued or in an identifier. */
export const mentionsRetiredName = matcherFor(RETIRED_NAME_SHA256, RETIRED_NAME_LENGTH);
