// The automatic checks of docs/adding-a-model.md: every model file pinned, every first-run download pinned, a rule for
// every input that names a path, a download or code, a worker build that matches the catalog, CPU work marked, and
// results saved without their metadata. Each known gap is listed (the unpinned files in scripts/lib/worker-catalog.mjs,
// the others here), and each list may only shrink.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStamp, distProblem } from "../bin/lib/worker/stamp.mjs";
import { LOADER_FOLDERS } from "../scripts/comfy/build-library.mjs";
import { buildIndex, cpuWork, formatIndex, loadInputs } from "../scripts/comfy/build-requirements.mjs";
import { firstRunFileProblem, firstRunProblems, metadataFormats, metadataKept, pathInputs, perRunTextInputs, unpinnedModelFiles, unruledPathInputs } from "../scripts/lib/catalog-checks.mjs";
import { workerParts } from "../scripts/lib/worker-build.mjs";
import { FREE_TEXT_INPUTS, filePins, inputRules, readCatalog, REQUIRED_RULES, UNPINNED_FILES } from "../scripts/lib/worker-catalog.mjs";
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
  "image-matte-feynobg",
  "infinitetalk-wanwrapper",
  "interpolate-rife-vfi",
  "lipsync-latentsync16",
  "lipsync-v2v-infinitetalk",
  "qwen-image-21-edit-small",
  "qwen-image-21-t2i-small",
  "sfx-hunyuan-foley",
  "sfx-thinksound",
  "speech-edit-auk",
  "speech-tts-auk",
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
  "video-key-corridorkey",
  "video-motion-transfer-h3",
  "voice-change-chatterbox",
];

/**
 * Workflows whose graphs still save results with their metadata (the prompt, the local time). The list may only shrink.
 * image-vectorize-vtracer's SVG save node writes the run's graph into each SVG whatever ComfyUI is told. A worker takes
 * it out of the SVG before the studio gets it, and tells every clip save node to write none (bin/lib/worker/results.mjs),
 * so the list matters for runs on a person's own GPU.
 */
const KEEPS_METADATA = [
  "captions-whisper-burnin",
  "image-vectorize-vtracer",
  "infinitetalk-wanwrapper",
  "interpolate-rife-vfi",
  "lipsync-latentsync16",
  "lipsync-v2v-infinitetalk",
  "mixed-media-zimage-frames",
  "selftest-meta-batch",
  "upscale-video-esrgan-chunked",
  "upscale-video-rtx",
  "upscale-video-seedvr2-chunked",
  "v2a-mmaudio",
  "video-key-corridorkey",
  "video-matte-vrmbg3",
];

