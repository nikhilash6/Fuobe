import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { GenInput } from "@/lib/catalog/types";
import type { ComfyWorkflow, Manifest, ManifestWorkflow } from "@/lib/comfy";
import { licenceInfo, workflowLicence } from "@/lib/licences";
import type { DbsModel } from "@/lib/av/split";
import type { MediaInfo } from "@/lib/media-probe";

// DBS D3: graph B (dub-prepare-dbs-transcribe), the open dub's first step with DBS in place of MelBand RoFormer. Same
// output contract and ASR bindings as dub-prepare-separate-transcribe, so the dub only changes its model id.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-comfy-dbs-dub-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { collectOutputs, prepareWorkflow } = await import("@/server/providers/comfyui");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const root = path.resolve(__dirname, "..");
const lib = (f: string) => JSON.parse(fs.readFileSync(path.join(root, "workflows/comfyui", f), "utf8"));
const manifest = lib("manifest.json") as Manifest;
const entryOf = (id: string) => manifest.workflows.find((w) => w.id === id) as ManifestWorkflow;
const dbs = entryOf("dub-prepare-dbs-transcribe");
const melband = entryOf("dub-prepare-separate-transcribe");
const graphA = lib("separate-soundtrack-dbs.json") as ComfyWorkflow;
const graph = lib("dub-prepare-dbs-transcribe.json") as ComfyWorkflow;
const old = lib("dub-prepare-separate-transcribe.json") as ComfyWorkflow;

describe("dub-prepare-dbs-transcribe in the manifest", () => {
  it("has the MelBand graph's outputs: voice and background stems, cues, transcript and language", () => {
    expect(dbs).toMatchObject({ capability: "separate-audio", vramGb: 8, validated: true });
    expect(dbs.outputs).toEqual(melband.outputs);
    expect(dbs.outputs.map((o) => o.stem ?? o.role)).toEqual(["voice", "background", "cues", "transcript", "language"]);
  });

  it("has its bindings (sourceLanguage, asrModel, hints, maxChars on node 7), plus the DBS model", () => {
    const { separationModel, filenamePrefix, ...rest } = dbs.bindings;
    const { filenamePrefix: oldPrefix, ...oldRest } = melband.bindings;
    expect(rest).toEqual(oldRest);
    expect(separationModel).toEqual([{ node: "2", input: "model" }]);
    expect(filenamePrefix?.map((b) => b.node)).toEqual(oldPrefix?.map((b) => b.node));
    expect(dbs.defaults).toMatchObject({ separationModel: "DBS-BSRNN-DnR", sourceLanguage: "auto", asrModel: "Qwen/Qwen3-ASR-1.7B-hf" });
    expect(dbs.autoDownloads).toEqual(melband.autoDownloads);
  });

  it("names both packs and both DBS models, and records the licences as information", () => {
    expect(dbs.customNodes?.map((c) => c.name)).toEqual(["ComfyUI-DBS", "ComfyUI-QwenASR"]);
    expect(dbs.models.map((m) => [m.file, m.folder])).toEqual(entryOf("separate-soundtrack-dbs").models.map((m) => [m.file, m.folder]));
    expect(dbs.models.every((m) => typeof m.sizeGb === "number")).toBe(true);
    expect(dbs.license).toBe("DBS weights Apache-2.0 (trained on DnR v2, CC BY 4.0); Qwen3-ASR / ForcedAligner Apache-2.0; ComfyUI-QwenASR GPL-3.0; ComfyUI-DBS MIT");
    expect(licenceInfo(workflowLicence(dbs)).name).toBeTruthy();
  });

  it("is in the GPU pre-flight's requirement index with both packs and the DBS files", () => {
    const idx = lib("requirements.json");
    expect(idx.workflows["dub-prepare-dbs-transcribe"]).toMatchObject({
      packs: { "ComfyUI-DBS": ["DBSLoader", "DBSSeparate"], "ComfyUI-QwenASR": ["AILab_Qwen3ASRSubtitle"] },
      files: ["dbs/DBS-BSRNN-DnR/config.json", "dbs/DBS-BSRNN-DnR/model.safetensors", "dbs/DBS-TIGER-DnR/config.json", "dbs/DBS-TIGER-DnR/model.safetensors"],
      vramGb: 8,
    });
  });
});

