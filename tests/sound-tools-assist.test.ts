import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOUD_SPLIT_PROBLEM } from "@/lib/av/split";
import { OFF_DB, planRemix, REMIX_FEATURE, remixWords } from "@/lib/av/clean-dialogue";
import type { GenInput } from "@/lib/catalog/types";

// Assist and MCP's split_soundtrack and remove_dialogue (DBS D9), and the remix at set levels they run on graph C
// (oss-dbs-remix, the model Clean up dialogue runs on).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-sound-assist-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { getTool, executeTool } = await import("@/server/assist/tools");
const { soundPlan, offlinePlan } = await import("@/server/assist/agent");
const { handleMcp } = await import("@/server/mcp");
const { getGeneration } = await import("@/server/generations");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

/** A 16-bit PCM WAV of `seconds` of silence. */
function wav(seconds: number, channels = 2, rate = 8000): Buffer {
  const frames = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + frames * channels * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + frames * channels * 2, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(frames * channels * 2, 40);
  return b;
}

const audioFile = () => saveFile({ data: wav(3), contentType: "audio/wav", source: "upload", name: "podcast.wav" }).url;
const videoFile = () => saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "interview.mp4" }).url;

describe("planRemix (graph C, oss-dbs-remix)", () => {
  it("keeps the named stems at their levels and leaves the others out", () => {
    const p = planRemix({ engine: "open", media: "/api/files/a.wav", kind: "audio", keep: ["voice", "music"], levels: { music: -12.4 } });
    expect(p.levels).toEqual({ voice: 0, music: -12, effects: OFF_DB });
    const r = p.steps[0].request;
    expect(r).toMatchObject({ modelId: "oss-dbs-remix", op: "separate-audio", feature: REMIX_FEATURE, inputs: { audio: "/api/files/a.wav" } });
    expect(r.params?.extra).toEqual({ channels: "mono", voiceDb: 0, musicDb: -12, effectsDb: OFF_DB });
    expect(remixWords(p.levels)).toBe("Dialogue, Music −12 dB");
    expect(p.summary).toMatch(/one file: Dialogue, Music −12 dB/);
  });

  it("clamps levels, keeps all three by default, and refuses the cloud", () => {
    expect(planRemix({ engine: "open", media: "/api/files/a.mp4", kind: "video", levels: { voice: 40, effects: -99 } }).levels).toEqual({ voice: 12, music: 0, effects: -60 });
    expect(() => planRemix({ engine: "cloud", media: "/api/files/a.wav", kind: "audio" })).toThrow(CLOUD_SPLIT_PROBLEM);
    expect(() => planRemix({ engine: "open", media: "/api/files/a.wav", kind: "audio", keep: [] as never })).not.toThrow();
  });

  it("binds each stem's level to graph C's AudioAdjustVolume nodes", async () => {
    const p = planRemix({ engine: "open", media: "/api/files/a.wav", kind: "audio", keep: ["music", "effects"], levels: { music: -6 } });
    const input: GenInput = { seed: 1, audio: "song.wav", extra: p.steps[0].request.params?.extra as Record<string, unknown> };
    const { manifest, workflow } = await prepareWorkflow("soundtrack-remix-dbs", input, {
      generationId: "g1",
      op: "separate-audio",
      upload: async (_d: unknown, _t: unknown, name: string) => `up_${name}`,
      media: () => undefined,
      device: async () => "cpu",
      dbsModels: async () => undefined,
    });
    expect(manifest.id).toBe("soundtrack-remix-dbs");
    expect([workflow["4"].inputs.volume, workflow["5"].inputs.volume, workflow["6"].inputs.volume]).toEqual([OFF_DB, -6, 0]);
    expect(workflow["1"].inputs.audio).toBe("song.wav");
  });
});

