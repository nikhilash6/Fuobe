import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Engine, Generation, GenInput } from "@/lib/catalog/types";

// DBS D9 (docs/research/dbs-separation-7.md §8 and §9 D9): Assist's and MCP's split_soundtrack and remove_dialogue. What
// a call returns (stems, one stem, one remix), graph C (soundtrack-remix-dbs, Clean up dialogue's oss-dbs-remix) for a remix, the open engine
// only (the cloud refuses: samAudioCloud is false), price first (estimate_job), and the offline planner's suggestions.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-soundtrack-tools-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: the open models run on the demo provider.
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { getSetting, setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const tools = await import("@/server/assist/tools");
const studio = await import("@/server/assist/studio-tools");
const agent = await import("@/server/assist/agent");
const { handleMcp } = await import("@/server/mcp");
const gens = await import("@/server/generations");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { resolveWorkflowId } = await import("@/lib/comfy-variants");
const split = await import("@/lib/av/split");
const { getModel } = await import("@/lib/catalog");
const { CLOUD_ONLY_REMOVE_PROBLEM, CLOUD_REMOVE_PROBLEM } = await import("@/lib/av/remove-dialogue");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const plan = (name: string, input: unknown, engine: Engine = "cloud") => tools.planFor(name, input, { engine });
const run = (name: string, input: unknown, engine: Engine = "cloud") => tools.executeTool(name, input, { engine });
const rpc = (method: string, params?: unknown) => handleMcp({ jsonrpc: "2.0", id: 1, method, params });

/** A two-second 16-bit stereo WAV. */
function wav(name = "film.wav"): string {
  const rate = 8000;
  const n = rate * 2;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  return saveFile({ data: buf, contentType: "audio/wav", name, source: "upload" }).url;
}

/** A small MP4 with a video track and (unless null) a stereo AAC track, 2 s each. */
function mp4(channels: number | null = 2, name = "interview.mp4"): string {
  const u32 = (...v: number[]) => Buffer.concat(v.map((x) => Buffer.from([x >>> 24, (x >>> 16) & 255, (x >>> 8) & 255, x & 255])));
  const box = (type: string, ...parts: Buffer[]) => {
    const body = Buffer.concat(parts);
    return Buffer.concat([u32(8 + body.length), Buffer.from(type), body]);
  };
  const trak = (handler: string, ...stbl: Buffer[]) =>
    box("trak", box("mdia", box("mdhd", u32(0, 0, 0, 1000, 2000), Buffer.alloc(4)), box("hdlr", u32(0, 0), Buffer.from(handler), Buffer.alloc(12)), box("minf", box("stbl", ...stbl))));
  const entry = Buffer.alloc(28);
  entry.writeUInt16BE(1, 6);
  entry.writeUInt16BE(channels ?? 2, 16);
  entry.writeUInt16BE(16, 18);
  const sound = channels === null ? [] : [trak("soun", box("stsd", u32(0, 1), box("mp4a", entry)))];
  const data = Buffer.concat([box("ftyp", Buffer.from("isom"), u32(0)), box("moov", box("mvhd", u32(0, 0, 0, 1000, 2000), Buffer.alloc(80)), trak("vide", box("stts", u32(0, 1, 50, 40))), ...sound)]);
  return saveFile({ data, contentType: "video/mp4", name, source: "upload" }).url;
}

async function finished(id: string): Promise<Generation> {
  const deadline = Date.now() + 15_000;
  let g = gens.getGeneration(id)!;
  while (g.status !== "succeeded" && g.status !== "failed" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    g = gens.getGeneration(id)!;
  }
  return g;
}

describe("what split_soundtrack returns (splitOutcome)", () => {
  it("all four stems, one stem, music & effects as the background stem, or a mix", () => {
    expect(split.splitOutcome()).toEqual({ kind: "stems" });
    expect(split.splitOutcome(["dialogue", "music", "effects"])).toEqual({ kind: "stems" });
    expect(split.splitOutcome(["music"])).toEqual({ kind: "stem", stem: "music" });
    expect(split.splitOutcome(["dialogue"])).toEqual({ kind: "stem", stem: "voice" });
    expect(split.splitOutcome(["effects", "music"])).toEqual({ kind: "stem", stem: "background" });
    // Dialogue with one of the others isn't one stem: one mix, the rest left out.
    expect(split.splitOutcome(["dialogue", "effects"])).toEqual({ kind: "mix", levels: { voiceDb: 0, musicDb: split.REMIX_OUT_DB, effectsDb: 0 } });
  });

  it("levels make one mix: whole dB, clamped, a stem not kept left out", () => {
    expect(split.splitOutcome(undefined, { music: -12.4 })).toEqual({ kind: "mix", levels: { voiceDb: 0, musicDb: -12, effectsDb: 0 } });
    expect(split.splitOutcome(["dialogue", "music"], { dialogue: 40, music: -90, effects: 3 })).toEqual({
      kind: "mix",
      levels: { voiceDb: split.REMIX_MAX_DB, musicDb: split.REMIX_MIN_DB, effectsDb: split.REMIX_OUT_DB },
    });
    // A level only for a stem that isn't kept changes nothing: the music stem.
    expect(split.splitOutcome(["music"], { dialogue: -6 })).toEqual({ kind: "stem", stem: "music" });
    expect(() => split.splitOutcome([])).toThrow("Keep at least one of dialogue, music or effects");
    expect(split.remixWords({ voiceDb: 0, musicDb: -12, effectsDb: split.REMIX_OUT_DB })).toBe("Dialogue + Music −12 dB");
  });

  it("a remix plan: one job with the levels, every channel of a stereo source", () => {
    const p = split.planSplit({ engine: "open", media: "/api/files/a.wav", kind: "audio", channels: 2, seconds: 10, remix: { voiceDb: 0, musicDb: -12, effectsDb: -100 } });
    expect(p.mode).toBe("each channel");
    // Graph C's model (Clean up dialogue's), with all three levels given (the graph's own defaults are -18 dB under the dialogue).
    expect(p.steps[0].request.modelId).toBe("oss-dbs-remix");
    expect(p.steps[0].request.params?.extra).toEqual({ voiceDb: 0, musicDb: -12, effectsDb: -100, channels: "each channel", sourceChannels: 2 });
    expect(p.steps[0].request.title).toBe("Mix (Dialogue + Music −12 dB) · soundtrack");
    // A mono source stays one pass; asked for mono, a stereo one too.
    expect(split.planSplit({ engine: "open", media: "/api/files/a.wav", kind: "audio", channels: 1, remix: { voiceDb: 0, musicDb: 0, effectsDb: 0 } }).mode).toBe("mono");
    expect(split.planSplit({ engine: "open", media: "/api/files/a.wav", kind: "audio", channels: 2, stereo: false, remix: { voiceDb: 0, musicDb: 0, effectsDb: 0 } }).mode).toBe("mono");
    // Without levels: as the Audio hub's plan (mono, four stems).
    const plain = split.planSplit({ engine: "open", media: "/api/files/a.wav", kind: "audio", channels: 2 }).steps[0].request;
    expect(plain.params?.extra).toEqual({ channels: "mono", sourceChannels: 2 });
    expect(plain.modelId).toBe(split.SPLIT_MODEL);
  });
});

describe("graph C runs for a remix (soundtrack-remix-dbs)", () => {
  const has = () => true;
  const req = (extra: Record<string, unknown>) => ({ op: "separate-audio", clips: 0, images: 0, audio2: false, extra, has });

  it("runs on graph C's own model (oss-dbs-remix), not as a variant of the four-stem split", () => {
    expect(getModel("oss-dbs-remix")?.routes.find((r) => r.provider === "comfyui")?.endpoint).toBe("soundtrack-remix-dbs");
    expect(resolveWorkflowId("separate-soundtrack-dbs", req({ voiceDb: 0, musicDb: -12, effectsDb: -100 }))).toBe("separate-soundtrack-dbs");
  });

  it("binds the levels to Adjust Audio Volume and the DBS rules to the loader and the split", async () => {
    const input: GenInput = { seed: 1, audio: "film.wav", extra: { voiceDb: -6, musicDb: -100, effectsDb: 3, channels: "each channel", separationModel: "DBS-TIGER-DnR" } };
    const { workflow } = await prepareWorkflow("soundtrack-remix-dbs", input, {
      generationId: "gen1",
      op: "separate-audio",
      upload: async (_d: unknown, _t: unknown, name: string) => `up_${name}`,
      media: () => ({ container: "wav", channels: 2 }),
      device: async () => "cpu",
      dbsModels: async () => undefined,
    } as never);
    expect(workflow["1"].inputs.audio).toBe("film.wav");
    expect(workflow["2"].inputs.model).toBe("DBS-TIGER-DnR");
    expect(workflow["3"].inputs.channels).toBe("each channel");
    expect([workflow["4"].inputs.volume, workflow["5"].inputs.volume, workflow["6"].inputs.volume]).toEqual([-6, -100, 3]);
    expect(workflow["9"]).toMatchObject({ class_type: "SaveAudioAdvanced", inputs: { format: "flac", filename_prefix: "fuobe/gen1" } });
    expect(workflow["10"]).toMatchObject({ class_type: "PreviewAny" });
  });

  it("is in the manifest, validated, with its pack and the four DBS files on the GPU pre-flight's index", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/manifest.json"), "utf8"));
    const w = manifest.workflows.find((x: { id: string }) => x.id === "soundtrack-remix-dbs");
    expect(w).toMatchObject({ capability: "separate-audio", validated: true, outputs: [
        { node: "9", kind: "audio", stem: "voice" },
        { node: "10", kind: "text", role: "report" },
      ],
    });
    expect(w.defaults).toMatchObject({ voiceDb: 0, musicDb: -18, effectsDb: -18 });
    const reqs = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/requirements.json"), "utf8"));
    const r = reqs.workflows?.["soundtrack-remix-dbs"] ?? reqs["soundtrack-remix-dbs"];
    expect(r.packs).toEqual({ "ComfyUI-DBS": ["DBSLoader", "DBSSeparate"] });
    expect(r.files).toHaveLength(4);
  });
});

