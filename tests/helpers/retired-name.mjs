// The name of the closed studio Fuobe's parity research measures against, as a check that never spells it.
// The repo calls that studio "the parity studio" and never writes its name. Two checks read this one module, so their
// matcher and their interim list can't drift: tests/neutral-names.test.ts (pnpm test) and scripts/check-neutral-names.mjs
// (CI, before the build). Only the SHA-256 of the lower-case name and its length are kept here.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

/**
 * Interim, by path only: three files whose comments (and one migration's SQL) still name the studio until the change
 * that rewords them lands. Remove each line in that change, and this list with the last one.
 * @type {Readonly<Record<string, string>>}
 */
export const INTERIM_ALLOWED = Object.freeze({
  "src/server/db.ts": "migration 22's comment and SQL",
  "src/server/generations.ts": "two comments",
  "src/components/studio/feed.tsx": "one comment",
});

/**
 * Every tracked file under `root`, as git lists it (paths with forward slashes).
 * @param {string} root
 * @returns {string[]}
 */
export function trackedFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  return out.split("\0").filter(Boolean);
}

/**
 * A file is binary when its first 8 KB hold a NUL byte (git's own test).
 * @param {Buffer} buf
 */
export const isBinary = (buf) => buf.subarray(0, 8192).includes(0);

/**
 * A path safe to print: each part that names it becomes "[…]" (all of it, when only the whole path does).
 * @param {string} file
 * @param {(text: string) => boolean} [mentions]
 */
export function maskPath(file, mentions = mentionsRetiredName) {
  if (!mentions(file)) return file;
  const masked = file
    .split("/")
    .map((part) => (mentions(part) ? "[…]" : part))
    .join("/");
  return mentions(masked) ? "[…]" : masked;
}

/**
 * @typedef {{ file: string, line?: number }} NameHit A line that names it (`file` already masked); no `line` when the
 * name is split across two lines.
 */

/**
 * The lines of one file's `text` that name it.
 * @param {string} file
 * @param {string} text
 * @param {(text: string) => boolean} [mentions]
 * @returns {NameHit[]}
 */
export function hitsIn(file, text, mentions = mentionsRetiredName) {
  if (!mentions(text)) return [];
  const shown = maskPath(file, mentions);
  const lines = text.split(/\r?\n/).flatMap((line, i) => (mentions(line) ? [{ file: shown, line: i + 1 }] : []));
  return lines.length ? lines : [{ file: shown }];
}

/**
 * `path:line`, or `path (split across lines)`.
 * @param {NameHit} hit
 */
export const formatHit = (hit) => (hit.line ? `${hit.file}:${hit.line}` : `${hit.file} (split across lines)`);

/**
 * Every tracked file under `root`, checked: its path, then its text unless it is binary or on the interim list. A file
 * on the list is still read, to say when its entry can go.
 * @param {string} root
 * @param {{ mentions?: (text: string) => boolean, interim?: Readonly<Record<string, string>> }} [options]
 * @returns {{
 *   files: string[],
 *   namedPaths: string[],
 *   hits: NameHit[],
 *   skipped: string[],
 *   cleared: string[],
 *   missing: string[],
 * }} namedPaths: tracked paths that name it (masked); hits: lines outside the interim list; skipped: interim files that
 *   still name it; cleared: interim files that no longer do; missing: interim entries git doesn't track.
 */
export function scanTree(root, { mentions = mentionsRetiredName, interim = INTERIM_ALLOWED } = {}) {
  const files = trackedFiles(root);
  const namedPaths = files.filter((f) => mentions(f)).map((f) => maskPath(f, mentions));
  const hits = [];
  const skipped = [];
  const cleared = [];
  for (const f of files) {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) continue; // deleted in the working tree, not yet committed
    const buf = fs.readFileSync(full);
    if (isBinary(buf)) continue;
    const found = hitsIn(f, buf.toString("utf8"), mentions);
    if (Object.hasOwn(interim, f)) (found.length ? skipped : cleared).push(f);
    else hits.push(...found);
  }
  const tracked = new Set(files);
  const missing = Object.keys(interim).filter((f) => !tracked.has(f));
  return { files, namedPaths, hits, skipped, cleared, missing };
}
