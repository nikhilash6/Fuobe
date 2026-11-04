// The automatic checks of docs/adding-a-model.md: every model file pinned, every first-run download pinned, a rule for
// every input that names a path, a download or code, a worker build that matches the catalog, CPU work marked, and clips
// saved without their metadata. Each known gap is listed here, and each list may only shrink.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { workerParts } from "../scripts/build-worker.mjs";
import { LOADER_FOLDERS } from "../scripts/comfy/build-library.mjs";
import { buildIndex, cpuWork, formatIndex, loadInputs } from "../scripts/comfy/build-requirements.mjs";
import { firstRunFileProblem, firstRunProblems, metadataFormats, metadataKept, pathInputs, unpinnedModelFiles, unruledPathInputs } from "../scripts/lib/catalog-checks.mjs";
import { filePins, inputRules, readCatalog, REQUIRED_RULES } from "../scripts/lib/worker-catalog.mjs";
import { tempDir } from "./helpers/temp-dir";

type Node = { class_type: string; inputs: Record<string, unknown> };
type Graph = Record<string, Node>;
type ManifestWorkflow = { id: string; file: string; vramGb?: number; models: { file: string; folder: string }[]; autoDownloads?: string[]; bindings?: Record<string, { node: string; input: string }[]> };
type Rule = { kind: string; folders?: string[] };
type Rules = { inputs: Record<string, Record<string, Rule>>; text: Record<string, string[]>; closed: Record<string, string[]> };
type Catalog = {
  graphs: Record<string, Graph>;
  manifest: { workflows: ManifestWorkflow[] };
  requirements: { files: Record<string, { folder: string; file: string; url: string }>; workflows: Record<string, { files: string[]; optional: string[]; vramGb: number; firstRun: string[]; cpu?: true }> };
  pins: Record<string, { sha256?: string }>;
};

const root = path.resolve(__dirname, "..");
const LIBRARY = path.join(root, "workflows/comfyui");
const BUILD = path.join(root, "scripts/build-worker.mjs");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(LIBRARY, f), "utf8"));
const catalog = readCatalog(root) as unknown as Catalog;
const rules = inputRules(catalog) as Rules;
const build = (...args: string[]) => spawnSync(process.execPath, [BUILD, ...args], { cwd: root, encoding: "utf8" });

/**
 * Model files the catalog names that have no SHA-256 pin yet. A worker never reports such a file, so no worker runs a
 * workflow that needs one. Their pins need the exact files, or a signed-in account for the repositories that ask for
 * one (`node scripts/comfy/build-requirements.mjs --refresh-pins` with HF_TOKEN). The list may only shrink: a new file
 * with no pin fails, and so does a file here that has a pin now.
 */
const UNPINNED_FILES = [
  "dbs/DBS-BSRNN-DnR/config.json",
  "dbs/DBS-TIGER-DnR/config.json",
  "diffusion_models/flux3-image-klein-base-bf16.safetensors",
  "diffusion_models/flux3-image-klein-base-int8-convrot.safetensors",
  "diffusion_models/flux3-image-klein-base-nvfp4.safetensors",
  "diffusion_models/flux3-image-klein-bf16.safetensors",
  "diffusion_models/flux3-image-klein-int8-convrot.safetensors",
  "diffusion_models/flux3-image-klein-nvfp4.safetensors",
  "diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
  "latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
  "loras/ltx-2.5-22b-ic-lora-refine-details-1.0.safetensors",
  "loras/ltx-2.5-22b-ic-lora-restore-1.0.safetensors",
  "text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
  "text_encoders/qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors",
  "text_encoders/qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors",
  "vae/ltx-2.5-audio-vae-bf16.safetensors",
  "vae/ltx-2.5-video-vae-bf16.safetensors",
];

/**
 * Workflows whose nodes fetch files on their first run (autoDownloads) and whose files first-run-files.json doesn't pin
 * yet. The list may only shrink: a new workflow must pin its first-run files, and a workflow here that pins them now
 * must come off.
 */
const FIRST_RUN_GAPS = [
  "bg-remove-rmbg",
  "captions-qwen3-asr",
  "captions-whisper-burnin",
  "dub-prepare-dbs-transcribe",
  "dub-prepare-separate-transcribe",
  "face-swap-reactor",
  "infinitetalk-wanwrapper",
  "interpolate-rife-vfi",
  "lipsync-latentsync16",
  "lipsync-v2v-infinitetalk",
  "qwen-image-21-edit-small",
  "qwen-image-21-t2i-small",
  "sfx-hunyuan-foley",
  "sfx-thinksound",
  "tryon-flux2-klein-4b",
  "tts-chatterbox-multilingual",
  "tts-dialogue-chatterbox",
  "tts-indextts2",
  "tts-qwen3-clone",
  "tts-qwen3-design",
  "tts-voxcpm2",
  "tts-voxcpm2-clone",
  "v2a-hunyuan-foley",
  "video-depth-vda-large",
  "video-depth-vda-small",
  "video-fix-faces-h3",
  "video-from-picture-h3",
  "video-from-picture-solar",
  "video-motion-transfer-h3",
  "voice-change-chatterbox",
];

