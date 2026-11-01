import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { GenInput } from "@/lib/catalog/types";
import type { ComfyWorkflow, Manifest, ManifestWorkflow } from "@/lib/comfy";
import { resolveWorkflowId } from "@/lib/comfy-variants";
import { ATTRIBUTIONS, licenceInfo, licenceTerms, nodePack, OPENMDW_NOTICE, workflowLicence } from "@/lib/licences";
import type { ReuseModel } from "@/lib/av/clean-voice";
import type { MediaInfo } from "@/lib/media-probe";

// Clean up voice on the open engine: Fuobe's ComfyUI-RE-USE pack in this repository, its two graphs in the manifest, the
// pinned weights, the install script, the licence rows, and how the provider fills the RE-USE bindings.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-comfy-reuse-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { collectOutputs, comfyReuseModels, prepareWorkflow } = await import("@/server/providers/comfyui");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const manifest = JSON.parse(read("workflows/comfyui/manifest.json")) as Manifest;
const entry = (id: string) => manifest.workflows.find((w) => w.id === id) as ManifestWorkflow;
const graph = (id: string) => JSON.parse(read(`workflows/comfyui/${id}.json`)) as ComfyWorkflow;
const requirements = JSON.parse(read("workflows/comfyui/requirements.json"));
const packs = JSON.parse(read("workflows/comfyui/packs.json"));
const pins = JSON.parse(read("workflows/comfyui/model-pins.json"));
const install = read("scripts/comfy/install-comfyui.sh");

const VOICE = "https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE/resolve/31f82f2efad1095034492f236e8dac9239ba713b/model.safetensors";
const LAUGHTER = "https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE-laughter/resolve/1b1521dd659608e1e063ada83e0acfe1da473a8b/model.safetensors";

