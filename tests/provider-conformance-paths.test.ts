/**
 * The untested hosted routes' paths that tests/provider-conformance.test.ts doesn't reach with its one-setting-at-a-time
 * variants, checked with ajv against the providers' own schemas (tests/fixtures/provider-schemas/, public GETs only):
 *
 * - Mureka's files/upload: the upload's own body ({file_url, purpose}) and the id its answer gives; a song of Mureka's own
 *   going by its song_id instead.
 * - Clean dialogue on a video: extract-audio (FLAC), DeepFilterNet 3 and merge-audio-video, each step's body; VEED's video.
 * - Fuobe Animation's cloud film: every gap length the film sends to Replicate's fast Wan 2.2 (17-81 frames in steps of 4
 *   at 16 fps, each made as 81), AniSora on the high-noise expert and a user's low-noise LoRA beside it.
 * - Songs with lyrics (Mureka, MiniMax Music 3, Lyria 3.5 in its prompt), instrumentals, and the API's limits on lengths.
 * - Pictures and clips beside the main input (Lyria's picture, Insert's references, Turbo extend's voices), each list at
 *   the catalog's own maximum, and the 12-file total.
 * - The longest prompt, the largest seeds, and lengths an API caller sends outside the composer's lists.
 *
 * Every body is also held to the schema's own fields: an unknown key fails, even where fal would ignore it.
 */
import { describe, expect, it } from "vitest";
import { cleanDialogueProblem, planCleanDialogue } from "@/lib/av/clean-dialogue";
import { getModel, getPreset } from "@/lib/catalog";
import { extractOutputs } from "@/lib/catalog/payload";
import { planGeneration, routesFor } from "@/lib/catalog/plan";
import type { GenerationRequest, GenParams, LoraRef } from "@/lib/catalog/types";
import { GAP_STEP, MAX_GAP_FRAMES, MIN_GAP_FRAMES } from "@/lib/inbetween";
import { LYRICS_PARAM, SONG_ID_PARAM } from "@/lib/lyrics";
import { bodyProblems, CLIP, documentedAnswer, END, handOverInput, IMG, PROMPT, routeRequest, schemaNames, SCHEMA_INDEX, SONG, VOICE, type Inputs } from "./helpers/provider-schemas";

const LYRICS = "[Verse]\nNeon light on the runway tonight\n\n[Chorus]\nWalk it, own it";
const refs = (kind: "png" | "mp4" | "mp3", n: number) => Array.from({ length: n }, (_, i) => `https://v3b.fal.media/files/in/ref${i}.${kind}`);

interface Run {
  modelId: string;
  op?: GenerationRequest["op"];
  prompt?: string;
  inputs?: Inputs;
  params?: GenParams;
  loras?: LoraRef[];
  engine?: GenerationRequest["engine"];
}

/** The plan, the route it goes to, and what fal.ts or replicate.ts sends for it (a song's upload too). */
function sent(run: Run) {
  const model = getModel(run.modelId)!;
  const req: GenerationRequest = { feature: model.kind, ...run, inputs: run.inputs ?? {}, params: run.params ?? {} };
  const plan = planGeneration(req, getModel, getPreset);
  const route = routesFor(plan.model, plan.op, plan.params).find((r) => r.provider !== "comfyui")!;
  const out = routeRequest(route, handOverInput(plan, { inputs: run.inputs ?? {} }));
  return { plan, route, ...out };
}

/** The run's body (and its upload's), held to the endpoint's schema: [] when it fits. */
function problems(run: Run): string[] {
  const s = sent(run);
  const provider = s.route.provider as "fal" | "replicate";
  const out = bodyProblems(provider, s.endpoint, s.body).map((p) => `${s.endpoint} ${p} ${JSON.stringify(s.body)}`);
  if (s.upload) out.push(...bodyProblems("fal", s.upload.endpoint, s.upload.body).map((p) => `${s.upload!.endpoint} ${p}`));
  return out;
}

const fits = (run: Run) => expect(problems(run), JSON.stringify(run)).toEqual([]);

