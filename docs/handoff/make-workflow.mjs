#!/usr/bin/env node
// Writes the build workflow script from docs/handoff/queue.json and workflow.body.js (docs/HANDOFF.md explains it).
// Usage: node docs/handoff/make-workflow.mjs <out.js> --trailer-file <file> [--repo <dir>] [--wt <dir>] [--ext <dir>]
//          [--base <branch>] [--skip key,key] [--only R,O] [--journal <journal.jsonl>]… [--done <results.json>]
//          [--save-done] [--remove-worktrees]
//   --trailer-file  the lines every commit message ends with (the attribution lines your session was given)
//   --repo          the checkout the integrator merges in (default: this repository's main checkout, even when this
//                   script runs from a linked worktree)
//   --wt            where package worktrees go (default: <repo>/../wt)
//   --ext           the folder of owner-shared and downloaded inputs that briefs call @EXT@ (default: <repo>/../ext)
//   --skip          packages to leave out of their lanes (packages already merged into the base, found by their
//                   "Merge branch 'o/<key>'" commits, are left out without it)
//   --only          the lanes to run (default: every lane in the queue)
//   --journal       a stopped build workflow's journal.jsonl (in its transcript folder; repeat for several runs, oldest
//                   first): the implement, review and fix stages it finished are reused, and packages its integrator
//                   merged are left out
//   --done          a JSON object { key: { impl?, review?, fix? } } of finished stages (the agents' reports)
//   --save-done     also writes the merged finished stages of the queued packages that aren't merged yet into
//                   queue.json `done` (before a session ends: then commit queue.json to the base and push)
//   --remove-worktrees  the integrator removes clean worktrees of merged branches (only with the owner's go-ahead)
// Finished stages are merged stage by stage, oldest source first: the queue's `done`, then each journal, then --done.
// A source that brings an earlier stage again (a new implement report) drops the later stages older sources had,
// since those were made from the earlier work.
// Before writing, it checks the branches with work in progress (o/<key>, local or on origin): a branch whose
// BASE..o/<key> holds an integrator's merge of another package was cut from a base that has since been rebuilt, and
// merging it would bring that work back, so the script stops and says which branches to move first.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const out = argv[0];
const trailerFile = opt("--trailer-file");
if (!out || out.startsWith("--") || !trailerFile) {
  console.error("usage: node docs/handoff/make-workflow.mjs <out.js> --trailer-file <file> [options]");
  process.exit(2);
}

