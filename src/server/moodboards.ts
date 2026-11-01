import "server-only";
import { nanoid } from "nanoid";
import { getTrainingTarget, identityFor, targetsFor, type TrainingTarget } from "@/lib/catalog/training";
import { MAX_ELEMENT_PHOTOS } from "@/lib/catalog/elements";
import type { Engine, Generation } from "@/lib/catalog/types";
import { COVER_PROMPT, CURATED_SETS, MOODBOARD_LIMITS, moodboardStatus, moodboardError, type CuratedMoodboard, type Moodboard } from "@/components/moodboards/logic";
import { db } from "./db";
import { createElement, getElement } from "./elements";
import { createGenerations, getGeneration } from "./generations";
import { engineMode } from "./settings";
import { demoTraining, describeTargets, startTraining, trainingBlocker } from "./training";

/**
 * Moodboards (Soul 2.0's "presets evolved"): a named set of 5–80 reference images in one style.
 *
 * Making one starts a cover job, which is also what makes the board usable on the cloud: Recraft V4
 * Styles turns the 10 most representative images into a reusable style (its id comes back in
 * meta.styleId) while drawing the cover; on the open engine Krea 2 Style Reference draws
 * the cover from the board's collages. The status follows that job: In queue → In progress →
 * Preparing cover → Complete (or Failed, with Retry). A board can also be trained as a Z-Image Turbo style LoRA
 * (Fuobe Soul ID's style trainings, build plan O3: AI-Toolkit on the user's GPU or fal's Z-Image trainer in style
 * mode): a style element whose LoRA is then the board's Fuobe look, on Fuobe Soul on either engine.
 */

