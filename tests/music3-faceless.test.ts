import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { buildEpisodeGraph, defaultSettings, genreInfo, MUSIC_MAX, pickerData, resolveModels, secondsFor, type EpisodeSettings, type ScriptBlock } from "@/lib/catalog/faceless";

// Faceless and Explainer's music bed can be MiniMax Music 3 (either engine) or ElevenLabs Music
// v2.5 in the cloud, beside Sonilo and ACE-Step; each says the longest bed it makes.
const block = (i: number, words = 20): ScriptBlock => {
  const narration = Array.from({ length: words }, (_, w) => `w${i}x${w}`).join(" ");
  return { id: `b${i}`, narration, visual: `Scene ${i}`, motion: "slow push-in", seconds: secondsFor(narration) };
};
const settings = (s: Partial<EpisodeSettings>) => ({ ...defaultSettings(s.engine ?? "cloud", genreInfo("education")), ...s });
const graph = (s: Partial<EpisodeSettings>) =>
  buildEpisodeGraph({ feature: "faceless", title: "Tides", genre: genreInfo("education"), settings: settings(s), blocks: [block(1), block(2)], fallbackVoice: "/api/files/uploads/demo-voice.wav" }, getModel);
const musicStep = (s: Partial<EpisodeSettings>) => graph(s).find((x) => x.key === "music")!;

describe("the music bed's model", () => {
  it("lists each engine's choices with the longest bed each makes", () => {
    const picks = pickerData(getModel).musicModels!;
    expect(picks.filter((m) => m.engine === "cloud").map((m) => [m.id, m.name, m.maxSeconds])).toEqual([
      ["sonilo-music", "Sonilo Music 1.1", 600],
      ["minimax-music-3", "MiniMax Music 3", 300],
      ["elevenlabs-music-2-5", "ElevenLabs Music v2.5", 600],
    ]);
    expect(picks.filter((m) => m.engine === "open").map((m) => [m.id, m.maxSeconds])).toEqual([
      ["oss-ace-step", 240],
      ["oss-minimax-music-3", 300],
    ]);
    expect(MUSIC_MAX["oss-minimax-music-3"]).toBe(300);
  });

  it("runs the one picked on its engine, else the engine's default", () => {
    expect(resolveModels(settings({ musicModel: "minimax-music-3" }), 100, getModel).music).toBe("minimax-music-3");
    expect(resolveModels(settings({ engine: "open", musicModel: "oss-minimax-music-3" }), 100, getModel).music).toBe("oss-minimax-music-3");
    // A pick from the other engine (a channel moved to your GPU) falls back.
    expect(resolveModels(settings({ engine: "open", musicModel: "minimax-music-3" }), 100, getModel).music).toBe("oss-ace-step");
    expect(resolveModels(settings({ music: false, musicModel: "minimax-music-3" }), 100, getModel).music).toBeNull();
  });

  it("keeps the pick when the settings are saved", async () => {
    const { SettingsSchema } = await import("@/server/faceless");
    expect(SettingsSchema.parse(settings({ musicModel: "minimax-music-3" })).musicModel).toBe("minimax-music-3");
  });

  it("asks a model that sings for an instrumental bed", () => {
    expect(musicStep({ musicModel: "minimax-music-3" }).request).toMatchObject({ modelId: "minimax-music-3", op: "music", params: { extra: { lyrics: "[Instrumental]" } } });
    expect(musicStep({ engine: "open", musicModel: "oss-minimax-music-3" }).request.params?.extra).toEqual({ lyrics: "[Instrumental]" });
    expect(musicStep({}).request.params?.extra).toBeUndefined();
    expect(musicStep({ musicModel: "elevenlabs-music-2-5" }).request.params?.extra).toBeUndefined();
  });
});