describe("Mureka's song tools: the upload, its answer, and a song sent by its id", () => {
  for (const [modelId, purpose] of [
    ["mureka-extend", "audio"],
    ["mureka-remix", "remix"],
  ] as const) {
    const run: Run = { modelId, prompt: "Warm synth-pop, female vocal", inputs: { audio: SONG }, params: { sourceDuration: 120, extra: { [LYRICS_PARAM]: LYRICS } } };

    it(`${modelId}: a song Mureka didn't make goes through files/upload as {file_url, purpose: "${purpose}"}`, () => {
      const s = sent(run);
      expect(s.upload).toEqual({ endpoint: "mureka/api/files/upload", body: { file_url: SONG, purpose } });
      expect(s.body.upload_audio_id).toBe("mureka-upload-id");
      expect(s.body).not.toHaveProperty("song_id");
      fits(run);
    });

    it(`${modelId}: one of Mureka's own goes by its song_id, with nothing uploaded`, () => {
      const byId: Run = { ...run, params: { ...run.params, extra: { ...run.params!.extra, [SONG_ID_PARAM]: "song_1" } } };
      const s = sent(byId);
      expect(s.upload).toBeUndefined();
      expect(s.body.song_id).toBe("song_1");
      expect(s.body).not.toHaveProperty("upload_audio_id");
      fits(byId);
    });
  }

  it("the upload's documented answer carries the id the tool then takes", () => {
    const answer = documentedAnswer("fal", "mureka/api/files/upload") as { id?: unknown };
    expect(schemaNames("fal", "mureka/api/files/upload").output).toBeTruthy();
    expect(typeof answer.id).toBe("string");
    expect((answer.id as string).length).toBeGreaterThan(0);
  });

  it("a song's documented answer keeps its song_id on the result, for Extend and Remix to send", () => {
    for (const endpoint of ["mureka/v9.5/generate/song", "mureka/v9/generate/song", "mureka/v8/song/extend", "mureka/v8/song/remix"]) {
      const answer = { ...(documentedAnswer("fal", endpoint) as object), song_id: "song_42" };
      const outs = extractOutputs(answer, "music");
      expect(outs.map((o) => [o.kind, o.meta?.songId]), endpoint).toEqual([["audio", "song_42"]]);
    }
  });
});

describe("Clean dialogue on a video in the cloud: each step's body", () => {
  const VIDEO = "/api/files/uploads/2026-11-06/vlog.mp4";

  it("keeps the schemas of every step it sends", () => {
    for (const e of ["fal-ai/workflow-utilities/extract-audio", "fal-ai/deepfilternet3", "fal-ai/ffmpeg-api/merge-audio-video", "veed/clean-audio"]) expect(SCHEMA_INDEX.fal).toContain(e);
  });

  it("DeepFilterNet 3: the soundtrack is extracted as FLAC, cleaned, then put back on the video", () => {
    const plan = planCleanDialogue({ engine: "cloud", media: VIDEO, kind: "video", cleaner: "deepfilternet", seconds: 42 });
    expect(plan.steps.map((s) => [s.request.modelId, s.chain?.map((c) => c.slot)])).toEqual([
      ["extract-soundtrack", undefined],
      ["deepfilternet3", ["audio"]],
      ["merge-audio-video", ["audio"]],
    ]);
    // Each step as the server hands it over: files uploaded, the chained slot filled with the step before's result.
    const filled: Record<string, Inputs> = {
      "extract-soundtrack": { video: CLIP },
      deepfilternet3: { audio: "https://v3b.fal.media/files/out/extracted.flac" },
      "merge-audio-video": { video: CLIP, audio: "https://v3b.fal.media/files/out/clean.flac" },
    };
    const endpoints: string[] = [];
    for (const step of plan.steps) {
      const run: Run = { ...step.request, modelId: step.request.modelId!, inputs: filled[step.request.modelId!] };
      const s = sent(run);
      endpoints.push(s.endpoint);
      fits(run);
      if (s.endpoint === "fal-ai/workflow-utilities/extract-audio") expect(s.body).toEqual({ video_url: CLIP, audio_format: "flac" });
      if (s.endpoint === "fal-ai/ffmpeg-api/merge-audio-video") expect(s.body).toMatchObject({ video_url: CLIP, audio_url: filled["merge-audio-video"].audio });
    }
    expect(endpoints).toEqual(["fal-ai/workflow-utilities/extract-audio", "fal-ai/deepfilternet3", "fal-ai/ffmpeg-api/merge-audio-video"]);
  });

  it("each step's documented answer reads as the file the next step takes", () => {
    expect(extractOutputs(documentedAnswer("fal", "fal-ai/workflow-utilities/extract-audio"), "separate-audio").map((o) => o.kind)).toEqual(["audio"]);
    expect(extractOutputs(documentedAnswer("fal", "fal-ai/deepfilternet3"), "enhance-voice").map((o) => o.kind)).toEqual(["audio"]);
    expect(extractOutputs(documentedAnswer("fal", "fal-ai/ffmpeg-api/merge-audio-video"), "mux").map((o) => o.kind)).toEqual(["video"]);
  });

  it("VEED takes the video itself as its audio_url ('a video's audio track is used'), then the clean voice goes back on it", () => {
    const plan = planCleanDialogue({ engine: "cloud", media: VIDEO, kind: "video", cleaner: "veed", seconds: 42, strength: 0.6 });
    expect(plan.steps.map((s) => s.request.modelId)).toEqual(["veed-clean-audio", "merge-audio-video"]);
    const run: Run = { ...plan.steps[0].request, modelId: "veed-clean-audio", inputs: { video: CLIP } };
    expect(sent(run).body).toEqual({ audio_url: CLIP, output_format: "flac", strength: 0.6 });
    fits(run);
  });

  it("fal's size limits are said before anything is uploaded", () => {
    expect(cleanDialogueProblem({ engine: "cloud", media: VIDEO, kind: "video", cleaner: "deepfilternet", bytes: 100_000_001 })).toMatch(/100 MB/);
    expect(cleanDialogueProblem({ engine: "cloud", media: VIDEO, kind: "video", cleaner: "veed", bytes: 512 * 1024 * 1024 + 1 })).toMatch(/512 MB/);
  });
});