const SHA = "0123456789abcdef".repeat(4);
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("every model file has a SHA-256 pin", () => {
  it("every file a catalog workflow names, but for a list of gaps that may only shrink", () => {
    const gaps = unpinnedModelFiles(catalog, rules);
    const fresh = Object.keys(gaps).filter((f) => !UNPINNED_FILES.includes(f));
    expect(fresh, `Pin these in workflows/comfyui/model-pins.json:\n${fresh.map((f) => `${f} (${gaps[f].join(", ")})`).join("\n")}`).toEqual([]);
    const pinned = UNPINNED_FILES.filter((f) => !gaps[f]);
    expect(pinned, `These have a pin now: take them off UNPINNED_FILES (scripts/lib/worker-catalog.mjs)\n${pinned.join("\n")}`).toEqual([]);
    const pins = filePins(catalog) as Record<string, string>;
    for (const sha of Object.values(pins)) expect(sha).toMatch(/^[0-9a-f]{64}$/);
    // Every file of the index is pinned or on the list; the list's other entries are files only a graph names.
    const indexFiles = Object.keys(catalog.requirements.files);
    const onList = UNPINNED_FILES.filter((f) => indexFiles.includes(f));
    expect(Object.keys(pins).length + onList.length).toBe(indexFiles.length);
    for (const f of UNPINNED_FILES.filter((x) => !indexFiles.includes(x))) expect(f, f).not.toMatch(/[\\/]/);
  });

  it("a file with no pin is found, in the index or only in a graph", () => {
    const loader = (name: string) => ({ "1": { class_type: "UNETLoader", inputs: { unet_name: name, weight_dtype: "default" } } });
    const fake = (graph: Graph, over: Partial<ManifestWorkflow> = {}, pins: Catalog["pins"] = {}, firstRun: Record<string, { path: string }[]> = {}) => ({
      graphs: { "a.json": graph },
      manifest: { workflows: [{ id: "a", file: "a.json", models: [], bindings: {}, ...over }] },
      requirements: { files: { "diffusion_models/x.safetensors": { folder: "diffusion_models", file: "x.safetensors", url: "https://h/x" } }, workflows: { a: { files: ["diffusion_models/x.safetensors"], optional: [] } } },
      pins,
      firstRun: { workflows: firstRun },
    });
    const r = { inputs: { UNETLoader: { unet_name: { kind: "model-file", folders: ["diffusion_models"] } } } };
    expect(unpinnedModelFiles(fake(loader("x.safetensors")), r)).toEqual({ "diffusion_models/x.safetensors": ["a"] });
    expect(unpinnedModelFiles(fake(loader("x.safetensors"), {}, { "https://h/x": { sha256: SHA } }), r)).toEqual({});
    // A file the index doesn't know can't have a pin.
    expect(unpinnedModelFiles(fake(loader("y.safetensors"), {}, { "https://h/x": { sha256: SHA } }), r)).toEqual({ "y.safetensors": ["a"] });
    // Unless the run picks it (a LoRA the manifest binds), or first-run-files.json pins it for that workflow.
    const pinned = { "https://h/x": { sha256: SHA } };
    expect(unpinnedModelFiles(fake(loader("y.safetensors"), { bindings: { lora: [{ node: "1", input: "unet_name" }] } }, pinned), r)).toEqual({});
    const fetched = { autoDownloads: ["the node downloads y.safetensors on first run"] };
    expect(unpinnedModelFiles(fake(loader("y.safetensors"), fetched, pinned, { a: [{ path: "models/diffusion_models/y.safetensors" }] }), r)).toEqual({});
    // Named in the autoDownloads text only, or pinned for another workflow, or under a name that only starts the
    // same: it still has no pin.
    expect(unpinnedModelFiles(fake(loader("y.safetensors"), fetched, pinned), r)).toEqual({ "y.safetensors": ["a"] });
    expect(unpinnedModelFiles(fake(loader("y.safetensors"), fetched, pinned, { b: [{ path: "models/diffusion_models/y.safetensors" }] }), r)).toEqual({ "y.safetensors": ["a"] });
    expect(unpinnedModelFiles(fake(loader("y.pt"), { autoDownloads: ["the node downloads y.pth"] }, pinned, { a: [{ path: "models/x/y.pth" }] }), r)).toEqual({ "y.pt": ["a"] });
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
    for (const p of ["../x.pth", "/x.pth", "C:/x.pth", "models/../x.pth", "models\\x.pth", "~/x.pth", "models//x.pth", ".hidden/x", "models/x..pth", ""]) {
      expect(firstRunFileProblem({ ...good, path: p }), p).toMatch(/plain relative path/);
    }
    // Data folders only: a model folder, or a folder inside a node pack. Never ComfyUI's or a pack's own code.
    for (const p of ["custom_nodes/ComfyUI-Frame-Interpolation/ckpts/rife/rife49.pth", "custom_nodes/ComfyUI-IndexTTS2/checkpoints/config.yaml", "models/insightface/models/buffalo_l/det_10g.onnx", "models/x.pth"]) {
      expect(firstRunFileProblem({ ...good, path: p }), p).toBeNull();
    }
    for (const p of ["main.py", "comfy/sd.py", "custom_nodes/ComfyUI-RMBG/__init__.py", "custom_nodes/ComfyUI-RMBG/x.pth", "custom_nodes/x.pth", "user/default/x.json", "models"]) {
      expect(firstRunFileProblem({ ...good, path: p }), p).toMatch(/model folder .* node pack/);
    }
    for (const p of ["custom_nodes/ComfyUI-RMBG/nodes/x.py", "custom_nodes/pack/lib/x.pyd", "models/x/run.bat", "models/x/lib.dll", "models/x/a.so", "models/x/tool.EXE", "models/x/web.js", "models/x/x.ps1"]) {
      expect(firstRunFileProblem({ ...good, path: p }), p).toMatch(/never code/);
    }
    for (const p of ["models/CON", "models/nul.pth", "models/x/COM1.bin", "models/aux/x.pth", "models/x/y."]) {
      expect(firstRunFileProblem({ ...good, path: p }), p).toMatch(/Windows device/);
    }
    expect(firstRunFileProblem({ ...good, url: "http://huggingface.co/org/repo/resolve/main/x" })).toMatch(/https/);
    expect(firstRunFileProblem({ ...good, url: "https://user@github.com/org/repo/x" })).toMatch(/https/);
    expect(firstRunFileProblem({ ...good, url: "https://github.com" })).toMatch(/https/);
    // Every Hugging Face host names a commit: huggingface.co, hf.co and the hosts under them, in any case.
    for (const url of ["https://huggingface.co/org/repo/resolve/main/x", "https://hf.co/org/repo/resolve/main/x", "https://HuggingFace.co/org/repo/resolve/main/x", "https://cdn-lfs.huggingface.co/repos/x", "https://cas-bridge.xethub.hf.co/x"]) {
      expect(firstRunFileProblem({ ...good, url }), url).toMatch(/commit/);
    }
    expect(firstRunFileProblem({ ...good, url: `https://hf.co/org/repo/resolve/${COMMIT}/BEN2_Base.pth` })).toBeNull();
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
    expect(unruledPathInputs(catalog, less)).toEqual(["AILab_Qwen3ASRSubtitle.output_path (required, named for a path, a path or a download)", "UNETLoader.unet_name (a model file, a path or a download)"]);
  });

  it("stops when the catalog links another node into any input that has a rule (a model file, a sent file, a save name)", () => {
    const relink = (cls: string, input: string) => {
      const c = structuredClone(catalog);
      let n = 0;
      for (const g of Object.values(c.graphs)) {
        for (const node of Object.values(g ?? {})) {
          if (node?.class_type !== cls || !(input in (node.inputs ?? {})) || n) continue;
          node.inputs[input] = ["999", 0];
          n++;
        }
      }
      expect(n, `${cls}.${input}`).toBe(1);
      return c;
    };
    for (const [cls, input] of [
      ["UNETLoader", "unet_name"],
      ["LoadImage", "image"],
      ["SaveImage", "filename_prefix"],
      ["SaveVideo", "filename_prefix"],
    ]) {
      expect(() => workerParts(relink(cls, input), root), `${cls}.${input}`).toThrow(new RegExp(`${cls}\\.${input} .*links into it`));
    }
  });

  it("reads a value the studio fills per run only for a slash path, a model file or a name that says path", () => {
    const fake = (inputs: Record<string, unknown>, bound: string[] = []) => ({
      graphs: { "a.json": { "1": { class_type: "SomeApiNode", inputs } } },
      manifest: { workflows: [{ id: "a", file: "a.json", models: [], bindings: Object.fromEntries(bound.map((i) => [i, [{ node: "1", input: i }]])) }] },
      requirements: { files: {}, workflows: { a: { core: ["SomeApiNode"], packs: {}, files: [], optional: [], vramGb: 0, firstRun: [] } } },
      pins: {},
    });
    const flagged = (c: ReturnType<typeof fake>) => pathInputs(c).map((p: { input: string; why: string[] }) => `${p.input} (${p.why.join(", ")})`);
    const ruleOf = (c: ReturnType<typeof fake>, input: string) => (inputRules(c) as Rules).inputs.SomeApiNode?.[input];
    // An aspect ratio and a time the run fills: free text, which the worker takes ("16:9", "21:9").
    const perRun = fake({ aspect_ratio: "16:9", start: "00:00:05" }, ["aspect_ratio", "start"]);
    expect(flagged(perRun)).toEqual([]);
    expect(() => workerParts(perRun, root)).not.toThrow();
    expect(ruleOf(perRun, "aspect_ratio")).toBeUndefined();
    expect((inputRules(perRun) as Rules).text.SomeApiNode).toEqual(["aspect_ratio", "start"]);
    // The same values written in the catalog only: held to them.
    const fixed = fake({ aspect_ratio: "16:9", start: "00:00:05" });
    expect(flagged(fixed)).toEqual(["aspect_ratio (refused as a path)", "start (refused as a path)"]);
    expect(unruledPathInputs(fixed, inputRules(fixed))).toEqual([]);
    expect(ruleOf(fixed, "aspect_ratio")).toEqual({ kind: "literal", value: "16:9" });
    // A slash path is held to the catalog's value even when the run fills the input.
    const slash = fake({ source: "C:/media/x.mp4" }, ["source"]);
    expect(flagged(slash)).toEqual(["source (a path or a download)"]);
    expect(unruledPathInputs(slash, inputRules(slash))).toEqual([]);
  });

  it("finds a path in words and inside settings written as JSON, and the build holds them to the catalog's values", () => {
    const fake = (inputs: Record<string, unknown>) => ({
      graphs: { "a.json": { "1": { class_type: "SomeNode", inputs } } },
      manifest: { workflows: [{ id: "a", file: "a.json", models: [], bindings: {} }] },
      requirements: { files: {}, workflows: { a: { core: ["SomeNode"], packs: {}, files: [], optional: [], vramGb: 0, firstRun: [] } } },
      pins: {},
    });
    const cases: [unknown, string][] = [
      [JSON.stringify({ shots: [{ id: "a", prompt: "A calm shot." }], source: "../../../Users/x/v.mp4" }, null, 2), "a path in its JSON"],
      [JSON.stringify({ weights: "model.safetensors", note: "the base" }, null, 2), "a path in its JSON"],
      [JSON.stringify({ base: "C:\\Users\\x" }, null, 2), "a path in its JSON"],
      ["C:\\Users\\x\\a secret file.mp4", "a path in its words"],
      ["/etc/x and more words", "a path in its words"],
    ];
    for (const [v, why] of cases) {
      const c = fake({ plan: v });
      expect(pathInputs(c).map((p: { why: string[] }) => p.why.join(", ")), String(v)).toEqual([why]);
      expect(unruledPathInputs(c, inputRules(c)), String(v)).toEqual([]);
      expect((inputRules(c) as Rules).inputs.SomeNode?.plan, String(v)).toEqual({ kind: "literal", value: v });
    }
    // Settings and words with no path keep free text.
    for (const v of [JSON.stringify({ coordinate_space: "pixels", boxes: [] }, null, 2), "auto (1088 -> 1080, 2176 -> 2160)", "Scene 2: 50% faster"]) {
      const c = fake({ plan: v });
      expect(pathInputs(c), v).toEqual([]);
      expect((inputRules(c) as Rules).text.SomeNode, v).toEqual(["plan"]);
    }
  });

  it("every input filled per run with text that isn't a prompt has a rule or is a known setting", () => {
    const subset = read("object_info.subset.json");
    expect(perRunTextInputs(catalog, subset, rules), "Give each a rule, or add it to FREE_TEXT_INPUTS (scripts/lib/worker-catalog.mjs) when its node never reads it as a path").toEqual([...FREE_TEXT_INPUTS].sort());
    // Read on its own: a text input the run fills, with a default that names no path, is found all the same.
    const fake = (inputs: Record<string, unknown>, bound: string[], cls = "SomeNode") => ({
      graphs: { "a.json": { "1": { class_type: cls, inputs } } },
      manifest: { workflows: [{ id: "a", file: "a.json", models: [], bindings: Object.fromEntries(bound.map((i) => [i, [{ node: "1", input: i }]])) }] },
      requirements: { files: {}, workflows: {} },
      pins: {},
    });
    const defs = { SomeNode: { input: { required: { voice: ["STRING", {}], prompt: ["STRING", {}], mode: [["fast", "slow"]], steps: ["INT", {}], picked: ["COMBO", { options: ["a"] }] }, optional: { extra: ["STRING", {}] } } } };
    const c = fake({ voice: "narrator", prompt: "a calm shot", mode: "fast", steps: 4, picked: "a", extra: "" }, ["voice", "prompt", "mode", "steps", "picked", "extra"]);
    expect(perRunTextInputs(c, defs, inputRules(c))).toEqual(["SomeNode.extra", "SomeNode.voice"]);
    // Not filled per run: the catalog's own value, which the path checks read.
    expect(perRunTextInputs(fake({ voice: "narrator" }, []), defs, { inputs: {} })).toEqual([]);
    // With a rule: held to it.
    expect(perRunTextInputs(c, defs, { inputs: { SomeNode: { voice: { kind: "literal", value: "narrator" }, extra: { kind: "literal", value: "" } } } })).toEqual([]);
    // A node the definitions don't name: text in the catalog counts, a number doesn't.
    expect(perRunTextInputs(fake({ voice: "narrator", steps: 4 }, ["voice", "steps"], "OtherNode"), defs, { inputs: {} })).toEqual(["OtherNode.voice"]);
  });

  it("from the command line it builds however the script is reached, a linked folder included", () => {
    const link = path.join(tempDir("fuobe-worker-link-"), "repo");
    fs.symlinkSync(root, link, process.platform === "win32" ? "junction" : "dir");
    try {
      const out = path.join(tempDir("fuobe-worker-linked-out-"), "dist");
      const r = spawnSync(process.execPath, [path.join(link, "scripts/build-worker.mjs"), "--out", out], { cwd: link, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^worker: /);
      expect(fs.readdirSync(out).sort()).toEqual(fs.readdirSync(first).sort());
      for (const f of fs.readdirSync(out)) expect(fs.readFileSync(path.join(out, f), "utf8"), f).toBe(fs.readFileSync(path.join(first, f), "utf8"));
    } finally {
      fs.unlinkSync(link);
    }
  }, 60_000);

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
    expect(files).toEqual(expect.arrayContaining(["allowed-nodes.json", "input-rules.json", "file-pins.json", "computer-runner.mjs", "build-stamp.json"]));
    // Stamped with this checkout, so a worker starts on these parts (and on no older ones).
    expect(built(first, "build-stamp.json")).toEqual({ built: "scripts/build-worker.mjs", stamp: buildStamp(root) });
    expect(distProblem(root, first)).toBeNull();
    const parts = workerParts(catalog, root) as { nodes: string[]; rules: Rules; pins: Record<string, string> };
    expect(built(first, "allowed-nodes.json")).toEqual({ built: "scripts/build-worker.mjs", nodes: parts.nodes });
    expect(built(first, "input-rules.json")).toEqual({ built: "scripts/build-worker.mjs", ...parts.rules });
    expect(built(first, "file-pins.json")).toEqual({ built: "scripts/build-worker.mjs", files: filePins(catalog) });
    // The pins come from the requirement index, which is the one its inputs build, byte for byte (a Windows checkout
    // may turn its line ends into CRLF).
    expect(fs.readFileSync(path.join(LIBRARY, "requirements.json"), "utf8").replace(/\r\n/g, "\n")).toBe(formatIndex(buildIndex(loadInputs(LIBRARY))));
  }, 60_000);
});

