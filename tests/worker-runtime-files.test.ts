import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { graphCheck } from "../bin/lib/worker/checks.mjs";
import { modelFiles, runtimeFileList } from "../bin/lib/worker/inventory.mjs";
import { runtimeFilePins, workerFiles } from "../scripts/lib/worker-build.mjs";
import { allowedNodeList, inputRules, readCatalog } from "../scripts/lib/worker-catalog.mjs";
import { injectLoras } from "@/lib/comfy";
import { LORA_LIBRARY } from "@/lib/catalog/lora-library.generated";
import { hasFiles } from "@/lib/lanes";
import { graphLoraNames, LORA_FOLDER, runtimeFiles, runtimeNeeds } from "@/lib/runtime-files";
import type { RequirementIndex } from "@/lib/gpu/types";
import { tempDir } from "./helpers/temp-dir";

/**
 * Run-time files on the worker (docs/gpu-workers.md "Run-time files"): its build lists the LoRA library's pinned files,
 * it verifies the ones on its PC as it verifies the catalog's (folder, name, exact size and SHA-256) and reports them, so
 * a graph that loads a look's LoRA passes its own check only when that file is the pinned one.
 */

const sha = (data: string) => crypto.createHash("sha256").update(data).digest("hex");
const root = path.resolve(__dirname, "..");

