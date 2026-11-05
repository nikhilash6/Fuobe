// Job tickets on the worker (docs/gpu-workers.md, "Job tickets"): an account's run comes as a ticket, not a graph. The
// worker composes the graph itself, with the studio's own composer built into its dist (compose/) and its own copy of
// the catalog (workflows/comfyui in its checkout), for the catalog version its build was made from. Its PC's ceiling
// (worker.json `ceiling`) is the most it ever runs; the PC's own facts (its GPU's memory, its RAM, the model files and
// packs its ComfyUI has) make the choices that depend on the PC.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The catalog version this worker's build composes for (dist/catalog-version.json), or null when it isn't built. */
export function builtCatalogVersion(dist = path.join(here, "dist")) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dist, "catalog-version.json"), "utf8")).version;
    return typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The catalog as the composer reads it, from a checkout's workflows/comfyui: manifest.json and each workflow's file
 * (read again for each job, so the composer never shares a graph between two jobs).
 */
export function workerCatalog(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const byId = new Map((manifest.workflows ?? []).map((w) => [w.id, w]));
  return {
    has: (id) => byId.has(id),
    get: (id) => {
      const m = byId.get(id);
      if (!m) throw new Error(`The catalog has no workflow ${id}`);
      return { manifest: m, workflow: JSON.parse(fs.readFileSync(path.join(dir, path.basename(String(m.file))), "utf8")) };
    },
  };
}

const LANE = /^([0-9a-f]{12}|small)$/;
const WORKFLOW = /^[a-z0-9][a-z0-9._-]{0,95}(\{n\}[a-z0-9._-]{0,32})?$/i;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * A ceiling as worker.json keeps it (src/lib/job-ticket.ts cleanCeiling says the same): the lanes and workflows its PC
 * may ever run (absent: all), and the largest picture in megapixels, the longest clip in seconds and the most results
 * per run (absent: no limit of its own). Null when it sets nothing.
 */
export function ceilingOf(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const ids = (v, re) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && re.test(x)))].sort() : undefined);
  const cap = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(v, 1e6) : undefined);
  const c = {};
  const lanes = ids(raw.lanes, LANE);
  const workflows = ids(raw.workflows, WORKFLOW);
  if (lanes) c.lanes = lanes;
  if (workflows) c.workflows = workflows;
  for (const k of ["maxMegapixels", "maxSeconds", "maxOutputs"]) {
    const v = cap(raw[k]);
    if (v !== undefined) c[k] = k === "maxOutputs" ? Math.floor(v) : v;
  }
  return Object.keys(c).length ? c : null;
}

/**
 * A ceiling from setup's answers: `work` is "all" (or empty) or lane and workflow names separated by commas or spaces;
 * the three sizes are numbers (0 or empty: no limit). `known(id)` says whether the catalog has a workflow. Returns
 * { ceiling } (null: no ceiling), or { error } in words.
 *
 * @param {{ work?: string, megapixels?: string, seconds?: string, outputs?: string }} a
 * @param {(id: string) => boolean} [known]
 */
export function ceilingFrom(a, known = () => true) {
  const raw = {};
  const work = String(a.work ?? "").trim();
  if (work && work.toLowerCase() !== "all") {
    const names = work.split(/[\s,;]+/).filter(Boolean);
    const lanes = names.filter((n) => LANE.test(n));
    const workflows = names.filter((n) => !LANE.test(n));
    const bad = workflows.find((n) => !WORKFLOW.test(n) || !known(n));
    if (bad) return { error: `${bad} isn't a lane or a workflow of the studio's catalog.` };
    if (lanes.length) raw.lanes = lanes;
    if (workflows.length) raw.workflows = workflows;
  }
  for (const [k, v] of [["maxMegapixels", a.megapixels], ["maxSeconds", a.seconds], ["maxOutputs", a.outputs]]) {
    const text = String(v ?? "").trim();
    if (!text) continue;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return { error: `${text} isn't a number of 0 or more.` };
    if (n > 0) raw[k] = n;
  }
  return { ceiling: ceilingOf(raw) };
}

/** A ceiling in words for the PC's owner ("all workflows, pictures up to 4 MP, clips up to 10 s, 4 results a run"). */
export function ceilingWords(c) {
  if (!c) return "everything the studio asks, at any size";
  const work = c.lanes || c.workflows ? [...(c.lanes ?? []).map((l) => `lane ${l}`), ...(c.workflows ?? [])].join(", ") : "all workflows";
  const sizes = [c.maxMegapixels && `pictures up to ${c.maxMegapixels} MP`, c.maxSeconds && `clips up to ${c.maxSeconds} s`, c.maxOutputs && `${c.maxOutputs} result${c.maxOutputs === 1 ? "" : "s"} a run`].filter(Boolean);
  return [work, ...sizes].join(", ");
}

/** Each workflow's lane, from the requirements index (the studio's lanes: src/lib/lanes.ts allLanes). */
export function laneMap(index, allLanes) {
  const by = new Map();
  for (const l of allLanes(index, sha)) for (const id of l.workflows) by.set(id, l.lane);
  return (id) => by.get(id) ?? "small";
}

/**
 * Is a graph job inside the ceiling (the owner's own jobs come as graphs): by its lane or workflow. A ticket's sizes are
 * checked by the composer.
 */
export function graphInside(c, t) {
  if (!c || (c.lanes === undefined && c.workflows === undefined)) return true;
  return (!!t.lane && !!c.lanes?.includes(t.lane)) || (!!t.workflowId && !!c.workflows?.includes(t.workflowId));
}

/**
 * Its own ComfyUI's answers for the choices that depend on the PC (src/lib/ticket-compose.ts workerFactsFrom), read
 * through `own` (its ComfyUI only). An answer it can't read stays unknown.
 */
export async function readPcAnswers(own, base) {
  const get = async (p) => {
    try {
      const r = await own(`${base}${p}`, { cache: "no-store" });
      if (r.status === 404) return null;
      return r.ok ? await r.json() : undefined;
    } catch {
      return undefined;
    }
  };
  const [stats, dbs, reuse, idol] = await Promise.all([get("/system_stats"), get("/models/dbs"), get("/models/reuse"), get("/object_info/IdolPruneSplat")]);
  return { stats, dbs: dbs ?? undefined, reuse, idol };
}
