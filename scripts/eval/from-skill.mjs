#!/usr/bin/env node
// pnpm eval:from-skill <name> [--out file] [--url …] [--token …]
//
// Writes an evaluation case (scripts/eval/cases/skill-<name>.json) from a saved skill's recipe: its examples become the
// case's inputs, and the case runs the skill through its own routes (POST /api/assist/skills/<name>/run, priced first by
// …/estimate), so `pnpm eval:run --suite skill-<name> --engine open|cloud` regression-tests the skill on a GPU or the
// cloud under the harness's spend cap. The recipe's checks pick the metrics. The skill is read from the Fuobe server the
// harness measures (the fuobe CLI's server and token).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { connect } from "./lib/server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = { image: "images", video: "video", audio: "audio" };
const METRICS = { image: ["clip", "aesthetic"], video: ["temporal", "clip"], audio: [] };

/** A case input path for an example: a Fuobe file as a link on that server, a link as it is. */
const asInput = (v, server) => (typeof v === "string" && v.startsWith("/api/files/") ? new URL(v, server).href : v);

/**
 * The case for a recipe (pure: the tests call it). Media examples become the case's inputs, and the run's body names
 * them as `{{inputs.…}}`; every other input takes its example (or default).
 * @param {{ name: string, title: string, recipe: { params: any[], steps: any[], checks?: Record<string, any> } }} view
 * @param {string} server the server's address (examples that are Fuobe files become links to it)
 */
export function caseFromSkill(view, server) {
  const { recipe } = view;
  const inputs = {};
  const values = {};
  const missing = [];
  for (const p of recipe.params) {
    const v = p.example ?? p.default;
    const slot = MEDIA[p.type];
    if (slot) {
      if (v === undefined || v === null || v === "") {
        if (p.required) missing.push(p.label);
        continue;
      }
      if (slot === "images") {
        inputs.images = [...(inputs.images ?? []), asInput(v, server)];
        values[p.id] = `{{inputs.images.${inputs.images.length - 1}}}`;
      } else if (!inputs[slot]) {
        inputs[slot] = asInput(v, server);
        values[p.id] = `{{inputs.${slot}}}`;
      } else {
        // A second clip or sound of the same kind: one more of the case's lists (videos, audios).
        const list = slot === "video" ? "videos" : "audios";
        inputs[list] = [...(inputs[list] ?? []), asInput(v, server)];
        values[p.id] = `{{inputs.${list}.${inputs[list].length - 1}}}`;
      }
    } else if (v !== undefined && v !== null && v !== "") values[p.id] = typeof v === "number" ? String(v) : v;
    else if (p.required) missing.push(p.label);
  }
  if (missing.length) throw new Error(`/${view.name} has no example for ${missing.join(", ")}: run it once from its form (Skills → Run…) so it keeps one, then try again`);
  const kinds = Object.values(recipe.checks ?? {}).map((c) => c.kind).filter(Boolean);
  const kind = ["video", "image", "audio"].find((k) => kinds.includes(k)) ?? (recipe.steps.some((s) => s.kind === "tool") ? "video" : "image");
  const generate = recipe.steps.filter((s) => s.kind === "generate");
  const firstModel = generate[0]?.request.modelId ?? "skill";
  const suite = `skill-${view.name}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60);
  return {
    $schema: "./case.schema.json",
    suite,
    title: `Skill: ${view.title}`,
    description: `Runs the saved skill /${view.name} with the inputs it was made with, through its own routes, to check that it still makes what it did. Made by pnpm eval:from-skill ${view.name}.`,
    original: "skill",
    kind,
    targets: { open: { models: [firstModel] }, cloud: { models: [firstModel] }, demo: { models: [firstModel] } },
    defaults: { seeds: [1], metrics: METRICS[kind] ?? [], timeoutSeconds: 1800 },
    variants: { default: { description: "The skill as saved" } },
    cases: [
      {
        id: `${suite}/examples`,
        title: `${view.title} with its examples`,
        ...(Object.keys(inputs).length && { inputs }),
        prompts: [{ id: "skill", text: view.title }],
        submit: { route: `/api/assist/skills/${view.name}/run`, body: { values, engine: "{{engine}}" }, result: "all", estimate: `/api/assist/skills/${view.name}/estimate` },
      },
    ],
  };
}

async function main() {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, url: { type: "string" }, token: { type: "string" } } });
  const name = positionals[0];
  if (!name) {
    process.stderr.write("Usage: pnpm eval:from-skill <name> [--out file]\n");
    return 2;
  }
  const { client, target } = connect({ url: v.url, token: v.token });
  const view = await client.request("GET", `/api/assist/skills/${encodeURIComponent(name)}/recipe`);
  const c = caseFromSkill(view, target.url);
  const out = path.resolve(v.out ?? path.join(HERE, "cases", `${c.suite}.json`));
  fs.writeFileSync(out, `${JSON.stringify(c, null, 2)}\n`);
  process.stdout.write(`Wrote ${path.relative(process.cwd(), out)}. Check it with pnpm eval:validate, then run: pnpm eval:run --suite ${c.suite} --engine open (or cloud, under its spend cap)\n`);
  return 0;
}

// Run directly (not imported by the tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => (process.exitCode = code),
    (e) => {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = 1;
    },
  );
}
