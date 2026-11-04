/**
 * Full songs in the cloud: MiniMax Music 3 (the open model, hosted on fal), Mureka 9 / 9.5 songs and instrumentals,
 * ElevenLabs Music v2.5 and Lyria 3.5, and Mureka's song tools (extend, remix, stems): payloads built from the research
 * records, prices as fal's pages state them (2026-11-01), lyrics in each model's own form.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { buildPayload, extractOutputs } from "@/lib/catalog/payload";
import { estimateCost, planGeneration } from "@/lib/catalog/plan";
import type { GenerationRequest, ModelRoute, Operation } from "@/lib/catalog/types";
import { nextSteps, outputActions } from "@/lib/output-actions";
import { downloadName } from "@/lib/library";
import { songFormat, songToolProblem } from "@/lib/lyrics";
import { migrateRequest } from "@/lib/catalog/replaced";
import type { Generation } from "@/lib/catalog/types";

const route = (id: string, op?: Operation): ModelRoute => {
  const r = getModel(id)?.routes.find((x) => !op || x.op === op);
  if (!r?.map) throw new Error(`${id} has no ${op ?? ""} route`);
  return r;
};
const payload = (id: string, input: Record<string, unknown>) => buildPayload(route(id).map!, { prompt: "", ...input } as never);
const plan = (req: Omit<GenerationRequest, "feature">) => planGeneration({ feature: "audio", ...req }, getModel, getPreset);
const planError = (req: Omit<GenerationRequest, "feature">) => {
  try {
    plan(req);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const cost = (id: string, params: Record<string, unknown> = {}, op: Operation = "music") => estimateCost(getModel(id)!, params, 1, op);

const research = JSON.parse(fs.readFileSync("docs/research/new-models-10.json", "utf8")) as { endpointRecords: { endpoint: string; inputs: Record<string, { required?: boolean }>; license?: string; status: string }[] };
const record = (ep: string) => research.endpointRecords.find((e) => e.endpoint === ep)!;

describe("the research records", () => {
  it("hold every endpoint the cloud models call, read from fal on 11-01, with each one's licence or terms", () => {
    for (const ep of ["minimax/music-3", "mureka/v9.5/generate/song", "mureka/v9/generate/song", "mureka/v9/generate/instrumental", "mureka/v8/song/extend", "mureka/v8/song/remix", "mureka/api/song/stem", "mureka/api/files/upload", "elevenlabs/music/v2.5", "google/lyria-3.5"]) {
      const r = record(ep);
      expect(r, ep).toBeTruthy();
      expect(r.status, ep).toBe("active");
      expect(r.license, ep).toBeTruthy();
    }
    // MiniMax Music 3's own licence and the Comfy-Org repack's tag are both on record.
    expect(record("minimax/music-3").license).toMatch(/MiniMax-Music3 Community License.*Apache-2\.0/s);
  });
});

describe("MiniMax Music 3 on fal (minimax-music-3)", () => {
  it("is the open model's cloud line, with its licence as information", () => {
    const m = getModel("minimax-music-3")!;
    expect(m.name).toBe("MiniMax Music 3 · both engines");
    expect(m.engine).toBe("cloud");
    expect(m.licence?.licence).toBe("MiniMax-Music3 Community License");
    expect(m.options.durations).toContain(300);
    expect(getModel("oss-minimax-music-3")?.engine).toBe("open");
  });

  it("sends the style, the lyrics with their tags on lines of their own, the length and the seed", () => {
    expect(payload("minimax-music-3", { prompt: "Acoustic pop, 96 BPM", duration: 180, seed: 7, extra: { lyrics: "[verse] Morning light\n[chorus]\nsing" } })).toEqual({
      prompt: "Acoustic pop, 96 BPM",
      lyrics: "[Verse]\nMorning light\n\n[Chorus]\nsing",
      duration: 180,
      seed: 7,
    });
    // Its lyrics are required: a run with none asks for an instrumental (so the lyrics stay optional in Fuobe).
    expect(payload("minimax-music-3", { prompt: "Lo-fi" })).toEqual({ prompt: "Lo-fi", lyrics: "[instrumental]" });
    expect(getModel("minimax-music-3")!.options.lyrics?.required).toBeUndefined();
    expect(plan({ modelId: "minimax-music-3", prompt: "Lo-fi" }).op).toBe("music");
  });

  it("costs $0.002 a second of the length asked for", () => {
    expect(cost("minimax-music-3", { duration: 300 })).toBe(0.6);
    expect(cost("minimax-music-3")).toBe(0.24);
  });
});

describe("Mureka 9 / 9.5", () => {
  it("Mureka 9.5 runs on its own route: lyrics, a length of 2 to 5 minutes, no Version", () => {
    expect(route("mureka-song").endpoint).toBe("mureka/v9.5/generate/song");
    expect(payload("mureka-song", { prompt: "Synth pop", duration: 240, extra: { lyrics: "[Verse]\nhi", model: "mureka-8" } })).toEqual({ prompt: "Synth pop", lyrics: "[Verse]\nhi", duration: 240 });
    expect(getModel("mureka-song")!.options.durations).toEqual([120, 180, 240, 300]);
  });

  it("prices a song by whether it brings its lyrics", () => {
    expect(cost("mureka-song")).toBe(0.5);
    expect(cost("mureka-song", { extra: { lyrics: "[Verse]\nhello" } })).toBe(0.15);
    expect(cost("mureka-9")).toBe(0.3);
    expect(cost("mureka-9", { extra: { lyrics: "[Verse]\nhello" } })).toBe(0.045);
    expect(cost("mureka-9-instrumental")).toBe(0.045);
    expect(route("mureka-9").endpoint).toBe("mureka/v9/generate/song");
    expect(payload("mureka-9-instrumental", { prompt: "Calm piano bed", extra: { lyrics: "[Verse]\nx" } })).toEqual({ prompt: "Calm piano bed" });
  });

  it("keeps the song's id on the result, for its song tools", () => {
    const out = extractOutputs({ audio: { url: "https://v3.fal.media/x.mp3", content_type: "audio/mpeg" }, song_id: "song_123", duration: 180000 }, "music");
    expect(out).toHaveLength(1);
    expect(out[0].meta).toMatchObject({ songId: "song_123" });
  });
});

describe("Mureka's versions", () => {
  it("Mureka 9.5 Instrumental: a description, $0.15 a track", () => {
    expect(payload("mureka-9-5-instrumental", { prompt: "Warm lo-fi bed" })).toEqual({ prompt: "Warm lo-fi bed" });
    expect(cost("mureka-9-5-instrumental")).toBe(0.15);
  });

  it("Mureka 8, O2 and 7.6 stay on the versioned route, the Version always sent", () => {
    expect(route("mureka-8").endpoint).toBe("mureka/api/generate/song");
    expect(payload("mureka-8", { prompt: "pop" })).toEqual({ prompt: "pop", model: "mureka-8" });
    expect(payload("mureka-8", { prompt: "pop", duration: 180, extra: { model: "mureka-7.6", lyrics: "[Verse]\nla" } })).toEqual({ prompt: "pop", model: "mureka-7.6", lyrics: "[Verse]\nla" });
    expect(cost("mureka-8")).toBe(0.3);
    expect(cost("mureka-8", { extra: { lyrics: "[Verse]\nla" } })).toBe(0.045);
  });

  it("a song saved with its Version runs that version again", () => {
    const saved = (model: string) => migrateRequest({ modelId: "mureka-song", prompt: "pop", params: { duration: 180, extra: { model, seed: 3 } } });
    expect(saved("mureka-9")).toEqual({ request: { modelId: "mureka-9", prompt: "pop", params: { duration: 180, extra: { seed: 3 } } } });
    expect(saved("mureka-9.5")).toEqual({ request: { modelId: "mureka-song", prompt: "pop", params: { duration: 180, extra: { seed: 3 } } } });
    expect(saved("mureka-7.6").request).toMatchObject({ modelId: "mureka-8", params: { extra: { model: "mureka-7.6" } } });
    expect(saved("mureka-o2").request.modelId).toBe("mureka-8");
    expect(migrateRequest({ modelId: "mureka-song", params: { extra: { model: "mureka-9" } } }).request).toEqual({ modelId: "mureka-9", params: {} });
    // Today's runs are left as they are.
    const now = { modelId: "mureka-song", prompt: "pop" };
    expect(migrateRequest(now).request).toBe(now);
  });

  it("a Mureka song sings words: an instrumental is its instrumental model", () => {
    expect(planError({ modelId: "mureka-song", prompt: "pop", params: { extra: { lyrics: "[Instrumental]" } } })).toBe("Mureka 9.5 sings the lyrics you write: for an instrumental, pick Mureka 9.5 Instrumental");
    expect(planError({ modelId: "mureka-9", prompt: "pop", params: { extra: { lyrics: "[Instrumental]" } } })).toBe("Mureka 9 sings the lyrics you write: for an instrumental, pick Mureka 9 Instrumental");
    expect(getModel("mureka-song")!.options.lyrics).toEqual({ max: 5000, instrumentalModel: "mureka-9-5-instrumental" });
  });

  it("MiniMax Music 2.5 makes an instrumental by its own switch, with no words written for it", () => {
    expect(payload("minimax-music-2-5", { prompt: "lo-fi", extra: { lyrics: "[Instrumental]" } })).toEqual({ prompt: "lo-fi", is_instrumental: true, lyrics_optimizer: false });
    expect(payload("minimax-music-2-5", { prompt: "lo-fi", extra: { lyrics: "[Verse]\nla" } })).toEqual({ prompt: "lo-fi", lyrics: "[Verse]\nla", lyrics_optimizer: true });
  });
});

describe("ElevenLabs Music v2.5 and Lyria 3.5", () => {
  it("ElevenLabs takes a length in milliseconds and bills each started minute", () => {
    expect(payload("elevenlabs-music-2-5", { prompt: "Synthwave", duration: 90, seed: 3 })).toEqual({ prompt: "Synthwave", music_length_ms: 90000 });
    expect(cost("elevenlabs-music-2-5", { duration: 30 })).toBe(0.6);
    expect(cost("elevenlabs-music-2-5", { duration: 90 })).toBe(1.2);
    expect(getModel("elevenlabs-music-2-5")!.options.lyrics).toBeUndefined();
  });

  it("Lyria 3.5 counts the description and the lyrics together against its 5,000 characters", () => {
    const lyrics = `[Verse]\n${"la la la la\n".repeat(380)}`.trim();
    expect(plan({ modelId: "lyria-3-5", prompt: "x".repeat(200), params: { extra: { lyrics } } }).op).toBe("music");
    expect(planError({ modelId: "lyria-3-5", prompt: "x".repeat(510), params: { extra: { lyrics } } })).toMatch(/^Lyria 3\.5 reads up to 5,000 characters of description and lyrics together: these are 5,\d{3}\. Shorten them or drop a verse$/);
  });

  it("Lyria 3.5 reads the lyrics after the description, takes a picture, and has no negative prompt", () => {
    expect(payload("lyria-3-5", { prompt: "Uplifting pop, 120 BPM", images: ["https://x/p.png"], extra: { lyrics: "[chorus] rise up" } })).toEqual({
      prompt: "Uplifting pop, 120 BPM.\n\nLyrics:\n[Chorus]\nrise up",
      image_url: "https://x/p.png",
    });
    expect(getModel("lyria-3-5")!.options.negativePrompt).toBeUndefined();
    expect(cost("lyria-3-5")).toBe(0.1);
  });
});

describe("Mureka's song tools", () => {
  it("extend: one of Mureka's own songs by its id, the new part's lyrics, where it starts in whole milliseconds", () => {
    const sent = payload("mureka-extend", { audio: "https://x/song.mp3", startTime: 183.4567, extra: { lyrics: "[verse] more", songId: "song_9", extend_type: "tail" } });
    expect(sent).toEqual({ song_id: "song_9", lyrics: "[Verse]\nmore", extend_at: 183457, extend_type: "tail" });
    // Any other song: no id here, the fal provider sends it first through Mureka's files/upload (purpose "audio").
    const other = payload("mureka-extend", { audio: "https://x/song.mp3", startTime: 10, extra: { lyrics: "[Verse]\nmore" } });
    expect(other).toEqual({ lyrics: "[Verse]\nmore", extend_at: 10000 });
    expect(route("mureka-extend").map!.songSource).toEqual({ songId: "song_id", uploadId: "upload_audio_id", upload: { endpoint: "mureka/api/files/upload", purpose: "audio" } });
    expect(route("mureka-remix").map!.songSource?.upload.purpose).toBe("remix");
  });

  it("prices the upload a song that isn't Mureka's needs", () => {
    expect(cost("mureka-extend", { extra: { songId: "song_9" } }, "song-extend")).toBe(0.004);
    expect(cost("mureka-extend", {}, "song-extend")).toBe(0.014);
    expect(cost("mureka-remix", {}, "song-remix")).toBe(0.21);
    expect(cost("mureka-stems", {}, "song-stems")).toBe(0.2);
  });

  it("remix takes a style and the whole song's lyrics; stems take the song's address", () => {
    expect(payload("mureka-remix", { prompt: "Jazz trio", extra: { lyrics: "[Verse]\nla", songId: "s1" } })).toEqual({ prompt: "Jazz trio", lyrics: "[Verse]\nla", song_id: "s1" });
    expect(payload("mureka-stems", { audio: "https://x/song.mp3" })).toEqual({ audio_url: "https://x/song.mp3" });
  });

  it("plans each tool with what it needs, in plain words", () => {
    const song = { audio: "/api/files/song.mp3" };
    expect(planError({ modelId: "mureka-extend", inputs: song })).toBe("Write the lyrics of the new part");
    expect(planError({ modelId: "mureka-extend", inputs: {}, params: { extra: { lyrics: "[Verse]\nx" } } })).toBe("Add the song to extend");
    expect(planError({ modelId: "mureka-remix", inputs: song, params: { extra: { lyrics: "[Verse]\nx" } } })).toBe("Describe the remix: its genre, mood and instruments");
    expect(planError({ modelId: "mureka-remix", prompt: "jazz", inputs: song })).toMatch(/^Write the remix's lyrics/);
    expect(plan({ modelId: "mureka-stems", inputs: song }).op).toBe("song-stems");
    expect(plan({ modelId: "mureka-extend", inputs: song, params: { extra: { lyrics: "[verse] x" } } }).params.extra).toEqual({ lyrics: "[Verse]\nx" });
  });
});

describe("lyrics in the plan", () => {
  it("normalizes them for a model that sings, refuses ones too long, and leaves them out for one that doesn't", () => {
    expect(plan({ modelId: "minimax-music-3", prompt: "pop", params: { extra: { lyrics: "[verse] a" } } }).params.extra).toEqual({ lyrics: "[Verse]\na" });
    expect(planError({ modelId: "mureka-extend", inputs: { audio: "/api/files/s.mp3" }, params: { extra: { lyrics: `[Verse]\n${"la ".repeat(1100)}` } } })).toMatch(/^Mureka Extend sings up to 3,000 characters/);
    const sonilo = plan({ modelId: "sonilo-music", prompt: "beat", params: { duration: 30, extra: { lyrics: "[Verse]\nwords" } } });
    expect(sonilo.params.extra).toBeUndefined();
    expect(sonilo.notes?.[0]).toMatch(/writes its own words/);
    // An instrumental bed (Faceless) on a model that doesn't sing: quietly left out.
    expect(plan({ modelId: "sonilo-music", prompt: "beat", params: { duration: 30, extra: { lyrics: "[Instrumental]" } } }).notes).toBeUndefined();
  });

  it("YuE2 sings lyrics only, and covers a song; other models refuse a song to cover", () => {
    expect(planError({ modelId: "oss-yue2", prompt: "pop" })).toMatch(/^YuE2 sings your lyrics/);
    expect(planError({ modelId: "oss-yue2", prompt: "pop", params: { extra: { lyrics: "[Instrumental]" } } })).toMatch(/^YuE2 sings your lyrics/);
    expect(plan({ modelId: "oss-yue2", prompt: "pop", inputs: { audio: "/api/files/s.mp3" }, params: { extra: { lyrics: "[Verse]\nla" } } }).op).toBe("music");
    expect(planError({ modelId: "oss-minimax-music-3", prompt: "pop", inputs: { audio: "/api/files/s.mp3" } })).toBe("MiniMax Music 3 makes a new song: remove the song you added, or pick YuE2 to cover it");
  });
});

describe("a music result's song tools", () => {
  const gen = (o: Partial<Generation> = {}, meta: Record<string, unknown> = {}): Generation =>
    ({ id: "g1", status: "succeeded", op: "music", feature: "audio", modelId: "mureka-song", request: { feature: "audio", modelId: "mureka-song" }, outputs: [{ url: "/api/files/song.mp3", kind: "audio", meta }], createdAt: 0, ...o }) as unknown as Generation;
  const ids = (g: Generation, engineMode?: "both" | "open" | "cloud") => outputActions(g, 0, { engineMode }).filter((a) => ["extend-song", "remix-song", "song-stems"].includes(a.id));

  it("Extend song, Remix and Stems open Extend & remix with the song (and Mureka's id for its own)", () => {
    const acts = ids(gen({}, { songId: "song_1" }));
    expect(acts.map((a) => a.label)).toEqual(["Extend song", "Remix", "Stems"]);
    expect(acts[0].href).toBe("/audio/song?model=mureka-extend&audio=%2Fapi%2Ffiles%2Fsong.mp3&song=song_1");
    expect(acts[2].href).toBe("/audio/song?model=mureka-stems&audio=%2Fapi%2Ffiles%2Fsong.mp3");
    // Any song made in Fuobe (a song from your GPU too): sent to Mureka first, with its lyrics for the remix.
    const sung = gen({ modelId: "oss-minimax-music-3", request: { feature: "audio", modelId: "oss-minimax-music-3", params: { extra: { lyrics: "[Verse]\nla la" } } } });
    expect(ids(sung)[1].href).toBe("/audio/song?model=mureka-remix&audio=%2Fapi%2Ffiles%2Fsong.mp3&lyrics=%5BVerse%5D%0Ala%20la");
  });

  it("Remix only on a song with vocals; Stems only on an MP3 or M4A song", () => {
    const labels = (g: Generation) => ids(g).map((a) => a.label);
    // Instrumentals: Mureka's instrumental model, lyrics that are only [Instrumental], a model's own with no words.
    expect(labels(gen({ modelId: "mureka-9-instrumental" }))).toEqual(["Extend song", "Stems"]);
    expect(labels(gen({ modelId: "mureka-9-5-instrumental" }))).toEqual(["Extend song", "Stems"]);
    expect(labels(gen({ request: { feature: "audio", modelId: "mureka-song", params: { extra: { lyrics: "[Instrumental]" } } } }))).toEqual(["Extend song", "Stems"]);
    expect(labels(gen({ modelId: "minimax-music-3" }))).toEqual(["Extend song", "Stems"]);
    expect(labels(gen({ modelId: "oss-ace-step" }))).toEqual(["Extend song", "Stems"]);
    // A song Mureka writes words for from a description keeps Remix.
    expect(labels(gen())).toEqual(["Extend song", "Remix", "Stems"]);
    // An extension: its run's lyrics are the new part's only, so Remix stays and carries none.
    const extended = gen({ op: "song-extend", modelId: "mureka-extend", request: { feature: "song-tools", modelId: "mureka-extend", params: { extra: { lyrics: "[Instrumental]" } } } });
    expect(ids(extended).find((a) => a.id === "remix-song")!.href).toBe("/audio/song?model=mureka-remix&audio=%2Fapi%2Ffiles%2Fsong.mp3");
    // A WAV song (fal's MiniMax Music 3 answers with one): no Stems.
    const wav = { ...gen({ request: { feature: "audio", modelId: "minimax-music-3", params: { extra: { lyrics: "[Verse]\nla" } } } }), outputs: [{ url: "/api/files/song.wav", kind: "audio", contentType: "audio/wav" }] } as unknown as Generation;
    expect(labels(wav)).toEqual(["Extend song", "Remix"]);
    expect(nextSteps(wav, 0).map((a) => a.label)).toEqual(["Extend song", "Remix", "Split soundtrack"]);
  });

  it("says in plain words which songs the tools take", () => {
    expect(songFormat("audio/mpeg", "x")).toBe("mp3");
    expect(songFormat(undefined, "/api/files/a/song.M4A?x=1")).toBe("m4a");
    expect(songFormat(undefined, "/api/files/abc")).toBeUndefined();
    expect(songToolProblem("song-stems", { format: "flac" })).toBe("Stems take an MP3 or M4A song: this one is a FLAC file. Save it as an MP3 and add it again");
    expect(songToolProblem("song-stems", { format: "mp3", bytes: 9_000_000 })).toBeNull();
    expect(songToolProblem("song-remix", { seconds: 351 })).toBe("Remix takes a song of 0:10 to 5:50: this one is 5:51");
    expect(songToolProblem("song-remix", { seconds: 120, format: "wav" })).toBeNull();
    expect(songToolProblem("song-extend", { seconds: 900, format: "wav" })).toBeNull();
    // The remix of an instrumental is refused in the plan.
    expect(planError({ modelId: "mureka-remix", prompt: "jazz", inputs: { audio: "/api/files/s.mp3" }, params: { extra: { lyrics: "[Instrumental]" } } })).toMatch(/^Write the remix's lyrics.*not instrumentals\)$/);
  });

  it("names a stem's card and download for its track", () => {
    const g = { ...gen({ op: "song-stems" }), outputs: [{ url: "/api/files/a.mp3", kind: "audio", meta: { stem: "vocals" } }, { url: "/api/files/b.mp3", kind: "audio", meta: { stem: "bass guitar" } }] } as unknown as Generation;
    expect(downloadName(g, g.outputs[0], 0)).toMatch(/-g1-vocals\.mp3$/);
    expect(downloadName(g, g.outputs[1], 1)).toMatch(/-g1-bass-guitar\.mp3$/);
  });

  it("are a song's next steps", () => {
    expect(nextSteps(gen(), 0).map((a) => a.label)).toEqual(["Extend song", "Remix", "Stems"]);
    expect(nextSteps(gen(), 0, 3, { engineMode: "open" }).map((a) => a.id)).toEqual(["lipsync", "voice-change", "split-soundtrack"]);
  });

  it("not on sound effects or speech, nor on an install that runs open models only", () => {
    expect(ids(gen({ op: "sfx" }))).toEqual([]);
    expect(ids(gen({ op: "tts" }))).toEqual([]);
    expect(ids(gen(), "open")).toEqual([]);
    expect(ids(gen({ op: "song-remix" }))).toHaveLength(3);
  });
});