/** Workflows whose graphs still save clips with their metadata (the prompt, the local time). The list may only shrink. */
const KEEPS_METADATA = [
  "captions-whisper-burnin",
  "infinitetalk-wanwrapper",
  "interpolate-rife-vfi",
  "lipsync-latentsync16",
  "lipsync-v2v-infinitetalk",
  "mixed-media-zimage-frames",
  "selftest-meta-batch",
  "upscale-video-esrgan-chunked",
  "upscale-video-seedvr2-chunked",
  "v2a-mmaudio",
];

const SHA = "0123456789abcdef".repeat(4);
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("every model file has a SHA-256 pin", () => {
  it("every file a catalog workflow names, but for a list of gaps that may only shrink", () => {
    const gaps = unpinnedModelFiles(catalog, rules);
    const fresh = Object.keys(gaps).filter((f) => !UNPINNED_FILES.includes(f));
    expect(fresh, `Pin these in workflows/comfyui/model-pins.json:\n${fresh.map((f) => `${f} (${gaps[f].join(", ")})`).join("\n")}`).toEqual([]);
    const pinned = UNPINNED_FILES.filter((f) => !gaps[f]);
    expect(pinned, `These have a pin now: take them off UNPINNED_FILES\n${pinned.join("\n")}`).toEqual([]);
    const pins = filePins(catalog) as Record<string, string>;
    for (const sha of Object.values(pins)) expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(pins).length + UNPINNED_FILES.length).toBe(Object.keys(catalog.requirements.files).length);
  });

  it("a file with no pin is found, in the index or only in a graph", () => {
    const loader = (name: string) => ({ "1": { class_type: "UNETLoader", inputs: { unet_name: name, weight_dtype: "default" } } });
    const fake = (graph: Graph, over: Partial<ManifestWorkflow> = {}, pins: Catalog["pins"] = {}) => ({
      graphs: { "a.json": graph },
      manifest: { workflows: [{ id: "a", file: "a.json", models: [], bindings: {}, ...over }] },
      requirements: { files: { "diffusion_models/x.safetensors": { folder: "diffusion_models", file: "x.safetensors", url: "https://h/x" } }, workflows: { a: { files: ["diffusion_models/x.safetensors"], optional: [] } } },
      pins,
    });
    const r = { inputs: { UNETLoader: { unet_name: { kind: "model-file", folders: ["diffusion_models"] } } } };
    expect(unpinnedModelFiles(fake(loader("x.safetensors")), r)).toEqual({ "diffusion_models/x.safetensors": ["a"] });
    expect(unpinnedModelFiles(fake(loader("x.safetensors"), {}, { "https://h/x": { sha256: SHA } }), r)).toEqual({});
    // A file the index doesn't know can't have a pin.
    expect(unpinnedModelFiles(fake(loader("y.safetensors"), {}, { "https://h/x": { sha256: SHA } }), r)).toEqual({ "y.safetensors": ["a"] });
    // Unless the run picks it (a LoRA the manifest binds), or a node fetches it on its first run (pinned there).
    expect(unpinnedModelFiles(fake(loader("y.safetensors"), { bindings: { lora: [{ node: "1", input: "unet_name" }] } }, { "https://h/x": { sha256: SHA } }), r)).toEqual({});
    expect(unpinnedModelFiles(fake(loader("y.safetensors"), { autoDownloads: ["the node downloads y.safetensors on first run"] }, { "https://h/x": { sha256: SHA } }), r)).toEqual({});
  });
});

