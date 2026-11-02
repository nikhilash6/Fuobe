import { describe, expect, it } from "vitest";
import { insertTag, isInstrumental, lyricsOf, lyricsProblem, normalizeLyrics, parseLyrics, promptWithLyrics, songFromRun, songLength, structureOf, tagName, withSongId } from "@/lib/lyrics";
import { durationLabel } from "@/lib/composer";

// The lyrics editor's words and section tags, as every music model reads them.
describe("lyrics with section tags", () => {
  it("reads each tag with the lines under it, in title case, words after a tag moved below it", () => {
    const text = "Intro hum\n[verse 1] Morning light\nacross the window\n\n[PRE CHORUS]\nhold on\n[chorus][Instrumental]";
    expect(parseLyrics(text)).toEqual([
      { tag: null, lines: ["Intro hum"] },
      { tag: "Verse 1", lines: ["Morning light", "across the window"] },
      { tag: "Pre-Chorus", lines: ["hold on"] },
      { tag: "Chorus", lines: [] },
      { tag: "Instrumental", lines: [] },
    ]);
    expect(structureOf(text)).toEqual(["Verse 1", "Pre-Chorus", "Chorus", "Instrumental"]);
  });

  it("writes one tag per line, the words below, a blank line between sections", () => {
    expect(normalizeLyrics("[verse]  Line one  \r\nline two\n\n\n[chorus] sing it\n")).toBe("[Verse]\nLine one\nline two\n\n[Chorus]\nsing it");
    expect(normalizeLyrics("   \n")).toBe("");
    expect(normalizeLyrics(undefined)).toBe("");
    expect(tagName("outro - final chord")).toBe("Outro - final chord");
    expect(tagName("verse2")).toBe("Verse 2");
    expect(tagName("hook")).toBe("Hook");
  });

  it("knows an instrumental from a song", () => {
    expect(isInstrumental("")).toBe(true);
    expect(isInstrumental("[Instrumental]")).toBe(true);
    expect(isInstrumental("[Intro]\n[Solo]")).toBe(false);
    expect(isInstrumental("[Instrumental]\n[Solo]")).toBe(true);
    expect(isInstrumental("[Verse]\nla la")).toBe(false);
  });

  it("takes them from params.extra.lyrics, normalized", () => {
    expect(lyricsOf({ lyrics: "[verse] hi" })).toBe("[Verse]\nhi");
    expect(lyricsOf({ lyrics: 3 })).toBe("");
    expect(lyricsOf(undefined)).toBe("");
  });

  it("says when they are longer than the model sings", () => {
    expect(lyricsProblem("[Verse]\nshort", 3000)).toBeNull();
    expect(lyricsProblem(`[Verse]\n${"la ".repeat(40)}`, 50, "Mureka Extend")).toMatch(/^Mureka Extend sings up to 50 characters of lyrics: these are \d+\./);
    expect(lyricsProblem("x".repeat(9000), undefined)).toBeNull();
  });

  it("goes after the prompt for a model that reads both in one text (Lyria 3.5)", () => {
    expect(promptWithLyrics("Indie pop, 96 BPM.", "[verse]\nhello")).toBe("Indie pop, 96 BPM.\n\nLyrics:\n[Verse]\nhello");
    expect(promptWithLyrics("Ambient", "[Instrumental]")).toBe("Ambient. Instrumental, no vocals.");
    expect(promptWithLyrics("Ambient", "")).toBe("Ambient");
  });

  it("puts a tag on a line of its own at the cursor, the cursor below it", () => {
    expect(insertTag("", 0, "verse")).toEqual({ text: "[Verse]\n", cursor: 8 });
    // At the end of a line: after it, a blank line between.
    const a = insertTag("hello there", 5, "chorus");
    expect(a.text).toBe("hello there\n\n[Chorus]\n");
    expect(a.cursor).toBe(a.text.length);
    // At the start of a line: before it.
    const b = insertTag("one\ntwo", 4, "Bridge");
    expect(b.text).toBe("one\n\n[Bridge]\n\ntwo");
    expect(b.text.slice(b.cursor)).toBe("\ntwo");
    expect(insertTag("words", 0, "Intro").text).toBe("[Intro]\n\nwords");
  });

  it("reads lengths as a song does", () => {
    expect(songLength(300)).toBe("5:00");
    expect(songLength(95)).toBe("1:35");
    expect(durationLabel(10)).toBe("10s");
    expect(durationLabel(120)).toBe("2:00");
    expect(durationLabel(270)).toBe("4:30");
  });
});

describe("a song's Mureka id on Reuse", () => {
  it("comes back as the attached song's id, out of the settings, with the lyrics in the editor", () => {
    const r = songFromRun({ lyrics: "[Verse]\nmore", songId: "song_1", extend_type: "tail" }, "/api/files/a.mp3");
    expect(r).toEqual({ extra: { extend_type: "tail" }, lyrics: "[Verse]\nmore", song: { id: "song_1", url: "/api/files/a.mp3" } });
    expect(songFromRun({ songId: "song_1" }, undefined)).toEqual({ extra: undefined });
    expect(songFromRun({ seed: 1 }, "/api/files/a.mp3")).toEqual({ extra: { seed: 1 } });
  });

  it("goes with the song it names only: a song swapped in, or a stale id, is sent as the file", () => {
    const song = { id: "song_1", url: "/api/files/a.mp3" };
    expect(withSongId({ lyrics: "x" }, song, "/api/files/a.mp3", true)).toEqual({ lyrics: "x", songId: "song_1" });
    expect(withSongId({ lyrics: "x", songId: "song_1" }, song, "/api/files/b.mp3", true)).toEqual({ lyrics: "x" });
    expect(withSongId({ songId: "song_1" }, undefined, "/api/files/b.mp3", true)).toBeUndefined();
    // A model that isn't Mureka's never gets one.
    expect(withSongId({ lyrics: "x" }, song, "/api/files/a.mp3", false)).toEqual({ lyrics: "x" });
  });
});

describe("written lyrics cut to a model's limit", () => {
  it("at the last line break before it, or at the limit when there is none", async () => {
    const { trimLyrics } = await import("@/server/enhance");
    expect(trimLyrics("[Verse]\nabc def\nghi jkl", 16)).toBe("[Verse]\nabc def");
    const one = `[Verse]\n${"a".repeat(50)}`;
    expect(trimLyrics(one.replace("\n", " "), 20).length).toBeLessThanOrEqual(20);
    expect(trimLyrics("x".repeat(40), 10)).toBe("x".repeat(10));
  });
});
