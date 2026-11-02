import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLOUD_ONLY_REMOVE_PROBLEM,
  CLOUD_REMOVE_PROBLEM,
  clampLowerDb,
  KEPT_STEM,
  LOWER_DEFAULT_DB,
  muxChain,
  NO_SOUND_PROBLEM,
  OUTCOMES,
  planRemoveDialogue,
  REMOVE_DIALOGUE_FEATURE,
  REMOVE_DIALOGUE_MAX_SECONDS,
  REMOVED_STEM,
  removeDialogueProblem,
  requestedOutcome,
  removeDialogueTime,
} from "@/lib/av/remove-dialogue";
import { splitTime } from "@/lib/av/split";
import { resolveWorkflowId } from "@/lib/comfy-variants";
import { HUB_MODES, modeHref } from "@/lib/hubs";
import type { Generation, GenInput, Operation } from "@/lib/catalog/types";

// Video tools → Remove dialogue (DBS D2): the planner, the two-step chain on the open engine (graph A, then the
// stream-copy mux), the graph the mux runs, the provider's bindings and the API in demo mode.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-remove-dialogue-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: the open models run on the demo provider.
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const gens = await import("@/server/generations");
const { createPipeline } = await import("@/server/chains");
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const route = await import("@/app/api/audio-tools/route");
const { nextSteps, outputActions } = await import("@/lib/output-actions");
const { STUDIO_ROWS, studioTool } = await import("@/server/gpu/tools");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const VIDEO = "/api/files/uploads/2026-11-01/interview.mp4";

/** A small MP4: a video track and, unless `channels` is null, an AAC sound track with that many channels (2 s each). */
function mp4Sound(channels: number | null): Buffer {
  const u32 = (...v: number[]) =>
    Buffer.concat(
      v.map((n) =>
        Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]),
      ),
    );
  const box = (type: string, ...parts: Buffer[]) => {
    const body = Buffer.concat(parts);
    return Buffer.concat([u32(8 + body.length), Buffer.from(type), body]);
  };
  const trak = (handler: string, ...stbl: Buffer[]) =>
    box(
      "trak",
      box(
        "mdia",
        box("mdhd", u32(0, 0, 0, 1000, 2000), Buffer.alloc(4)),
        box("hdlr", u32(0, 0), Buffer.from(handler), Buffer.alloc(12)),
        box("minf", box("stbl", ...stbl)),
      ),
    );
  const entry = Buffer.alloc(28);
  entry.writeUInt16BE(1, 6);
  entry.writeUInt16BE(channels ?? 2, 16);
  entry.writeUInt16BE(16, 18);
  const sound =
    channels === null
      ? []
      : [trak("soun", box("stsd", u32(0, 1), box("mp4a", entry)))];
  return Buffer.concat([
    box("ftyp", Buffer.from("isom"), u32(0)),
    box(
      "moov",
      box("mvhd", u32(0, 0, 0, 1000, 2000), Buffer.alloc(80)),
      trak("vide", box("stts", u32(0, 1, 50, 40))),
      ...sound,
    ),
  ]);
}
const video = (channels: number | null = 2, name = "interview.mp4") =>
  saveFile({
    data: mp4Sound(channels),
    contentType: "video/mp4",
    name,
    source: "upload",
  }).url;

