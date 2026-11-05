import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matcherFor, mentionsRetiredName, wordsOf } from "./helpers/retired-name.mjs";

/**
 * The repo never names the closed studio its parity research measures Fuobe against: code, tests, docs, research, file
 * names, everything tracked. Write "the parity studio" (or "the parity research" for where a fact came from). This test
 * knows the name only as a hash (tests/helpers/retired-name.mjs), so it never spells it either.
 */

const ROOT = path.resolve(__dirname, "..");

/**
 * Interim, by path only: three files whose comments (and one migration's SQL) still name the studio until the change
 * that rewords them lands. Remove each line in that change, and this list with the last one.
 */
const INTERIM_ALLOWED: Record<string, string> = {
  "src/server/db.ts": "migration 22's comment and SQL",
  "src/server/generations.ts": "two comments",
  "src/components/studio/feed.tsx": "one comment",
};

/** Every tracked file, as git lists it (paths with forward slashes). */
function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  return out.split("\0").filter(Boolean);
}

/** A file is binary when its first 8 KB hold a NUL byte (git's own test). */
const isBinary = (buf: Buffer) => buf.subarray(0, 8192).includes(0);

/** `path:line` for each line of `text` that names it. */
function hitsIn(file: string, text: string): string[] {
  if (!mentionsRetiredName(text)) return [];
  const lines = text.split(/\r?\n/).flatMap((line, i) => (mentionsRetiredName(line) ? [`${file}:${i + 1}`] : []));
  return lines.length ? lines : [`${file} (split across lines)`];
}

describe("neutral names: the parity studio is never named", () => {
  const files = trackedFiles();

  it("reads every tracked file", () => {
    expect(files.length).toBeGreaterThan(3000);
    expect(files).toContain("src/server/providers/index.ts");
    expect(files).toContain("docs/research/README.md");
  });

  it("names no tracked file or folder after it", () => {
    expect(files.filter((f) => mentionsRetiredName(f))).toEqual([]);
  });

  it("finds it in no tracked text file", () => {
    const hits: string[] = [];
    const skipped = Object.keys(INTERIM_ALLOWED);
    for (const f of files) {
      if (INTERIM_ALLOWED[f]) continue;
      const full = path.join(ROOT, f);
      if (!fs.existsSync(full)) continue; // deleted in the working tree, not yet committed
      const buf = fs.readFileSync(full);
      if (isBinary(buf)) continue;
      hits.push(...hitsIn(f, buf.toString("utf8")));
    }
    if (skipped.length) console.info(`neutral names: not yet checked: ${skipped.join(", ")}`);
    expect(hits).toEqual([]);
  }, 120_000); // about 3,100 files and 50 MB of text: a few seconds, longer on a busy machine

  it("keeps the interim list honest: each file on it still exists", () => {
    for (const f of Object.keys(INTERIM_ALLOWED)) expect(files, f).toContain(f);
  });

  it("catches every spelling, shown here with a stand-in word", () => {
    const word = "quokkabird";
    const mentions = matcherFor(createHash("sha256").update(word).digest("hex"), word.length);
    for (const p of [
      "export class QuokkaBirdProvider {}",
      "const viaQuokkabird = true;",
      "QUOKKABIRD_API_KEY=x",
      "https://quokkabird.ai/pricing",
      "a quokka bird",
      "the Quokka-Bird studio",
      '"quokkabirdEquivalent": "Soul"',
      'label: "Quokkabird first"',
      "openquokkabirdai",
      "docs/research/quokkabird-inventory.md",
    ])
      expect(mentions(p), p).toBe(true);
    for (const ok of ["Quokka Audio v2", "a quokka", "bird watching", "quokka-audio"]) expect(mentions(ok), ok).toBe(false);
    expect(wordsOf("QuokkaBirdProvider HTMLParser x2y")).toEqual(["quokka", "bird", "provider", "html", "parser", "x", "y"]);
  });

  it("leaves unrelated words alone", () => {
    for (const ok of ["Higgs Audio v2 3B (HiggsAudioEngineNode)", "the parity studio's Soul", "Hugging Face (HF_TOKEN)"]) expect(mentionsRetiredName(ok), ok).toBe(false);
  });
});
