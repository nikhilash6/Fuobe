#!/usr/bin/env node
// Fails when a tracked file's path or text names the parity studio. CI runs it before the build (it needs only Node and
// git, no install); tests/neutral-names.test.ts checks the same under pnpm test. Both read the matcher and the interim
// list from tests/helpers/retired-name.mjs, so they can't drift.
//
// It prints where, never what: `path:line`, with any part of a path that names it masked. Exit 0 clean, 1 named, 2
// when git can't list the checkout.
//
// Run:  node scripts/check-neutral-names.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INTERIM_ALLOWED, formatHit, scanTree } from "../tests/helpers/retired-name.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "scripts/check-neutral-names.mjs";
const LIST = "tests/helpers/retired-name.mjs (INTERIM_ALLOWED)";
const ACTIONS = process.env.GITHUB_ACTIONS === "true";

// GitHub's workflow commands (::error file=…,line=…::message) put the finding on the commit's file and line.
const escapeData = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
function report(level, message, hit) {
  const text = hit ? `${formatHit(hit)}: ${message}` : message;
  if (!ACTIONS) {
    (level === "error" ? console.error : console.log)(`${level}: ${text}`);
    return;
  }
  // A masked path can't point at its file, so only an unmasked one is linked.
  const linked = hit && !hit.file.includes("[…]");
  const props = linked ? ` file=${escapeProperty(hit.file)}${hit.line ? `,line=${hit.line}` : ""}` : "";
  console.log(`::${level}${props}::${escapeData(text)}`);
}

const started = Date.now();
let scan;
try {
  scan = scanTree(ROOT);
} catch (e) {
  report("error", `git couldn't list the tracked files: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  process.exit(2);
}
if (!scan.files.includes(SELF)) {
  report("error", `git listed ${scan.files.length} files, without ${SELF}: run it from a checkout of the repository.`);
  process.exit(2);
}

for (const p of scan.namedPaths) report("error", `A tracked path names the parity studio: ${p}. Rename it with a neutral word.`);
for (const hit of scan.hits) report("error", 'This line names the parity studio. Write "the parity studio" (or "the parity research") instead.', hit);
for (const f of scan.missing) report("warning", `${f} is on the interim list but not tracked: take it off ${LIST}.`);
for (const f of scan.cleared) report("notice", `${f} no longer names it: take it off ${LIST}.`);

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const interim = Object.keys(INTERIM_ALLOWED).length;
const summary = `neutral names: ${count(scan.files.length, "tracked file")} in ${seconds} s${interim ? `, ${scan.skipped.length} of ${interim} interim files not checked yet` : ""}`;
if (scan.namedPaths.length || scan.hits.length) {
  const files = new Set(scan.hits.map((h) => h.file)).size;
  const found = [scan.namedPaths.length && count(scan.namedPaths.length, "path"), scan.hits.length && `${count(scan.hits.length, "line")} in ${count(files, "file")}`];
  console.error(`${summary}: ${found.filter(Boolean).join(" and ")} name the parity studio.`);
  process.exit(1);
}
console.log(`${summary}: clean.`);
