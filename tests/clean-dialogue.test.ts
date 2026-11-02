import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bedOf,
  CLEAN_DIALOGUE_FEATURE,
  CLEAN_DIALOGUE_PRESET,
  cleanDialogueHref,
  cleanDialogueProblem,
  CLEANERS,
  mixPresetFor,
  CLOUD_NOTE,
  deepFilterNetPrice,
  OFF_DB,
  OPEN_NOTE,
  planCleanDialogue,
  VEED_MAX_SECONDS,
  veedPrice,
} from "@/lib/av/clean-dialogue";
import { buildPayload, extractOutputs } from "@/lib/catalog/payload";
import { estimateCost } from "@/lib/catalog/plan";
import { getModel } from "@/lib/catalog";
import { defaultModelForNode, modelChoices } from "@/lib/catalog/canvas";
import type { Generation, GenInput } from "@/lib/catalog/types";

// Clean up dialogue (DBS D5): the plan per engine and cleaner, the cloud cleaners' prices and payloads against their
// research records, graph C (soundtrack-remix-dbs) in the manifest and its bindings, the hand-offs, and the API in demo
// mode.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-clean-dialogue-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const gens = await import("@/server/generations");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const route = await import("@/app/api/audio-tools/route");
const { outputActions } = await import("@/lib/output-actions");
const { STUDIO_ROWS, studioTool } = await import("@/server/gpu/tools");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const ROOT = path.join(__dirname, "..");
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const research = json("docs/research/paid-model-apis-3.json").endpoints as { endpoint: string; inputs: Record<string, unknown>; license?: string; pricing?: { usd: number; unit: string } }[];
const record = (ep: string) => research.find((e) => e.endpoint === ep)!;
const AUDIO = "/api/files/uploads/2026-11-02/podcast.wav";
const VIDEO = "/api/files/uploads/2026-11-02/vlog.mp4";

describe("the plan on the open engine", () => {
  it("one DBS remix: the dialogue at 0 dB and the music and effects at −18 dB by default", () => {
    const p = planCleanDialogue({ engine: "open", media: AUDIO, kind: "audio", name: "Podcast", channels: 2, seconds: 20 });
    expect(p.steps).toHaveLength(1);
    const r = p.steps[0].request;
    expect(r).toMatchObject({ modelId: "oss-dbs-remix", op: "separate-audio", feature: CLEAN_DIALOGUE_FEATURE, inputs: { audio: AUDIO }, title: "Clean dialogue · Podcast" });
    expect(r.params).toEqual({ extra: { channels: "mono", voiceDb: 0, musicDb: -18, effectsDb: -18, sourceChannels: 2 }, sourceDuration: 20 });
    expect(p).toMatchObject({ bed: -18, cleaner: null, mode: "mono", remux: false, length: 20 });
    expect(p.notes).toContain(OPEN_NOTE);
    expect(p.notes).toContain("The result is mono. Turn on Stereo to keep it stereo.");
  });

  it("Dialogue only sends the music and effects to −100 dB; stereo and the model travel as asked", () => {
    const p = planCleanDialogue({ engine: "open", media: AUDIO, kind: "audio", bed: "off", stereo: true, quality: "best", channels: 2 });
    expect(p.steps[0].request.params?.extra).toMatchObject({ channels: "each channel", voiceDb: 0, musicDb: OFF_DB, effectsDb: OFF_DB, separationModel: "DBS-TIGER-DnR" });
    expect(p.summary).toContain("out, every channel on its own (2 passes)");
    // A surround file is cleaned in mono.
    const s = planCleanDialogue({ engine: "open", media: AUDIO, kind: "audio", stereo: true, channels: 6 });
    expect(s.mode).toBe("mono");
    expect(s.notes.some((n) => n.includes("6 channels"))).toBe(true);
  });

  it("a video gets its clean soundtrack back with the stream-copy mux", () => {
    const p = planCleanDialogue({ engine: "open", media: VIDEO, kind: "video", bed: -12 });
    expect(p.steps.map((s) => [s.key, s.request.modelId, s.request.op])).toEqual([
      ["clean", "oss-dbs-remix", "separate-audio"],
      ["video", "oss-mux", "mux"],
    ]);
    expect(p.steps[0].request.inputs).toEqual({ video: VIDEO });
    expect(p.steps[1]).toMatchObject({ after: ["clean"], chain: [{ slot: "audio" }], request: { inputs: { video: VIDEO } } });
    expect(p.steps[0].request.params?.extra).toMatchObject({ musicDb: -12, effectsDb: -12 });
    expect(planCleanDialogue({ engine: "open", media: VIDEO, kind: "video", remux: false }).steps).toHaveLength(1);
  });

  it("reads a bed level in whole dB from −40 to 0, or off", () => {
    expect([bedOf("off"), bedOf(-18), bedOf("-24"), bedOf(-60), bedOf(3), bedOf(-17.6), bedOf(undefined)]).toEqual(["off", -18, -24, -40, 0, -18, -18]);
  });
});

