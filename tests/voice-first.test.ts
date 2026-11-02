import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BED_DB,
  BED_NOTES,
  planVoiceFirst,
  putsBedBack,
  VOICE_FIRST_MODELS,
  voiceFirstApplies,
  voiceFirstCost,
  voiceFirstDefault,
  voiceFirstLine,
  voiceFirstTime,
  voiceSource,
} from "@/lib/av/voice-first";
import { splitTime } from "@/lib/av/split";
import { getModel } from "@/lib/catalog";
import type { GenerationRequest } from "@/lib/catalog/types";

// "Clean the voice first" (DBS D6): the plan per engine and studio, the chain's stems, the put-back after a lip re-sync,
// the prices and times, and the server's expansion in demo mode (createGenerations, previewGeneration, Genjutsu's
// "What's said", Character Swap Studio's transcript).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-voice-first-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: the open models run on the demo provider.
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const gens = await import("@/server/generations");
const { createPipeline } = await import("@/server/chains");
const { transcribeClip } = await import("@/server/genjutsu");
const { changeAccess } = await import("@/server/model-access");
const { planTranscribe } = await import("@/lib/catalog/swap-studio-plan");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const AUDIO = "/api/files/uploads/2026-11-02/voice.wav";
const VIDEO = "/api/files/uploads/2026-11-02/clip.mp4";

const transcript = (inputs: GenerationRequest["inputs"], modelId = "oss-qwen3-asr"): GenerationRequest => ({ feature: "transcribe", modelId, op: "transcribe", inputs, params: { sourceLanguage: "en" } });
const lipsync = (inputs: GenerationRequest["inputs"], modelId = "oss-infinitetalk-v2v"): GenerationRequest => ({ feature: "lipsync", modelId, op: "lipsync", inputs, title: "Re-sync" });

describe("where it applies, and its default", () => {
  it("cleans a transcript's recording or video and a lip sync's voice; nothing else", () => {
    expect(voiceSource({ inputs: { audio: AUDIO } }, "transcribe")).toEqual({ slot: "audio", url: AUDIO });
    expect(voiceSource({ inputs: { video: VIDEO } }, "transcribe")).toEqual({ slot: "video", url: VIDEO });
    expect(voiceSource({ inputs: { video: VIDEO, audio: AUDIO } }, "lipsync")).toEqual({ slot: "audio", url: AUDIO });
    expect(voiceSource({ inputs: { images: ["/api/files/a.png"], audio: AUDIO } }, "avatar")).toEqual({ slot: "audio", url: AUDIO });
    // A lip sync's video is the picture, not the speech.
    expect(voiceSource({ inputs: { video: VIDEO } }, "lipsync")).toBeNull();
    expect(voiceFirstApplies({ inputs: { audio: AUDIO } }, "tts")).toBe(false);
    expect(voiceFirstApplies({ inputs: {} }, "transcribe")).toBe(false);
  });

  it("is on for a video and off for an audio upload", () => {
    expect(voiceFirstDefault({ inputs: { video: VIDEO } }, "transcribe")).toBe(true);
    expect(voiceFirstDefault({ inputs: { audio: AUDIO } }, "transcribe")).toBe(false);
    expect(voiceFirstDefault({ inputs: { video: VIDEO, audio: AUDIO } }, "lipsync")).toBe(true);
    expect(voiceFirstDefault({ inputs: { images: ["/api/files/a.png"], audio: AUDIO } }, "avatar")).toBe(false);
  });

  it("puts the music and effects back only after a lip re-sync on your GPU of a clip with sound", () => {
    const req = { inputs: { video: VIDEO, audio: AUDIO } };
    expect(putsBedBack(req, "lipsync", "open")).toBe(true);
    expect(putsBedBack(req, "lipsync", "open", false)).toBe(false);
    expect(putsBedBack(req, "lipsync", "cloud")).toBe(false);
    expect(putsBedBack({ inputs: { images: ["/api/files/a.png"], audio: AUDIO } }, "avatar", "open")).toBe(false);
  });
});

