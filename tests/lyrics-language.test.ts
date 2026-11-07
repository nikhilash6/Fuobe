import { describe, expect, it } from "vitest";
import { lyricsLanguageHint } from "@/lib/lyrics-language";

// The lyrics request names the language and script of the description, read from its letters.
describe("the lyrics' language from the description's script", () => {
  it("Hindi in Devanagari, Gujarati in Gujarati script", () => {
    expect(lyricsLanguageHint("मानसून की पहली बारिश पर एक रोमांटिक बॉलीवुड गीत")).toBe(
      "Write the lyrics in Hindi, in Devanagari script, not in English, unless the description asks for another language. Keep the section tags in English.",
    );
    expect(lyricsLanguageHint("નવરાત્રિ ગરબા પર એક ઉત્સાહી ગીત")).toMatch(/^Write the lyrics in Gujarati, in Gujarati script, not in English/);
  });

  it("other scripts, and Devanagari that isn't Hindi keeps the description's language", () => {
    expect(lyricsLanguageHint("மழைக்கால காதல் பாடல்")).toMatch(/in Tamil, in Tamil script/);
    expect(lyricsLanguageHint("비 오는 밤의 사랑 노래")).toMatch(/in Korean, in Hangul script/);
    expect(lyricsLanguageHint("雨の夜のラブソング")).toMatch(/in Japanese, in Japanese script/);
    expect(lyricsLanguageHint("पावसाळ्यातील प्रेमगीत आहे, मराठी")).toMatch(/in the description's language, in Devanagari script/);
    expect(lyricsLanguageHint("Песня о дожде")).toMatch(/in the description's language, in Cyrillic script/);
  });

  it("no hint for Latin letters, a few borrowed words, or nothing", () => {
    expect(lyricsLanguageHint("Upbeat synth-pop about driving through Mumbai at night")).toBeNull();
    expect(lyricsLanguageHint("A Bollywood love song with the word प्यार in the chorus, sung in English")).toBeNull();
    expect(lyricsLanguageHint("Canción de amor bajo la lluvia")).toBeNull();
    expect(lyricsLanguageHint("120 bpm")).toBeNull();
  });
});