describe("the plan in the cloud", () => {
  it("one call for audio on each cleaner, named as itself", () => {
    for (const c of CLEANERS) {
      const p = planCleanDialogue({ engine: "cloud", media: AUDIO, kind: "audio", cleaner: c.id, seconds: 90 });
      expect(p.steps.map((s) => [s.request.modelId, s.request.op]), c.id).toEqual([[c.model, c.op]]);
      expect(p.steps[0].request.inputs).toEqual({ audio: AUDIO });
      expect(p.steps[0].request.params?.sourceDuration).toBe(90);
      expect(p.notes).toContain(CLOUD_NOTE);
      expect(p.bed).toBeNull();
    }
    expect(CLEANERS.map((c) => c.label)).toEqual(["Clean (VEED)", "Denoise (DeepFilterNet 3)", "Voice only (ElevenLabs)"]);
  });

  it("VEED and ElevenLabs read a video themselves; DeepFilterNet gets its extracted soundtrack; the voice goes back on the video", () => {
    const veed = planCleanDialogue({ engine: "cloud", media: VIDEO, kind: "video", cleaner: "veed", strength: 0.6 });
    expect(veed.steps.map((s) => s.request.modelId)).toEqual(["veed-clean-audio", "merge-audio-video"]);
    expect(veed.steps[0].request).toMatchObject({ inputs: { video: VIDEO }, params: { extra: { strength: 0.6 } } });
    expect(veed.steps[1]).toMatchObject({ after: ["clean"], chain: [{ slot: "audio" }], request: { op: "mux", inputs: { video: VIDEO } } });
    const dfn = planCleanDialogue({ engine: "cloud", media: VIDEO, kind: "video", cleaner: "deepfilternet" });
    expect(dfn.steps.map((s) => [s.key, s.request.modelId])).toEqual([
      ["sound", "extract-soundtrack"],
      ["clean", "deepfilternet3"],
      ["video", "merge-audio-video"],
    ]);
    expect(dfn.steps[1]).toMatchObject({ after: ["sound"], chain: [{ slot: "audio" }] });
    expect(planCleanDialogue({ engine: "cloud", media: VIDEO, kind: "video", cleaner: "isolation" }).steps.map((s) => s.request.modelId)).toEqual(["elevenlabs-voice-isolation", "merge-audio-video"]);
    // Strength is VEED's alone.
    expect(planCleanDialogue({ engine: "cloud", media: AUDIO, kind: "audio", cleaner: "deepfilternet", strength: 0.5 }).steps[0].request.params?.extra).toBeUndefined();
  });

  it("says what's in the way: no file, no sound, over VEED's 30 minutes", () => {
    expect(cleanDialogueProblem({ engine: "open", media: "", kind: "video" })).toBe("Add the video to clean");
    expect(cleanDialogueProblem({ engine: "cloud", media: AUDIO, kind: "audio", silent: true })).toBe("This file has no sound to clean");
    expect(cleanDialogueProblem({ engine: "cloud", media: AUDIO, kind: "audio", seconds: VEED_MAX_SECONDS + 1 })).toContain("30 minutes");
    expect(cleanDialogueProblem({ engine: "cloud", media: AUDIO, kind: "audio", cleaner: "isolation", seconds: VEED_MAX_SECONDS + 1 })).toBeNull();
    expect(() => planCleanDialogue({ engine: "open", media: AUDIO, kind: "audio", silent: true })).toThrow("no sound");
  });
});