// The main checkout: the parent of the shared git directory (a linked worktree's own top folder is not it).
const mainCheckout = () => path.dirname(execFileSync("git", ["-C", here, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim());
const repo = path.resolve(opt("--repo") ?? mainCheckout());
const wt = path.resolve(opt("--wt") ?? path.join(repo, "..", "wt"));
const ext = path.resolve(opt("--ext") ?? path.join(repo, "..", "ext"));
const queue = JSON.parse(fs.readFileSync(path.join(here, "queue.json"), "utf8"));
const base = opt("--base") ?? queue.base;
const trailer = fs.readFileSync(trailerFile, "utf8").trim();
const skip = new Set((opt("--skip") ?? "").split(",").filter(Boolean));
const only = opt("--only")?.split(",").filter(Boolean);

// Packages the integrator merged: "Merge branch 'o/<key>' into <base>" on the base's history (local or origin).
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const exists = (ref) => { try { git("rev-parse", "--verify", "-q", ref); return true; } catch { return false; } };
const baseRef = [base, `origin/${base}`].find(exists);
if (!baseRef) throw new Error(`no branch ${base} or origin/${base} in ${repo}: git fetch origin first`);
const mergedKeys = (subjects) => [...subjects.matchAll(/^Merge branch 'o\/([^']+)'/gm)].map((m) => m[1]);
const merged = new Set(mergedKeys(git("log", "--format=%s", baseRef)));

// Stages finished by earlier build workflows: each journal line is {type, key, label?, result?}.
const STAGES = ["impl", "review", "fix"];
const journals = [];
argv.forEach((a, i) => {
  if (a !== "--journal") return;
  const label = {};
  const stages = {};
  for (const line of fs.readFileSync(argv[i + 1], "utf8").split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (j.label) label[j.key] = j.label;
    if (j.type !== "result" || !label[j.key] || !j.result) continue;
    const [stage, key] = label[j.key].split(":");
    if (STAGES.includes(stage)) {
      const s = (stages[key] ??= {});
      // A stage run again makes the later stages of an earlier attempt stale.
      for (const later of STAGES.slice(STAGES.indexOf(stage) + 1)) delete s[later];
      s[stage] = j.result;
    }
    if (stage === "merge" && j.result.merged?.length) merged.add(key);
  }
  journals.push(stages);
});
const doneFile = opt("--done") ? JSON.parse(fs.readFileSync(opt("--done"), "utf8")) : {};
const done = {};
for (const src of [queue.done ?? {}, ...journals, doneFile]) {
  for (const [k, v] of Object.entries(src)) {
    const first = STAGES.findIndex((s) => s in v);
    const kept = Object.fromEntries(Object.entries(done[k] ?? {}).filter(([s]) => first === -1 || STAGES.indexOf(s) < first));
    done[k] = { ...kept, ...v };
  }
}

const lanes = {};
for (const [name, keys] of Object.entries(queue.lanes)) {
  if (only && !only.includes(name)) continue;
  const left = keys.filter((k) => !skip.has(k) && !merged.has(k));
  if (left.length) lanes[name] = left;
}
const pkgs = {};
for (const key of Object.values(lanes).flat()) {
  const p = queue.packages[key];
  if (!p) throw new Error(`queue.json has no package ${key}`);
  const wip = queue.wip?.[key];
  pkgs[key] = { key, title: p.title, phase: p.phase, brief: p.brief.replaceAll("@EXT@", ext), ...(wip && { wip }) };
}
const keep = Object.fromEntries(Object.entries(done).filter(([k]) => k in pkgs));
const phases = [...new Set(Object.values(pkgs).map((p) => p.phase))];

// Before a session ends: keep the finished stages of every queued package that isn't merged yet in queue.json `done`.
if (argv.includes("--save-done")) {
  const queued = new Set(Object.values(queue.lanes).flat());
  queue.done = Object.fromEntries(Object.entries(done).filter(([k]) => queued.has(k) && !merged.has(k)));
  fs.writeFileSync(path.join(here, "queue.json"), `${JSON.stringify(queue, null, 1)}\n`);
  const saved = Object.entries(queue.done).map(([k, v]) => `${k} (${Object.keys(v).join(", ")})`);
  console.log(`queue.json done now holds: ${saved.join(", ") || "nothing"}; commit it to ${base} and push (docs/HANDOFF.md, "Before a session ends")`);
}

// Branches cut from a base that has since been rebuilt (docs/HANDOFF.md, "Work in progress").
const stale = [];
for (const key of Object.keys(pkgs)) {
  for (const ref of [`refs/heads/o/${key}`, `refs/remotes/origin/o/${key}`]) {
    if (!exists(ref)) continue;
    const others = [...new Set(mergedKeys(git("log", "--format=%s", `${baseRef}..${ref}`)).filter((k) => k !== key))];
    const named = others.slice(0, 5).map((k) => `o/${k}`).join(", ") + (others.length > 5 ? ` and ${others.length - 5} more` : "");
    if (others.length) stale.push(`${ref.replace(/^refs\/(heads|remotes)\//, "")} (it carries merges of ${named})`);
  }
}
if (stale.length) {
  console.error(`These branches were cut from a base that has since been rebuilt; move their own commits onto ${baseRef} first (git rebase --onto ${baseRef} <old base> <branch>; docs/HANDOFF.md, "Work in progress"), or leave the packages out with --skip:\n  ${stale.join("\n  ")}`);
  process.exit(1);
}

const meta = {
  name: "fuobe-continue",
  description: `Continue Fuobe's build queue: lanes ${Object.keys(lanes).join(", ")}, ${Object.keys(pkgs).length} packages, each implement → review → fix → merge into ${base}`,
  phases: phases.map((title) => ({ title })),
};
const j = (v) => JSON.stringify(v);
const script = [
  `export const meta = ${JSON.stringify(meta, null, 2)}`,
  `const REPO = ${j(repo)}`,
  `const WT = ${j(wt)}`,
  `const EXT = ${j(ext)}`,
  `const BASE = ${j(base)}`,
  `const PLAN = 'docs/research/fuobe-originals-recipes-5.md'`,
  `const TRAILER = ${j(trailer)}`,
  `const REMOVE_WORKTREES = ${argv.includes("--remove-worktrees")}`,
  `const LANES = ${j(lanes)}`,
  `const DONE = ${j(keep)}`,
  `const PKGS = ${j(pkgs)}`,
  fs.readFileSync(path.join(here, "workflow.body.js"), "utf8"),
].join("\n");

const bytes = Buffer.byteLength(script);
if (bytes >= 512 * 1024) throw new Error(`the script is ${bytes} bytes; the Workflow tool takes under 512 KB: run fewer lanes (--only) or skip packages`);
fs.writeFileSync(out, script);
const left = Object.values(queue.lanes).flat().filter((k) => merged.has(k));
if (left.length) console.log(`already merged into ${baseRef}, left out: ${left.join(", ")}`);
const reused = Object.entries(keep).map(([k, v]) => `${k} (${Object.keys(v).join(", ")})`);
console.log(`${out}: ${Object.keys(pkgs).length} packages in lanes ${Object.entries(lanes).map(([n, k]) => `${n} (${k.length}, first ${k[0]})`).join(", ")}; reused stages for ${reused.join(", ") || "none"}; ${bytes} bytes`);
