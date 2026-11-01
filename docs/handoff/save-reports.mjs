#!/usr/bin/env node
// Saves the stage reports of the packages merged into the base, for the next PR's description (docs/HANDOFF.md,
// "Before a session ends"; pr-describe.js reads the folder as its `reports`).
// Usage: node docs/handoff/save-reports.mjs <out-dir> [--done <results.json>]… [<journal.jsonl>]…
//   <out-dir>     where <key>.json goes, e.g. docs/handoff/reports
//   --done        stages finished without the Workflow tool: { key: { impl?, review?, fix?, merge? } }
//   journal.jsonl a build workflow's journal (in its transcript folder), oldest first
// Sources, oldest first: queue.json `done` (stages finished in earlier sessions: run this before make-workflow.mjs
// --save-done, which drops merged packages from it), then the arguments in their order. As in make-workflow.mjs, a
// stage run again drops the later stages of the earlier attempt. A package is saved when it has an integrator's report
// that merged it, as <out-dir>/<key>.json: { key, impl, review, fix, merge }.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [outDir, ...args] = process.argv.slice(2);
if (!outDir || outDir.startsWith("--")) {
  console.error("usage: node docs/handoff/save-reports.mjs <out-dir> [--done <results.json>]… [<journal.jsonl>]…");
  process.exit(2);
}

const STAGES = ["impl", "review", "fix", "merge"];
const reports = {};
const add = (key, stage, result) => {
  const r = (reports[key] ??= {});
  for (const later of STAGES.slice(STAGES.indexOf(stage) + 1)) delete r[later];
  r[stage] = result;
};
const addAll = (done) => {
  for (const [key, stages] of Object.entries(done ?? {})) {
    for (const stage of STAGES) if (stages?.[stage]) add(key, stage, stages[stage]);
  }
};

addAll(JSON.parse(fs.readFileSync(path.join(here, "queue.json"), "utf8")).done);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--done") {
    addAll(JSON.parse(fs.readFileSync(args[++i], "utf8")));
    continue;
  }
  // Each journal line is {type, key, label?, result?}: the label ("<stage>:<package>") comes with "started".
  const label = {};
  for (const line of fs.readFileSync(args[i], "utf8").split("\n")) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (j.label) label[j.key] = j.label;
    if (j.type !== "result" || !label[j.key] || !j.result || typeof j.result !== "object") continue;
    const [stage, key] = label[j.key].split(":");
    if (STAGES.includes(stage) && key) add(key, stage, j.result);
  }
}

const saved = Object.entries(reports).filter(([, r]) => r.merge?.merged?.length);
fs.mkdirSync(outDir, { recursive: true });
for (const [key, r] of saved) fs.writeFileSync(path.join(outDir, `${key}.json`), `${JSON.stringify({ key, ...r }, null, 1)}\n`);
console.log(`saved in ${outDir}: ${saved.map(([key, r]) => `${key} (${Object.keys(r).join(", ")})`).join(", ") || "nothing (no merged package in these sources)"}`);