describe("the cloud cleaners' prices", () => {
  const veed = getModel("veed-clean-audio")!;
  const dfn = getModel("deepfilternet3")!;
  const iso = getModel("elevenlabs-voice-isolation")!;

  it("VEED bills whole minutes of input, rounded up from whole seconds, at least one ($0.0125 a minute)", () => {
    const at = (s: number) => estimateCost(veed, { sourceDuration: s }, 1, "enhance-voice");
    expect([at(10), at(60), at(60.4), at(61), at(300.011), at(301), at(600), at(1800)]).toEqual([0.0125, 0.0125, 0.0125, 0.025, 0.063, 0.075, 0.125, 0.375].map((v) => Math.round(v * 1000) / 1000));
    expect(veedPrice(300.011)).toBeCloseTo(0.0625);
    expect(veedPrice(0)).toBe(0.0125);
    expect(record("veed/clean-audio").pricing).toMatchObject({ usd: 0.0125, unit: "minute" });
  });

  it("DeepFilterNet 3 bills $0.001 a second of audio; ElevenLabs isolation $0.10 a minute of the clip", () => {
    expect(estimateCost(dfn, { sourceDuration: 90 }, 1, "enhance-voice")).toBe(0.09);
    expect(deepFilterNetPrice(90)).toBeCloseTo(0.09);
    expect(estimateCost(iso, { sourceDuration: 90 }, 1, "separate-audio")).toBe(0.15);
    // A length the caller sets still wins.
    expect(estimateCost(iso, { sourceDuration: 90, duration: 30 }, 1, "separate-audio")).toBe(0.05);
    expect(record("fal-ai/deepfilternet3").pricing).toMatchObject({ usd: 0.001, unit: "second" });
  });

  it("records DeepFilterNet 3's licence as information", () => {
    expect(dfn.licence).toMatchObject({ licence: "MIT OR Apache-2.0", commercial: true });
    expect(record("fal-ai/deepfilternet3").license).toContain("MIT OR Apache-2.0");
  });
});

describe("the cloud payloads against the research schemas", () => {
  const fields = (ep: string) => Object.keys(record(ep).inputs);
  const mapOf = (id: string) => getModel(id)!.routes[0].map!;

  it("VEED: the file (audio or a video) as audio_url, FLAC out, the strength slider", () => {
    const a = buildPayload(mapOf("veed-clean-audio"), { seed: 1, audio: "https://x/a.wav", extra: { strength: 0.6 } } as GenInput);
    const v = buildPayload(mapOf("veed-clean-audio"), { seed: 1, video: "https://x/v.mp4" } as GenInput);
    expect(a).toMatchObject({ audio_url: "https://x/a.wav", output_format: "flac", strength: 0.6 });
    expect(v).toMatchObject({ audio_url: "https://x/v.mp4", output_format: "flac" });
    for (const k of [...Object.keys(a), ...Object.keys(v)]) expect(fields("veed/clean-audio"), k).toContain(k);
  });

  it("DeepFilterNet 3: audio_url and FLAC out", () => {
    const p = buildPayload(mapOf("deepfilternet3"), { seed: 1, audio: "https://x/a.wav" } as GenInput);
    expect(p).toEqual({ audio_url: "https://x/a.wav", audio_format: "flac" });
    for (const k of Object.keys(p)) expect(fields("fal-ai/deepfilternet3"), k).toContain(k);
  });

  it("reads each answer's audio file", () => {
    expect(extractOutputs({ audio: { url: "https://f/v.flac", content_type: "audio/flac" }, audio_duration: 12 }, "enhance-voice")[0]).toMatchObject({ url: "https://f/v.flac", kind: "audio" });
    expect(extractOutputs({ audio_file: { url: "https://f/d.flac", content_type: "audio/flac" }, timings: { inference: 1 } }, "enhance-voice")[0]).toMatchObject({ url: "https://f/d.flac", kind: "audio" });
  });
});

