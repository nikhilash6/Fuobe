import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { limitWords, limitWordsAt } from "@/lib/limit-words";
import { longWaitWords } from "@/lib/pending-words";
import { clockWords, lineWords, noteWords } from "@/lib/pool-line";
import { cleanCopy, COPY_KEYS, COPY_MAX, copyLine, knownCopy, noteServiceCopy } from "@/lib/service-copy";

/*
 * Display copy (src/lib/service-copy.ts): an install's billing service may send its own sentences for a few wait and
 * limit lines. Without it, Fuobe's own plain sentences show.
 */

afterEach(() => noteServiceCopy(null));

describe("display copy", () => {
  const now = new Date(2026, 10, 8, 12, 0).getTime();
  const at = now + (2 * 60 + 20) * 60_000;

  it("keeps known keys with text only, cleaned, and nothing too long", () => {
    expect(cleanCopy(null)).toBeNull();
    expect(cleanCopy("limitDaily")).toBeNull();
    expect(cleanCopy(["x"])).toBeNull();
    expect(cleanCopy({ madeUp: "x", limitDaily: 3 })).toBeNull();
    expect(cleanCopy({ limitDaily: "  Back\n {when}.  ", chatNext: "", queueLong: "x".repeat(COPY_MAX + 1), writeBusy: "Soon." })).toEqual({ limitDaily: "Back {when}.", writeBusy: "Soon." });
    expect(new Set(COPY_KEYS).size).toBe(COPY_KEYS.length);
  });

  it("fills the placeholders; a sentence naming one that isn't given shows the plain one", () => {
    expect(copyLine("chatAhead", { n: 3 }, "{n} ahead of you", null)).toBe("3 ahead of you");
    expect(copyLine("chatAhead", { n: 3 }, "{n} ahead of you", { chatAhead: "{n} before yours" })).toBe("3 before yours");
    expect(copyLine("chatAhead", { n: 3 }, "{n} ahead of you", { chatAhead: "{who} before yours" })).toBe("3 ahead of you");
    // A value is put in as it is, never read for placeholders again.
    expect(copyLine("queueBusy", { line: "{n}", n: 2 }, "{line}", { queueBusy: "{line} · more" })).toBe("{n} · more");
  });

  it("with no copy, every line is plain", () => {
    expect(knownCopy()).toBeNull();
    expect(limitWords("free-today", 40 * 60)).toBe("Free runs refresh in about 40 min.");
    expect(limitWords("free-hour")).toBe("Free runs refresh in a moment.");
    expect(limitWords("network", 40 * 60)).toBe("Free runs on your network refresh in about 40 min.");
    expect(limitWordsAt("replies", at, now)).toBe(`More free replies at ${clockWords(at, now)}.`);
    expect(noteWords({ place: 1, etaSeconds: null, held: "today", startAt: at }, now)).toBe(`Free runs refresh at ${clockWords(at, now)}.`);
    expect(lineWords({ place: 9, etaSeconds: 600 }, now)).toBe("8 ahead of you · about 10 min");
    expect(longWaitWords()).toBe("Your run is saved and starts automatically; it'll appear here when it's ready.");
  });

  it("with copy noted, the lines read it", () => {
    noteServiceCopy({
      limitDaily: "Daily runs are back {when}.",
      limitHour: "Hourly runs are back {when}.",
      limitNetwork: "Runs on this network are back {when}.",
      limitReplies: "Replies are back {when}.",
      queueBusy: "{line} · {n} in front",
      queueLong: "Saved; it starts by itself.",
    });
    expect(limitWords("free-today", 40 * 60)).toBe("Daily runs are back in about 40 min.");
    expect(limitWords("free-hour", 40 * 60)).toBe("Hourly runs are back in about 40 min.");
    expect(limitWords("network", 40 * 60)).toBe("Runs on this network are back in about 40 min.");
    expect(limitWordsAt("replies", at, now)).toBe(`Replies are back at ${clockWords(at, now)}.`);
    expect(noteWords({ place: 1, etaSeconds: null, held: "hour", startAt: at }, now)).toBe(`Hourly runs are back at ${clockWords(at, now)}.`);
    // Only with many ahead.
    expect(lineWords({ place: 3, etaSeconds: 120 }, now)).toBe("2 ahead of you · about 2 min");
    expect(lineWords({ place: 9, etaSeconds: 600 }, now)).toBe("8 ahead of you · about 10 min · 8 in front");
    expect(longWaitWords()).toBe("Saved; it starts by itself.");
    // Other limits keep their own words.
    expect(limitWords("runs", 40 * 60)).toBe("You've made a lot this hour — you can run again in about 40 min.");
    noteServiceCopy(undefined);
    expect(limitWords("free-today", 40 * 60)).toBe("Free runs refresh in about 40 min.");
  });
});

describe("the public tree holds only plain wait and limit words", () => {
  // Built from parts, so this file never holds a phrase it looks for.
  const phrases = [
    ["lots", "of", "people"],
    ["high", "demand", "right", "now"],
    ["are", "shared", "out"],
    ["people", "are", "chatting"],
    ["people", "are", "writing"],
    ["people", "are", "creating"],
    ["creating", "on", "Fuobe"],
  ].map((w) => w.join(" "));

  it("finds none of the busy-time phrases in any tracked file", () => {
    const root = path.resolve(__dirname, "..");
    const args = ["grep", "-n", "-i", "-I", "-F", ...phrases.flatMap((p) => ["-e", p]), "--", "."];
    let out = "";
    try {
      out = execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
    } catch (e) {
      // git grep exits 1 when nothing matches.
      if ((e as { status?: number }).status !== 1) throw e;
    }
    expect(out.split("\n").filter(Boolean)).toEqual([]);
  });
});
