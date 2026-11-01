#!/usr/bin/env node
// Prints the next stage's prompt for one package, from a script make-workflow.mjs wrote, for a session that builds
// without the Workflow tool (docs/HANDOFF.md, "Building without the Workflow tool").
// Usage: node docs/handoff/next-prompt.mjs <script.js> <key>
// It runs the script's own code with an agent() that prints the first prompt it is given and stops: the stage that the
// finished stages (queue.json `done`, --journal, --done) leave next for that package (impl, review, fix or merge), with
// the fields its report has. Nothing else runs: no agent, no git command.
import fs from "node:fs";

const [file, key] = process.argv.slice(2);
if (!file || !key) {
  console.error("usage: node docs/handoff/next-prompt.mjs <script.js> <key>");
  process.exit(2);
}
const src = fs.readFileSync(file, "utf8").replace("export const meta", "const meta");
const end = src.lastIndexOf("const results = await Promise.all");
if (end === -1) throw new Error(`${file} is not a script make-workflow.mjs wrote`);

const agent = async (prompt, o) => {
  process.stdout.write(`=== ${o.label} (report fields: ${Object.keys(o.schema.properties).join(", ")})\n${prompt}\n`);
  process.exit(0);
};
const k = JSON.stringify(key);
const AsyncFunction = (async () => {}).constructor;
const body = `${src.slice(0, end)}
if (!PKGS[${k}]) throw new Error("not in this script (not queued, left out, or already merged into the base): " + ${k});
return runO(PKGS[${k}]);`;
const r = await new AsyncFunction("agent", "log", body)(agent, console.log).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
console.log(`${key}: no stage to print (${r?.failed ?? "every stage is done"})`);