describe("Fuobe Animation's cloud film: every gap the film sends, against Replicate's fast Wan 2.2 schema", () => {
  const anim = getModel("fuobe-animation")!;
  // A user's own Wan 2.2 LoRA for one expert. Replicate takes one LoRA per expert (lora_weights_transformer for high
  // noise, _2 for low noise), by URL.
  const own = (target: "high" | "low"): LoraRef => ({ file: `my-style-${target}.safetensors`, url: `https://huggingface.co/me/style/resolve/main/style-${target}.safetensors`, strength: 0.8, target });

  /** One gap's clip as createKeyframeFilm makes it: start and end frames, as long as the gap's own frames at 16 fps. */
  const gap = (frames: number, extra: Partial<Run> = {}): Run => ({
    modelId: anim.id,
    engine: "cloud",
    op: "flf2v",
    prompt: "a fox leaps. it lands",
    inputs: { images: [IMG], endImage: END },
    params: { aspectRatio: "16:9", resolution: "480p", seed: 42, numOutputs: 1, duration: (frames - 1) / 16 },
    ...extra,
  });

  it("each gap length, 17 to 81 frames in steps of 4, is made as 81 frames with AniSora on the high-noise expert", () => {
    for (let f = MIN_GAP_FRAMES; f <= MAX_GAP_FRAMES; f += GAP_STEP) {
      const s = sent(gap(f));
      expect(s.endpoint, `${f}`).toBe("wan-video/wan-2.2-i2v-fast");
      // Replicate makes 81-121 frames: the film brings the clip down to the gap's own frames (resampleGap).
      expect(s.body.num_frames, `${f}`).toBe(81);
      expect(s.body, `${f}`).toMatchObject({ frames_per_second: 16, interpolate_output: false, last_image: END });
      expect(s.body.lora_weights_transformer, `${f}`).toMatch(/AniSora/);
      expect(s.body.lora_weights_transformer_2, `${f}`).toBeUndefined();
      fits(gap(f));
    }
  });

  it("a user's low-noise LoRA goes beside AniSora; a high-noise one can't (AniSora holds that expert)", () => {
    const low = sent(gap(41, { loras: [own("low")] }));
    expect(low.body.lora_weights_transformer).toMatch(/AniSora/);
    expect(low.body.lora_weights_transformer_2).toBe(own("low").url);
    fits(gap(41, { loras: [own("low")] }));
    const high = sent(gap(41, { loras: [own("high")] }));
    expect(high.body.lora_weights_transformer).toMatch(/AniSora/);
    expect(high.body.lora_weights_transformer_2).toBeUndefined();
    fits(gap(41, { loras: [own("high")] }));
  });

  it("every shape and size the studio offers the film fits", () => {
    for (const aspectRatio of anim.options.aspectRatios ?? []) fits(gap(33, { params: { ...gap(33).params, aspectRatio } }));
    for (const resolution of anim.options.resolutions ?? []) fits(gap(33, { params: { ...gap(33).params, resolution } }));
    fits(gap(33, { params: { ...gap(33).params, seed: 2 ** 31 + 5 } }));
  });
});