describe("the plan per engine", () => {
  it("Transcribe on your GPU: DBS on the video, then Qwen3-ASR on its voice stem (the video no longer goes in)", () => {
    const p = planVoiceFirst({ request: { ...transcript({ video: VIDEO }), voiceFirst: true }, op: "transcribe", engine: "open", seconds: 12.3456 });
    expect(p.result).toBe("main");
    expect(p.bed).toBe(false);
    expect(p.steps.map((s) => [s.key, s.request.modelId, s.request.op])).toEqual([
      ["voice", "oss-dbs-separate", "separate-audio"],
      ["main", "oss-qwen3-asr", "transcribe"],
    ]);
    expect(p.steps[0].request.inputs).toEqual({ video: VIDEO });
    expect(p.steps[0].request.params).toEqual({ extra: { channels: "mono" }, sourceDuration: 12.346 });
    const main = p.steps[1];
    expect(main.after).toEqual(["voice"]);
    expect(main.chain).toEqual([{ slot: "audio", stem: "voice" }]);
    expect(main.request.inputs).toEqual({});
    expect(main.request.voiceFirst).toBeUndefined();
    expect(main.request.params).toMatchObject({ sourceLanguage: "en", sourceDuration: 12.346 });
    expect(p.steps.map((s) => s.request.step)).toEqual([
      { label: "Clean voice", index: 0, of: 2 },
      { label: "Words from the clean voice", index: 1, of: 2 },
    ]);
  });

  it("Transcribe in the cloud: ElevenLabs Voice Isolation before Scribe v2, its one output taken whole", () => {
    const p = planVoiceFirst({ request: transcript({ audio: AUDIO }, "scribe-v2"), op: "transcribe", engine: "cloud" });
    expect(p.steps.map((s) => s.request.modelId)).toEqual([VOICE_FIRST_MODELS.cloud, "scribe-v2"]);
    expect(p.steps[0].request.inputs).toEqual({ audio: AUDIO });
    expect(p.steps[1].chain).toEqual([{ slot: "audio" }]);
  });

  it("Lipsync on your GPU of a clip: the voice cleaned, the clip split, and its music and effects back under the clean voice at 0 dB", () => {
    const p = planVoiceFirst({ request: lipsync({ video: VIDEO, audio: AUDIO }), op: "lipsync", engine: "open", seconds: 8, clipChannels: 6 });
    expect(p.result).toBe("film");
    expect(p.bed).toBe(true);
    expect(p.steps.map((s) => [s.key, s.request.modelId, s.request.op])).toEqual([
      ["voice", "oss-dbs-separate", "separate-audio"],
      ["main", "oss-infinitetalk-v2v", "lipsync"],
      ["bed", "oss-dbs-separate", "separate-audio"],
      ["film", "oss-mux", "mux"],
    ]);
    // The lip sync keeps its picture and takes the clean voice.
    expect(p.steps[1].request.inputs).toEqual({ video: VIDEO });
    expect(p.steps[1].chain).toEqual([{ slot: "audio", stem: "voice" }]);
    // The clip's split reads its soundtrack (a surround file is split in mono, with its channel count).
    expect(p.steps[2].request.inputs).toEqual({ video: VIDEO });
    expect(p.steps[2].request.params?.extra).toEqual({ channels: "mono", sourceChannels: 6 });
    const film = p.steps[3];
    expect(film.after).toEqual(["main", "voice", "bed"]);
    expect(film.chain).toEqual([{ slot: "video" }, { slot: "audio", stem: "voice" }, { slot: "audio2", stem: "background" }]);
    expect(film.request.params?.extra).toEqual({ backgroundVolumeDb: BED_DB });
    expect(BED_DB).toBe(0);
    expect(film.request.title).toBe("Re-sync");
    expect(p.steps.map((s) => s.request.step?.index)).toEqual([0, 1, 2, 3]);
    expect(p.steps.every((s) => s.request.step?.of === 4)).toBe(true);
  });

  it("Lipsync of a silent clip, a talking avatar, or in the cloud: no put-back", () => {
    expect(planVoiceFirst({ request: lipsync({ video: VIDEO, audio: AUDIO }), op: "lipsync", engine: "open", clipHasSound: false }).steps.map((s) => s.key)).toEqual(["voice", "main"]);
    const avatar = planVoiceFirst({ request: { feature: "lipsync", modelId: "oss-infinitetalk", op: "avatar", inputs: { images: ["/api/files/a.png"], audio: AUDIO } }, op: "avatar", engine: "open" });
    expect(avatar.steps.map((s) => s.key)).toEqual(["voice", "main"]);
    expect(avatar.steps[1].request.inputs).toEqual({ images: ["/api/files/a.png"] });
    const cloud = planVoiceFirst({ request: lipsync({ video: VIDEO, audio: AUDIO }, "sync-lipsync-3"), op: "lipsync", engine: "cloud" });
    expect(cloud.steps.map((s) => s.request.modelId)).toEqual(["elevenlabs-voice-isolation", "sync-lipsync-3"]);
    expect(cloud.steps[0].request.inputs).toEqual({ audio: AUDIO });
  });

  it("says what's missing", () => {
    expect(() => planVoiceFirst({ request: transcript({}), op: "transcribe", engine: "open" })).toThrow("Add the recording or video to transcribe");
    expect(() => planVoiceFirst({ request: lipsync({ video: VIDEO }), op: "lipsync", engine: "open" })).toThrow("Add the voice first");
  });
});

