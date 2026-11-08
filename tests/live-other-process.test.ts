import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/*
 * While the site updates, its two app processes run side by side for a moment, and the runner in either may save a
 * run's result. A live stream reads its changes from the triggers on its own process's connection, so a write by the
 * other process used to reach no open stream: a run that finished then stayed "on its way" on screen. The stream now
 * also sweeps the rows updated lately, and passes on another process's changes within seconds.
 */

vi.setConfig({ testTimeout: 30_000 });
const dir = tempDir("fuobe-live-other-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { db, DATA_DIR } = await import("@/server/db");
const live = await import("@/server/live");

const dec = new TextDecoder();

/** Everything a stream sends, read as it comes; `until` waits for what arrives from now on. */
function tap(body: ReadableStream<Uint8Array>) {
  let all = "";
  const reader = body.getReader();
  void (async () => {
    for (;;) {
      const r = await reader.read().catch(() => ({ done: true as const, value: undefined }));
      if (r.done) return;
      all += dec.decode(r.value);
    }
  })();
  return {
    /** Wait until what arrives from now on passes `done`, or `ms` pass: that text, and how long it took. */
    async until(done: (t: string) => boolean, ms: number): Promise<{ text: string; ms: number }> {
      const from = all.length;
      const start = Date.now();
      while (!done(all.slice(from)) && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 25));
      return { text: all.slice(from), ms: Date.now() - start };
    },
  };
}

describe("a change written by another app process", () => {
  it("reaches an open stream within seconds, once, and this process's own changes aren't sent twice", async () => {
    setSetting("demoMode", "on");
    gens.ensureRunner();
    // A run made here and finished, so it is a row like any other.
    const g = gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", prompt: "a flying cat" })[0];
    for (let i = 0; i < 200 && !["succeeded", "failed"].includes(gens.getGeneration(g.id)!.status); i++) await new Promise((r) => setTimeout(r, 100));

    const ac = new AbortController();
    const stream = tap(live.generationEventStream(ac.signal, { pingMs: 60_000 }).body!);
    await new Promise((r) => setTimeout(r, 100));

    // The other process: its own connection to the same database, with no triggers of this one.
    const other = new Database(path.join(DATA_DIR, "fuobe.db"));
    try {
      other.prepare("UPDATE generations SET favorite = 1, updated_at = ? WHERE id = ?").run(Date.now(), g.id);
      const got = await stream.until((t) => t.includes(`"id":"${g.id}"`), live.SWEEP_MS * 3);
      expect(got.text).toContain("event: generation");
      expect(got.text).toContain(`"favorite":true`);
      expect(got.ms).toBeLessThan(live.SWEEP_MS * 3);
      // Seen once: the next sweeps send nothing more for it.
      const again = await stream.until((t) => t.includes(`"id":"${g.id}"`), live.SWEEP_MS * 2 + 500);
      expect(again.text).not.toContain(`"id":"${g.id}"`);

      // A change made here comes through the triggers at once, and the sweep doesn't repeat it.
      db().prepare("UPDATE generations SET favorite = 0, updated_at = ? WHERE id = ?").run(Date.now() + 1, g.id);
      const own = await stream.until((t) => (t.match(new RegExp(`"id":"${g.id}"`, "g")) ?? []).length >= 2, live.SWEEP_MS * 2 + 500);
      expect((own.text.match(new RegExp(`"id":"${g.id}"`, "g")) ?? []).length).toBe(1);
    } finally {
      other.close();
      ac.abort();
    }
    // Nobody listening: the sweep stops.
    expect(live.listenerCount()).toBe(0);
    expect(live.sweepForeign()).toBe(0);
  });
});
