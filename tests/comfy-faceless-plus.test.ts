import { describe, expect, it } from "vitest";
import type { GenInput, Operation } from "@/lib/catalog/types";
import type { ComfyWorkflow, ManifestWorkflow } from "@/lib/comfy";
import type { MediaInfo } from "@/lib/media-probe";
import { expandAudioJoinWorkflow, expandVideoJoinWorkflow } from "@/lib/av/joins";
import { probeMedia } from "@/lib/media-probe";
import { tempDir } from "./helpers/temp-dir";

// The open engine's Ken Burns, loops and joins through the provider (r4/faceless-plus): canonical params →
// kenburns-still / audio-loop-crossfade / audio-join-crossfade / video-concat-encoded bindings, the crossfade
// curve the provider writes, and the joins of more clips than the templates bind.
const tmp = tempDir("fuobe-comfy-faceless-plus-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow, getWorkflow } = await import("@/server/providers/comfyui");
const { getModel } = await import("@/lib/catalog");

interface Upload {
  name: string;
  type: string;
  data: Buffer;
}

async function prepare(id: string, input: GenInput, op: Operation, media: Record<string, MediaInfo> = {}) {
  const uploads: Upload[] = [];
  const res = await prepareWorkflow(id, { seed: 7, ...input }, {
    generationId: "gen1",
    op,
    upload: async (data, type, name) => {
      uploads.push({ name, type, data });
      return `up_${name}`;
    },
    media: (name) => media[name],
    serverRam: async () => undefined,
  });
  return { ...res, uploads };
}
const at = (wf: ComfyWorkflow, m: ManifestWorkflow, key: string) => (m.bindings[key] ?? []).map((t) => wf[t.node].inputs[t.input]);
const wav = (duration: number): MediaInfo => ({ container: "wav", hasVideo: false, hasAudio: true, duration });

/** Every link in the graph points at a node that exists, and every node but the save feeds another one. */
function wellFormed(wf: ComfyWorkflow) {
  const used = new Set<string>();
  for (const [id, n] of Object.entries(wf)) {
    for (const v of Object.values(n.inputs)) {
      if (Array.isArray(v) && typeof v[0] === "string") {
        expect(wf[v[0]], `${id} → ${v[0]}`).toBeDefined();
        used.add(v[0]);
      }
    }
  }
  const orphans = Object.keys(wf).filter((id) => !used.has(id) && !/^Save/.test(wf[id].class_type));
  expect(orphans).toEqual([]);
}

describe("Ken Burns on the open engine (kenburns-still)", () => {
  it("is the open model's still-motion route", () => {
    expect(getModel("oss-ken-burns")!.routes).toEqual([expect.objectContaining({ op: "still-motion", provider: "comfyui", endpoint: "kenburns-still" })]);
  });

  it("maps the move: zoom, crop centre, easing, length, frame rate and the output size", async () => {
    const { workflow: wf, manifest: m } = await prepare(
      "kenburns-still",
      { images: ["still.png"], aspectRatio: "16:9", resolution: "720p", duration: 6, fps: 24, zoomFrom: 1, zoomTo: 1.15, panFrom: { x: 0.5, y: 0.5 }, panTo: { x: 0.435, y: 0.44 }, easing: "ease-in-out" },
      "still-motion",
    );
    const get = (k: string) => at(wf, m, k)[0];
    expect(get("image")).toBe("still.png");
    expect([get("zoomStart"), get("zoomEnd"), get("panStartX"), get("panStartY"), get("panEndX"), get("panEndY")]).toEqual([1, 1.15, 0.5, 0.5, 0.435, 0.44]);
    expect([get("easeInOut"), get("duration"), get("fps"), get("width"), get("height")]).toEqual([1, 6, 24, 1280, 720]);
    expect(get("filenamePrefix")).toBe("fuobe/gen1");
    const piece = await prepare("kenburns-still", { images: ["still.png"], aspectRatio: "9:16", resolution: "480p", duration: 7, easing: "linear" }, "still-motion");
    expect(at(piece.workflow, piece.manifest, "easeInOut")).toEqual([0]);
    expect([at(piece.workflow, piece.manifest, "width")[0], at(piece.workflow, piece.manifest, "height")[0]]).toEqual([480, 854]);
    // Without a move the graph's own preset (push in to 1.25) stays.
    const plain = await prepare("kenburns-still", { images: ["still.png"], duration: 3 }, "still-motion");
    expect(at(plain.workflow, plain.manifest, "zoomEnd")).toEqual([1.25]);
  });

  it("refuses more than 10 s in one job (scenes are split before they get here)", async () => {
    await expect(prepare("kenburns-still", { images: ["still.png"], duration: 12 }, "still-motion")).rejects.toThrow("Ken Burns on the open engine makes up to 10 s per clip — split a longer move into pieces");
  });
});

describe("the crossfade curve the provider writes", () => {
  it("uploads a stereo 16-bit 8 kHz WAV exactly the crossfade long, and binds the crossfade and the bed's length", async () => {
    const { workflow: wf, manifest: m, uploads } = await prepare("audio-loop-crossfade", { audio: "bed.flac", duration: 301, crossfade: 3 }, "audio-loop", { "bed.flac": wav(240) });
    expect(uploads.map((u) => [u.name, u.type])).toEqual([["fade_curve.wav", "audio/wav"]]);
    const curve = uploads[0].data;
    expect(probeMedia(curve)).toMatchObject({ container: "wav", duration: 3 });
    const v = new DataView(curve.buffer, curve.byteOffset, curve.byteLength);
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([2, 8000, 16, 24_000 * 4]);
    // Left fades in from 0, right fades out from full.
    expect([v.getInt16(44, true), v.getInt16(46, true)]).toEqual([0, 32767]);
    expect([v.getInt16(44 + 23_999 * 4, true), v.getInt16(46 + 23_999 * 4, true)]).toEqual([32767, 0]);
    expect(at(wf, m, "fadeCurve")).toEqual(["up_fade_curve.wav"]);
    expect([at(wf, m, "audio")[0], at(wf, m, "crossfade")[0], at(wf, m, "duration")[0], at(wf, m, "headroomDb")[0]]).toEqual(["bed.flac", 3, 301, -3]);
  });

  it("writes a linear curve on request, and keeps a curve given in params.extra", async () => {
    const lin = await prepare("audio-loop-crossfade", { audio: "bed.flac", duration: 30, crossfade: 0.5, extra: { curve: "linear" } }, "audio-loop");
    const d = lin.uploads[0].data;
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const mid = 2000;
    expect(v.getInt16(44 + mid * 4, true) + v.getInt16(46 + mid * 4, true)).toBeGreaterThanOrEqual(32766);
    expect(Object.values(lin.workflow).some((n) => "curve" in n.inputs)).toBe(false);
    const given = await prepare("audio-loop-crossfade", { audio: "bed.flac", duration: 30, extra: { fadeCurve: "mine.wav" } }, "audio-loop");
    expect(given.uploads).toEqual([]);
    expect(at(given.workflow, given.manifest, "fadeCurve")).toEqual(["mine.wav"]);
  });

  it("refuses a clip too short for the crossfade, and beds over 10 minutes", async () => {
    await expect(prepare("audio-loop-crossfade", { audio: "a.wav", duration: 30, crossfade: 2 }, "audio-loop", { "a.wav": wav(3) })).rejects.toThrow(/needs a clip longer than 4 s \(this one is 3 s\)/);
    await expect(prepare("audio-loop-crossfade", { audio: "a.wav", duration: 700, crossfade: 2 }, "audio-loop")).rejects.toThrow("Loops on the open engine run up to 10 minutes (600 s)");
  });
});

describe("joins of any number of clips in one prompt", () => {
  it("joins two audio clips with the template as it is", async () => {
    const { workflow: wf, manifest: m } = await prepare("audio-join-crossfade", { audios: ["a.wav", "b.wav"], crossfade: 1 }, "audio-join");
    expect([at(wf, m, "audio")[0], at(wf, m, "audio2")[0], at(wf, m, "crossfade")[0]]).toEqual(["a.wav", "b.wav", 1]);
    expect(Object.keys(wf)).toEqual(Object.keys(getWorkflow("audio-join-crossfade").workflow));
  });

  it("folds four clips into one graph: body, seam, middle, seam, middle, seam, rest", async () => {
    const names = ["a.wav", "b.mp3", "c.flac", "d.wav"];
    const { workflow: wf } = await prepare("audio-join-crossfade", { audios: names, crossfade: 1.5 }, "audio-join", { "a.wav": wav(10), "b.mp3": wav(8), "c.flac": wav(12), "d.wav": wav(6) });
    wellFormed(wf);
    const loaders = Object.entries(wf).filter(([, n]) => /LoadAudio/.test(n.class_type) && n.inputs.audio !== "up_fade_curve.wav");
    expect(loaders.map(([, n]) => [n.class_type, n.inputs.audio])).toEqual([
      ["VHS_LoadAudioUpload", "a.wav"],
      ["VHS_LoadAudioUpload", "b.mp3"],
      ["VHS_LoadAudioUpload", "c.flac"],
      ["LoadAudio", "d.wav"],
    ]);
    // The concat chain from the save back to the first clip's body.
    const order: string[] = [];
    const walk = (id: string) => {
      const n = wf[id];
      if (n.class_type !== "AudioConcat") return void order.push(id);
      walk((n.inputs.audio1 as [string, number])[0]);
      walk((n.inputs.audio2 as [string, number])[0]);
    };
    const save = Object.keys(wf).find((id) => wf[id].class_type === "SaveAudio")!;
    walk((wf[save].inputs.audio as [string, number])[0]);
    expect(order).toEqual(["a1_body", "s1_seam", "a2_mid", "s2_seam", "a3_mid", "s3_seam", "a4_rest"]);
    // A middle clip: from X, as long as the clip minus two crossfades (its length from the VHS loader).
    expect(wf.a2_mid.inputs.start_index).toEqual(wf.a2_head.inputs.duration);
    expect(wf[(wf.a2_mid.inputs.duration as [string])[0]].inputs).toMatchObject({ expression: "a - 2 * b", "values.a": ["a2_load", 1] });
    // A seam: the tail fading out (the curve's right channel) plus the next head fading in (left).
    expect(wf.s2_out.inputs).toMatchObject({ audio1: ["a2_tail", 0], merge_method: "multiply" });
    expect(wf.s2_in.inputs).toMatchObject({ audio1: ["a3_head", 0], merge_method: "multiply" });
    expect([(wf.s2_out.inputs.audio2 as [string, number])[1], (wf.s2_in.inputs.audio2 as [string, number])[1]]).toEqual([1, 0]);
    expect(wf.s2_seam.inputs).toMatchObject({ audio1: ["s2_out", 0], audio2: ["s2_in", 0], merge_method: "add" });
  });

  it("refuses a middle clip too short for its two crossfades", async () => {
    await expect(prepare("audio-join-crossfade", { audios: ["a.wav", "b.wav", "c.wav"], crossfade: 2 }, "audio-join", { "a.wav": wav(10), "b.wav": wav(3), "c.wav": wav(9) })).rejects.toThrow(
      /^Clip 2 is 3 s, too short for a 2 s crossfade/,
    );
  });

  it("joins encoded clips with one loader each, in order, into one ConcatenateVideo", async () => {
    expect(getModel("oss-join-encoded")!.routes[0]).toMatchObject({ op: "concat", endpoint: "video-concat-encoded" });
    const two = await prepare("video-concat-encoded", { videos: ["s1.mp4", "s2.mp4"] }, "concat");
    expect(Object.keys(two.workflow)).toEqual(["1", "2", "3", "4"]);
    expect([two.workflow["1"].inputs.file, two.workflow["2"].inputs.file]).toEqual(["s1.mp4", "s2.mp4"]);
    const names = Array.from({ length: 7 }, (_, i) => `s${i + 1}.mp4`);
    const { workflow: wf } = await prepare("video-concat-encoded", { videos: names }, "concat");
    wellFormed(wf);
    const join = Object.values(wf).find((n) => n.class_type === "ConcatenateVideo")!;
    const wired = Object.entries(join.inputs).filter(([k]) => k.startsWith("videos.")).map(([, v]) => wf[(v as [string])[0]].inputs.file);
    expect(wired).toEqual(names);
    expect(join.inputs.codec).toBe("auto");
    expect(Object.values(wf).find((n) => n.class_type === "SaveVideo")!.inputs.filename_prefix).toBe("fuobe/gen1");
    await expect(prepare("video-concat-encoded", { videos: ["s1.mp4"] }, "concat")).rejects.toThrow("Add a second clip");
  });

  it("refuses graphs that aren't joins", () => {
    expect(() => expandVideoJoinWorkflow(getWorkflow("audio-join-crossfade").workflow, ["a", "b", "c"])).toThrow(/Not a video join workflow/);
    expect(() => expandAudioJoinWorkflow(getWorkflow("video-concat-encoded").workflow, ["a", "b", "c"])).toThrow(/Not an audio join workflow/);
    expect(() => expandVideoJoinWorkflow(getWorkflow("video-concat-encoded").workflow, Array.from({ length: 101 }, (_, i) => `${i}`))).toThrow(/up to 100 clips/);
  });
});