describe("graph B", () => {
  it("splits like graph A in mono at the input's rate: the speech is the voice stem, the original minus the speech the background (FLAC)", () => {
    expect(Object.fromEntries(Object.entries(graph).map(([id, n]) => [id, n.class_type]))).toEqual({
      "1": "LoadAudio",
      "2": "DBSLoader",
      "3": "DBSSeparate",
      "4": "AudioMerge",
      "5": "SaveAudioAdvanced",
      "6": "SaveAudioAdvanced",
      "7": "AILab_Qwen3ASRSubtitle",
      "8": "SaveText",
      "9": "SaveText",
      "10": "PreviewAny",
    });
    for (const id of ["2", "3", "4"]) expect(graph[id].inputs).toEqual(graphA[id].inputs);
    expect(graph["3"].inputs).toMatchObject({ channels: "mono", output_sample_rate: "input" });
    expect([graph["5"].inputs.audio, graph["6"].inputs.audio]).toEqual([["3", 2], ["4", 0]]);
    expect([graph["5"].inputs.format, graph["6"].inputs.format]).toEqual(["flac", "flac"]);
  });

  it("transcribes the speech with the MelBand graph's Qwen3-ASR node, its settings unchanged", () => {
    const { audio, ...settings } = graph["7"].inputs;
    const { audio: oldAudio, ...oldSettings } = old["7"].inputs;
    expect(audio).toEqual(["3", 2]);
    expect(oldAudio).toEqual(["4", 0]);
    expect(settings).toEqual(oldSettings);
    for (const id of ["8", "9", "10"]) expect(Object.keys(graph[id].inputs)).toEqual(Object.keys(old[id].inputs));
    expect([graph["8"].inputs.text, graph["9"].inputs.text, graph["10"].inputs.source]).toEqual([["7", 1], ["7", 0], ["7", 2]]);
  });
});

describe("the provider fills graph B", () => {
  async function prepare(input: GenInput, opts: { device?: string; media?: Record<string, MediaInfo>; installed?: DbsModel[] } = {}) {
    const res = await prepareWorkflow("dub-prepare-dbs-transcribe", { seed: 1, ...input }, {
      generationId: "gen1",
      op: "separate-audio",
      upload: async (_d, _t, name) => `up_${name}`,
      media: (name) => opts.media?.[name],
      device: async () => opts.device,
      dbsModels: async () => opts.installed,
    });
    return res.workflow;
  }

  it("reads the video's soundtrack, picks the DBS model by the host and fills the ASR settings", async () => {
    const cpu = await prepare({ video: "clip.mp4", extra: { asrModel: "Qwen/Qwen3-ASR-0.6B-hf" } }, { device: "cpu" });
    expect(cpu["1"].inputs.audio).toBe("clip.mp4");
    expect(cpu["2"].inputs.model).toBe("DBS-BSRNN-DnR");
    expect(cpu["7"].inputs.model).toBe("Qwen/Qwen3-ASR-0.6B-hf");
    expect(["5", "6", "8", "9"].map((id) => cpu[id].inputs.filename_prefix)).toEqual(Array(4).fill("fuobe/gen1"));
    expect((await prepare({ video: "clip.mp4" }, { device: "cuda" }))["2"].inputs.model).toBe("DBS-TIGER-DnR");
    await expect(prepare({ video: "clip.mp4", extra: { separationModel: "DBS-TIGER-DnR" } }, { installed: ["DBS-BSRNN-DnR"] })).rejects.toThrow(/isn't installed on your ComfyUI/);
  });

  it("makes a surround source's background from music + effects (ComfyUI saves mono or stereo only)", async () => {
    expect((await prepare({ video: "clip.mp4" }))["4"].inputs).toEqual({ audio1: ["1", 0], audio2: ["3", 2], merge_method: "subtract" });
    const surround: MediaInfo = { container: "mp4", duration: 10, hasVideo: true, hasAudio: true, channels: 6 };
    const wf = await prepare({ video: "clip.mp4" }, { media: { "clip.mp4": surround } });
    expect(wf["3"].inputs.channels).toBe("mono");
    expect(wf["4"].inputs).toEqual({ audio1: ["3", 0], audio2: ["3", 1], merge_method: "add" });
    expect(JSON.stringify(wf)).not.toContain("sourceChannels");
  });

  it("returns the stems voice first, then the cues and the transcript", () => {
    const flac = (n: string) => ({ audio: [{ filename: `gen1_${n}.flac`, subfolder: "fuobe", type: "output" }] });
    const outs = collectOutputs(
      { outputs: { "6": flac("6"), "5": flac("5"), "8": { text: ["0.00-1.20: Hello there"] }, "9": { text: ["Hello there"] }, "10": { text: ["English"] } } } as never,
      dbs,
      "http://comfy.test:8188",
    );
    expect(outs.filter((o) => o.kind === "audio").map((o) => o.meta?.stem)).toEqual(["voice", "background"]);
    expect(outs.some((o) => o.kind === "text")).toBe(true);
  });
});
