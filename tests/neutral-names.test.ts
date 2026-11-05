import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";
import { INTERIM_ALLOWED, formatHit, maskPath, matcherFor, mentionsRetiredName, scanTree, wordsOf } from "./helpers/retired-name.mjs";

/**
 * The repo never names the closed studio its parity research measures Fuobe against: code, tests, docs, research, file
 * names, everything tracked. Write "the parity studio" (or "the parity research" for where a fact came from). This test
 * knows the name only as a hash (tests/helpers/retired-name.mjs), so it never spells it either.
 *
 * CI runs the same check before every build (scripts/check-neutral-names.mjs, in .github/workflows/deploy.yml), with the
 * matcher and the interim list (INTERIM_ALLOWED) from the same module.
 */

const ROOT = path.resolve(__dirname, "..");

/** A stand-in for the name, with its own matcher: the scan's own tests plant this word, never the real one. */
const WORD = "quokkabird";
const standIn = matcherFor(createHash("sha256").update(WORD).digest("hex"), WORD.length);

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

/** A new git repository holding `files` (path → text or bytes), all added. */
function repoWith(files: Record<string, string | Buffer>): string {
  const dir = tempDir("fuobe-neutral-");
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  return dir;
}

describe("neutral names: the parity studio is never named", () => {
  let scan: ReturnType<typeof scanTree>;
  beforeAll(() => {
    scan = scanTree(ROOT);
  }, 120_000); // about 12,700 files and 50 MB of text: a few seconds, longer on a busy machine

  it("reads every tracked file", () => {
    expect(scan.files.length).toBeGreaterThan(3000);
    expect(scan.files).toContain("src/server/providers/index.ts");
    expect(scan.files).toContain("docs/research/README.md");
  });

  it("names no tracked file or folder after it", () => {
    expect(scan.namedPaths).toEqual([]);
  });

  it("finds it in no tracked text file", () => {
    if (scan.skipped.length) console.info(`neutral names: not yet checked: ${scan.skipped.join(", ")}`);
    expect(scan.hits.map(formatHit)).toEqual([]);
  });

  it("keeps the interim list honest: each file on it still exists", () => {
    expect(scan.missing).toEqual([]);
    for (const f of Object.keys(INTERIM_ALLOWED)) expect(scan.files, f).toContain(f);
  });

  it("catches every spelling, shown here with a stand-in word", () => {
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
      expect(standIn(p), p).toBe(true);
    for (const ok of ["Quokka Audio v2", "a quokka", "bird watching", "quokka-audio"]) expect(standIn(ok), ok).toBe(false);
    expect(wordsOf("QuokkaBirdProvider HTMLParser x2y")).toEqual(["quokka", "bird", "provider", "html", "parser", "x", "y"]);
  });

  it("leaves unrelated words alone", () => {
    for (const ok of ["Higgs Audio v2 3B (HiggsAudioEngineNode)", "the parity studio's Soul", "Hugging Face (HF_TOKEN)"]) expect(mentionsRetiredName(ok), ok).toBe(false);
  });

  it("scans a tree the way CI does, and says where without the word (stand-in)", () => {
    const dir = repoWith({
      "src/a.ts": "const ok = 1;\nconst viaQuokkaBird = true;\n",
      "docs/split.md": "the quokka\nbird studio\n",
      "docs/quokkabird-inventory/notes.md": "clean\n",
      "src/still.ts": "// QUOKKABIRD_API_KEY\n",
      "src/done.ts": "// reworded\n",
      "public/x.bin": Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(WORD)]),
    });
    const r = scanTree(dir, { mentions: standIn, interim: { "src/still.ts": "one comment", "src/done.ts": "one comment", "src/gone.ts": "renamed" } });
    expect(r.files).toHaveLength(6);
    expect(r.namedPaths).toEqual(["docs/[…]/notes.md"]);
    expect(r.hits.map(formatHit)).toEqual(["docs/split.md (split across lines)", "src/a.ts:2"]);
    expect(r.skipped).toEqual(["src/still.ts"]);
    expect(r.cleared).toEqual(["src/done.ts"]);
    expect(r.missing).toEqual(["src/gone.ts"]);
    // A path is printed with each part that names it masked, or masked whole when only the whole path does.
    expect(maskPath("docs/research/quokka-bird-api.json", standIn)).toBe("docs/research/[…]");
    expect(maskPath("docs/quokka/bird.md", standIn)).toBe("[…]");
    expect(maskPath("docs/research/README.md", standIn)).toBe("docs/research/README.md");
  });

  it("runs as CI's first check, before the install and the build", () => {
    const yml = fs.readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8");
    const at = (s: string) => yml.indexOf(s);
    expect(at("node scripts/check-neutral-names.mjs")).toBeGreaterThan(at("actions/setup-node@"));
    expect(at("node scripts/check-neutral-names.mjs")).toBeLessThan(at("pnpm install --frozen-lockfile"));
    expect(at("pnpm install --frozen-lockfile")).toBeLessThan(at("pnpm build"));
    expect(at("pnpm build")).toBeLessThan(at("\n  deploy:"));
  });

  it("the CI script runs on a checkout with Node and git alone, and passes a clean one", () => {
    const self = (f: string) => fs.readFileSync(path.join(ROOT, f));
    const dir = repoWith({
      "scripts/check-neutral-names.mjs": self("scripts/check-neutral-names.mjs"),
      "tests/helpers/retired-name.mjs": self("tests/helpers/retired-name.mjs"),
      "src/server/db.ts": "// clean\n",
      "README.md": "the parity studio\n",
    });
    const out = execFileSync(process.execPath, [path.join(dir, "scripts/check-neutral-names.mjs")], { cwd: dir, env: { ...process.env, GITHUB_ACTIONS: "true" } }).toString();
    expect(out).toMatch(/^::notice::src\/server\/db\.ts no longer names it/m);
    expect(out).toMatch(/^::warning::src\/server\/generations\.ts is on the interim list but not tracked/m);
    expect(out).toMatch(/neutral names: 4 tracked files in [\d.]+ s, 0 of 3 interim files not checked yet: clean\.$/m);
  });
});