describe("the run-time files a worker verifies", () => {
  it("are the LoRA library's entries with a pinned size and SHA-256, the same in the worker's build and the studio", () => {
    const studio = runtimeFiles();
    expect(studio.length).toBeGreaterThan(50);
    expect(studio.every((f) => f.folder === LORA_FOLDER && f.sizeBytes > 0 && /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(studio.map((f) => f.file)).toContain("AWPortrait-Z.safetensors");
    // An entry with no pin (or no size) is never one.
    const unpinned = LORA_LIBRARY.filter((e) => !e.sha256 || !e.sizeBytes).map((e) => e.file);
    for (const f of unpinned) expect(studio.some((x) => x.file === f)).toBe(false);
    // The worker's build reads the same library, without running the studio's code.
    expect(runtimeFilePins(root)).toEqual(studio);
    const built = JSON.parse((workerFiles().files as unknown as Record<string, string>)["runtime-files.json"]);
    expect(built.files).toEqual(studio);
  });

  it("an entry is kept once by name, and only with a real SHA-256 and a whole positive size", () => {
    const good = { file: "a.safetensors", sha256: "a".repeat(64), sizeBytes: 3 };
    expect(runtimeFiles([good, { ...good, sizeBytes: 9 }, { file: "b.safetensors", sha256: "nope", sizeBytes: 3 }, { file: "c.safetensors", sha256: "c".repeat(64), sizeBytes: 0 }, { file: "d.safetensors", sha256: "d".repeat(64) }])).toEqual([
      { folder: "loras", file: "a.safetensors", sizeBytes: 3, sha256: "a".repeat(64) },
    ]);
  });

  it("the worker reads its built list, and none from a build without one", () => {
    const dir = tempDir("fuobe-worker-runtime-list-");
    const file = path.join(dir, "runtime-files.json");
    expect(runtimeFileList(file)).toEqual([]);
    const ok = { folder: "loras", file: "a.safetensors", sizeBytes: 3, sha256: "a".repeat(64) };
    fs.writeFileSync(file, JSON.stringify({ files: [ok, { ...ok, file: "b.safetensors", sha256: "short" }, { ...ok, file: "c.safetensors", sizeBytes: "3" }, null] }));
    expect(runtimeFileList(file)).toEqual([ok]);
  });
});

describe("the worker's run-time files", () => {
  const look = { folder: "loras", file: "look.safetensors", sizeBytes: 5, sha256: sha("LOOK!") };

  it("are verified as the catalog's are: reported with their hash, never a copy of another size or hash", async () => {
    const models = tempDir("fuobe-worker-runtime-");
    fs.mkdirSync(path.join(models, "loras"));
    fs.writeFileSync(path.join(models, "loras", "look.safetensors"), "LOOK!");
    fs.writeFileSync(path.join(models, "loras", "other.safetensors"), "EVIL!");
    fs.writeFileSync(path.join(models, "loras", "short.safetensors"), "hi");
    const index = { files: {} };
    const runtime = [look, { ...look, file: "other.safetensors" }, { ...look, file: "short.safetensors" }, { ...look, file: "missing.safetensors" }];
    const cache = path.join(models, "hash-cache.json");
    expect(await modelFiles([models], index, cache, {}, { runtime })).toEqual([{ folder: "loras", name: "look.safetensors", size: 5, sha256: sha("LOOK!") }]);
    // None asked: only the catalog's own, as before.
    expect(await modelFiles([models], index, cache, {})).toEqual([]);
  });

  it("a file the catalog names too counts once, with the catalog's pin", async () => {
    const models = tempDir("fuobe-worker-runtime-twice-");
    fs.mkdirSync(path.join(models, "loras"));
    fs.writeFileSync(path.join(models, "loras", "look.safetensors"), "LOOK!");
    const index = { files: { a: { folder: "loras", file: "look.safetensors", sizeBytes: 5 } } };
    const found = await modelFiles([models], index, path.join(models, "hash-cache.json"), { "loras/look.safetensors": sha("LOOK!") }, { runtime: [look] });
    expect(found).toEqual([{ folder: "loras", name: "look.safetensors", size: 5, sha256: sha("LOOK!") }]);
  });

  it('with fileCheck "size", a run-time file of the exact size counts until its hash is known', async () => {
    const models = tempDir("fuobe-worker-runtime-size-");
    fs.mkdirSync(path.join(models, "loras"));
    fs.writeFileSync(path.join(models, "loras", "look.safetensors"), "LOOK!");
    const found = await modelFiles([models], { files: {} }, path.join(models, "hash-cache.json"), {}, { runtime: [look], fileCheck: "size" });
    expect(found).toEqual([{ folder: "loras", name: "look.safetensors", size: 5, sha256: look.sha256 }]);
  });

  it("a graph that loads a look's LoRA passes the worker's check only once that file is verified", () => {
    const catalog = readCatalog(root);
    const rules = inputRules(catalog);
    const allowed = new Set(allowedNodeList(root, catalog));
    const base = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" } },
      "2": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    };
    const graph = injectLoras(base as never, [{ file: "AWPortrait-Z.safetensors", strength: 0.6 }]) as unknown as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    const own = [{ folder: "diffusion_models", name: "z_image_turbo_bf16.safetensors" }];
    expect(graphCheck(graph, allowed, own, { rules, staged: [] })).toMatchObject({ reason: "model-unverified", cls: "LoraLoaderModelOnly", input: "lora_name" });
    expect(graphCheck(graph, allowed, [...own, { folder: "loras", name: "AWPortrait-Z.safetensors" }], { rules, staged: [] })).toBeNull();
    // The studio reads the same LoRA from the graph, as a file a worker must have.
    expect(graphLoraNames(graph)).toEqual(["AWPortrait-Z.safetensors"]);
  });
});

describe("a run's run-time files, as the studio reads them", () => {
  const index = {
    files: {
      "loras/own.safetensors": { folder: "loras", file: "own.safetensors", sizeBytes: 4, sha256: "1".repeat(64) },
      "loras/option.safetensors": { folder: "loras", file: "option.safetensors", sizeBytes: 6, sha256: "2".repeat(64) },
    },
    workflows: { wf: { files: ["loras/own.safetensors"] } },
  } as unknown as Pick<RequirementIndex, "files" | "workflows">;
  const library = [{ folder: "loras", file: "look.safetensors", sizeBytes: 5, sha256: "3".repeat(64) }];

  it("leaves the workflow's own files to its lane, takes an index file by its entry, a library file by its pin, and names the rest", () => {
    const r = runtimeNeeds(["own.safetensors", "option.safetensors", "look.safetensors", "mine.safetensors", "look.safetensors"], index, "wf", library);
    expect(r.files).toEqual([
      { folder: "loras", name: "option.safetensors", size: 6, sha256: "2".repeat(64) },
      { folder: "loras", name: "look.safetensors", size: 5, sha256: "3".repeat(64) },
    ]);
    expect(r.unknown).toEqual(["mine.safetensors"]);
  });

  it("a worker has them only with the exact size and hash of each", () => {
    const need = runtimeNeeds(["look.safetensors"], index, "wf", library).files;
    const inv = (size: number, sha256: string) => ({ files: [{ folder: "loras", name: "look.safetensors", size, sha256 }], nodePacks: [] });
    expect(hasFiles(inv(5, "3".repeat(64)), need)).toBe(true);
    expect(hasFiles(inv(5, "4".repeat(64)), need)).toBe(false);
    expect(hasFiles(inv(6, "3".repeat(64)), need)).toBe(false);
    expect(hasFiles({ files: [], nodePacks: [] }, [])).toBe(true);
  });

  it("reads every LoRA loader's file from a graph, once each, and no placeholder", () => {
    const g = {
      "1": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: "a.safetensors", model: ["0", 0] } },
      "2": { class_type: "WanVideoLoraSelect", inputs: { lora: "sub\\b.safetensors", strength: 1 } },
      "3": { class_type: "LoraLoader", inputs: { lora_name: "a.safetensors" } },
      "4": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: "None" } },
      "5": { class_type: "CLIPTextEncode", inputs: { text: "lora_name a.safetensors" } },
      "6": { class_type: "LoraLoaderModelOnly", inputs: { lora_name: ["7", 0] } },
    };
    expect(graphLoraNames(g)).toEqual(["a.safetensors", "sub/b.safetensors"]);
  });
});
