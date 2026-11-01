import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { GenInput } from "@/lib/catalog/types";
import type { ComfyWorkflow, Manifest, ManifestWorkflow } from "@/lib/comfy";
import { installScript, nodeInstall } from "@/lib/comfy-install";
import { ATTRIBUTIONS, licenceInfo, nodePack, workflowLicence } from "@/lib/licences";
import type { DbsModel } from "@/lib/av/split";
import type { MediaInfo } from "@/lib/media-probe";

// DBS D1's ground on the open engine: the pinned pack and weights, graph A (separate-soundtrack-dbs) in the manifest,
// the folder models, the licence rows, and how the provider fills the model and channel bindings.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-comfy-dbs-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { collectOutputs, comfyDbsModels, comfyDevice, prepareWorkflow } = await import("@/server/providers/comfyui");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "workflows/comfyui/manifest.json"), "utf8")) as Manifest;
const entry = manifest.workflows.find((w) => w.id === "separate-soundtrack-dbs") as ManifestWorkflow;
const graph = JSON.parse(fs.readFileSync(path.join(root, "workflows/comfyui/separate-soundtrack-dbs.json"), "utf8")) as ComfyWorkflow;
const install = fs.readFileSync(path.join(root, "scripts/comfy/install-comfyui.sh"), "utf8");

const PACK = "f656e53434b5485c148a2866fbd6ddc6b6152ed6";
const BSRNN = "5af343f57f106fbb95efe8a60f1a3999eeb0aef8";
const TIGER = "22da7d4cd3ea63f9365181008bff1c0d2ab6fb2b";

describe("separate-soundtrack-dbs in the manifest", () => {
  it("binds the audio, the DBS model and the channel mode, with BSRNN and mono as defaults", () => {
    expect(entry).toMatchObject({ capability: "separate-audio", vramGb: 0, validated: true });
    expect(entry.bindings.audio).toEqual([{ node: "1", input: "audio" }]);
    expect(entry.bindings.separationModel).toEqual([{ node: "2", input: "model" }]);
    expect(entry.bindings.channels).toEqual([{ node: "3", input: "channels" }]);
    expect(entry.defaults).toEqual({ separationModel: "DBS-BSRNN-DnR", channels: "mono" });
    expect(entry.notes).toMatch(/^CPU OK, about 1\.7 GiB on CUDA\./);
    expect(entry.license).toBe("DBS weights Apache-2.0 (JusperLee; trained on DnR v2, CC BY 4.0); ComfyUI-DBS code MIT; vendored DBS code Apache-2.0 with MIT notices (BS-RoFormer, MSST, TIGER)");
  });

  it("outputs voice, music, effects, background and the report, in that order", () => {
    expect(entry.outputs).toEqual([
      { node: "5", kind: "audio", stem: "voice" },
      { node: "6", kind: "audio", stem: "music" },
      { node: "7", kind: "audio", stem: "effects" },
      { node: "8", kind: "audio", stem: "background" },
      { node: "9", kind: "text", role: "report" },
    ]);
  });

  it("is graph A: speech, music and sfx at the input's rate, the background as the original minus the speech, FLAC stems", () => {
    expect(Object.fromEntries(Object.entries(graph).map(([id, n]) => [id, n.class_type]))).toEqual({
      "1": "LoadAudio",
      "2": "DBSLoader",
      "3": "DBSSeparate",
      "4": "AudioMerge",
      "5": "SaveAudioAdvanced",
      "6": "SaveAudioAdvanced",
      "7": "SaveAudioAdvanced",
      "8": "SaveAudioAdvanced",
      "9": "PreviewAny",
    });
    expect(graph["2"].inputs).toEqual({ model: "DBS-BSRNN-DnR", device: "auto" });
    expect(graph["3"].inputs).toEqual({ model: ["2", 0], audio: ["1", 0], channels: "mono", output_sample_rate: "input" });
    expect(graph["4"].inputs).toEqual({ audio1: ["1", 0], audio2: ["3", 2], merge_method: "subtract" });
    // DBSSeparate's outputs: 0 music, 1 sfx, 2 speech, 3 report.
    expect(["5", "6", "7", "8"].map((id) => graph[id].inputs.audio)).toEqual([["3", 2], ["3", 0], ["3", 1], ["4", 0]]);
    expect(["5", "6", "7", "8"].every((id) => graph[id].inputs.format === "flac")).toBe(true);
    expect(graph["9"].inputs.source).toEqual(["3", 3]);
  });

  it("lists both models as required (a CUDA host runs DBS-TIGER), under models/dbs, at pinned revisions", () => {
    expect(entry.models).toEqual([
      { file: "DBS-BSRNN-DnR/model.safetensors", folder: "dbs", url: `https://huggingface.co/JusperLee/DBS-BSRNN-DnR/resolve/${BSRNN}/model.safetensors`, sizeGb: 0.02 },
      { file: "DBS-BSRNN-DnR/config.json", folder: "dbs", url: `https://huggingface.co/JusperLee/DBS-BSRNN-DnR/resolve/${BSRNN}/config.json`, sizeGb: 0 },
      { file: "DBS-TIGER-DnR/model.safetensors", folder: "dbs", url: `https://huggingface.co/JusperLee/DBS-TIGER-DnR/resolve/${TIGER}/model.safetensors`, sizeGb: 0.004 },
      { file: "DBS-TIGER-DnR/config.json", folder: "dbs", url: `https://huggingface.co/JusperLee/DBS-TIGER-DnR/resolve/${TIGER}/config.json`, sizeGb: 0 },
    ]);
    expect(entry.customNodes).toEqual([{ name: "ComfyUI-DBS", repo: `https://github.com/hiroki-abe-58/ComfyUI-DBS/tree/${PACK}` }]);
  });

  it("copies install commands that clone the pack at its pin and make each model's folder first", () => {
    const script = installScript({ ...entry, models: entry.models.map((m) => ({ ...m, present: false })) });
    expect(script).toContain(nodeInstall({ name: "ComfyUI-DBS", repo: `https://github.com/hiroki-abe-58/ComfyUI-DBS/tree/${PACK}` }));
    expect(script).toContain(`git -C "$COMFYUI/custom_nodes/ComfyUI-DBS" checkout -q ${PACK}`);
    expect(script).toContain(`mkdir -p "$COMFYUI/models/dbs/DBS-BSRNN-DnR" && wget -c -O "$COMFYUI/models/dbs/DBS-BSRNN-DnR/model.safetensors" "https://huggingface.co/JusperLee/DBS-BSRNN-DnR/resolve/${BSRNN}/model.safetensors"`);
    expect(script).toContain('"$COMFYUI/models/dbs/DBS-BSRNN-DnR/config.json"');
    // TIGER too: a GPU host set up from the Workflows page runs it by default, so its install fetches it.
    expect(script).toContain(`mkdir -p "$COMFYUI/models/dbs/DBS-TIGER-DnR" && wget -c -O "$COMFYUI/models/dbs/DBS-TIGER-DnR/model.safetensors" "https://huggingface.co/JusperLee/DBS-TIGER-DnR/resolve/${TIGER}/model.safetensors"`);
    expect(script).toContain('"$COMFYUI/models/dbs/DBS-TIGER-DnR/config.json"');
  });
});

