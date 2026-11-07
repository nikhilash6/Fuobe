import "server-only";
import { MODELS } from "@/lib/catalog";
import { dualEngine } from "@/lib/catalog/engines";
import type { Engine, ModelDef, Operation } from "@/lib/catalog/types";
import { AUDIO_STUDIO, EDIT_STUDIO, IMAGE_STUDIO, MUSIC_STUDIO, VIDEO_STUDIO } from "@/lib/studios";
import { workersHold } from "./computer/pool";
import { poolOnWorkers, poolTakes, workflowPicks } from "./hosted";
import { isOffered } from "./model-access";
import { ownGpu } from "./providers/comfyui";
import { tenant } from "./tenant";

/**
 * The owner's runs on their own GPUs (Settings: ComfyUI runs on "workers") meet the same check before Run as a visitor's
 * run on them (hosted-run.ts poolGate): a worker is allowed the workflow's lane and holds its files (poolTakes). A run
 * nothing here can take is refused when it is planned and priced, in plain words, so a chain never runs its first step
 * and then stops at a later one.
 */
export class NotOnGpusError extends Error {
  constructor(
    readonly modelId: string,
    readonly modelName: string,
    readonly op: Operation,
    /** "files": no GPU here has the model's files; "lane": one has them, but isn't allowed its lane. */
    readonly why: "files" | "lane",
  ) {
    super(notOnGpusText(modelName, why));
    this.name = "NotOnGpusError";
  }
}

/** What the owner reads when their GPUs can't run a model: the true cause, in plain words. */
export function notOnGpusText(name: string, why: "files" | "lane"): string {
  return why === "files"
    ? `Your GPUs don't have ${name}'s files yet. Add them to a worker's ComfyUI, or pick another model.`
    : `Your GPUs have ${name}'s files, but none of them is allowed to run it. Allow its lane in Settings → Open-source engine · ComfyUI → Workers, or pick another model.`;
}

/** Whether no worker holds a workflow's files (for one that picks its graph at run time, any graph it may pick). */
export function filesMissing(endpoint: string): boolean {
  const picks = endpoint.includes("{") ? workflowPicks(endpoint) : [endpoint];
  return !picks.length || !picks.every((id) => workersHold(id));
}

/**
 * The owner's run of this ComfyUI workflow, when their GPUs can't take it: why, as an error to throw. Null when they
 * can, when the run is an account's or a visitor's (hosted-run.ts checks those), and when the owner's ComfyUI is not on
 * the workers (their own computer or server says what it lacks itself).
 */
export function ownerGpuMiss(route: { provider: string; endpoint: string }, model: Pick<ModelDef, "id" | "name">, op: Operation): NotOnGpusError | null {
  if (route.provider !== "comfyui" || tenant() || ownGpu() || !poolOnWorkers()) return null;
  if (poolTakes(route.endpoint)) return null;
  return new NotOnGpusError(model.id, model.name, op, filesMissing(route.endpoint) ? "files" : "lane");
}

/**
 * Whether the owner's GPUs run a model now: a model with no ComfyUI route, or one of its ComfyUI workflows they take
 * (ownerGpuMiss). Assist lists the models they don't run last, saying why.
 */
export function ownerGpusRun(m: ModelDef): boolean {
  const comfy = m.routes.filter((r) => r.provider === "comfyui");
  return !comfy.length || comfy.some((r) => !ownerGpuMiss(r, m, r.op));
}

/** The studios' default models: a step that can't run moves to one of these first. */
const DEFAULTS = new Set([IMAGE_STUDIO, EDIT_STUDIO, VIDEO_STUDIO, AUDIO_STUDIO, MUSIC_STUDIO].flatMap((s) => [s.defaultModels?.open, s.defaultModels?.cloud]).filter(Boolean) as string[]);

const rank = (m: ModelDef, op: Operation): number => {
  if (DEFAULTS.has(m.id)) return 0;
  // A model ranked by its badges only for some operations isn't ranked for the others (src/lib/composer.ts bestForStudio).
  if (m.bestOps && !m.bestOps.includes(op)) return 9;
  // A Fuobe Original keeps its own recipe and words: last of its engine, never first.
  if (dualEngine(m)) return 8;
  return m.badges?.includes("top") ? 1 : m.badges?.includes("new") ? 2 : 5;
};

/**
 * Other models that do the same job as `model` (its kind and this operation), best first: on its own engine first (the
 * studios' defaults, then top picks, then what's new, then the rest), then on the other engine. Only models Settings
 * offers, never hidden ones, and none that runs without a prompt when it takes one. `multiShot`: those that cut a clip
 * into shots first. The caller plans each one as it would run (its route, a key, the GPUs here) and keeps the first
 * that runs.
 */
export function sameJobModels(model: ModelDef, op: Operation, o: { multiShot?: boolean } = {}): { id: string; engine: Engine }[] {
  const out: { id: string; engine: Engine; score: number; i: number }[] = [];
  MODELS.forEach((m, i) => {
    if (m.id === model.id || m.hidden || m.kind !== model.kind || (m.options.promptless && !model.options.promptless)) return;
    if (!m.routes.some((r) => r.op === op)) return;
    const engines: Engine[] = m.engines?.length ? m.engines : [m.engine];
    for (const engine of engines) {
      if (!isOffered(m.id, engine)) continue;
      const other = engine !== model.engine ? 100 : 0;
      const shots = o.multiShot && !m.options.multiShot ? 10 : 0;
      out.push({ id: m.id, engine, score: other + shots + rank(m, op), i });
    }
  });
  return out.sort((a, b) => a.score - b.score || a.i - b.i).map(({ id, engine }) => ({ id, engine }));
}