describe("what the switch says", () => {
  it("prices the cloud step at ElevenLabs' $0.10 a minute of speech; free on your GPU", () => {
    expect(getModel("elevenlabs-voice-isolation")?.pricing).toMatchObject({ unit: "minute", usd: 0.1 });
    expect(voiceFirstCost("cloud", 30, getModel)).toBeCloseTo(0.05, 6);
    expect(voiceFirstCost("cloud", 120, getModel)).toBeCloseTo(0.2, 6);
    expect(voiceFirstCost("open", 120, getModel)).toBe(0);
    expect(voiceFirstLine({ engine: "cloud", seconds: 30, getModel })).toBe("+$0.05");
    expect(voiceFirstLine({ engine: "cloud", getModel })).toBe("+$0.10 a minute");
  });

  it("times the open step as one Fast mono split (two and the mux with the put-back)", () => {
    const one = splitTime({ seconds: 60, quality: "fast", mode: "mono" });
    expect(voiceFirstTime({ seconds: 60 })).toEqual(one);
    expect(voiceFirstTime({ seconds: 60, bed: true })).toEqual({ low: one.low * 2 + 2, high: one.high * 2 + 4 });
    expect(voiceFirstTime({ seconds: 60, device: "cuda" })).toEqual(splitTime({ seconds: 60, quality: "best", mode: "mono", device: "cuda" }));
    expect(voiceFirstLine({ engine: "open", seconds: 60, getModel })).toMatch(/^Free · adds about \d+(–\d+)? min$/);
    expect(voiceFirstLine({ engine: "open", seconds: 5, device: "cuda", getModel })).toBe("Free · adds under a minute");
    expect(voiceFirstLine({ engine: "open", getModel })).toBe("Free · adds a little time");
  });

  it("says plainly what each engine does with a clip's music and effects", () => {
    expect(BED_NOTES.open).toMatch(/go back under the new lip movement/);
    expect(BED_NOTES.cloud).toMatch(/your GPU \(open source\)/);
  });
});

// ---------------------------------------------------------------------------
// The server, in demo mode

/** A small MP4: a video track and, unless `sound` is false, a stereo AAC track (2 s each). */
function mp4(sound = true): Buffer {
  const u32 = (...v: number[]) => Buffer.concat(v.map((n) => Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])));
  const box = (type: string, ...parts: Buffer[]) => {
    const body = Buffer.concat(parts);
    return Buffer.concat([u32(8 + body.length), Buffer.from(type), body]);
  };
  const trak = (handler: string, ...stbl: Buffer[]) =>
    box("trak", box("mdia", box("mdhd", u32(0, 0, 0, 1000, 2000), Buffer.alloc(4)), box("hdlr", u32(0, 0), Buffer.from(handler), Buffer.alloc(12)), box("minf", box("stbl", ...stbl))));
  const entry = Buffer.alloc(28);
  entry.writeUInt16BE(1, 6);
  entry.writeUInt16BE(2, 16);
  entry.writeUInt16BE(16, 18);
  return Buffer.concat([
    box("ftyp", Buffer.from("isom"), u32(0)),
    box("moov", box("mvhd", u32(0, 0, 0, 1000, 2000), Buffer.alloc(80)), trak("vide", box("stts", u32(0, 1, 50, 40))), ...(sound ? [trak("soun", box("stsd", u32(0, 1), box("mp4a", entry)))] : [])),
  ]);
}
const clip = (sound = true) => saveFile({ data: mp4(sound), contentType: "video/mp4", name: sound ? "clip.mp4" : "silent.mp4", source: "upload" }).url;

