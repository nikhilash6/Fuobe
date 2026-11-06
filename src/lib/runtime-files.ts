/**
 * Run-time files (docs/gpu-workers.md "Run-time files"): the model files a run adds beyond its workflow's own, such as a
 * Soul look's, Soul Cinema's, a DoP motion's or a model recipe's LoRAs, and a LoRA a graph picks by option. A worker
 * verifies them as it verifies a workflow's files (folder, name, exact size and SHA-256) and reports them with its
 * inventory; a run goes to the workers only when one that may run its workflow verified every run-time file it loads.
 *
 * Only a file with a pinned size and SHA-256 can be verified: every LoRA library entry that has both
 * (lora-library.generated.ts), and the LoRAs the requirements index names. Any other file (a person's own trained LoRA, a
 * map LoRA with no pin) runs on a GPU of the person's own.
 *
 * Pure: the server, the worker build (scripts/lib/worker-build.mjs reads the same library) and the tests share it.
 */
import { LORA_LIBRARY } from "./catalog/lora-library.generated";
import type { RequirementIndex } from "./gpu/types";
import type { FileNeed } from "./lanes";

/** The model folder ComfyUI reads a LoRA from (by its name there). */
export const LORA_FOLDER = "loras";

/** A run-time file a worker can verify: its folder, name, exact size and SHA-256. */
export interface RuntimeFile {
  folder: string;
  file: string;
  sizeBytes: number;
  sha256: string;
}

const SHA = /^[0-9a-f]{64}$/;

/**
 * The run-time files a worker verifies: each LoRA library entry with a pinned SHA-256 and size, once by name, sorted. The
 * worker's build writes the same list (dist/runtime-files.json).
 */
export function runtimeFiles(library: readonly { file: string; sha256?: string; sizeBytes?: number }[] = LORA_LIBRARY): RuntimeFile[] {
  const out = new Map<string, RuntimeFile>();
  for (const e of library) {
    if (!e.file || out.has(e.file) || typeof e.sha256 !== "string" || !SHA.test(e.sha256) || !Number.isInteger(e.sizeBytes) || (e.sizeBytes ?? 0) <= 0) continue;
    out.set(e.file, { folder: LORA_FOLDER, file: e.file, sizeBytes: e.sizeBytes!, sha256: e.sha256 });
  }
  return [...out.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** "folder/name" of every run-time file, as an inventory keeps them. */
export const runtimeFileKeys = (files: readonly RuntimeFile[] = runtimeFiles()): Set<string> => new Set(files.map((f) => `${f.folder}/${f.file}`));

/**
 * A run's run-time files as a worker must have them (`files`), from the LoRA names it loads: a LoRA of the workflow's own
 * files is left out (its lane says), one the requirements index names is that file, then a library file. `unknown`: the
 * names no worker can verify (no pin), so no worker runs that run.
 */
export function runtimeNeeds(names: readonly string[], index: Pick<RequirementIndex, "files" | "workflows">, workflowId?: string, files: readonly RuntimeFile[] = runtimeFiles()): { files: FileNeed[]; unknown: string[] } {
  const own = new Set(workflowId ? (index.workflows[workflowId]?.files ?? []) : []);
  const byName = new Map(files.map((f) => [f.file, f]));
  const out = new Map<string, FileNeed>();
  const unknown: string[] = [];
  for (const raw of names) {
    const name = typeof raw === "string" ? raw.replace(/\\/g, "/") : "";
    if (!name || out.has(name) || unknown.includes(name)) continue;
    const key: `${string}/${string}` = `${LORA_FOLDER}/${name}`;
    if (own.has(key)) continue;
    const listed = index.files[key];
    if (listed) {
      out.set(name, { folder: listed.folder, name: listed.file, size: listed.sizeBytes, sha256: listed.sha256 ?? null });
      continue;
    }
    const lib = byName.get(name);
    if (lib) out.set(name, { folder: lib.folder, name: lib.file, size: lib.sizeBytes, sha256: lib.sha256 });
    else unknown.push(name);
  }
  return { files: [...out.values()], unknown };
}

/** The node inputs that name a LoRA file (LoraLoader's and LoraLoaderModelOnly's lora_name, WanVideoLoraSelect's lora). */
const LORA_INPUT = /^lora(_name)?$/;

/** The LoRA files a ComfyUI graph loads (each LoRA loader's file, as the worker checks it), once each. */
export function graphLoraNames(graph: Record<string, { class_type?: unknown; inputs?: Record<string, unknown> } | null | undefined>): string[] {
  const out = new Set<string>();
  for (const node of Object.values(graph ?? {})) {
    if (!node || typeof node.class_type !== "string" || !node.inputs) continue;
    for (const [input, v] of Object.entries(node.inputs)) if (LORA_INPUT.test(input) && typeof v === "string" && v && v !== "None") out.add(v.replace(/\\/g, "/"));
  }
  return [...out];
}