describe("first-run downloads have pinned files", () => {
  it("every workflow whose nodes fetch files on their first run, but for a list of gaps that may only shrink", () => {
    expect(firstRunProblems(catalog.manifest, read("first-run-files.json"), FIRST_RUN_GAPS)).toEqual([]);
  });

  it("a pinned file names its place, a fixed link, its exact size and its SHA-256", () => {
    const good = { path: "models/RMBG/BEN2/BEN2_Base.pth", url: `https://huggingface.co/org/repo/resolve/${COMMIT}/BEN2_Base.pth`, sizeBytes: 1024, sha256: SHA };
    expect(firstRunFileProblem(good)).toBeNull();
    expect(firstRunFileProblem({ ...good, url: "https://github.com/org/repo/releases/download/v1/BEN2_Base.pth" })).toBeNull();
    for (const p of ["../x.pth", "/x.pth", "C:/x.pth", "models/../x.pth", "models\\x.pth", "~/x.pth", "models//x.pth", ".hidden/x", ""]) {
      expect(firstRunFileProblem({ ...good, path: p }), p).toMatch(/plain relative path/);
    }
    expect(firstRunFileProblem({ ...good, url: "http://huggingface.co/org/repo/resolve/main/x" })).toMatch(/https/);
    expect(firstRunFileProblem({ ...good, url: "https://huggingface.co/org/repo/resolve/main/x" })).toMatch(/commit/);
    expect(firstRunFileProblem({ ...good, sizeBytes: 0 })).toMatch(/size/);
    expect(firstRunFileProblem({ ...good, sha256: SHA.toUpperCase() })).toMatch(/sha256/);
    expect(firstRunFileProblem({ ...good, sha256: undefined })).toMatch(/sha256/);

    const manifest = { workflows: [{ id: "a", autoDownloads: ["a node fetches x on first run"] }, { id: "b" }] };
    expect(firstRunProblems(manifest, { workflows: {} })).toEqual(["a: a node fetches files on its first run (autoDownloads) and first-run-files.json pins none"]);
    expect(firstRunProblems(manifest, { workflows: { a: [good] } })).toEqual([]);
    expect(firstRunProblems(manifest, { workflows: {} }, ["a"])).toEqual([]);
    expect(firstRunProblems(manifest, { workflows: { a: [good] } }, ["a"])).toEqual(["a: its first-run files are pinned now; take it off the list of gaps"]);
    expect(firstRunProblems(manifest, { workflows: {} }, ["a", "b"])).toEqual(["b: on the list of gaps, but it fetches nothing on its first run"]);
    expect(firstRunProblems(manifest, { workflows: { a: [good], b: [good] } })).toEqual(["b: first-run-files.json lists it, but the manifest names no first-run download for it"]);
    expect(firstRunProblems(manifest, { workflows: { a: [{ ...good, sha256: "x" }] } })).toEqual([`a: ${good.path}: sha256 must be 64 lower-case hex digits`]);
  });
});