describe("the two RE-USE graphs in the manifest", () => {
  it("voice-clean-reuse: LoadAudio, RE-USE, a FLAC voice and the report", () => {
    const e = entry("voice-clean-reuse");
    expect(e).toMatchObject({ capability: "enhance-voice", vramGb: 0 });
    expect(e.bindings).toMatchObject({
      audio: [{ node: "1", input: "audio" }],
      reuseModel: [{ node: "2", input: "model" }],
      rate: [{ node: "3", input: "rate" }],
      channels: [{ node: "3", input: "channels" }],
      roomToneDb: [{ node: "3", input: "room_tone_db" }],
      level: [{ node: "3", input: "level" }],
    });
    expect(e.outputs).toEqual([
      { node: "4", kind: "audio", stem: "voice" },
      { node: "5", kind: "text", role: "report" },
    ]);
    const g = graph("voice-clean-reuse");
    expect(Object.fromEntries(Object.entries(g).map(([id, n]) => [id, n.class_type]))).toEqual({ "1": "LoadAudio", "2": "REUSELoader", "3": "REUSEEnhance", "4": "SaveAudioAdvanced", "5": "PreviewAny" });
    expect(g["3"].inputs).toMatchObject({ reuse_model: ["2", 0], audio: ["1", 0], rate: "source", chunk_seconds: 0, overlap_seconds: 1, room_tone_db: -60, level: "match input" });
    expect(g["4"].inputs.format).toBe("flac");
    expect(g["5"].inputs.source).toEqual(["3", 1]);
  });

  it("voice-clean-bed-reuse: DBS splits, RE-USE cleans the speech, and the original minus the speech goes back under it", () => {
    const e = entry("voice-clean-bed-reuse");
    expect(e.capability).toBe("enhance-voice");
    expect(e.bindings.separationModel).toEqual([{ node: "3", input: "model" }]);
    expect(e.bindings.channels).toEqual([
      { node: "4", input: "channels" },
      { node: "6", input: "channels" },
    ]);
    const g = graph("voice-clean-bed-reuse");
    expect(g["5"].inputs).toEqual({ audio1: ["1", 0], audio2: ["4", 2], merge_method: "subtract" });
    expect(g["6"].inputs).toMatchObject({ audio: ["4", 2], bed: ["5", 0], bed_db: 0 });
    expect(e.customNodes.map((c) => c.name).sort()).toEqual(["ComfyUI-DBS", "ComfyUI-RE-USE"]);
  });

  it("lists the voice model as required and the laughter model as optional, pinned to the NemotronLabs repositories", () => {
    for (const id of ["voice-clean-reuse", "voice-clean-bed-reuse"]) {
      const models = entry(id).models;
      expect(models).toContainEqual({ file: "NemotronLabs-RE-USE.safetensors", folder: "reuse", url: VOICE, sizeGb: 0.04 });
      expect(models).toContainEqual({ file: "NemotronLabs-RE-USE-laughter.safetensors", folder: "reuse", url: LAUGHTER, sizeGb: 0.04, optional: true });
      // Never the older, non-commercial nvidia/RE-USE.
      expect(JSON.stringify(models)).not.toMatch(/huggingface\.co\/nvidia\/RE-USE\//);
    }
  });

  it("runs the bed graph for Keep music & effects only", () => {
    const has = (id: string) => manifest.workflows.some((w) => w.id === id);
    const req = (extra: Record<string, unknown>) => ({ op: "enhance-voice", clips: 0, images: 0, audio2: false, extra, has });
    expect(resolveWorkflowId("voice-clean-reuse", req({}))).toBe("voice-clean-reuse");
    expect(resolveWorkflowId("voice-clean-reuse", req({ background: "keep" }))).toBe("voice-clean-bed-reuse");
    expect(resolveWorkflowId("voice-clean-reuse", req({ background: "remove" }))).toBe("voice-clean-reuse");
  });
});

describe("requirements.json, packs.json and the pins", () => {
  it("installs the pack from a subfolder of this repository at its pin, with the reuse folder and both classes", () => {
    const pack = requirements.packs["ComfyUI-RE-USE"];
    expect(pack).toMatchObject({ repo: "https://github.com/workingprototype/Fuobe", subdir: "comfy-nodes/ComfyUI-RE-USE", classes: ["REUSEEnhance", "REUSELoader"], folders: ["reuse"], requirementsTxt: false, install: "manual" });
    expect(pack.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(packs["ComfyUI-RE-USE"].commit).toBe(pack.commit);
    expect(requirements.folders).toContain("reuse");
    expect(requirements.sentinels).toEqual(expect.arrayContaining(["REUSELoader", "REUSEEnhance"]));
  });

  it("knows both weight files: their URLs, sizes and SHA-256", () => {
    expect(requirements.files["reuse/NemotronLabs-RE-USE.safetensors"]).toMatchObject({ pinnedUrl: VOICE, sizeBytes: 38_592_940, packFolder: "ComfyUI-RE-USE" });
    expect(requirements.files["reuse/NemotronLabs-RE-USE-laughter.safetensors"]).toMatchObject({ pinnedUrl: LAUGHTER, sizeBytes: 38_592_940, presence: "list" });
    expect(pins[VOICE].sha256).toBe("06badaf4029b297f97f7fe48d62990b48d5482608210df577354e0d4e0ed70e1");
    expect(pins[LAUGHTER].sha256).toBe("35c2a4e284515275d2e49a8e8cb5cd392ae67a1f1d345de1c12a0202c7b6b610");
    expect(requirements.workflows["voice-clean-reuse"]).toMatchObject({ files: ["reuse/NemotronLabs-RE-USE.safetensors"], optional: ["reuse/NemotronLabs-RE-USE-laughter.safetensors"], packs: { "ComfyUI-RE-USE": ["REUSEEnhance", "REUSELoader"] } });
  });
});

describe("install-comfyui.sh", () => {
  it("copies the pack from this checkout (no pin to drift) and fetches both weights with their SHA-256", () => {
    expect(install).toContain('cp -r "$REPO_ROOT/comfy-nodes/ComfyUI-RE-USE" "$COMFYUI_DIR/custom_nodes/"');
    expect(install).toContain("06badaf4029b297f97f7fe48d62990b48d5482608210df577354e0d4e0ed70e1  NemotronLabs-RE-USE.safetensors");
    expect(install).toContain("35c2a4e284515275d2e49a8e8cb5cd392ae67a1f1d345de1c12a0202c7b6b610  NemotronLabs-RE-USE-laughter.safetensors");
    expect(install).toContain('"NemotronLabs-RE-USE 31f82f2efad1095034492f236e8dac9239ba713b"');
    expect(install).toMatch(/REUSE_WEIGHTS:-1/);
    expect(install).not.toMatch(/huggingface\.co\/nvidia\/RE-USE\//);
  });
});

describe("the provider fills the RE-USE bindings", () => {
  async function prepare(input: GenInput, opts: { device?: string; media?: Record<string, MediaInfo>; installed?: ReuseModel[] | null; id?: string } = {}) {
    let asked = 0;
    const res = await prepareWorkflow(opts.id ?? "voice-clean-reuse", { seed: 1, ...input }, {
      generationId: "gen1",
      op: "enhance-voice",
      upload: async (_d, _t, name) => `up_${name}`,
      media: (name) => opts.media?.[name],
      device: async () => {
        asked++;
        return opts.device;
      },
      reuseModels: async () => opts.installed,
      dbsModels: async () => undefined,
    });
    return { wf: res.workflow, asked, id: res.manifest.id };
  }

  it("loads the file for Voice only or Keep laughter, and refuses one the host doesn't have, in words", async () => {
    expect((await prepare({ audio: "a.wav" })).wf["2"].inputs.model).toBe("NemotronLabs-RE-USE.safetensors");
    expect((await prepare({ audio: "a.wav", extra: { reuseModel: "laughter" } }, { installed: ["voice", "laughter"] })).wf["2"].inputs.model).toBe("NemotronLabs-RE-USE-laughter.safetensors");
    await expect(prepare({ audio: "a.wav", extra: { reuseModel: "laughter" } }, { installed: ["voice"] })).rejects.toThrow(/^Keep laughter isn't installed/);
    await expect(prepare({ audio: "a.wav" }, { installed: [] })).rejects.toThrow(/^RE-USE isn't on your ComfyUI yet \(models\/reuse\/NemotronLabs-RE-USE\.safetensors, 39 MB\)/);
    await expect(prepare({ audio: "a.wav" }, { installed: null })).rejects.toThrow(/^Clean up voice needs the ComfyUI-RE-USE nodes/);
  });

  it("picks the rate: the source's on a GPU, capped on a CPU (16 kHz past 2 minutes), or the one asked for", async () => {
    expect((await prepare({ audio: "a.wav" }, { device: "cuda" })).wf["3"].inputs.rate).toBe("source");
    expect((await prepare({ audio: "a.wav" }, { device: "cpu" })).wf["3"].inputs.rate).toBe("source up to 24000");
    const long: MediaInfo = { container: "wav", duration: 600, hasVideo: false, hasAudio: true, channels: 1 };
    expect((await prepare({ audio: "a.wav" }, { device: "cpu", media: { "a.wav": long } })).wf["3"].inputs.rate).toBe("source up to 16000");
    const full = await prepare({ audio: "a.wav", extra: { rate: "48000" } }, { device: "cpu" });
    expect(full.wf["3"].inputs.rate).toBe("48000");
    expect(full.asked).toBe(0);
  });

  it("writes Strength as room tone and the level in the node's words, and nothing of the page's own keys", async () => {
    const { wf } = await prepare({ audio: "a.wav", extra: { strength: "natural", level: "voice", background: "remove", sourceChannels: 2 } });
    expect(wf["3"].inputs).toMatchObject({ room_tone_db: -24, level: "-16 LUFS", channels: "mono" });
    expect(JSON.stringify(wf)).not.toMatch(/sourceChannels|strength|background/);
    expect((await prepare({ audio: "a.wav", extra: { strength: "light" } })).wf["3"].inputs.room_tone_db).toBe(-14);
  });

  it("reads a video's soundtrack, and keeps music & effects on the bed graph (mono bed for a surround source)", async () => {
    expect((await prepare({ video: "clip.mp4" })).wf["1"].inputs.audio).toBe("clip.mp4");
    const bed = await prepare({ video: "clip.mp4", extra: { background: "keep", strength: "natural" } });
    expect(bed.id).toBe("voice-clean-bed-reuse");
    expect(bed.wf["6"].inputs).toMatchObject({ room_tone_db: -24, bed: ["5", 0] });
    const surround: MediaInfo = { container: "mp4", duration: 10, hasVideo: true, hasAudio: true, channels: 6 };
    const five = await prepare({ video: "clip.mp4", extra: { background: "keep", channels: "each channel" } }, { media: { "clip.mp4": surround } });
    expect(five.wf["5"].inputs).toEqual({ audio1: ["4", 0], audio2: ["4", 1], merge_method: "add" });
    expect([five.wf["4"].inputs.channels, five.wf["6"].inputs.channels]).toEqual(["mono", "mono"]);
  });
});

describe("which RE-USE files the host has (GET /models/reuse)", () => {
  it("reads the list (Windows paths too), says null without the pack, and nothing when unreachable", async () => {
    globalThis.__fuobeComfyReuse = undefined;
    let answer: Response | Error = Response.json(["NemotronLabs-RE-USE.safetensors", "sub\\NemotronLabs-RE-USE-laughter.safetensors"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe("http://comfy.test:8188/models/reuse");
        if (answer instanceof Error) throw answer;
        return answer.clone();
      }),
    );
    try {
      expect(await comfyReuseModels("main", 0)).toEqual(["voice", "laughter"]);
      answer = new Response("Not found", { status: 404 });
      expect(await comfyReuseModels("main", 0)).toBeNull();
      answer = new Error("connect ECONNREFUSED");
      expect(await comfyReuseModels("main", 0)).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      globalThis.__fuobeComfyReuse = undefined;
    }
  });
});

describe("a finished clean's outputs", () => {
  it("are the clean voice (stem voice) and the node's report as text", () => {
    const report = JSON.stringify({ device: "cuda:0", scan: "triton", rate: 48000, times_real_time: 2.1 });
    const out = collectOutputs(
      { outputs: { "4": { audio: [{ filename: "gen1_00001_.flac", subfolder: "fuobe", type: "output" }] }, "5": { text: [report] } } } as never,
      entry("voice-clean-reuse"),
      "http://comfy.test:8188",
    );
    expect(out[0]).toMatchObject({ kind: "audio", meta: { stem: "voice" } });
    expect(out[1]).toMatchObject({ kind: "text", text: report, meta: { role: "report" } });
  });
});

describe("licences, as information", () => {
  it("knows OpenMDW-1.1 as a commercial licence that keeps its notices with the weights", () => {
    const text = entry("voice-clean-reuse").license!;
    expect(licenceInfo(text)).toMatchObject({ name: "OpenMDW-1.1", class: "commercial", url: expect.stringContaining("NVIDIA-NemotronLabs-RE-USE/blob/31f82f2e") });
    expect(licenceTerms(text).notices).toEqual([OPENMDW_NOTICE]);
    expect(licenceTerms(text).flags).toEqual([]);
    expect(workflowLicence(entry("voice-clean-bed-reuse"))).toContain("DBS weights Apache-2.0");
  });

  it("records the pack (MIT, adapted NVIDIA code) at its pin and the model", () => {
    const pack = nodePack("ComfyUI-RE-USE");
    expect(pack?.licence).toMatchObject({ name: "MIT", class: "commercial" });
    expect(pack?.repo).toBe(`https://github.com/workingprototype/Fuobe/tree/${requirements.packs["ComfyUI-RE-USE"].commit}/comfy-nodes/ComfyUI-RE-USE`);
    expect(pack?.licence.note).toMatch(/not NVIDIA's code path/);
    expect(ATTRIBUTIONS.find((a) => a.for === "RE-USE (clean up voice)")).toMatchObject({ licence: "OpenMDW-1.1", note: expect.stringMatching(/non-commercial \(NSCLv1\)/) });  });
});
