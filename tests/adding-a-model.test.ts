// The automatic checks of adding a model, a workflow or a node pack: CPU work is marked in the requirement index.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOADER_FOLDERS } from "../scripts/comfy/build-library.mjs";
import { cpuWork } from "../scripts/comfy/build-requirements.mjs";
import { inputRules, readCatalog } from "../scripts/lib/worker-catalog.mjs";

type Node = { class_type: string; inputs: Record<string, unknown> };
type Graph = Record<string, Node>;
type ManifestWorkflow = { id: string; file: string; vramGb?: number; models: { file: string; folder: string }[]; autoDownloads?: string[] };
type Rules = { inputs: Record<string, Record<string, { kind: string }>> };
type Catalog = { graphs: Record<string, Graph>; manifest: { workflows: ManifestWorkflow[] }; requirements: { workflows: Record<string, { cpu?: true }> } };

const root = path.resolve(__dirname, "..");
const catalog = readCatalog(root) as unknown as Catalog;
const rules = inputRules(catalog) as Rules;

describe("CPU work is marked, so it is never counted as GPU work", () => {
  const index = catalog.requirements.workflows;
  const loaders = new Set(Object.keys(LOADER_FOLDERS));
  /** Read on its own: a node that loads or runs a model, a model file, a first-run download, or VRAM. */
  const usesGpu = (w: ManifestWorkflow) => {
    const nodes = Object.values(catalog.graphs[w.file] ?? {}).filter((n) => typeof n?.class_type === "string");
    const gpuNode = nodes.some((n) => loaders.has(n.class_type) || Object.keys(n.inputs ?? {}).some((i) => rules.inputs[n.class_type]?.[i]?.kind === "model-file"));
    return gpuNode || w.models.length > 0 || (w.autoDownloads ?? []).length > 0 || (Number(w.vramGb) || 0) > 0;
  };

  it("every catalog workflow that uses no GPU node is marked, and only those", () => {
    const wrong = catalog.manifest.workflows.filter((w) => !!index[w.id]?.cpu !== !usesGpu(w) || !!index[w.id]?.cpu !== cpuWork(w)).map((w) => w.id);
    expect(wrong).toEqual([]);
    const cpu = Object.keys(index).filter((id) => index[id].cpu);
    expect(cpu).toEqual(expect.arrayContaining(["video-trim", "video-concat-encoded", "video-concat-2", "video-mux-audio", "audio-join-crossfade", "kenburns-still", "still-to-clip", "captions-burnin", "frame-extract"]));
    for (const id of ["wan22-t2v-14b", "bg-remove-rmbg", "separate-soundtrack-dbs", "video-fix-colours", "upscale-image-esrgan"]) expect(index[id]?.cpu, id).toBeUndefined();
  });

  it("a model file, a first-run download or any VRAM makes a workflow GPU work", () => {
    expect(cpuWork({ models: [], vramGb: 0 })).toBe(true);
    expect(cpuWork({ models: [] })).toBe(true);
    expect(cpuWork({ models: [{ file: "x.safetensors", folder: "vae" }], vramGb: 0 })).toBe(false);
    expect(cpuWork({ models: [], autoDownloads: ["a node fetches x"], vramGb: 0 })).toBe(false);
    expect(cpuWork({ models: [], vramGb: 2 })).toBe(false);
  });
});