describe("CPU work is marked in the requirement index", () => {
  const index = catalog.requirements.workflows;
  const loaders = new Set(Object.keys(LOADER_FOLDERS));
  /**
   * Read on its own: a node that loads or runs a model, a model file, an input whose value names a download or a model
   * file (a node that fetches weights by an "org/name" id), a first-run download, or VRAM.
   */
  const usesGpu = (w: ManifestWorkflow, graphs: Record<string, Graph> = catalog.graphs) => {
    const graph = graphs[w.file] ?? {};
    const nodes = Object.values(graph).filter((n) => typeof n?.class_type === "string");
    const gpuNode = nodes.some((n) => loaders.has(n.class_type) || Object.keys(n.inputs ?? {}).some((i) => rules.inputs[n.class_type]?.[i]?.kind === "model-file"));
    // A save name or a file the job sends names no weights, whatever its value, and neither does a media type
    // ("video/h264-mp4", a save node's format).
    const flagged = pathInputs({ graphs: { [w.file]: graph }, manifest: { workflows: [w] } }).filter(
      (p: { cls: string; input: string; why: string[] }) =>
        !["input-file", "output-name"].includes(rules.inputs[p.cls]?.[p.input]?.kind ?? "") && p.why.some((why) => why === "a path or a download" || why === "a model file"),
    );
    const mediaType = (v: unknown) => typeof v === "string" && /^(image|video|audio)\/[\w.+-]+$/.test(v);
    const weights = flagged.some((p: { cls: string; input: string }) => nodes.some((n) => n.class_type === p.cls && p.input in (n.inputs ?? {}) && !mediaType(n.inputs[p.input]) && !Array.isArray(n.inputs[p.input])));
    return gpuNode || weights || w.models.length > 0 || (w.autoDownloads ?? []).length > 0 || typeof w.vramGb !== "number" || w.vramGb > 0;
  };

  it("every catalog workflow that uses no GPU node is marked, and only those", () => {
    const wrong = catalog.manifest.workflows.filter((w) => !!index[w.id]?.cpu !== !usesGpu(w) || !!index[w.id]?.cpu !== cpuWork(w)).map((w) => w.id);
    expect(wrong).toEqual([]);
    const cpu = Object.keys(index).filter((id) => index[id].cpu);
    expect(cpu).toEqual(expect.arrayContaining(["video-trim", "video-concat-encoded", "video-concat-2", "video-mux-audio", "audio-join-crossfade", "kenburns-still", "still-to-clip", "captions-burnin", "frame-extract"]));
    for (const id of ["wan22-t2v-14b", "bg-remove-rmbg", "separate-soundtrack-dbs", "video-fix-colours", "upscale-image-esrgan"]) expect(index[id]?.cpu, id).toBeUndefined();
  });

  it("the cross-check finds a node that fetches weights by a download id or a file name, with no loader and no model listed", () => {
    const w: ManifestWorkflow = { id: "x", file: "x.json", models: [], vramGb: 0, bindings: {} };
    const one = (inputs: Record<string, unknown>) => ({ "x.json": { "1": { class_type: "SomeNewNode", inputs }, "2": { class_type: "SaveVideo", inputs: { video: ["1", 0], filename_prefix: "fuobe/x", format: "video/h264-mp4" } } } });
    // What the index would say (CPU work) against what the graph shows: the test above fails on such a workflow.
    expect(cpuWork(w)).toBe(true);
    expect(usesGpu(w, one({ repo_id: "someone/weights-model" }))).toBe(true);
    expect(usesGpu(w, one({ weights: "net.pth" }))).toBe(true);
    expect(usesGpu(w, one({ mode: "fast", fps: 24 }))).toBe(false);
  });

  it("a model file, a first-run download or any VRAM makes a workflow GPU work", () => {
    expect(cpuWork({ models: [], vramGb: 0 })).toBe(true);
    expect(cpuWork({ models: [{ file: "x.safetensors", folder: "vae" }], vramGb: 0 })).toBe(false);
    expect(cpuWork({ models: [], autoDownloads: ["a node fetches x"], vramGb: 0 })).toBe(false);
    expect(cpuWork({ models: [], vramGb: 2 })).toBe(false);
    // Only an explicit 0: a missing, misspelt or written-as-text vramGb is never CPU work.
    expect(cpuWork({ models: [] })).toBe(false);
    expect(cpuWork({ models: [], vramGB: 0 })).toBe(false);
    expect(cpuWork({ models: [], vramGb: "0" })).toBe(false);
    expect(cpuWork({ models: [], vramGb: null })).toBe(false);
  });

  it("the index can't be built while a workflow's vramGb is missing or isn't a number", () => {
    const inputs = loadInputs(LIBRARY);
    const id = "video-trim";
    for (const vramGb of [undefined, "0", null, -1, Number.NaN]) {
      const manifest = { ...inputs.manifest, workflows: inputs.manifest.workflows.map((w: ManifestWorkflow) => (w.id === id ? { ...w, vramGb } : w)) };
      expect(() => buildIndex({ ...inputs, manifest }), String(vramGb)).toThrow(new RegExp(`${id}: vramGb must be a number`));
    }
    expect(() => buildIndex(inputs)).not.toThrow();
  });
});

describe("saved results carry no metadata", () => {
  const formats = metadataFormats(read("object_info.subset.json"));

  it("new graphs save results without their metadata, but for a list that may only shrink", () => {
    expect(metadataKept(catalog, formats)).toEqual(KEEPS_METADATA);
  });

  it("an SVG save node always keeps it, whatever its inputs say", () => {
    const svg = (inputs: Record<string, unknown>) => ({ graphs: { "a.json": { "1": { class_type: "SaveSVGNode", inputs } } }, manifest: { workflows: [{ id: "a", file: "a.json" }] } });
    expect(metadataKept(svg({ svg: ["2", 0], filename_prefix: "fuobe/x" }), formats)).toEqual(["a"]);
    expect(metadataKept(svg({ svg: ["2", 0], filename_prefix: "fuobe/x", save_metadata: false }), formats)).toEqual(["a"]);
    expect(metadataKept({ graphs: { "a.json": { "1": { class_type: "SaveImage", inputs: { images: ["2", 0] } } } }, manifest: { workflows: [{ id: "a", file: "a.json" }] } }, formats)).toEqual([]);
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
