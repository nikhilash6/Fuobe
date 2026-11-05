/**
 * Lanes: the jobs that load the same big model files, so a worker that has them loaded runs the next one with no reload
 * (docs/gpu-workers.md). A lane is named by its files, never by hand: the first 12 hex digits of the SHA-256 of the
 * sorted names of a workflow's files over 2 GB in workflows/comfyui/requirements.json. Two workflows that load the same
 * diffusion model and text encoder share a lane. A workflow with no big file has the lane "small".
 *
 * Pure: the server, the worker program and the tests share it. `sha256hex` is passed in (node:crypto on the server).
 */
import type { IndexWorkflow, RequirementIndex } from "./gpu/types";

export const BIG_FILE_BYTES = 2 * 2 ** 30;
export const SMALL_LANE = "small";

export interface FileNeed {
  folder: string;
  name: string;
  size: number;
  sha256: string | null;
}

/** What a task needs from the worker that takes it. */
export interface Needs {
  workflowId: string;
  files: FileNeed[];
  packs: string[];
  /** The graphics memory a worker must report, with VRAM_TOLERANCE already allowed for. */
  minVramBytes: number;
  /** How big the job is (its largest picture in megapixels, its longest clip in seconds, its results): a PC's ceiling reads it. */
  size?: { megapixels: number; seconds: number; outputs: number };
  /** A job ticket's catalog version (src/lib/job-ticket.ts): only a worker built for that catalog takes the task. */
  catalogVersion?: string;
}

/**
 * A card sold as a whole number of GB reports a little less than that (a 32 GB card about 31.8 GiB, a 10 GB card a
 * few MB under 10 GiB). A workflow's VRAM need allows this much under its whole GB, so such a card takes the lanes made
 * for its size.
 */
export const VRAM_TOLERANCE = 0.03;

/** The graphics memory a workflow of `gb` whole GB needs from a worker, in bytes (3% under the whole GB). */
export const minVramBytesFor = (gb: number) => Math.round((gb || 0) * 2 ** 30 * (1 - VRAM_TOLERANCE));

type Sha = (text: string) => string;

const bigFiles = (index: RequirementIndex, wf: IndexWorkflow) =>
  wf.files
    .map((k) => index.files[k])
    .filter((f) => f && f.sizeBytes > BIG_FILE_BYTES)
    .map((f) => `${f.folder}/${f.file}`)
    .sort();

/** A workflow's lane key, or "small". Null: no such workflow. */
export function laneOf(index: RequirementIndex, workflowId: string, sha: Sha): string | null {
  const wf = index.workflows[workflowId];
  if (!wf) return null;
  const big = bigFiles(index, wf);
  return big.length ? sha(big.join("\n")).slice(0, 12) : SMALL_LANE;
}

/** A readable name for a lane: its biggest file's name, cleaned ("wan2.2 i2v high noise 14B fp8"). */
export function laneLabel(index: RequirementIndex, lane: string, sha: Sha): string {
  if (lane === SMALL_LANE) return "Small jobs";
  for (const [id, wf] of Object.entries(index.workflows)) {
    if (laneOf(index, id, sha) !== lane) continue;
    const biggest = wf.files.map((k) => index.files[k]).filter(Boolean).sort((a, b) => b.sizeBytes - a.sizeBytes)[0];
    if (biggest) return biggest.file.replace(/\.(safetensors|gguf|pth|ckpt)$/i, "").replace(/[_-]+/g, " ");
  }
  return lane;
}

/** Every lane in the index, with its label and the workflows in it. */
export function allLanes(index: RequirementIndex, sha: Sha): { lane: string; label: string; workflows: string[] }[] {
  const by = new Map<string, string[]>();
  for (const id of Object.keys(index.workflows)) {
    const lane = laneOf(index, id, sha)!;
    by.set(lane, [...(by.get(lane) ?? []), id]);
  }
  return [...by].map(([lane, workflows]) => ({ lane, label: laneLabel(index, lane, sha), workflows })).sort((a, b) => a.label.localeCompare(b.label));
}