describe("Assist: split_soundtrack and remove_dialogue", () => {
  const ctx = { engine: "open" as const };
  it("prices a split first (free in demo mode, on graph A) and refuses the cloud engine in words", () => {
    const media = audioFile();
    const split = getTool("split_soundtrack")!;
    const jobs = split.plan!({ media }, ctx);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ tool: "split_soundtrack", modelId: "oss-dbs-separate", costUsd: 0, demo: true, atomic: true });
    expect(jobs[0].note).toMatch(/Splits it into dialogue, music, effects and music & effects/);
    const cloud = split.plan!({ media }, { engine: "cloud" });
    expect(cloud[0].error).toBe(CLOUD_SPLIT_PROBLEM);
    expect(split.place!({ media }, ctx)).toEqual({ studio: "Split soundtrack", href: "/audio/split" });
  });

  it("makes one remix when parts or levels are named, and four stems otherwise", async () => {
    const media = audioFile();
    const split = getTool("split_soundtrack")!;
    const out = await split.run({ media, keep: ["music", "effects"], levels_db: { music: -6 } }, ctx);
    expect(out.isError).toBeFalsy();
    const body = JSON.parse(out.content as string);
    const g = getGeneration(body.result)!;
    expect(g.request).toMatchObject({ modelId: "oss-dbs-remix", feature: REMIX_FEATURE });
    expect(g.request.params?.extra).toMatchObject({ voiceDb: OFF_DB, musicDb: -6, effectsDb: 0 });
    const stems = JSON.parse((await split.run({ media }, ctx)).content as string);
    expect(getGeneration(stems.result)!.request.modelId).toBe("oss-dbs-separate");
    expect(getGeneration(stems.result)!.request.feature).toBe("audio-split");
  });

  it("reads keep and music_db into Remove dialogue's three outcomes on the video", async () => {
    const video = videoFile();
    const tool = getTool("remove_dialogue")!;
    expect(tool.title!({ video })).toBe("No dialogue");
    expect(tool.title!({ video, keep: "dialogue" })).toBe("Dialogue only");
    expect(tool.title!({ video, keep: "dialogue", music_db: -18 })).toBe("Lower the music");
    const jobs = tool.plan!({ video, keep: "dialogue", music_db: -18 }, ctx);
    expect(jobs.map((j) => j.modelId)).toEqual(["oss-dbs-separate", "oss-mux"]);
    expect(jobs.every((j) => !j.error && j.costUsd === 0)).toBe(true);
    const run = JSON.parse((await tool.run({ video, keep: "dialogue", music_db: -18 }, ctx)).content as string);
    const mux = getGeneration(run.result)!;
    expect(mux.request.params?.extra?.backgroundVolumeDb).toBe(-18);
    expect(run.steps).toHaveLength(2);
    expect(tool.plan!({ video }, { engine: "cloud" })[0].error).toMatch(/Remove dialogue runs on your GPU/);
  });

  it("refuses a file that is gone, as a tool error", async () => {
    const out = await executeTool("split_soundtrack", { media: "/api/files/uploads/none.wav" }, ctx);
    expect(out.isError).toBe(true);
  });

  it("is offered over MCP and priced with estimate_job", async () => {
    const list = (await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string; description: string }[] } };
    const names = list.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["split_soundtrack", "remove_dialogue"]));
    expect(list.result.tools.find((t) => t.name === "split_soundtrack")!.description).toMatch(/no hosted DBS/);
    const media = audioFile();
    const est = (await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "estimate_job", arguments: { tool: "split_soundtrack", arguments: { media, engine: "open" } } } })) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    // MCP's calls run on the cloud engine unless one asks for the open one: there it says why it can't.
    const cloud = (await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "estimate_job", arguments: { tool: "split_soundtrack", arguments: { media } } } })) as { result: { content: { text: string }[] } };
    expect(cloud.result.content[0].text).toContain(CLOUD_SPLIT_PROBLEM);
    expect(est.result.isError, est.result.content[0].text).toBe(false);
    expect(est.result.content[0].text).toMatch(/oss-dbs-separate|DBS/);
  });
});

describe("the offline planner's sound suggestions", () => {
  const v = [{ kind: "video", url: "/api/files/v.mp4" }];
  const a = [{ kind: "audio", url: "/api/files/a.wav" }];
  it("reads 'remove the dialogue', 'just the music', 'lower the music' and 'split the soundtrack'", () => {
    expect(soundPlan("remove the dialogue from this video", v)).toMatchObject({ tool: "remove_dialogue", input: { video: "/api/files/v.mp4", keep: "bed" } });
    expect(soundPlan("just the music please", v)).toMatchObject({ tool: "split_soundtrack", input: { media: "/api/files/v.mp4", keep: ["music"] } });
    expect(soundPlan("lower the music by 18 db", v)).toMatchObject({ tool: "remove_dialogue", input: { keep: "dialogue", music_db: -18 } });
    expect(soundPlan("only the dialogue", v)).toMatchObject({ tool: "remove_dialogue", input: { keep: "dialogue" } });
    expect(soundPlan("take out the talking", a)).toMatchObject({ tool: "split_soundtrack", input: { keep: ["music", "effects"] } });
    expect(soundPlan("split the soundtrack into stems", a)).toMatchObject({ tool: "split_soundtrack", input: { media: "/api/files/a.wav" } });
    expect(soundPlan("remove the dialogue", [])).toBeNull();
    expect(soundPlan("make it cinematic", v)).toBeNull();
  });
  it("leaves a voice repair to Clean up voice and another studio's job to that studio", () => {
    for (const words of [
      "remove the background noise from the speech",
      "reduce the background noise in this voice recording",
      "get rid of the echo on the voice",
      "clean up the dialogue",
      "transcribe just the speech",
      "dub this video into spanish and keep the music",
      "restyle this as anime, keep the music",
      "cut this video down to 10 seconds and keep the speech",
      "add captions but only the dialogue",
    ])
      expect(soundPlan(words, v), words).toBeNull();
    expect(offlinePlan("Dub this video into Spanish and keep the music\n\nAttached files:\n- video 1: /api/files/v.mp4", "open")?.tool).not.toMatch(/split_soundtrack|remove_dialogue/);
    expect(offlinePlan("Transcribe just the speech\n\nAttached files:\n- video 1: /api/files/v.mp4", "open")?.tool).not.toMatch(/split_soundtrack|remove_dialogue/);
  });
  it("is what offlinePlan answers for an attached clip", () => {
    expect(offlinePlan("Remove the dialogue from this video\n\nAttached files:\n- video 1: /api/files/v.mp4", "open")).toMatchObject({ tool: "remove_dialogue" });
    // Without a clip, music is still a music track.
    expect(offlinePlan("just the music for a cafe", "open")!.tool).toBe("generate");
  });
});