describe("install-comfyui.sh", () => {
  it("pins ComfyUI-DBS and records the Registry flag", () => {
    expect(install).toContain(`[ComfyUI-DBS]="https://github.com/hiroki-abe-58/ComfyUI-DBS ${PACK}"`);
    expect(install).toMatch(/Comfy Registry flags its only version \(0\.1\.0/);
  });

  it("fetches the four weight files at their revisions into models/dbs/<model>/ and checks their SHA-256 (DBS_WEIGHTS=0 skips it)", () => {
    const block = install.slice(install.indexOf("# --- DBS weights"), install.indexOf("# --- end DBS weights"));
    expect(block).toContain('if [ "${DBS_WEIGHTS:-1}" = "1" ]; then');
    expect(block).toContain(`"DBS-BSRNN-DnR ${BSRNN}"`);
    expect(block).toContain(`"DBS-TIGER-DnR ${TIGER}"`);
    expect(block).toContain("https://huggingface.co/JusperLee/$name/resolve/$rev/$f");
    expect(block).toContain("sha256sum -c");
    for (const line of [
      "26290f93e7b501113325e922e7b0c18edca944634e6b9be39856a55204628405  DBS-BSRNN-DnR/model.safetensors",
      "57055e2b71913d98a4e1ed426b71617f0dfc372901cc5a8a3bc4a5c69415043e  DBS-BSRNN-DnR/config.json",
      "3d8205743f2a6f5a6704f5d4104d7cf5bf7bf02dab2fd728da31f4c69225cadb  DBS-TIGER-DnR/model.safetensors",
      "c7f7893323e78f9b99747a13090558a13c4f4b77383a38acb9979709fd04d1d8  DBS-TIGER-DnR/config.json",
    ])
      expect(block).toContain(line);
  });
});

describe("the library spec", async () => {
  const spec = await import("../scripts/comfy/library.spec.mjs");
  const build = await import("../scripts/comfy/build-library.mjs");

  it("knows the pack's classes and repository, the folder models and the new binding keys", () => {
    expect(spec.PACK_CLASSES["ComfyUI-DBS"].test("DBSLoader")).toBe(true);
    expect(spec.PACK_CLASSES["ComfyUI-DBS"].test("DBSSeparate")).toBe(true);
    expect(spec.PACK_CLASSES["ComfyUI-DBS"].test("DBSLoaderX")).toBe(false);
    expect(spec.CUSTOM_NODE_REPOS["ComfyUI-DBS"]).toBe(`https://github.com/hiroki-abe-58/ComfyUI-DBS/tree/${PACK}`);
    expect(spec.KNOWN_MODELS["DBS-TIGER-DnR/model.safetensors"]).toEqual({ folder: "dbs", url: `https://huggingface.co/JusperLee/DBS-TIGER-DnR/resolve/${TIGER}/model.safetensors` });
    const e = spec.SPEC.find((s: { id: string }) => s.id === "separate-soundtrack-dbs");
    expect(e).toMatchObject({ packs: ["ComfyUI-DBS"], requiredModels: ["DBS-BSRNN-DnR/model.safetensors", "DBS-BSRNN-DnR/config.json", "DBS-TIGER-DnR/model.safetensors", "DBS-TIGER-DnR/config.json"] });
    expect(e).not.toHaveProperty("optionalModels");
    expect(build.BINDING_KEYS.has("separationModel")).toBe(true);
    expect(build.BINDING_KEYS.has("channels")).toBe(true);
  });

  it("gives Workflows the spec's note: a file with more than 2 channels is split in mono, its background from music + effects", () => {
    const e = spec.SPEC.find((s: { id: string }) => s.id === "separate-soundtrack-dbs");
    expect(entry.notes).toBe(e?.notes);
    expect(entry.notes).toMatch(/the provider splits a file with more than 2 channels in mono and makes its background from music \+ effects \(node 4 rewired to AudioMerge add\)/);
    // Not the rule before it: every channel separated on its own.
    expect(entry.notes).not.toMatch(/forces it for inputs with more than 2 channels|6x for 5\.1/);
  });

  it("rounds sizes to two decimals, three only where two would read 0, so no other entry's size moves", () => {
    // film_net_fp16 (68,882,302 bytes) stays 0.07, as tests/video-finish.test.ts expects after a full rebuild.
    expect(build.gb(68_882_302)).toBe(0.07);
    expect(build.gb(18_900_000)).toBe(0.02);
    expect(build.gb(4_100_000)).toBe(0.004);
    expect(build.gb(1_200)).toBe(0);
    expect(build.gb(9_660_000_000)).toBe(9.66);
  });
});

describe("the provider fills the DBS bindings", () => {
  async function prepare(input: GenInput, opts: { device?: string; media?: Record<string, MediaInfo>; installed?: DbsModel[] } = {}) {
    let asked = 0;
    const res = await prepareWorkflow("separate-soundtrack-dbs", { seed: 1, ...input }, {
      generationId: "gen1",
      op: "separate-audio",
      upload: async (_d, _t, name) => `up_${name}`,
      media: (name) => opts.media?.[name],
      device: async () => {
        asked++;
        return opts.device;
      },
      dbsModels: async () => opts.installed,
    });
    return { wf: res.workflow, asked };
  }

  it("uses DBS-BSRNN on a CPU host and DBS-TIGER on a CUDA one, unless the run picks a model", async () => {
    expect((await prepare({ audio: "film.wav" }, { device: "cpu" })).wf["2"].inputs.model).toBe("DBS-BSRNN-DnR");
    expect((await prepare({ audio: "film.wav" }, { device: "cuda" })).wf["2"].inputs.model).toBe("DBS-TIGER-DnR");
    expect((await prepare({ audio: "film.wav" })).wf["2"].inputs.model).toBe("DBS-BSRNN-DnR");
    const picked = await prepare({ audio: "film.wav", extra: { separationModel: "DBS-BSRNN-DnR" } }, { device: "cuda" });
    expect(picked.wf["2"].inputs.model).toBe("DBS-BSRNN-DnR");
    // The host isn't asked when the run says which model.
    expect(picked.asked).toBe(0);
    expect((await prepare({ audio: "film.wav", extra: { separationModel: "best" } }, { device: "cpu" })).wf["2"].inputs.model).toBe("DBS-TIGER-DnR");
  });

  it("never sends a model the host doesn't have: the other one for the host's pick, words for one asked for", async () => {
    // A GPU ComfyUI with only BSRNN on disk: the default run takes BSRNN instead of failing inside DBSLoader.
    expect((await prepare({ audio: "film.wav" }, { device: "cuda", installed: ["DBS-BSRNN-DnR"] })).wf["2"].inputs.model).toBe("DBS-BSRNN-DnR");
    expect((await prepare({ audio: "film.wav" }, { device: "cuda", installed: ["DBS-BSRNN-DnR", "DBS-TIGER-DnR"] })).wf["2"].inputs.model).toBe("DBS-TIGER-DnR");
    await expect(prepare({ audio: "film.wav", extra: { separationModel: "DBS-TIGER-DnR" } }, { device: "cuda", installed: ["DBS-BSRNN-DnR"] })).rejects.toThrow(
      /^Best \(DBS-TIGER\) isn't installed on your ComfyUI \(models\/dbs\/DBS-TIGER-DnR\)/,
    );
  });

  it("separates the mono mix unless stereo stems are asked for; a file with more than 2 channels in mono, its bed from music + effects", async () => {
    const plain = (await prepare({ audio: "film.wav" })).wf;
    expect(plain["3"].inputs.channels).toBe("mono");
    expect(plain["4"].inputs).toEqual({ audio1: ["1", 0], audio2: ["3", 2], merge_method: "subtract" });
    const stereo = (await prepare({ audio: "film.wav", extra: { channels: "each channel" } })).wf;
    expect(stereo["3"].inputs.channels).toBe("each channel");
    expect(stereo["4"].inputs.merge_method).toBe("subtract");
    // ComfyUI saves mono or stereo only: a 6-channel stem would come out as scrambled stereo three times as long.
    const surround: MediaInfo = { container: "wav", duration: 10, hasVideo: false, hasAudio: true, channels: 6 };
    const five = (await prepare({ audio: "film.wav", extra: { channels: "each channel" } }, { media: { "film.wav": surround } })).wf;
    expect(five["3"].inputs.channels).toBe("mono");
    expect(five["4"].inputs).toEqual({ audio1: ["3", 0], audio2: ["3", 1], merge_method: "add" });
    // A file the header doesn't count: the channels the browser decoded.
    const decoded = (await prepare({ video: "clip.ogg", extra: { sourceChannels: 6 } })).wf;
    expect([decoded["3"].inputs.channels, decoded["4"].inputs.merge_method]).toEqual(["mono", "add"]);
    expect((await prepare({ video: "clip.mp4", extra: { sourceChannels: 2 } })).wf["4"].inputs.merge_method).toBe("subtract");
  });

  it("reads a video's soundtrack with LoadAudio and keeps the rest of the graph as built", async () => {
    const { wf } = await prepare({ video: "clip.mp4" });
    expect(wf["1"].inputs.audio).toBe("clip.mp4");
    expect(wf["3"].inputs.output_sample_rate).toBe("input");
    expect(["5", "6", "7", "8"].map((id) => wf[id].inputs.filename_prefix)).toEqual(Array(4).fill("fuobe/gen1"));
    // Nothing of the page's own keys reaches the graph.
    expect(JSON.stringify(wf)).not.toContain("sourceChannels");
  });
});

describe("which DBS models the host has (GET /models/dbs)", () => {
  it("reads the dbs folder's list, keeps it a few seconds, and says nothing when the pack isn't loaded", async () => {
    globalThis.__fuobeComfyDbs = undefined;
    let answer: Response = Response.json(["DBS-BSRNN-DnR/config.json", "DBS-BSRNN-DnR/model.safetensors", "DBS-TIGER-DnR/model.safetensors"]);
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe("http://comfy.test:8188/models/dbs");
      return answer.clone();
    });
    vi.stubGlobal("fetch", fetch);
    try {
      expect(await comfyDbsModels()).toEqual(["DBS-BSRNN-DnR"]);
      expect(await comfyDbsModels()).toEqual(["DBS-BSRNN-DnR"]);
      expect(fetch).toHaveBeenCalledTimes(1);
      // A run asks afresh: a model installed a moment ago is there.
      answer = Response.json(["DBS-BSRNN-DnR/config.json", "DBS-BSRNN-DnR/model.safetensors", "DBS-TIGER-DnR/config.json", "DBS-TIGER-DnR/model.safetensors"]);
      expect(await comfyDbsModels("main", 0)).toEqual(["DBS-BSRNN-DnR", "DBS-TIGER-DnR"]);
      // No ComfyUI-DBS: no dbs folder (404), so the host can't say and nothing is refused for it.
      answer = new Response("Not found", { status: 404 });
      expect(await comfyDbsModels("main", 0)).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      globalThis.__fuobeComfyDbs = undefined;
    }
  });

  it("asks once while a request is on its way: callers that arrive meanwhile share its answer, the device's too", async () => {
    globalThis.__fuobeComfyDbs = undefined;
    globalThis.__fuobeComfyDevice = undefined;
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(new URL(url).pathname);
        await new Promise((r) => setTimeout(r, 50));
        return url.endsWith("/models/dbs") ? Response.json(["DBS-BSRNN-DnR/config.json", "DBS-BSRNN-DnR/model.safetensors"]) : Response.json({ devices: [{ type: "cpu" }] });
      }),
    );
    try {
      const [models, devices] = await Promise.all([Promise.all(Array.from({ length: 10 }, () => comfyDbsModels("main", 0))), Promise.all(Array.from({ length: 10 }, () => comfyDevice()))]);
      expect(models.every((m) => m?.join() === "DBS-BSRNN-DnR")).toBe(true);
      expect(devices.every((d) => d === "cpu")).toBe(true);
      expect(asked.sort()).toEqual(["/models/dbs", "/system_stats"]);
      // Once answered, a run asks afresh.
      await comfyDbsModels("main", 0);
      expect(asked.filter((a) => a === "/models/dbs")).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
      globalThis.__fuobeComfyDbs = undefined;
      globalThis.__fuobeComfyDevice = undefined;
    }
  });
});