/** A 1 s mono 16 kHz WAV. */
function wav(): Buffer {
  const frames = 16000;
  const b = Buffer.alloc(44 + frames * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + frames * 2, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(frames * 2, 40);
  return b;
}
const voice = () => saveFile({ data: wav(), contentType: "audio/wav", name: "voice.wav", source: "upload" }).url;

async function finished(id: string, ms = 15_000) {
  const deadline = Date.now() + ms;
  let g = gens.getGeneration(id)!;
  while (g.status !== "succeeded" && g.status !== "failed" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    g = gens.getGeneration(id)!;
  }
  return g;
}

describe("createGenerations with voiceFirst (demo mode)", () => {
  it("transcribes a video's clean voice on your GPU: the transcript first, both in one batch", async () => {
    const video = clip();
    const made = gens.createGenerations({ ...transcript({ video }), voiceFirst: true });
    expect(made.map((g) => [g.modelId, g.op])).toEqual([
      ["oss-qwen3-asr", "transcribe"],
      ["oss-dbs-separate", "separate-audio"],
    ]);
    expect(new Set(made.map((g) => g.batchId)).size).toBe(1);
    // The transcript keeps the request as asked: Reuse runs it again with the switch on.
    expect(made[0].request.asked).toMatchObject({ voiceFirst: true, inputs: { video } });
    expect(made[0].request.chain).toEqual([{ slot: "audio", stem: "voice" }]);
    const split = await finished(made[1].id);
    expect(split.status).toBe("succeeded");
    const words = await finished(made[0].id);
    expect(words.status).toBe("succeeded");
    // It ran on the voice stem, not the video.
    const voiceStem = split.outputs.find((o) => o.meta?.stem === "voice")!;
    const ran = gens.getGeneration(made[0].id)!.request;
    expect(ran.inputs?.audio).toBe(voiceStem.url);
    expect(ran.inputs?.video).toBeUndefined();
  }, 30_000);

  it("re-syncs a clip on your GPU with its music and effects put back: the mux first, four steps", async () => {
    const video = clip();
    const audio = voice();
    const made = gens.createGenerations({ ...lipsync({ video, audio }), voiceFirst: true });
    expect(made.map((g) => [g.modelId, g.op])).toEqual([
      ["oss-mux", "mux"],
      ["oss-dbs-separate", "separate-audio"],
      ["oss-dbs-separate", "separate-audio"],
      ["oss-infinitetalk-v2v", "lipsync"],
    ]);
    expect(made[0].request.chain).toEqual([{ slot: "video" }, { slot: "audio", stem: "voice" }, { slot: "audio2", stem: "background" }]);
    expect(made[0].request.params?.extra).toEqual({ backgroundVolumeDb: 0 });
    // The voice is split from the voice upload, the bed from the clip.
    expect(made.filter((g) => g.op === "separate-audio").map((g) => g.request.inputs)).toEqual([{ audio }, { video }]);
    // The demo's placeholder mux takes a while after the three steps it waits for.
    const film = await finished(made[0].id, 50_000);
    expect(film.status).toBe("succeeded");
    expect(film.outputs[0].kind).toBe("video");
  }, 60_000);

  it("leaves the put-back out for a clip with no sound", () => {
    const made = gens.createGenerations({ ...lipsync({ video: clip(false), audio: voice() }), voiceFirst: true });
    expect(made.map((g) => g.modelId)).toEqual(["oss-infinitetalk-v2v", "oss-dbs-separate"]);
  });

  it("cleans with ElevenLabs before a cloud model, without the put-back", () => {
    const made = gens.createGenerations({ ...lipsync({ video: clip(), audio: voice() }, "sync-lipsync-3"), voiceFirst: true });
    expect(made.map((g) => g.modelId)).toEqual(["sync-lipsync-3", "elevenlabs-voice-isolation"]);
    expect(made[0].request.chain).toEqual([{ slot: "audio" }]);
  });

  it("runs as asked without the switch, or where it doesn't apply", () => {
    expect(gens.createGenerations(transcript({ video: clip() })).map((g) => g.modelId)).toEqual(["oss-qwen3-asr"]);
    expect(gens.createGenerations({ feature: "image", modelId: "oss-qwen-image-21", op: "t2i", prompt: "A koi pond at night", voiceFirst: true }).map((g) => g.modelId)).toEqual(["oss-qwen-image-21"]);
  });

  it("works as a pipeline step: the step's result is the transcript", () => {
    const { byKey, items } = createPipeline([{ key: "words", request: { ...transcript({ video: clip() }), voiceFirst: true } }]);
    expect(byKey.words.modelId).toBe("oss-qwen3-asr");
    expect(items.map((g) => g.modelId)).toEqual(["oss-qwen3-asr", "oss-dbs-separate"]);
  });

  it("names the switch when its step can't run (its model switched off)", () => {
    changeAccess([{ kind: "model", id: "oss-dbs-separate", on: false }]);
    try {
      expect(() => gens.createGenerations({ ...transcript({ video: clip() }), voiceFirst: true })).toThrow(/^Clean the voice first can't run \(DBS \(dialogue, music, effects\)\): .*Turn it off to run without it$/s);
      expect(() => gens.previewGeneration({ ...transcript({ video: clip() }), voiceFirst: true })).toThrow(/^Clean the voice first can't run: /);
    } finally {
      changeAccess([{ kind: "reset" }]);
    }
  });
});

describe("previewGeneration with voiceFirst", () => {
  it("adds ElevenLabs' price in the cloud and nothing on your GPU", () => {
    const audio = voice();
    const plain = gens.previewGeneration(transcript({ audio }, "scribe-v2"));
    const clean = gens.previewGeneration({ ...transcript({ audio }, "scribe-v2"), voiceFirst: true });
    // Demo mode prices the run as it would be paid (the demo is free, the price says what it would cost).
    if (plain.costUsd !== null && clean.costUsd !== null) expect(clean.costUsd).toBeGreaterThanOrEqual(plain.costUsd);
    const open = gens.previewGeneration({ ...transcript({ audio }), voiceFirst: true });
    expect(open.model.id).toBe("oss-qwen3-asr");
    expect(open.costUsd).toBe(0);
  });

  it("says what a lip re-sync does with the clip's music and effects on each engine", () => {
    const req = (modelId: string) => ({ ...lipsync({ video: clip(), audio: voice() }, modelId), voiceFirst: true });
    expect(gens.previewGeneration(req("oss-infinitetalk-v2v")).notes).toContain(BED_NOTES.open);
    expect(gens.previewGeneration(req("sync-lipsync-3")).notes).toContain(BED_NOTES.cloud);
  });
});

describe("the studios that transcribe a clip", () => {
  it("Genjutsu's “What's said” cleans the voice when asked, and returns the transcript's id", () => {
    const video = clip();
    const on = transcribeClip({ engine: "open", source: { url: video, duration: 2 }, voiceFirst: true });
    const g = gens.getGeneration(on.id)!;
    expect(g.op).toBe("transcribe");
    expect(g.request.chain).toEqual([{ slot: "audio", stem: "voice" }]);
    const off = transcribeClip({ engine: "open", source: { url: video, duration: 2 } });
    expect(gens.getGeneration(off.id)!.request.chain).toBeUndefined();
  });

  it("Character Swap Studio's transcript carries the switch on its step", () => {
    const c = { name: "Take 1", source: { url: VIDEO, duration: 4, hasAudio: true }, normalized: { url: VIDEO } } as unknown as Parameters<typeof planTranscribe>[0];
    expect(planTranscribe(c, "open")[0].request.voiceFirst).toBeUndefined();
    expect(planTranscribe(c, "open", true)[0].request.voiceFirst).toBe(true);
    expect(planTranscribe(c, "cloud", true)[0].request).toMatchObject({ modelId: "scribe-v2", voiceFirst: true });
  });
});