const post = (body: unknown, preview = false) =>
  route.POST(
    new Request(`http://x/api/audio-tools${preview ? "?preview=1" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

async function finished(id: string) {
  const deadline = Date.now() + 15_000;
  let g = gens.getGeneration(id)!;
  while (
    g.status !== "succeeded" &&
    g.status !== "failed" &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 200));
    g = gens.getGeneration(id)!;
  }
  return g;
}

describe("the plan per outcome (open engine)", () => {
  it("No dialogue: graph A on the video, then the background stem in place of its sound", () => {
    const p = planRemoveDialogue({
      engine: "open",
      video: VIDEO,
      name: "Interview",
    });
    expect(p.outcome).toBe("no-dialogue");
    expect(p.steps.map((s) => s.key)).toEqual(["split", "video"]);
    const [split, mux] = p.steps;
    expect(split.request).toMatchObject({
      modelId: "oss-dbs-separate",
      op: "separate-audio",
      feature: REMOVE_DIALOGUE_FEATURE,
      inputs: { video: VIDEO },
      params: { extra: { channels: "mono" } },
      step: { index: 0, of: 2 },
    });
    expect(split.after).toBeUndefined();
    expect(mux.request).toMatchObject({
      modelId: "oss-mux",
      op: "mux",
      inputs: { video: VIDEO },
      title: "No dialogue · Interview",
      batchTitle: "No dialogue · Interview",
      step: { index: 1, of: 2 },
    });
    expect(mux.after).toEqual(["split"]);
    expect(mux.chain).toEqual([{ slot: "audio", stem: "background" }]);
    expect(mux.request.params).toBeUndefined();
    expect(p.summary).toBe(
      "Takes the talking out and keeps the music and sound effects. The picture stays exactly as it was.",
    );
    expect(p.notes[0]).toMatch(
      /^Speech the model misses .* stays in the music and effects/,
    );
    expect(p.notes[1]).toBe(
      "The dialogue it takes out is kept as a download beside the result.",
    );
  });

  it("Dialogue only: the voice stem in place of the sound", () => {
    const p = planRemoveDialogue({
      engine: "open",
      video: VIDEO,
      outcome: "dialogue-only",
    });
    expect(p.steps[1].chain).toEqual([{ slot: "audio", stem: "voice" }]);
    expect(p.steps[1].after).toEqual(["split"]);
    expect(p.steps[1].request.title).toBe("Dialogue only · video");
    expect(p.notes[1]).toBe(
      "The music & effects it takes out is kept as a download beside the result.",
    );
  });

  it("Lower the music: the voice over the background at the slider's level, both from the one split", () => {
    const p = planRemoveDialogue({
      engine: "open",
      video: VIDEO,
      outcome: "lower-music",
      musicDb: -18,
    });
    const mux = p.steps[1];
    expect(mux.after).toEqual(["split", "split"]);
    expect(mux.chain).toEqual([
      { slot: "audio", stem: "voice" },
      { slot: "audio2", stem: "background" },
    ]);
    expect(mux.request.params).toEqual({ extra: { backgroundVolumeDb: -18 } });
    expect(p.musicDb).toBe(-18);
    expect(p.summary).toBe(
      "Keeps the talking and lowers the music and sound effects by 18 dB under it. The picture stays exactly as it was.",
    );
    // The default and the slider's ends.
    expect(
      planRemoveDialogue({
        engine: "open",
        video: VIDEO,
        outcome: "lower-music",
      }).musicDb,
    ).toBe(LOWER_DEFAULT_DB);
    expect([
      clampLowerDb(-40),
      clampLowerDb(3),
      clampLowerDb(-12.4),
      clampLowerDb(undefined),
    ]).toEqual([-30, 0, -12, -12]);
  });

  it("keeps one stem and lists the other as the one taken out", () => {
    expect(OUTCOMES.map((o) => o.id)).toEqual([
      "no-dialogue",
      "dialogue-only",
      "lower-music",
    ]);
    expect(KEPT_STEM).toEqual({
      "no-dialogue": "background",
      "dialogue-only": "voice",
      "lower-music": null,
    });
    expect(REMOVED_STEM).toEqual({
      "no-dialogue": "voice",
      "dialogue-only": "background",
      "lower-music": null,
    });
    for (const o of OUTCOMES)
      expect(
        muxChain(o.id).every(
          (c) => c.stem === "voice" || c.stem === "background",
        ),
      ).toBe(true);
  });

  it("reads an earlier run's outcome and level back from its mux step's request (Compare puts them in the controls)", () => {
    for (const o of OUTCOMES) {
      const mux = planRemoveDialogue({
        engine: "open",
        video: VIDEO,
        outcome: o.id,
        musicDb: -20,
      }).steps[1];
      expect(
        requestedOutcome({ chain: mux.chain, params: mux.request.params }),
      ).toEqual({
        outcome: o.id,
        musicDb: o.id === "lower-music" ? -20 : LOWER_DEFAULT_DB,
      });
    }
    // A level missing or out of range reads as the slider would show it.
    const lower = muxChain("lower-music");
    expect(requestedOutcome({ chain: lower })).toEqual({
      outcome: "lower-music",
      musicDb: LOWER_DEFAULT_DB,
    });
    expect(
      requestedOutcome({
        chain: lower,
        params: { extra: { backgroundVolumeDb: -45 } },
      }).musicDb,
    ).toBe(-30);
    expect(requestedOutcome({})).toEqual({
      outcome: "no-dialogue",
      musicDb: LOWER_DEFAULT_DB,
    });
  });

  it("passes the model asked for and the channel count; a surround file is split in mono", () => {
    const best = planRemoveDialogue({
      engine: "open",
      video: VIDEO,
      quality: "best",
      channels: 2,
      seconds: 20,
    });
    expect(best.steps[0].request.params).toEqual({
      extra: {
        channels: "mono",
        separationModel: "DBS-TIGER-DnR",
        sourceChannels: 2,
      },
      sourceDuration: 20,
    });
    expect(best.length).toBe(20);
    const five = planRemoveDialogue({
      engine: "open",
      video: VIDEO,
      channels: 6,
    });
    expect(five.mode).toBe("mono");
    expect(five.steps[0].request.params?.extra).toEqual({
      channels: "mono",
      sourceChannels: 6,
    });
    expect(five.notes.at(-1)).toBe(
      "This file has 6 channels: its new soundtrack comes out in mono, as ComfyUI saves mono or stereo only.",
    );
  });
});

describe("what's in the way", () => {
  it("names the cloud, a missing video, a clip with no sound and one over 30 minutes", () => {
    expect(removeDialogueProblem({ engine: "cloud", video: VIDEO })).toBe(
      CLOUD_REMOVE_PROBLEM,
    );
    expect(CLOUD_REMOVE_PROBLEM).toMatch(
      /^Remove dialogue runs on your GPU \(open source\)/,
    );
    expect(removeDialogueProblem({ engine: "open" })).toBe(
      "Add the video to take the dialogue out of",
    );
    expect(
      removeDialogueProblem({ engine: "open", video: VIDEO, hasAudio: false }),
    ).toBe(NO_SOUND_PROBLEM);
    expect(NO_SOUND_PROBLEM).toBe("This clip has no sound");
    expect(
      removeDialogueProblem({
        engine: "open",
        video: VIDEO,
        seconds: REMOVE_DIALOGUE_MAX_SECONDS,
      }),
    ).toBeNull();
    expect(
      removeDialogueProblem({
        engine: "open",
        video: VIDEO,
        seconds: REMOVE_DIALOGUE_MAX_SECONDS + 1,
      }),
    ).toBe(
      "Videos run up to 30 minutes here — trim it first (Video tools → Trim)",
    );
    expect(() => planRemoveDialogue({ engine: "cloud", video: VIDEO })).toThrow(
      CLOUD_REMOVE_PROBLEM,
    );
  });
});

describe("time on the open engine", () => {
  it("is the split's time plus the mux's", () => {
    const o = {
      seconds: 20,
      quality: "fast" as const,
      mode: "mono" as const,
      channels: 2,
    };
    const t = removeDialogueTime(o);
    const s = splitTime(o);
    expect(t.low).toBeGreaterThan(s.low);
    expect(t.high).toBeGreaterThan(s.high);
    expect(t.low).toBeLessThan(t.high);
    expect(removeDialogueTime({ ...o, device: "cuda" }).high).toBeLessThan(
      t.low,
    );
  });
});

describe("the mux graph the provider picks", () => {
  const has = (id: string) =>
    ["video-mux-audio", "video-mux-audio-replace"].includes(id);
  const graphFor = (outcome: "no-dialogue" | "dialogue-only" | "lower-music") =>
    resolveWorkflowId("video-mux-audio", {
      op: "mux",
      clips: 0,
      images: 0,
      audio2: muxChain(outcome).some((c) => c.slot === "audio2"),
      extra: {},
      has,
    });

  it("replaces the sound with one stem, and mixes two for Lower the music", () => {
    expect(graphFor("no-dialogue")).toBe("video-mux-audio-replace");
    expect(graphFor("dialogue-only")).toBe("video-mux-audio-replace");
    expect(graphFor("lower-music")).toBe("video-mux-audio");
  });
});

describe("the provider's bindings for the two steps", () => {
  const ctx = (op: Operation) => ({
    generationId: "gen1",
    op,
    upload: async (_d: unknown, _t: unknown, name: string) => `up_${name}`,
    media: () => undefined,
    device: async () => "cpu",
    dbsModels: async () => undefined,
  });

  it("binds the video to LoadAudio for the oss-dbs-separate step (its soundtrack, no frames decoded)", async () => {
    const p = planRemoveDialogue({ engine: "open", video: VIDEO });
    const req = p.steps[0].request;
    const input: GenInput = {
      seed: 1,
      video: "interview.mp4",
      extra: req.params?.extra as Record<string, unknown>,
    };
    const { workflow } = await prepareWorkflow(
      "separate-soundtrack-dbs",
      input,
      ctx("separate-audio"),
    );
    expect(workflow["1"]).toMatchObject({
      class_type: "LoadAudio",
      inputs: { audio: "interview.mp4" },
    });
    expect(
      Object.values(workflow).some(
        (n) =>
          n.class_type === "LoadVideo" || n.class_type === "GetVideoComponents",
      ),
    ).toBe(false);
    expect(workflow["3"].inputs.channels).toBe("mono");
  });

  it("puts a stem on the picture with the stream-copy graph, and the voice over the lowered bed", async () => {
    const one = await prepareWorkflow(
      "video-mux-audio",
      { seed: 1, video: "interview.mp4", audio: "bg.flac", extra: {} },
      ctx("mux"),
    );
    expect(one.manifest.id).toBe("video-mux-audio-replace");
    expect(one.workflow["3"].inputs.audio).toBe("bg.flac");
    expect(
      Object.values(one.workflow).find(
        (n) => n.class_type === "ConcatenateVideo",
      )?.inputs.complete_audio,
    ).toBeDefined();
    const lower = await prepareWorkflow(
      "video-mux-audio",
      {
        seed: 1,
        video: "interview.mp4",
        audio: "voice.flac",
        audio2: "bg.flac",
        extra: { backgroundVolumeDb: -12 },
      } as GenInput,
      ctx("mux"),
    );
    expect(lower.manifest.id).toBe("video-mux-audio");
    expect([
      lower.workflow["3"].inputs.audio,
      lower.workflow["4"].inputs.audio,
      lower.workflow["5"].inputs.volume,
    ]).toEqual(["voice.flac", "bg.flac", -12]);
  });
});

describe("createPipeline takes one step twice for two of its stems", () => {
  it("allows two different stems of one split, and refuses anything else listed twice", () => {
    const split = {
      key: "split",
      request: {
        feature: "test",
        modelId: "oss-dbs-separate",
        op: "separate-audio" as const,
        inputs: { audio: "/api/files/x.wav" },
      },
    };
    const mux = (chain: { slot: "audio" | "audio2"; stem?: string }[]) => ({
      key: "mux",
      after: ["split", "split"],
      chain,
      request: {
        feature: "test",
        modelId: "oss-mux",
        op: "mux" as const,
        inputs: { video: "/api/files/x.mp4" },
      },
    });
    expect(() =>
      createPipeline([split, mux([{ slot: "audio" }, { slot: "audio2" }])]),
    ).toThrow("Step “mux” lists the same step twice");
    expect(() =>
      createPipeline([
        split,
        mux([
          { slot: "audio", stem: "voice" },
          { slot: "audio2", stem: "voice" },
        ]),
      ]),
    ).toThrow("Step “mux” lists the same step twice");
    const run = createPipeline([
      split,
      mux([
        { slot: "audio", stem: "voice" },
        { slot: "audio2", stem: "background" },
      ]),
    ]);
    expect(run.items).toHaveLength(2);
  });
});

describe("Remove dialogue in Video tools", () => {
  it("is a mode after Remove object with its own path", () => {
    const ids = HUB_MODES["video-tools"].map((m) => m.id);
    expect(ids.indexOf("remove-dialogue")).toBe(
      ids.indexOf("remove-object") + 1,
    );
    expect(
      HUB_MODES["video-tools"].find((m) => m.id === "remove-dialogue")?.label,
    ).toBe("Remove dialogue");
    expect(modeHref("video-tools", "remove-dialogue")).toBe(
      "/video-tools/remove-dialogue",
    );
  });

  it("is a hand-off from any video, and a next step under a clip that has its sound", () => {
    const gen = (op: Generation["op"], feature = "video"): Generation =>
      ({
        id: "g1",
        status: "succeeded",
        kind: "video",
        op,
        feature,
        outputs: [{ kind: "video", url: "/api/files/clip.mp4" }],
        request: { modelId: "x" },
        createdAt: 1,
      }) as unknown as Generation;
    const link = outputActions(gen("t2v"), 0).find(
      (a) => a.id === "remove-dialogue",
    );
    expect(link).toMatchObject({
      label: "Remove dialogue",
      placement: "menu",
      href: "/video-tools/remove-dialogue?video=%2Fapi%2Ffiles%2Fclip.mp4",
    });
    // A clip likely to carry speech keeps Upscale and adds Remove dialogue (Split soundtrack follows, in the menu).
    for (const [op, feature] of [
      ["lipsync", "lipsync"],
      ["mux", "dub"],
      ["trim", "video"],
      ["captions", "video"],
    ] as const)
      expect(nextSteps(gen(op, feature), 0).map((a) => a.id)).toEqual([
        "extend",
        "upscale",
        "remove-dialogue",
      ]);
    expect(nextSteps(gen("lipsync"), 0, 4).map((a) => a.id)).toEqual([
      "extend",
      "upscale",
      "remove-dialogue",
      "split-soundtrack",
    ]);
    // Sound for video (generated effects) and a Remove dialogue result itself don't offer it.
    for (const g of [gen("v2a"), gen("mux", REMOVE_DIALOGUE_FEATURE)])
      expect(nextSteps(g, 0).map((a) => a.id)).toEqual([
        "extend",
        "upscale",
        "split-soundtrack",
      ]);
    expect(nextSteps(gen("t2v"), 0).map((a) => a.id)).toEqual([
      "extend",
      "upscale",
      "add-sound",
    ]);
  });

  it("has a row on the GPU pre-flight board: the split's graph and the mux's", () => {
    const row = STUDIO_ROWS.find(
      (r) => r.href === "/video-tools/remove-dialogue",
    )!;
    expect(row).toMatchObject({
      label: "Remove dialogue",
      group: "Video tools",
    });
    const t = studioTool(row)!;
    expect(t.ref).toBe("studio:/video-tools/remove-dialogue");
    expect(t.workflows).toEqual(
      expect.arrayContaining(["separate-soundtrack-dbs", "video-mux-audio"]),
    );
  });
});

describe("POST /api/audio-tools remove-dialogue (demo mode)", () => {
  it("prices it as free with a time estimate, and runs both steps into the Library", async () => {
    const media = video(2);
    const preview = await (
      await post(
        {
          tool: "remove-dialogue",
          engine: "open",
          video: media,
          name: "Interview",
        },
        true,
      )
    ).json();
    expect(preview).toMatchObject({
      steps: 2,
      costUsd: 0,
      demo: true,
      length: 2,
      channels: 2,
      hostPick: "fast",
    });
    expect(preview.summary).toBe(
      "Takes the talking out and keeps the music and sound effects. The picture stays exactly as it was.",
    );
    expect(preview.estimate).toEqual(
      removeDialogueTime({
        seconds: 2,
        quality: "fast",
        mode: "mono",
        channels: 2,
      }),
    );

    const res = await post({
      tool: "remove-dialogue",
      engine: "open",
      video: media,
      name: "Interview",
      outcome: "lower-music",
      musicDb: -15,
    });
    expect(res.status).toBe(201);
    const run = await res.json();
    expect(run.items.map((g: Generation) => [g.modelId, g.op])).toEqual([
      ["oss-dbs-separate", "separate-audio"],
      ["oss-mux", "mux"],
    ]);
    expect(run.result).toMatchObject({
      feature: REMOVE_DIALOGUE_FEATURE,
      modelId: "oss-mux",
      op: "mux",
      provider: "mock",
    });
    expect(run.result.request.params.extra).toEqual({
      backgroundVolumeDb: -15,
    });
    // The stored request reads back as what was asked (Compare).
    expect(requestedOutcome(run.result.request)).toEqual({
      outcome: "lower-music",
      musicDb: -15,
    });
    const g = await finished(run.result.id);
    expect(g.status).toBe("succeeded");
    expect(g.outputs[0].kind).toBe("video");
    // The removed stems stay in the Library beside it.
    const split = gens.getGeneration(run.items[0].id)!;
    expect(
      split.outputs.filter((o) => o.kind === "audio").map((o) => o.meta?.stem),
    ).toEqual(["voice", "music", "effects", "background"]);
  }, 30_000);

  it("refuses a clip with no sound, the cloud, and an install set to paid APIs only, before anything is queued", async () => {
    const silent = video(null, "t2v.mp4");
    for (const preview of [true, false]) {
      const res = await post(
        { tool: "remove-dialogue", engine: "open", video: silent },
        preview,
      );
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe(NO_SOUND_PROBLEM);
    }
    const media = video(2, "b.mp4");
    expect(
      (
        await (
          await post(
            { tool: "remove-dialogue", engine: "cloud", video: media },
            true,
          )
        ).json()
      ).error,
    ).toBe(CLOUD_REMOVE_PROBLEM);
    setSetting("engineMode", "cloud");
    try {
      expect(
        (
          await (
            await post({
              tool: "remove-dialogue",
              engine: "open",
              video: media,
            })
          ).json()
        ).error,
      ).toBe(CLOUD_ONLY_REMOVE_PROBLEM);
    } finally {
      setSetting("engineMode", "both");
    }
    expect(
      (
        await (
          await post({
            tool: "remove-dialogue",
            engine: "open",
            video: "/etc/passwd",
          })
        ).json()
      ).error,
    ).toBe("Add the video to take the dialogue out of");
    expect(
      (
        await (
          await post(
            {
              tool: "remove-dialogue",
              engine: "open",
              video: "/api/files/uploads/gone.mp4",
            },
            true,
          )
        ).json()
      ).error,
    ).toBe("That video is gone — add it again");
    expect(
      (
        await (
          await post(
            {
              tool: "remove-dialogue",
              engine: "open",
              video: media,
              musicDb: -40,
            },
            true,
          )
        ).json()
      ).error,
    ).toBe("Lower the music by 0 to 30 dB");
  });

  it("refuses a video over 30 minutes by the browser's length when the header can't say", async () => {
    const odd = saveFile({
      data: Buffer.from("not really a video"),
      contentType: "video/mp4",
      name: "long.mp4",
      source: "upload",
    }).url;
    const res = await post(
      {
        tool: "remove-dialogue",
        engine: "open",
        video: odd,
        sourceDuration: 1801,
      },
      true,
    );
    expect((await res.json()).error).toBe(
      "Videos run up to 30 minutes here — trim it first (Video tools → Trim)",
    );
  });
});