describe("the worker build", () => {
  let first = "";
  let second = "";
  beforeAll(() => {
    first = tempDir("fuobe-worker-build-a-");
    second = tempDir("fuobe-worker-build-b-");
    for (const out of [first, second]) {
      const r = build("--out", out);
      expect(r.status, r.stderr).toBe(0);
    }
  }, 120_000);
  const built = (dir: string, f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

  it("gives a rule to every input whose catalog value names a path, a download or code", () => {
    const found = pathInputs(catalog).map((p: { cls: string; input: string }) => `${p.cls}.${p.input}`);
    expect(found).toEqual(
      expect.arrayContaining(["AILab_Qwen3ASRSubtitle.output_path", "AILab_Qwen3ASRSubtitle.model", "MiniMaxH3SourceTimeline.video_path", "StringFormat.f_string", "LoadImage.image", "UNETLoader.unet_name", "SaveVideo.filename_prefix"]),
    );
    expect(unruledPathInputs(catalog, rules)).toEqual([]);
    // In the file the build wrote, too: each of them, and each input that must always have one.
    const written = built(first, "input-rules.json") as Rules;
    const allowed = built(first, "allowed-nodes.json").nodes as string[];
    const missing = pathInputs(catalog).filter((p: { cls: string; input: string }) => !written.inputs[p.cls]?.[p.input]);
    expect(missing).toEqual([]);
    for (const [cls, input] of REQUIRED_RULES as [string, string][]) if (allowed.includes(cls)) expect(written.inputs[cls]?.[input], `${cls}.${input}`).toBeTruthy();
    // A prompt keeps free text: no rule.
    expect(written.inputs.CLIPTextEncode?.text).toBeUndefined();
  });

  it("names an input that has no rule", () => {
    const less = structuredClone(rules);
    delete less.inputs.AILab_Qwen3ASRSubtitle.output_path;
    delete less.inputs.UNETLoader.unet_name;
    expect(unruledPathInputs(catalog, less)).toEqual(["AILab_Qwen3ASRSubtitle.output_path (required, named for a path, a path or a download)", "UNETLoader.unet_name (a model file)"]);
  });

  it("stops when an input that must have a rule has none, or the catalog links into one", () => {
    const without = structuredClone(catalog);
    for (const g of Object.values(without.graphs)) for (const n of Object.values(g ?? {})) if (n?.class_type === "AILab_Qwen3ASRSubtitle") delete n.inputs.output_path;
    expect(() => workerParts(without, root)).toThrow(/no rule: .*AILab_Qwen3ASRSubtitle\.output_path/);
    const linked = structuredClone(catalog);
    for (const g of Object.values(linked.graphs)) for (const n of Object.values(g ?? {})) if (n?.class_type === "MiniMaxH3SourceTimeline") n.inputs.video_path = ["1", 0];
    expect(() => workerParts(linked, root)).toThrow(/MiniMaxH3SourceTimeline\.video_path .*links into it/);
  });

  it("from the command line: a missing rule fails the build, which writes nothing", () => {
    const copy = tempDir("fuobe-worker-catalog-");
    let changed = 0;
    for (const f of fs.readdirSync(LIBRARY).filter((x) => x.endsWith(".json"))) {
      let text = fs.readFileSync(path.join(LIBRARY, f), "utf8");
      if (text.includes("AILab_Qwen3ASRSubtitle") && f !== "requirements.json" && f !== "manifest.json" && f !== "object_info.subset.json") {
        const g = JSON.parse(text) as Graph;
        for (const n of Object.values(g)) {
          if (n?.class_type !== "AILab_Qwen3ASRSubtitle") continue;
          delete n.inputs.output_path;
          changed++;
        }
        text = JSON.stringify(g);
      }
      fs.writeFileSync(path.join(copy, f), text);
    }
    expect(changed).toBeGreaterThan(0);
    const out = path.join(tempDir("fuobe-worker-out-"), "dist");
    const r = build("--catalog", copy, "--out", out);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/These allowed inputs have no rule: .*AILab_Qwen3ASRSubtitle\.output_path/);
    expect(fs.existsSync(out)).toBe(false);
  }, 60_000);

  it("rebuilding gives no diff: two builds write the same files, and they match the catalog", () => {
    const files = fs.readdirSync(first).sort();
    expect(fs.readdirSync(second).sort()).toEqual(files);
    for (const f of files) expect(fs.readFileSync(path.join(second, f), "utf8"), f).toBe(fs.readFileSync(path.join(first, f), "utf8"));
    expect(files).toEqual(expect.arrayContaining(["allowed-nodes.json", "input-rules.json", "file-pins.json", "computer-runner.mjs"]));
    const parts = workerParts(catalog, root) as { nodes: string[]; rules: Rules; pins: Record<string, string> };
    expect(built(first, "allowed-nodes.json")).toEqual({ built: "scripts/build-worker.mjs", nodes: parts.nodes });
    expect(built(first, "input-rules.json")).toEqual({ built: "scripts/build-worker.mjs", ...parts.rules });
    expect(built(first, "file-pins.json")).toEqual({ built: "scripts/build-worker.mjs", files: filePins(catalog) });
    // The pins come from the requirement index, which is the one its inputs build, byte for byte (a Windows checkout
    // may turn its line ends into CRLF).
    expect(fs.readFileSync(path.join(LIBRARY, "requirements.json"), "utf8").replace(/\r\n/g, "\n")).toBe(formatIndex(buildIndex(loadInputs(LIBRARY))));
  });
});

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

describe("saved clips carry no metadata", () => {
  const formats = metadataFormats(read("object_info.subset.json"));

  it("new graphs save clips without their metadata, but for a list that may only shrink", () => {
    expect(metadataKept(catalog, formats)).toEqual(KEEPS_METADATA);
  });

  it("a save node keeps metadata unless told not to, in the formats that write it", () => {
    expect(formats?.has("video/h264-mp4")).toBe(true);
    expect(formats?.has("video/ProRes")).toBe(false);
    const one = (inputs: Record<string, unknown>) => ({ graphs: { "a.json": { "1": { class_type: "VHS_VideoCombine", inputs } } }, manifest: { workflows: [{ id: "a", file: "a.json" }] } });
    expect(metadataKept(one({ format: "video/h264-mp4", save_metadata: true }), formats)).toEqual(["a"]);
    expect(metadataKept(one({ format: "video/h264-mp4" }), formats)).toEqual(["a"]);
    expect(metadataKept(one({ format: "video/h264-mp4", save_metadata: false }), formats)).toEqual([]);
    expect(metadataKept(one({ format: "video/ProRes" }), formats)).toEqual([]);
    expect(metadataKept(one({ format: "video/ProRes" }))).toEqual(["a"]);
  });
});