describe("graph C (soundtrack-remix-dbs)", () => {
  const manifest = json("workflows/comfyui/manifest.json");
  const entry = manifest.workflows.find((w: { id: string }) => w.id === "soundtrack-remix-dbs");
  const graph = json("workflows/comfyui/soundtrack-remix-dbs.json") as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

  it("is in the manifest with its levels as bindings, one audio output, the DBS pack and weights, validated", () => {
    expect(entry).toMatchObject({ capability: "separate-audio", validated: true, vramGb: 0 });
    expect(Object.keys(entry.bindings)).toEqual(expect.arrayContaining(["audio", "separationModel", "channels", "voiceDb", "musicDb", "effectsDb"]));
    expect(entry.outputs.filter((o: { kind: string }) => o.kind === "audio")).toHaveLength(1);
    expect(entry.models.map((m: { file?: string; name?: string }) => m.file ?? m.name)).toEqual(expect.arrayContaining(["DBS-BSRNN-DnR/model.safetensors", "DBS-TIGER-DnR/model.safetensors"]));
    const req = json("workflows/comfyui/requirements.json");
    expect(req.workflows["soundtrack-remix-dbs"].packs["ComfyUI-DBS"]).toEqual(["DBSLoader", "DBSSeparate"]);
  });

  it("turns each DBS stem by its level and adds them up into one FLAC", () => {
    expect([graph["4"].inputs.audio, graph["5"].inputs.audio, graph["6"].inputs.audio]).toEqual([["3", 2], ["3", 0], ["3", 1]]);
    for (const k of ["4", "5", "6"]) expect(graph[k].class_type).toBe("AudioAdjustVolume");
    expect(graph["7"].inputs).toMatchObject({ audio1: ["4", 0], audio2: ["5", 0], merge_method: "add" });
    expect(graph["8"].inputs).toMatchObject({ audio1: ["7", 0], audio2: ["6", 0], merge_method: "add" });
    expect(graph["9"]).toMatchObject({ class_type: "SaveAudioAdvanced", inputs: { audio: ["8", 0], format: "flac" } });
  });

  it("the provider fills the levels, the model and the channels from the plan", async () => {
    const p = planCleanDialogue({ engine: "open", media: VIDEO, kind: "video", bed: -24, stereo: true, channels: 2 });
    const { workflow } = await prepareWorkflow("soundtrack-remix-dbs", { seed: 1, video: "vlog.mp4", extra: p.steps[0].request.params?.extra as Record<string, unknown> }, {
      generationId: "g1",
      op: "separate-audio",
      upload: async (_d, _t, name) => `up_${name}`,
      media: () => undefined,
      device: async () => "cpu",
      dbsModels: async () => undefined,
    });
    expect(workflow["1"].inputs.audio).toBe("vlog.mp4");
    expect([workflow["2"].inputs.model, workflow["3"].inputs.channels]).toEqual(["DBS-BSRNN-DnR", "each channel"]);
    expect([workflow["4"].inputs.volume, workflow["5"].inputs.volume, workflow["6"].inputs.volume]).toEqual([0, -24, -24]);
  });

  it("runs on oss-dbs-remix, an open model", () => {
    expect(getModel("oss-dbs-remix")).toMatchObject({ engine: "open", routes: [expect.objectContaining({ op: "separate-audio", provider: "comfyui", endpoint: "soundtrack-remix-dbs" })] });
  });
});

describe("hand-offs and the GPU pre-flight board", () => {
  const gen = (kind: "audio" | "video", op: Generation["op"], feature = "x"): Generation =>
    ({ id: "g", status: "succeeded", op, feature, modelId: "m", engine: "open", outputs: [{ url: "/api/files/a/b." + (kind === "audio" ? "wav" : "mp4"), kind }], request: {} }) as unknown as Generation;

  it("audio and video results open Split soundtrack on Clean up dialogue", () => {
    expect(cleanDialogueHref("audio", "/api/files/a/b.wav")).toBe(`/audio/split?audio=%2Fapi%2Ffiles%2Fa%2Fb.wav&preset=${CLEAN_DIALOGUE_PRESET}`);
    const a = outputActions(gen("audio", "tts"), 0).find((x) => x.id === "clean-dialogue");
    expect(a).toMatchObject({ label: "Clean up dialogue", href: cleanDialogueHref("audio", "/api/files/a/b.wav") });
    expect(outputActions(gen("video", "mux"), 0).find((x) => x.id === "clean-dialogue")?.href).toBe(cleanDialogueHref("video", "/api/files/a/b.mp4"));
    // Not on music or effects, nor on a result it made.
    for (const g of [gen("audio", "music"), gen("audio", "sfx"), gen("audio", "separate-audio", CLEAN_DIALOGUE_FEATURE)]) expect(outputActions(g, 0).some((x) => x.id === "clean-dialogue")).toBe(false);
  });

  it("opens the mixer on Clean dialogue only from that task, and on the original mix for a plain split", () => {
    expect(mixPresetFor("clean")).toBe(CLEAN_DIALOGUE_PRESET);
    // "Fine-tune in the mixer" switches to Split into stems and keeps the preset.
    expect(mixPresetFor("split", true)).toBe(CLEAN_DIALOGUE_PRESET);
    // Picking Split into stems after visiting Clean up dialogue clears it.
    expect(mixPresetFor("split")).toBeNull();
  });

  it("leaves the Canvas Clean up voice node on your GPU: the hosted cleaners aren't in its picker", () => {
    const node = { type: "clean-voice" as const, data: {} };
    expect(defaultModelForNode(node, "cloud")).toBeUndefined();
    expect(modelChoices(node).map((m) => m.id)).toEqual(["oss-reuse-voice"]);
  });

  it("has a row on the board: graph C and the mux", () => {
    const row = STUDIO_ROWS.find((r) => r.href === `/audio/split?preset=${CLEAN_DIALOGUE_PRESET}`)!;
    expect(row).toMatchObject({ label: "Clean up dialogue", group: "Audio" });
    expect(studioTool(row)!.workflows).toEqual(expect.arrayContaining(["soundtrack-remix-dbs", "video-mux-audio"]));
  });
});