describe("Songs: lyrics, instrumentals and the API's limits", () => {
  it("Mureka 9.5 and 9 sing your lyrics with a style of up to 1,024 characters", () => {
    for (const modelId of ["mureka-song", "mureka-9"]) {
      const run: Run = { modelId, prompt: "x".repeat(1024), params: { extra: { [LYRICS_PARAM]: LYRICS } } };
      expect(sent(run).body.lyrics, modelId).toBe(LYRICS);
      fits(run);
      // Without lyrics the description is the whole song's, up to 2,000.
      fits({ modelId, prompt: "x".repeat(2000) });
    }
  });

  it("the instrumentals take their 1,024-character description", () => {
    for (const modelId of ["mureka-9-5-instrumental", "mureka-9-instrumental"]) fits({ modelId, prompt: "x".repeat(1024) });
  });

  it("MiniMax Music 3 sings the user's lyrics, and sends [instrumental] when there are none", () => {
    const sung: Run = { modelId: "minimax-music-3", prompt: PROMPT, params: { extra: { [LYRICS_PARAM]: LYRICS } } };
    expect(sent(sung).body.lyrics).toBe(LYRICS);
    fits(sung);
    expect(sent({ modelId: "minimax-music-3", prompt: PROMPT }).body.lyrics).toBe("[instrumental]");
  });

  it("Lyria 3.5 reads the lyrics after the prompt, within its 5,000 characters, and takes a picture", () => {
    const run: Run = { modelId: "lyria-3-5", prompt: "Glossy synth-pop", inputs: { images: [IMG] }, params: { extra: { [LYRICS_PARAM]: LYRICS } } };
    const s = sent(run);
    expect(String(s.body.prompt)).toContain("Walk it, own it");
    expect(s.body.image_url).toBe(IMG);
    fits(run);
    fits({ modelId: "lyria-3-5", prompt: "x".repeat(5000) });
  });

  it("an API caller's length is kept inside the API's own limits (whole seconds or ms where the schema says integer)", () => {
    for (const duration of [1, 90.5, 151.4, 300, 900]) {
      fits({ modelId: "mureka-song", prompt: PROMPT, params: { duration } });
      fits({ modelId: "minimax-music-3", prompt: PROMPT, params: { duration } });
      fits({ modelId: "elevenlabs-music-2-5", prompt: PROMPT, params: { duration } });
    }
  });

  it("Extend starts where the song ends, in whole milliseconds, wherever that is", () => {
    for (const sourceDuration of [61.3457, 120, 299.9999]) {
      const run: Run = { modelId: "mureka-extend", inputs: { audio: SONG }, params: { sourceDuration, extra: { [LYRICS_PARAM]: LYRICS } } };
      expect(Number.isInteger(sent(run).body.extend_at), `${sourceDuration}`).toBe(true);
      fits(run);
    }
  });
});

describe("Pictures, clips and voices at the catalog's own maximums", () => {
  it("references: each list at its maximum, and as many as the 12-file total allows", () => {
    for (const modelId of ["minimax-h3-max-turbo-refs", "vidu-q4", "minimax-h3-lite", "minimax-h3-highspeed"]) {
      const o = getModel(modelId)!.options;
      const base: Run = { modelId, op: "ref2v", prompt: PROMPT, inputs: {} };
      fits({ ...base, inputs: { images: refs("png", o.maxImages ?? 1) } });
      if (o.maxVideos) fits({ ...base, inputs: { images: [IMG], videos: refs("mp4", o.maxVideos) } });
      if (o.maxAudios) fits({ ...base, inputs: { images: [IMG], audios: refs("mp3", o.maxAudios) } });
      if (o.maxReferences) {
        const images = o.maxReferences - (o.maxVideos ?? 0) - (o.maxAudios ?? 0);
        fits({ ...base, inputs: { images: refs("png", images), videos: refs("mp4", o.maxVideos ?? 0), audios: refs("mp3", o.maxAudios ?? 0) } });
        // One more is refused before it is sent.
        expect(() => sent({ ...base, inputs: { images: refs("png", images + 1), videos: refs("mp4", o.maxVideos ?? 0), audios: refs("mp3", o.maxAudios ?? 0) } }), modelId).toThrow(/up to 12 references in all/);
      }
    }
  });

  it("Insert a moment takes its 9 pictures and 3 clips beside the clip it goes into", () => {
    const run: Run = {
      modelId: "minimax-h3-max-insert",
      prompt: PROMPT,
      inputs: { video: CLIP, images: refs("png", 9), videos: refs("mp4", 3) },
      params: { sourceDuration: 8, sourceSize: { width: 1280, height: 720 }, startTime: 2, endTime: 5 },
    };
    const s = sent(run);
    expect([(s.body.reference_image_urls as string[]).length, (s.body.reference_video_urls as string[]).length]).toEqual([9, 3]);
    fits(run);
  });

  it("Turbo extend takes up to three voices beside the clip", () => {
    for (const n of [1, 2, 3]) fits({ modelId: "minimax-h3-max-turbo-extend", prompt: PROMPT, inputs: { video: CLIP, audios: refs("mp3", n) }, params: { sourceDuration: 8, sourceSize: { width: 1280, height: 720 } } });
  });
});

