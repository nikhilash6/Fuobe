/**
 * The music routes' limits as fal's own OpenAPI schemas state them (queue openapi.json?endpoint_id=…, read 2026-11-06), and
 * Mureka's files/upload rules from its own API reference (platform.mureka.ai, POST /v1/files/upload): a request outside them
 * is refused in Fuobe's words before it is paid for, or an API caller's length is kept inside them.
 */
import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { buildPayload } from "@/lib/catalog/payload";
import { planGeneration } from "@/lib/catalog/plan";
import type { Generation, GenerationRequest, ModelRoute } from "@/lib/catalog/types";
import { songToolProblem } from "@/lib/lyrics";
import { outputActions } from "@/lib/output-actions";

const route = (id: string): ModelRoute => getModel(id)!.routes[0];
const payload = (id: string, input: Record<string, unknown>) => buildPayload(route(id).map!, { prompt: "", ...input } as never);
const planError = (req: Omit<GenerationRequest, "feature">) => {
  try {
    planGeneration({ feature: "audio", ...req }, getModel, getPreset);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const words = (n: number) => "Glossy synth-pop, confident vocal, punchy drums. ".repeat(Math.ceil(n / 49)).slice(0, n - 1) + "x";
const LYRICS = "[Verse]\nNeon light on the runway tonight\n\n[Chorus]\nWalk it, own it";

describe("the prompt limits in fal's schemas", () => {
  it("refuses a prompt longer than the endpoint takes, before it is sent", () => {
    // maxLength: Mureka's songs 2,000, its instrumentals and Remix 1,024, ElevenLabs Music v2.5 4,100, Lyria 3.5 5,000.
    expect(planError({ modelId: "mureka-song", prompt: words(2000) })).toBeNull();
    expect(planError({ modelId: "mureka-song", prompt: words(2001) })).toBe("Mureka 9.5 takes up to 2,000 characters of prompt, and this one has 2,001: shorten it");
    expect(planError({ modelId: "mureka-9", prompt: words(2001) })).toMatch(/^Mureka 9 takes up to 2,000 characters/);
    expect(planError({ modelId: "mureka-9-5-instrumental", prompt: words(1024) })).toBeNull();
    expect(planError({ modelId: "mureka-9-5-instrumental", prompt: words(1025) })).toMatch(/^Mureka 9.5 Instrumental takes up to 1,024 characters/);
    expect(planError({ modelId: "mureka-9-instrumental", prompt: words(1025) })).toMatch(/^Mureka 9 Instrumental takes up to 1,024 characters/);
    expect(planError({ modelId: "elevenlabs-music-2-5", prompt: words(4101) })).toMatch(/^ElevenLabs Music v2.5 takes up to 4,100 characters/);
    expect(planError({ modelId: "lyria-3-5", prompt: words(5001) })).toMatch(/^Lyria 3.5 takes up to 5,000 characters/);
    const remix = { modelId: "mureka-remix", inputs: { audio: "/api/files/s.mp3" }, params: { extra: { lyrics: LYRICS } } };
    expect(planError({ ...remix, prompt: words(1024) })).toBeNull();
    expect(planError({ ...remix, prompt: words(1025) })).toMatch(/^Mureka Remix takes up to 1,024 characters/);
  });

  it("with lyrics, a Mureka song reads 1,024 characters of description (its schema: 'With lyrics, it … supports up to 1,024')", () => {
    expect(getModel("mureka-song")!.options.lyrics?.promptMax).toBe(1024);
    expect(getModel("mureka-9")!.options.lyrics?.promptMax).toBe(1024);
    const sung = (modelId: string, n: number) => planError({ modelId, prompt: words(n), params: { extra: { lyrics: LYRICS } } });
    expect(sung("mureka-song", 1024)).toBeNull();
    expect(sung("mureka-song", 1025)).toBe("With lyrics, Mureka 9.5 takes a style of up to 1,024 characters, and this one has 1,025: shorten it");
    expect(sung("mureka-9", 1500)).toMatch(/^With lyrics, Mureka 9 takes a style of up to 1,024 characters/);
    // Without lyrics the description is the whole song's: up to 2,000.
    expect(planError({ modelId: "mureka-song", prompt: words(1500) })).toBeNull();
  });
});

describe("the length limits in fal's schemas", () => {
  it("keeps an API caller's length inside them (Mureka 9.5 whole seconds 120-300, MiniMax Music 3 up to 300, ElevenLabs v2.5 3-600 s)", () => {
    expect(payload("mureka-song", { duration: 100 }).duration).toBe(120);
    expect(payload("mureka-song", { duration: 150.5 }).duration).toBe(151);
    expect(payload("mureka-song", { duration: 240 }).duration).toBe(240);
    expect(payload("minimax-music-3", { duration: 301 }).duration).toBe(300);
    expect(payload("minimax-music-3", { duration: 47 }).duration).toBe(47);
    expect(payload("elevenlabs-music-2-5", { duration: 2 }).music_length_ms).toBe(3000);
    expect(payload("elevenlabs-music-2-5", { duration: 47.25 }).music_length_ms).toBe(47250);
    expect(payload("elevenlabs-music-2-5", { duration: 900 }).music_length_ms).toBe(600000);
  });
});

describe("a song Mureka's files/upload takes (Extend and Remix of a song it didn't make)", () => {
  it("is an MP3 or M4A, and for Extend 10 MB at most; one of Mureka's own goes by its id and is never uploaded", () => {
    expect(songToolProblem("song-extend", { format: "wav", seconds: 60 }, false)).toBe("Extend takes an MP3 or M4A song: this one is a WAV file. Save it as an MP3 and add it again");
    expect(songToolProblem("song-remix", { format: "flac", seconds: 60 }, false)).toBe("Remix takes an MP3 or M4A song: this one is a FLAC file. Save it as an MP3 and add it again");
    expect(songToolProblem("song-extend", { format: "mp3", bytes: 10_500_000 }, false)).toBe("Extend takes a song of up to 10 MB: this one is 10.5 MB. Save it as a smaller MP3 and add it again");
    expect(songToolProblem("song-extend", { format: "m4a", bytes: 9_000_000 }, false)).toBeNull();
    expect(songToolProblem("song-remix", { format: "mp3", bytes: 12_000_000, seconds: 300 }, false)).toBeNull();
    // A caller that doesn't say how the song goes (the server before it passes songById) is not held to the upload's rules.
    expect(songToolProblem("song-extend", { format: "wav", bytes: 50_000_000 })).toBeNull();
    // By id: no upload, so neither the file's format nor its size matters.
    expect(songToolProblem("song-extend", { format: "wav", bytes: 50_000_000 }, true)).toBeNull();
    expect(songToolProblem("song-remix", { format: "wav", seconds: 120 }, true)).toBeNull();
    // Remix's own length rule comes first, by id or not.
    expect(songToolProblem("song-remix", { format: "wav", seconds: 400 }, true)).toBe("Remix takes a song of 0:10 to 5:50: this one is 6:40");
  });

  it("a Mureka song goes by its id for a month only ('Only supports songs generated within the last month'), then as its file", () => {
    const gen = (createdAt: number) =>
      ({ id: "g1", status: "succeeded", op: "music", feature: "audio", modelId: "mureka-song", request: { feature: "audio", modelId: "mureka-song" }, outputs: [{ url: "/api/files/song.mp3", kind: "audio", meta: { songId: "song_1" } }], createdAt, completedAt: createdAt }) as unknown as Generation;
    const extend = (g: Generation) => outputActions(g, 0, {}).find((a) => a.id === "extend-song")!.href;
    expect(extend(gen(Date.now() - 2 * 86_400_000))).toBe("/audio/song?model=mureka-extend&audio=%2Fapi%2Ffiles%2Fsong.mp3&song=song_1");
    expect(extend(gen(Date.now() - 31 * 86_400_000))).toBe("/audio/song?model=mureka-extend&audio=%2Fapi%2Ffiles%2Fsong.mp3");
  });
});