describe("POST /api/audio-tools clean-dialogue (demo mode)", () => {
  const wav = () => {
    const n = 44100 * 2;
    const b = Buffer.alloc(44 + n * 4);
    b.write("RIFF", 0);
    b.writeUInt32LE(36 + n * 4, 4);
    b.write("WAVEfmt ", 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(2, 22);
    b.writeUInt32LE(44100, 24);
    b.writeUInt32LE(44100 * 4, 28);
    b.writeUInt16LE(4, 32);
    b.writeUInt16LE(16, 34);
    b.write("data", 36);
    b.writeUInt32LE(n * 4, 40);
    return saveFile({ data: b, contentType: "audio/wav", name: "take.wav", source: "upload" }).url;
  };
  const post = (body: unknown, preview = false) =>
    route.POST(new Request(`http://x/api/audio-tools${preview ? "?preview=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

  it("prices the open remix as free with a time estimate, and runs it into the Library as one track", async () => {
    const media = wav();
    const p = await (await post({ tool: "clean-dialogue", engine: "open", media, kind: "audio", name: "Take" }, true)).json();
    expect(p).toMatchObject({ steps: 1, costUsd: 0, demo: true, length: 2, channels: 2, hostPick: "fast" });
    expect(p.estimate).toBeDefined();
    const res = await post({ tool: "clean-dialogue", engine: "open", media, kind: "audio", name: "Take", bed: "off" });
    expect(res.status).toBe(201);
    const run = await res.json();
    expect(run.result).toMatchObject({ modelId: "oss-dbs-remix", feature: CLEAN_DIALOGUE_FEATURE });
    const deadline = Date.now() + 15_000;
    let g = gens.getGeneration(run.result.id)!;
    while (g.status !== "succeeded" && g.status !== "failed" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      g = gens.getGeneration(run.result.id)!;
    }
    expect(g.status).toBe("succeeded");
    expect(g.outputs.filter((o) => o.kind === "audio")).toHaveLength(1);
  }, 30_000);

  it("prices each cloud cleaner on the file's length", async () => {
    const media = wav();
    const priced = async (cleaner: string) => (await (await post({ tool: "clean-dialogue", engine: "cloud", media, kind: "audio", cleaner }, true)).json()) as { costUsd: number | null; demo: boolean; steps: number };
    // With a fal.ai key the price check takes the real route (a check never calls fal): the 2 s file at each cleaner's
    // price. VEED bills at least a minute ($0.0125), DeepFilterNet 3 $0.001/s, ElevenLabs $0.10/min of the clip.
    setSetting("falKey", "fal-test-key");
    try {
      const veed = await priced("veed");
      const dfn = await priced("deepfilternet");
      const iso = await priced("isolation");
      expect([veed.steps, dfn.steps, iso.steps]).toEqual([1, 1, 1]);
      expect([veed.demo, dfn.demo, iso.demo]).toEqual([false, false, false]);
      expect([veed.costUsd, dfn.costUsd, iso.costUsd]).toEqual([0.013, 0.002, 0.003]);
    } finally {
      setSetting("falKey", "");
    }
  });

  it("an install set to paid APIs only keeps the cloud cleaners and refuses the open remix", async () => {
    const media = wav();
    setSetting("engineMode", "cloud");
    try {
      expect((await post({ tool: "clean-dialogue", engine: "cloud", media, kind: "audio" }, true)).status).toBe(200);
      const open = await post({ tool: "clean-dialogue", engine: "open", media, kind: "audio" }, true);
      expect(open.status).toBe(422);
      expect((await open.json()).error).toContain("paid cloud APIs only");
    } finally {
      setSetting("engineMode", "both");
    }
  });
});