describe("Values at the edges: the longest prompt, the largest seeds, lengths outside the lists", () => {
  it("the longest prompt each route takes fits its schema", () => {
    for (const [modelId, op, inputs] of [
      ["vidu-q4", "i2v", { images: [IMG] }],
      ["vidu-q4", "ref2v", { images: [IMG] }],
      ["meshy-7-retexture", "retexture-3d", { model3d: "https://v3b.fal.media/files/in/model.glb" }],
      ["meshy-6-retexture", "retexture-3d", { model3d: "https://v3b.fal.media/files/in/model.glb" }],
      ["mureka-remix", "song-remix", { audio: SONG }],
    ] as [string, GenerationRequest["op"], Inputs][]) {
      const route = getModel(modelId)!.routes.find((r) => r.op === op)!;
      const max = route.map!.promptMax!;
      expect(max, modelId).toBeGreaterThan(0);
      fits({ modelId, op, prompt: "y".repeat(max), inputs, params: { sourceDuration: 120, extra: { [LYRICS_PARAM]: LYRICS } } });
    }
  });

  it("seeds past a schema's top are folded into it, on every route whose schema bounds the seed", () => {
    const runs: Run[] = [
      { modelId: "minimax-h3-max-lipsync", inputs: { images: [IMG], audio: VOICE }, params: { sourceDuration: 12 } },
      { modelId: "minimax-h3-max-insert", prompt: PROMPT, inputs: { video: CLIP }, params: { sourceDuration: 8, sourceSize: { width: 1280, height: 720 }, startTime: 2, endTime: 5 } },
      { modelId: "minimax-h3-max-turbo", prompt: PROMPT },
      { modelId: "minimax-h3-max-turbo-refs", op: "ref2v", prompt: PROMPT, inputs: { images: [IMG] } },
      { modelId: "minimax-h3-max-look-vhs", prompt: PROMPT },
    ];
    for (const run of runs) for (const seed of [0, 2 ** 31 - 1, 2 ** 31, 2 ** 32 + 7, 999_999_999_999]) fits({ ...run, params: { ...run.params, seed } });
  });

  it("a length outside the composer's list (an API caller, Assist) goes as one the route takes", () => {
    for (const [modelId, inputs] of [
      ["vidu-q4", { images: [IMG] }],
      ["minimax-h3-max-turbo", {}],
      ["minimax-h3-max-turbo", { images: [IMG] }],
      ["minimax-h3-lite", {}],
    ] as [string, Inputs][]) {
      for (const duration of [4.5, 7, 9.25, 14.9]) fits({ modelId, prompt: PROMPT, inputs, params: { duration } });
    }
  });

  it("Cinema's lengths for Turbo, 1 to 15 s, fit its schema", () => {
    for (const duration of [1, 2, 7, 9, 11, 14, 15]) fits({ modelId: "minimax-h3-max-turbo", prompt: PROMPT, params: { duration } });
  });

  it("settings together, not only one at a time: every shape with every size and length", () => {
    for (const modelId of ["minimax-h3-max-turbo", "minimax-h3-lite", "kandinsky-6"]) {
      const o = getModel(modelId)!.options;
      for (const aspectRatio of o.aspectRatios ?? [undefined])
        for (const resolution of o.resolutions ?? [undefined])
          for (const duration of o.durations ?? [undefined]) fits({ modelId, prompt: PROMPT, params: { aspectRatio, resolution, duration } });
    }
  });
});