describe("split_soundtrack and remove_dialogue as tools", () => {
  it("are gated studio tools, listed for Assist and over MCP, priced by estimate_job", async () => {
    for (const name of ["split_soundtrack", "remove_dialogue"]) {
      const t = tools.getTool(name)!;
      expect(t.gated).toBe(true);
      expect(t.description).toMatch(/there is no hosted DBS, so the cloud engine refuses it/);
    }
    const list = (await rpc("tools/list")) as { result: { tools: { name: string; inputSchema: { properties?: Record<string, unknown>; enum?: string[] } }[] } };
    const names = list.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["split_soundtrack", "remove_dialogue", "estimate_job"]));
    const est = list.result.tools.find((t) => t.name === "estimate_job")!;
    expect((est.inputSchema.properties!.tool as { enum: string[] }).enum).toEqual(expect.arrayContaining(["split_soundtrack", "remove_dialogue"]));
    const init = (await rpc("initialize", { protocolVersion: "2025-11-25" })) as { result: { instructions: string; serverInfo: { version: string } } };
    expect(init.result.serverInfo.version).toBe("1.4.0");
    expect(init.result.instructions).toMatch(/split_soundtrack/);
    expect(init.result.instructions).toMatch(/remove_dialogue/);
  });

  it("validates its arguments: levels in range, keep from the three stems, music_db 0 to −30", () => {
    expect(plan("split_soundtrack", { media: "/api/files/x.wav", keep: ["voice"] }).error).toBeTruthy();
    expect(plan("split_soundtrack", { media: "/api/files/x.wav", levels_db: { music: -80 } }).error).toBeTruthy();
    expect(plan("remove_dialogue", { video: "/api/files/x.mp4", music_db: -40 }).error).toBeTruthy();
    expect(plan("remove_dialogue", { video: "/api/files/x.mp4", keep: "music" }).error).toBeTruthy();
  });

  it("prices a split first: free on the open engine (demo here), one step, the studio's page", () => {
    const media = wav("song.wav");
    // The chat's engine is the cloud: the tool still runs on the open engine unless asked otherwise.
    const p = plan("split_soundtrack", { media, keep: ["music"] });
    expect(p.error).toBeUndefined();
    expect(p.jobs).toHaveLength(1);
    expect(p.jobs[0]).toMatchObject({ tool: "split_soundtrack", modelId: "oss-dbs-separate", op: "separate-audio", costUsd: 0, demo: true, atomic: true });
    expect(p.jobs[0].error).toBeUndefined();
    expect(p.total).toBe(0);
    expect(p).toMatchObject({ studio: "Split soundtrack", href: "/audio/split" });
  });

  it("leaves the card's time out until the GPU's device is known, and says where it runs", async () => {
    const { planAudioTool } = await import("@/server/audio-tools");
    const body = studio.splitSoundtrackBody({ media: wav("time.wav") }).body;
    const time = () => studio.soundtrackTime(planAudioTool(body), body);
    const cache = (globalThis.__fuobeComfyDevice ??= new Map());
    const url = getSetting("comfyUrl").replace(/\/+$/, "");
    const before = cache.get(url);
    try {
      cache.delete(url);
      expect(time()).toBeNull();
      cache.set(url, { type: "cpu", at: Date.now() });
      expect(time()).toMatch(/ on your computer$/);
      cache.set(url, { type: "cuda", at: Date.now() });
      expect(time()).toMatch(/ on your GPU$/);
    } finally {
      if (before) cache.set(url, before);
      else cache.delete(url);
    }
  });

  it("prices Remove dialogue as the page's two steps (the split, then the stream-copy mux)", () => {
    const video = mp4();
    const p = plan("remove_dialogue", { video, music_db: -18 });
    expect(p.jobs.map((j) => [j.modelId, j.op, j.costUsd, !!j.error])).toEqual([
      ["oss-dbs-separate", "separate-audio", 0, false],
      ["oss-mux", "mux", 0, false],
    ]);
    expect(p).toMatchObject({ studio: "Remove dialogue", href: "/video-tools/remove-dialogue" });
  });

  it("refuses the cloud engine and a paid-APIs-only install in words, before anything is queued", async () => {
    const media = wav("cloud.wav");
    const video = mp4(2, "cloud.mp4");
    expect(plan("split_soundtrack", { media, engine: "cloud" }).jobs[0].error).toBe(split.CLOUD_SPLIT_PROBLEM);
    expect(plan("remove_dialogue", { video, engine: "cloud" }).jobs[0].error).toBe(CLOUD_REMOVE_PROBLEM);
    const before = gens.listGenerations({ limit: 500 }).length;
    const out = await run("split_soundtrack", { media, engine: "cloud" });
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content as string).error).toBe(split.CLOUD_SPLIT_PROBLEM);
    setSetting("engineMode", "cloud");
    try {
      expect(plan("split_soundtrack", { media }).jobs[0].error).toBe(split.CLOUD_ONLY_PROBLEM);
      expect(plan("remove_dialogue", { video }).jobs[0].error).toBe(CLOUD_ONLY_REMOVE_PROBLEM);
      expect((await run("remove_dialogue", { video })).isError).toBe(true);
    } finally {
      setSetting("engineMode", "both");
    }
    expect(gens.listGenerations({ limit: 500 }).length).toBe(before);
  });

  it("refuses what the pages refuse: a silent video, an image, keep 'bed' with music_db, a file that is gone", () => {
    expect(plan("remove_dialogue", { video: mp4(null, "silent.mp4") }).jobs[0].error).toBe("This clip has no sound");
    expect(plan("split_soundtrack", { media: "/api/files/uploads/still.png" }).jobs[0].error).toMatch(/Pass an audio file or a video/);
    expect(plan("remove_dialogue", { video: wav("speech.wav") }).jobs[0].error).toMatch(/use split_soundtrack for an audio file/);
    expect(plan("remove_dialogue", { video: mp4(2, "bed.mp4"), keep: "bed", music_db: -12 }).jobs[0].error).toMatch(/music_db lowers the music/);
    expect(plan("split_soundtrack", { media: "/api/files/uploads/gone.wav" }).jobs[0].error).toBe("That audio file is gone — add it again");
    expect(plan("split_soundtrack", { media: wav("none.wav"), keep: [] }).jobs[0].error).toBe("Keep at least one of dialogue, music or effects");
  });

  it("runs a split into the Library and says which stem to pick", async () => {
    const out = await run("split_soundtrack", { media: wav("run.wav"), keep: ["music"] });
    expect(out.isError).toBeFalsy();
    const body = JSON.parse(out.content as string);
    expect(body).toMatchObject({ tool: "Split soundtrack", href: "/audio/split", engine: "open", costUsd: 0, demo: true });
    expect(body.returns).toMatch(/music stem/);
    expect(out.items).toEqual([expect.objectContaining({ role: "tool", href: "/audio/split" }), { id: "", role: "generations", ids: [body.result] }]);
    const g = await finished(body.result);
    expect(g.status).toBe("succeeded");
    expect(g.outputs.map((o) => o.meta?.stem)).toEqual(["voice", "music", "effects", "background"]);
  }, 30_000);

  it("runs a remix as one mixed file (graph C)", async () => {
    const out = await run("split_soundtrack", { media: wav("remix.wav"), levels_db: { music: -12 }, keep: ["dialogue", "music"] });
    const body = JSON.parse(out.content as string);
    expect(body.returns).toMatch(/^one mixed file: Dialogue \+ Music −12 dB /);
    expect(body.returns).toMatch(/meta\.stem voice/);
    const g = await finished(body.result);
    expect(g.modelId).toBe("oss-dbs-remix");
    expect(g.request.params?.extra).toMatchObject({ voiceDb: 0, musicDb: -12, effectsDb: -100 });
    expect(g.request.params?.extra).not.toHaveProperty("remix");
    // Graph C tags its one audio output as the voice stem, whatever the levels.
    const audio = g.outputs.filter((o) => o.kind === "audio");
    expect(audio).toHaveLength(1);
    expect(audio[0].meta?.stem).toBe("voice");
  }, 30_000);

  it("runs Remove dialogue as the page does: the split, then the mux with the background stem", async () => {
    const out = await run("remove_dialogue", { video: mp4(2, "run.mp4") });
    const body = JSON.parse(out.content as string);
    expect(body.steps).toHaveLength(2);
    expect(body.returns).toMatch(/music and effects only/);
    const g = await finished(body.result);
    expect(g).toMatchObject({ modelId: "oss-mux", op: "mux", status: "succeeded" });
    expect(g.request.chain).toEqual([{ slot: "audio", stem: "background" }]);
  }, 30_000);

  it("builds the pages' own requests (the exported builders)", () => {
    const v = mp4(2, "b.mp4");
    expect(studio.removeDialogueBody({ video: v, keep: "dialogue" }).body).toMatchObject({ tool: "remove-dialogue", engine: "open", outcome: "dialogue-only" });
    expect(studio.removeDialogueBody({ video: v, music_db: -9.6 }).body).toMatchObject({ outcome: "lower-music", musicDb: -10 });
    expect(studio.splitSoundtrackBody({ media: v, quality: "best" }).body).toMatchObject({ tool: "split", kind: "video", quality: "best" });
  });
});