/** What a workflow's task needs: its default files (folder, name, exact size, sha256 when pinned), packs and VRAM (with the tolerance). */
export function needsOf(index: RequirementIndex, workflowId: string): Needs | null {
  const wf = index.workflows[workflowId];
  if (!wf) return null;
  const files = wf.files
    .map((k) => index.files[k])
    .filter(Boolean)
    .map((f) => ({ folder: f.folder, name: f.file, size: f.sizeBytes, sha256: f.sha256 ?? null }));
  return { workflowId, files, packs: Object.keys(wf.packs).sort(), minVramBytes: minVramBytesFor(wf.vramGb) };
}

/** The kinds of input file a worker may take. A worker makes every clip and sound again before its ComfyUI reads it. */
export const MEDIA_KINDS = ["image", "video", "audio"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** The node types that read a clip or a sound file the job sent. */
export const MEDIA_LOADERS: Record<"video" | "audio", readonly string[]> = {
  video: ["LoadVideo", "VHS_LoadVideo", "VHS_LoadVideoPath", "VHS_LoadVideoFFmpeg", "VHS_LoadVideoFFmpegPath"],
  audio: ["LoadAudio", "VHS_LoadAudio", "VHS_LoadAudioUpload"],
};

/** The kinds of input file a workflow reads besides pictures: "video", "audio", both or none. */
export function mediaOf(wf: Pick<IndexWorkflow, "core" | "packs">): ("video" | "audio")[] {
  const classes = new Set([...wf.core, ...Object.values(wf.packs).flat()]);
  return (["video", "audio"] as const).filter((k) => MEDIA_LOADERS[k].some((c) => classes.has(c)));
}

/**
 * A worker's verified files and node packs (PUT /api/gpu/computer/inventory), and the kinds of input it takes (`media`:
 * a worker without a way to make clips and sound again takes pictures only). No `media` (a worker from before workers
 * made clips and sound again): pictures only.
 */
export interface Inventory {
  files: FileNeed[];
  nodePacks: { name: string; commit: string | null }[];
  media?: MediaKind[];
}

const fileKey = (f: Pick<FileNeed, "folder" | "name">) => `${f.folder}/${f.name}`;

/** Has the worker this file: folder, name and exact size always; the SHA-256 too when the index pins one. */
export function hasFile(inv: Inventory, need: FileNeed): boolean {
  return inv.files.some((f) => fileKey(f) === fileKey(need) && f.size === need.size && (!need.sha256 || f.sha256 === need.sha256));
}

/**
 * What a worker can run with what it has: the workflows whose files and packs are all there, the lanes whose every
 * workflow runs, and, for the other lanes, what it lacks. A task goes only to a worker that can run its workflow.
 */
export function lanesFor(
  index: RequirementIndex,
  inv: Inventory,
  sha: Sha,
): { lanes: string[]; workflows: string[]; missing: { lane: string; label: string; files: string[]; bytes: number }[] } {
  const packs = new Set(inv.nodePacks.map((p) => p.name));
  const takes = new Set<string>(inv.media ?? ["image"]);
  const ok = new Map<string, boolean>();
  const workflows: string[] = [];
  const lacking = new Map<string, Map<string, number>>();
  for (const id of Object.keys(index.workflows)) {
    if (index.workflows[id].isolated) continue;
    const lane = laneOf(index, id, sha)!;
    const n = needsOf(index, id)!;
    const missingFiles = n.files.filter((f) => !hasFile(inv, f));
    const missingPacks = n.packs.filter((p) => !packs.has(p));
    const missingMedia = mediaOf(index.workflows[id]).filter((k) => !takes.has(k));
    const fine = !missingFiles.length && !missingPacks.length && !missingMedia.length;
    if (fine) workflows.push(id);
    ok.set(lane, (ok.get(lane) ?? true) && fine);
    if (!fine) {
      const m = lacking.get(lane) ?? new Map<string, number>();
      for (const f of missingFiles) m.set(fileKey(f), f.size);
      for (const p of missingPacks) m.set(`pack:${p}`, 0);
      for (const k of missingMedia) m.set(`input:${k}`, 0);
      lacking.set(lane, m);
    }
  }
  const lanes = [...ok].filter(([, v]) => v).map(([k]) => k).sort();
  const missing = [...lacking].map(([lane, m]) => ({ lane, label: laneLabel(index, lane, sha), files: [...m.keys()].sort(), bytes: [...m.values()].reduce((a, b) => a + b, 0) }));
  return { lanes, workflows: workflows.sort(), missing };
}