describe("a finished DBS job's outputs", () => {
  it("are the four FLAC stems, tagged and voice first, then the pack's report as text", () => {
    const flac = (n: string) => ({ audio: [{ filename: `gen1_${n}.flac`, subfolder: "fuobe", type: "output" }] });
    const report = JSON.stringify({ model: "DBS-BSRNN-DnR", device: "cpu", audio_seconds: 20, seconds: 73.7, times_real_time: 0.27 });
    const outs = collectOutputs({ outputs: { "8": flac("8"), "6": flac("6"), "5": flac("5"), "7": flac("7"), "9": { text: [report] } } } as never, entry, "http://comfy.test:8188");
    expect(outs.map((o) => [o.kind, o.meta?.stem ?? o.meta?.role])).toEqual([
      ["audio", "voice"],
      ["audio", "music"],
      ["audio", "effects"],
      ["audio", "background"],
      ["text", "report"],
    ]);
    expect(outs[4].text).toBe(report);
  });
});

describe("licences, as information", () => {
  it("records the ComfyUI-DBS pack (MIT) and gives the workflow's model row from its licence text", () => {
    expect(nodePack("ComfyUI-DBS")).toMatchObject({
      repo: `https://github.com/hiroki-abe-58/ComfyUI-DBS/tree/${PACK}`,
      licence: {
        name: "MIT",
        class: "commercial",
        note: "Dialogue / music / effects separation; MIT code, vendored DBS code Apache-2.0 with MIT notices; the DBS weights are Apache-2.0, trained on DnR v2 (CC BY 4.0). Some FSD50K and FMA clips inside DnR v2 carry their own CC licences, NC variants included; whether that reaches the weights or their outputs is unresolved",
      },
    });
    expect(licenceInfo(workflowLicence(entry))).toMatchObject({ name: "Apache-2.0", class: "commercial" });
  });

  it("credits DnR v2 (CC BY 4.0) and the three MIT notices of the vendored code", () => {
    const dnr = ATTRIBUTIONS.find((a) => a.licence === "CC BY 4.0");
    expect(dnr?.text).toBe("Trained on the Divide and Remaster (DnR) v2 dataset by Darius Petermann, Gordon Wichern, Zhong-Qiu Wang and Jonathan Le Roux");
    // The open question about DnR's own source clips, recorded as information (research §3.2).
    expect(dnr?.note).toMatch(/^Some FSD50K and FMA clips inside DnR v2 carry their own CC licences, NC variants included\./);
    expect(entry.notes).toMatch(/NC variants included; whether that reaches the weights or their outputs is unresolved/);
    // Still information: the workflow's licence row reads Apache-2.0, nothing is flagged or hidden for it.
    expect(licenceInfo(workflowLicence(entry)).class).toBe("commercial");
    expect(ATTRIBUTIONS.filter((a) => a.licence === "MIT").map((a) => a.text)).toEqual([
      "BS-RoFormer, copyright (c) 2023 Phil Wang",
      "Music-Source-Separation-Training, copyright (c) 2024 Roman Solovyev (ZFTurbo)",
      "TIGER / Look2Hear, copyright (c) 2026 Kai Li",
    ]);
  });
});