describe("the offline planner", () => {
  const attached = (kind: string, url: string) => `\n\nAttached files (use these URLs):\n- ${kind} 1: ${url}`;

  it("'Remove the dialogue from this video' with a video attached: remove_dialogue", () => {
    const v = "/api/files/uploads/clip.mp4";
    expect(agent.offlinePlan(`Remove the dialogue from this video${attached("video", v)}`, "cloud")).toMatchObject({ tool: "remove_dialogue", input: { video: v } });
    expect(agent.offlinePlan(`keep just the dialogue${attached("video", v)}`, "open")).toMatchObject({ tool: "remove_dialogue", input: { video: v, keep: "dialogue" } });
    expect(agent.offlinePlan(`lower the music under the talking by 18 dB${attached("video", v)}`, "open")).toMatchObject({ tool: "remove_dialogue", input: { video: v, music_db: -18 } });
  });

  it("'just the music' with a file attached: split_soundtrack", () => {
    const a = "/api/files/uploads/song.wav";
    expect(agent.offlinePlan(`give me just the music${attached("audio", a)}`, "open")).toMatchObject({ tool: "split_soundtrack", input: { media: a, keep: ["music"] } });
    expect(agent.offlinePlan(`remove the vocals${attached("audio", a)}`, "open")).toMatchObject({ tool: "split_soundtrack", input: { media: a, keep: ["music", "effects"] } });
    expect(agent.offlinePlan(`split the soundtrack into stems${attached("video", "/api/files/v.mp4")}`, "open")).toMatchObject({ tool: "split_soundtrack", input: { media: "/api/files/v.mp4" } });
  });

  it("asks for the file when none is attached, and leaves new pieces alone", () => {
    expect(agent.offlineSoundtrack("Remove the dialogue from this video")).toEqual({ say: expect.stringMatching(/Attach the video/) });
    expect(agent.offlineSoundtrack("write a song with no vocals")).toBeNull();
    expect(agent.offlineSoundtrack("a cinematic video of a lighthouse, no dialogue")).toBeNull();
    expect(agent.offlinePlan("a cinematic video of a lighthouse, no dialogue", "cloud")?.tool).toBe("generate");
    expect(agent.offlineSoundtrack("a red fox in the snow")).toBeNull();
  });

  it("leaves other jobs that mention the voice, the music or vocals to their own plans", () => {
    const v = attached("video", "/api/files/uploads/clip.mp4");
    const a = attached("audio", "/api/files/uploads/take.wav");
    const others = [
      `Remove the background noise from my voice${a}`,
      `Translate this video to French and keep the voice${v}`,
      `Dub this video into Spanish but keep the music${v}`,
      `Extend this video and keep the music${v}`,
      `Upscale this video, no voice changes${v}`,
      `Add captions to this video, keep the voice${v}`,
      `Lip sync this video to the audio, keep the voice${v}`,
      `Make a music video for this song with no vocals${a}`,
      `Write a song like this, no vocals${a}`,
      `Generate a video with this audio, no talking${a}`,
      `Keep the voice and make it 9:16${v}`,
    ];
    for (const m of others) {
      expect(agent.offlineSoundtrack(m), m).toBeNull();
      expect(["split_soundtrack", "remove_dialogue"], m).not.toContain(agent.offlinePlan(m, "open")?.tool);
    }
    // "keep only …" , "make it just the music" and "turn down the music" are still soundtrack requests.
    expect(agent.offlinePlan(`keep only the music${a}`, "open")).toMatchObject({ tool: "split_soundtrack", input: { keep: ["music"] } });
    expect(agent.offlinePlan(`make it just the music${a}`, "open")).toMatchObject({ tool: "split_soundtrack", input: { keep: ["music"] } });
    expect(agent.offlinePlan(`turn down the music under the dialogue${v}`, "open")).toMatchObject({ tool: "remove_dialogue", input: { music_db: -12 } });
  });
});

describe("public sign-up: the tools are the owner's (docs/public-signup.md)", () => {
  it("a visitor's change to an Assist chat (where the tools run) is refused, and MCP is owner-only, so a visitor never runs them", async () => {
    const access = await import("@/lib/guest-access");
    // Approving a split_soundtrack / remove_dialogue card is a change to the chat: assist-owner for guests and accounts.
    expect(access.isAssistChange("POST", "/api/assist/abc123/approval")).toBe(true);
    expect(access.isAssistChange("POST", "/api/assist/abc123/messages")).toBe(true);
    expect(access.ownerOnly("POST", "/api/mcp")).toBe(true);
    expect(access.ownerOnly("GET", "/api/mcp")).toBe(true);
  });
});
