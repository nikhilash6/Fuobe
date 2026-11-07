import { describe, expect, it } from "vitest";
import { clockWords, lineWords, noteWords } from "@/lib/pool-line";
import { LIMIT_KINDS, limitFields, limitNext, limitWords, limitWordsAt, readyInWords } from "@/lib/limit-words";
import { ENGINE_WORDS } from "@/lib/engine-error";
import { FILE_TROUBLE_WORDS, POOL_WORDS } from "@/lib/relay";

/*
 * Every wait, failure and limit a visitor reads about runs here is friendly and says what happens next: never the
 * machinery, never "busy" or "try again later", never an exclamation (src/lib/limit-words.ts, src/lib/pool-line.ts,
 * src/lib/engine-error.ts).
 */

const NEGATIVE = /\bbusy\b|resting|\bworkers?\b|\blanes?\b|\bqueue|try again later|error code|ComfyUI|!|[\\/]/i;

describe("limits", () => {
  const now = new Date(2026, 10, 8, 12, 0).getTime();

  it("say when free runs refresh, on the server as a wait and on the page as the viewer's clock", () => {
    expect(limitWords("free-today", 40 * 60)).toBe("Lots of people are creating on Fuobe today, so free runs are shared out — yours refresh in about 40 min.");
    const at = now + (2 * 60 + 20) * 60_000;
    expect(limitWordsAt("free-today", at, now)).toBe(`Lots of people are creating on Fuobe today, so free runs are shared out — yours refresh at ${clockWords(at, now)}.`);
    expect(limitWordsAt("replies", at, now)).toMatch(/free replies are shared out — yours refresh at /);
    // A time that has come: in a moment, never a time in the past.
    expect(limitWordsAt("free-hour", now - 1000, now)).toMatch(/refresh in a moment\.$/);
    expect(readyInWords(20)).toBe("in a moment");
    expect(limitFields("free-hour", 90, now)).toEqual({ limit: "free-hour", refreshAt: now + 90_000 });
  });

  it("a time on another day says so", () => {
    expect(clockWords(now + 20 * 3600_000, now)).toMatch(/^tomorrow at /);
  });

  it("past a limit on free runs, the next step: run it self-hosted, or a free account for a guest", () => {
    expect(limitNext("free-today", false)).toEqual({ label: "Want to keep going now? Run it self-hosted →", to: "self-hosted" });
    expect(limitNext("free-hour", true)).toEqual({ label: "Create a free account for more free runs", to: "sign-up" });
    expect(limitNext("reports", false)).toBeUndefined();
  });

  it("every sentence is friendly and plain", () => {
    for (const kind of LIMIT_KINDS) {
      for (const w of [limitWords(kind, 3600), limitWordsAt(kind, now + 3600_000, now)]) expect(w, w).not.toMatch(NEGATIVE);
    }
  });
});

describe("waits and failures", () => {
  const now = new Date(2026, 10, 8, 12, 0).getTime();

  it("the held lines use the same words as the limits", () => {
    const at = now + 3 * 3600_000;
    expect(noteWords({ place: 1, etaSeconds: null, held: "today", startAt: at }, now)).toBe(limitWordsAt("free-today", at, now));
    expect(noteWords({ place: 1, etaSeconds: null, held: "hour", startAt: at }, now)).toBe(limitWordsAt("free-hour", at, now));
    expect(lineWords({ place: 1, etaSeconds: null, held: "today", startAt: at }, now)).toBe(`Free runs refresh at ${clockWords(at, now)} · this one starts then`);
  });

  it("nothing a visitor reads names the machinery or ends in a dead end", () => {
    const lines = [
      ...[1, 2, 3, 6, 40].flatMap((place) => [lineWords({ place, etaSeconds: 200 }, now), lineWords({ place, etaSeconds: null, unknown: true }, now)]),
      noteWords({ place: 1, etaSeconds: null, unknown: true }, now)!,
      ...Object.values(POOL_WORDS),
      ...Object.values(FILE_TROUBLE_WORDS),
      ...Object.values(ENGINE_WORDS),
    ];
    for (const w of lines) expect(w, w).not.toMatch(NEGATIVE);
    // A failure always says what to do next.
    for (const w of [POOL_WORDS.failed, ...Object.values(FILE_TROUBLE_WORDS), ...Object.values(ENGINE_WORDS)]) expect(w, w).toMatch(/\btry\b/i);
  });

  it("lots of people only when lots really are waiting", () => {
    expect(lineWords({ place: 2, etaSeconds: 60 }, now)).toBe("1 ahead of you · about 1 min");
    expect(lineWords({ place: 7, etaSeconds: 600 }, now)).toBe("6 ahead of you · about 10 min · lots of people are creating right now");
  });
});

describe("a long wait in line", () => {
  it("keeps the run: saved, it starts by itself, with its place under it", async () => {
    const { pendingWords, LONG_WAIT_MS, LONG_WAIT_WORDS } = await import("@/lib/pending-words");
    const now = Date.now();
    const g = { status: "queued" as const, message: null, place: "pool" as const, queue: { place: 3, etaSeconds: 120 } };
    expect(pendingWords({ ...g, createdAt: now - 60_000 }, null, now)).toEqual({ label: "2 ahead of you · about 2 min", place: null });
    expect(pendingWords({ ...g, createdAt: now - LONG_WAIT_MS }, null, now)).toEqual({ label: LONG_WAIT_WORDS, place: "2 ahead of you · about 2 min" });
    expect(LONG_WAIT_WORDS).not.toMatch(/\bbusy\b|queue|worker|GPU|try again later|!/i);
  });
});
