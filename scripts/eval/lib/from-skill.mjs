// pnpm eval:from-skill <name>: a saved skill's recipe (src/lib/recipe.ts) as an evaluation suite, so the harness can
// regression-test the skill on the GPU or the cloud under its spend cap. The case runs the skill through its own route
// (POST /api/assist/skills/<name>/run, priced first by …/estimate) with the recipe's examples as its inputs; the
// recipe's checks become the case's note and its metrics. Pure: eval.mjs fetches the recipe and writes the file.
import path from "node:path";
import { LOCAL_DIR } from "./paths.mjs";

/** A file the harness ships, per input type: a demo run's input, and the input of one that has no example. */
const FIXTURE = { image: "fixtures/start-frame.png", video: "fixtures/walk-6s.mp4", audio: "fixtures/voice.wav" };
/** The case's input list per type (cases' `inputs`), and the body's token for its n-th file. */
const SLOT = { image: "images", video: "videos", audio: "audios" };
/** What a kind of result is measured by (no reference or prompt of its own: the words vary per skill). */
const METRICS_FOR = { image: ["aesthetic"], video: ["temporal"], audio: [] };

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "skill";

/** Where the suite goes: the git-ignored local cases folder (it holds links to your own files), as skill-<name>.json. */
export const suitePath = (name) => path.join(LOCAL_DIR, "cases", `skill-${slug(name)}.json`);

/** The steps no other step waits for: what a run ends with. */
function leaves(steps) {
  const waited = new Set(steps.flatMap((s) => (s.after === undefined ? [] : Array.isArray(s.after) ? s.after : [s.after])));
  return steps.filter((s) => !waited.has(s.key));
}

/** A check's words: "video · 1 · 9:16 · 4.5–5.5 s · no sound · looks like …". */
function checkWords(key, c) {
  const parts = [c.kind, c.count !== undefined && `${c.count} take${Number(c.count) === 1 ? "" : "s"}`, c.aspect, Array.isArray(c.seconds) ? `${c.seconds[0]}–${c.seconds[1]} s` : c.seconds !== undefined && `${c.seconds} s`, c.sound === true ? "with sound" : c.sound === false ? "no sound" : null, c.look && `looks like “${c.look}”`];
  return `${key}: ${parts.filter(Boolean).join(" · ")}`;
}

/**
 * The suite for a skill, from what GET /api/assist/skills/<name>/recipe answers (a RecipeView). One case per engine the
 * skill runs on (each sends that engine to the run route), and one for --engine demo. Throws when the harness can't
 * measure it: a skill that runs a studio tool (its steps run inside the studio) or one that runs nowhere here.
 */
export function suiteFromSkill(view) {
  const recipe = view?.recipe;
  if (!recipe || !Array.isArray(recipe.steps)) throw new Error("That skill has no recipe to measure");
  if (recipe.steps.some((s) => s.kind !== "generate")) throw new Error(`/${view.name} runs a studio tool: the harness measures skills made of generate steps`);
  if (!view.engines?.length) throw new Error(`/${view.name} doesn't run on this Fuobe${view.why ? `: ${view.why}` : ""}`);
  const ends = leaves(recipe.steps);
  const end = ends.at(-1);
  const checks = recipe.checks ?? {};
  const kind = ["image", "video", "audio"].includes(checks[end.key]?.kind) ? checks[end.key].kind : (Object.values(checks).find((c) => ["image", "video", "audio"].includes(c?.kind))?.kind ?? "image");
  // Inputs: each media input's example (a file on that Fuobe, or a link), else a fixture; the demo case uses fixtures.
  const inputs = {};
  const demoInputs = {};
  const values = {};
  const missing = [];
  for (const p of recipe.params) {
    if (SLOT[p.type]) {
      const slot = SLOT[p.type];
      const example = typeof p.example === "string" && p.example ? p.example : null;
      if (!example) missing.push(p.label);
      (inputs[slot] ??= []).push(example ?? FIXTURE[p.type]);
      (demoInputs[slot] ??= []).push(FIXTURE[p.type]);
      values[p.id] = `{{inputs.${slot}.${inputs[slot].length - 1}}}`;
    } else if (p.example !== undefined) values[p.id] = p.example;
    else if (p.default !== undefined) values[p.id] = p.default;
  }
  const notes = [
    `Runs the skill /${view.name} through its run route with the examples it was made from.`,
    ...(Object.keys(checks).length ? [`Its checks: ${Object.entries(checks).map(([k, c]) => checkWords(k, c)).join("; ")}.`] : []),
    ...(missing.length ? [`No example for ${missing.join(", ")}: a fixture stands in.`] : []),
  ];
  const route = `/api/assist/skills/${view.name}/run`;
  const estimate = `/api/assist/skills/${view.name}/estimate`;
  const engines = view.engines;
  const targets = Object.fromEntries([...engines, "demo"].map((e) => [e, { models: [end.request.modelId] }]));
  const caseFor = (engine) => ({
    id: `skill-${slug(view.name)}/${engine}`,
    title: `${view.title} (${engine === "open" ? "your GPU" : "the cloud"})`,
    ...(Object.keys(inputs).length && { inputs, demoInputs }),
    submit: { route, estimate, body: { values, engine }, result: "final" },
    engines: engine === engines[0] ? [engine, "demo"] : [engine],
    metrics: METRICS_FOR[kind],
    note: notes.join(" "),
  });
  return {
    suite: `skill-${slug(view.name)}`,
    title: `Skill: ${view.title}`,
    description: `Regression test of the saved skill /${view.name}: ${recipe.steps.length} step${recipe.steps.length === 1 ? "" : "s"} (${recipe.steps.map((s) => s.request.modelId).join(" → ")}), written by pnpm eval:from-skill. Write it again after you change the skill.`,
    original: `skill:${view.name}`,
    kind,
    targets,
    defaults: { seeds: [1001], metrics: METRICS_FOR[kind], timeoutSeconds: 1800 },
    cases: engines.map(caseFor),
  };
}
