/**
 * Fuobe Reshoot's graphs (video-reshoot-swap-h3, video-reshoot-edit-h3): the settings each request writes into them by
 * node title, after the manifest's bindings went in (the part, the painted first frame, the prompt, the seed). Pure, so
 * the provider (src/lib/comfy-compose.ts) and the tests share it.
 */
import type { ComfyWorkflow } from "./comfy";
import { RESHOOT, RESHOOT_WORKFLOWS, reshootQuality } from "./catalog/reshoot";

export const RESHOOT_IDS = new Set<string>(Object.values(RESHOOT_WORKFLOWS));

const clone = (g: ComfyWorkflow): ComfyWorkflow => JSON.parse(JSON.stringify(g)) as ComfyWorkflow;

function byTitle(graph: ComfyWorkflow, title: string): ComfyWorkflow[string] {
  const ids = Object.keys(graph).filter((id) => graph[id]._meta?.title === title);
  if (ids.length !== 1) throw new Error(`Expected one "${title}" node in the workflow, found ${ids.length}.`);
  return graph[ids[0]];
}

/** The settings as they travel (params.extra.openjutsu, as Genjutsu's other GPU modes'). Unknown values fall back to the defaults. */
export type ReshootSettings = Record<string, unknown>;

/** A frame count Remake takes: 17n + 5 within the quality's limit (else the nearest one below). */
export function reshootFrameCount(v: unknown, quality: "480p" | "720p"): number {
  const max = Math.min(RESHOOT.maxFrames, RESHOOT.maxFramesAt[quality]);
  let f = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 124;
  f = Math.max(RESHOOT.minFrames, Math.min(max, f));
  // 90 is on the grid (17 × 5 + 5), so this never goes below it.
  while (f % 17 !== 5) f--;
  return f;
}

/**
 * The graph for one Reshoot render: the frames to render (the part's loader reads exactly those, its sound with them),
 * the canvas's short edge, the painted frame pinned at frame 0, the describer's instruction and the seed.
 */
export function reshootGraph(wf: ComfyWorkflow, s: ReshootSettings): ComfyWorkflow {
  const graph = clone(wf);
  const quality = reshootQuality(typeof s.quality === "string" ? s.quality : undefined);
  const frames = reshootFrameCount(s.frames, quality);
  const seed = Math.max(0, Math.min(0xffffffff, Math.round(typeof s.seed === "number" && Number.isFinite(s.seed) ? s.seed : 0)));
  const cond = byTitle(graph, "Remake conditioning").inputs;
  cond.frames = frames;
  cond.short_edge = RESHOOT.shortEdge[quality];
  cond.pins = "0";
  byTitle(graph, "Source part").inputs.frame_load_cap = frames;
  byTitle(graph, "Remake noise").inputs.seed = seed;
  byTitle(graph, "Keyframe until").inputs.keyframe_until = RESHOOT.keyframeUntil;
  if (typeof s.describe === "string" && s.describe.trim()) byTitle(graph, "Describe the motion").inputs.prompt = s.describe.trim().slice(0, 2000);
  return graph;
}