interface Row {
  id: string;
  name: string;
  images_json: string;
  collages_json: string;
  engine: Engine;
  generation_id: string | null;
  status: string;
  cover_url: string | null;
  style_id: string | null;
  element_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

/** The model that prepares a board (and draws its cover) on each engine: on your GPU Krea 2 Style Reference (1–2 collages). */
export const PREP_MODEL: Record<Engine, string> = { cloud: "recraft-4-style", open: "oss-style-krea2" };

function toMoodboard(r: Row): Moodboard {
  const images = JSON.parse(r.images_json) as string[];
  const el = r.element_id ? getElement(r.element_id) : null;
  // The style LoRA that runs on Fuobe Soul on some engine (a demo training's stand-in says so instead).
  const lora = el && (identityFor(el.loras, { id: STYLE_MODEL, engine: "open" }) ?? identityFor(el.loras, { id: STYLE_MODEL, engine: "cloud" }));
  const demo = !lora && el?.loras.some((l) => l.demo);
  return {
    id: r.id,
    name: r.name,
    images,
    refs: images.slice(0, MOODBOARD_LIMITS.refs),
    collages: JSON.parse(r.collages_json) as string[],
    engine: r.engine,
    status: r.status as Moodboard["status"],
    cover: r.cover_url ?? images[0] ?? null,
    styleId: r.style_id,
    error: r.error,
    generationId: r.generation_id,
    lora: el
      ? { elementId: el.id, handle: el.handle, status: el.status === "training" ? "training" : lora ? "ready" : demo ? "demo" : el.status === "failed" ? "failed" : "none" }
      : null,
    createdAt: r.created_at,
  };
}

function update(id: string, fields: Partial<Row>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE moodboards SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`)
    .run({ ...fields, __now: Date.now(), __id: id });
}

/** Follow the cover job: live status while it runs, and the cover + style id once it's done (saved then). */
function settle(r: Row): Row {
  if (r.status === "complete" || r.status === "failed") return r;
  const g: Generation | null = r.generation_id ? getGeneration(r.generation_id, { includeDeleted: true }) : null;
  const next = moodboardStatus(g);
  if (next.status === "complete") {
    const out = g?.outputs.find((o) => o.kind === "image");
    // A demo run draws a placeholder and makes no real style: keep the first image as the cover then.
    const real = g && g.provider !== "mock";
    const styleId = real && typeof out?.meta?.styleId === "string" ? out.meta.styleId : null;
    const fields = { status: "complete", cover_url: real && out ? out.url : null, style_id: styleId, error: null };
    update(r.id, fields);
    return { ...r, ...fields };
  }
  if (next.status === "failed") {
    const fields = { status: "failed", error: next.error ?? "The cover job didn't finish" };
    update(r.id, fields);
    return { ...r, ...fields };
  }
  return { ...r, status: next.status };
}

export function listMoodboards(): Moodboard[] {
  const rows = db().prepare("SELECT * FROM moodboards ORDER BY created_at DESC").all() as Row[];
  return rows.map(settle).map(toMoodboard);
}

export function getMoodboard(id: string): Moodboard | null {
  const r = db().prepare("SELECT * FROM moodboards WHERE id = ?").get(id) as Row | undefined;
  return r ? toMoodboard(settle(r)) : null;
}

/** Soul 2.0's 33 built-in looks, for the Curated tab. */
export function curatedMoodboards(): CuratedMoodboard[] {
  return CURATED_SETS["soul-v2"];
}

/** The engine a board is prepared on: the one asked for, unless Settings locks the other. */
function prepEngine(asked: Engine): Engine {
  const mode = engineMode();
  return mode === "both" ? asked : mode;
}

/** Start (or restart) the cover job. Errors land on the board as Failed. */
function startPrep(id: string, name: string, images: string[], collages: string[], engine: Engine): void {
  const refs = images.slice(0, MOODBOARD_LIMITS.refs);
  try {
    const [g] = createGenerations({
      feature: "moodboard",
      modelId: PREP_MODEL[engine],
      ...(engine === "cloud" ? { op: "edit" as const } : {}),
      prompt: COVER_PROMPT(name),
      inputs: { images: engine === "cloud" ? refs : (collages.length ? collages : refs).slice(0, 2) },
      params: { aspectRatio: "1:1", numOutputs: 1 },
      title: `Moodboard cover · ${name}`,
    });
    update(id, { generation_id: g.id, status: "queued", error: null, cover_url: null, style_id: null, engine });
  } catch {
    // The cover job can't start (no fal key with demo mode off, say). The board still works from its own
    // images — style references on the cloud, collages on the open engine — so it's ready now, with its
    // first image as the cover and no saved Recraft style (Recraft then gets the images inline).
    update(id, { generation_id: null, status: "complete", error: null, cover_url: null, style_id: null, engine });
  }
}

export function createMoodboard(input: { name: string; images: string[]; collages?: string[]; engine: Engine }): Moodboard {
  const images = [...new Set(input.images)];
  const err = moodboardError({ name: input.name, images });
  if (err) throw new Error(err);
  const now = Date.now();
  const engine = prepEngine(input.engine);
  const row: Row = {
    id: nanoid(10),
    name: input.name.trim(),
    images_json: JSON.stringify(images),
    collages_json: JSON.stringify((input.collages ?? []).slice(0, 2)),
    engine,
    generation_id: null,
    status: "queued",
    cover_url: null,
    style_id: null,
    element_id: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(`INSERT INTO moodboards (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  startPrep(row.id, row.name, images, JSON.parse(row.collages_json), engine);
  return getMoodboard(row.id)!;
}

/** Retry a failed board (optionally on the other engine). */
export function retryMoodboard(id: string, engine?: Engine): Moodboard {
  const m = getMoodboard(id);
  if (!m) throw new Error("Moodboard not found");
  if (m.status !== "failed" && m.status !== "complete") throw new Error("This moodboard is still training. Try again once it is ready.");
  startPrep(id, m.name, m.images, m.collages, prepEngine(engine ?? m.engine));
  return getMoodboard(id)!;
}

export function renameMoodboard(id: string, name: string): Moodboard {
  const m = getMoodboard(id);
  if (!m) throw new Error("Moodboard not found");
  const err = moodboardError({ name, images: m.images });
  if (err) throw new Error(err);
  update(id, { name: name.trim() });
  return getMoodboard(id)!;
}

export function deleteMoodboard(id: string): boolean {
  return db().prepare("DELETE FROM moodboards WHERE id = ?").run(id).changes > 0;
}

/** The model a trained board's look runs on. */
const STYLE_MODEL = "fuobe-soul";

/** A trained board is a Fuobe look: it trains on Fuobe Soul's base (Z-Image Turbo), on the GPU or in the cloud. */
const lookTargets = () => targetsFor("style").filter((t) => t.modelIds.includes(STYLE_MODEL));

/** The style trainings a board can run on (AI-Toolkit on the user's GPU, fal in the cloud), with what stops each. */
export function moodboardTrainingTargets() {
  return describeTargets(lookTargets());
}

/** The style training a board runs when none is named: the engine mode's, else the board's own engine. */
function defaultStyleTarget(m: Moodboard): TrainingTarget {
  const mode = engineMode();
  const engine = mode === "both" ? m.engine : mode;
  return lookTargets().find((t) => t.engine === engine) ?? lookTargets()[0];
}

/**
 * Train a board as a Fuobe look: a style element with the board's most representative images (up to 80), trained as
 * a Z-Image Turbo style LoRA on the target asked (AI-Toolkit on the user's GPU, or fal's Z-Image trainer in style
 * mode). The LoRA then runs on Fuobe Soul on both engines as the board's look.
 */
export function trainMoodboard(id: string, targetId?: string): Moodboard {
  const m = getMoodboard(id);
  if (!m) throw new Error("Moodboard not found");
  if (m.status !== "complete") throw new Error("This moodboard is still training. Try again once it is ready.");
  const target = targetId ? getTrainingTarget(targetId) : defaultStyleTarget(m);
  if (!target || !lookTargets().includes(target)) throw new Error("Pick a style training for Fuobe Soul");
  // Say what's missing (a key, an AI-Toolkit URL, the engine mode) before making the style element, so a refusal leaves nothing behind.
  const blocker = trainingBlocker(target);
  if (blocker && !demoTraining(target)) throw new Error(blocker);
  let el = m.lora ? getElement(m.lora.elementId) : null;
  if (!el) {
    el = createElement({ name: m.name.slice(0, 60), kind: "style", description: `the visual style of the “${m.name}” moodboard`, references: m.images.slice(0, MAX_ELEMENT_PHOTOS) });
    update(id, { element_id: el.id });
  }
  startTraining(el.id, target.id);
  return getMoodboard(id)!;
}
