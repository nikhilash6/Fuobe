import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

// When the server is asked to stop, the live-updates streams end and the background runners stop, so `next start`
// finishes its own stop at once instead of waiting on a stream that never ends.
process.env.FUOBE_DATA_DIR = tempDir("fuobe-drain-");
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const live = await import("@/server/live");
const gens = await import("@/server/generations");
const shutdown = await import("@/server/shutdown");

type Reader = ReadableStreamDefaultReader<Uint8Array>;
const dec = new TextDecoder();

/** Reads a stream to its end; null when it is still open after `ms`. */
async function readToEnd(reader: Reader, ms: number): Promise<string | null> {
  let text = "";
  const end = Date.now() + ms;
  for (;;) {
    const left = end - Date.now();
    if (left <= 0) return null;
    const r = await Promise.race([reader.read(), new Promise<"wait">((ok) => setTimeout(() => ok("wait"), left))]);
    if (r === "wait") return null;
    if (r.done) return text;
    text += dec.decode(r.value);
  }
}

describe("stopping the server", () => {
  it("ends every open live-updates stream and stops the runners", async () => {
    gens.ensureRunner();
    const runner = globalThis.__fuobeRunner!;
    let ticks = 0;
    const tick = runner.tick;
    runner.tick = async () => {
      ticks++;
      await tick();
    };
    const before = live.listenerCount();
    const a = live.generationEventStream(new AbortController().signal, { pingMs: 60_000 }).body!.getReader();
    const b = live.generationEventStream(new AbortController().signal, { pingMs: 60_000 }).body!.getReader();
    expect(live.listenerCount()).toBe(before + 2);
    // Open streams stay open (a read that is still waiting after 300 ms).
    expect(dec.decode((await a.read()).value)).toMatch(/^retry: 2000\n/);
    const waiting = a.read();
    expect(await Promise.race([waiting.then(() => "read"), new Promise((ok) => setTimeout(() => ok("open"), 300))])).toBe("open");

    shutdown.drain();

    expect((await waiting).done).toBe(true);
    expect(await readToEnd(b, 2000)).toMatch(/^retry: 2000\n/);
    expect(live.listenerCount()).toBe(before);
    // No tick after the drain (the runner polls every 1.5 s).
    const seen = ticks;
    await new Promise((r) => setTimeout(r, 2000));
    expect(ticks).toBe(seen);
    // A runner asked for again doesn't start a second one.
    gens.ensureRunner();
    await new Promise((r) => setTimeout(r, 1700));
    expect(ticks).toBe(seen);

    // A stream opened while stopping ends at once.
    const late = live.generationEventStream(new AbortController().signal, { pingMs: 60_000 }).body!.getReader();
    expect(await readToEnd(late, 1000)).toBe("");
    expect(live.listenerCount()).toBe(before);
    expect(shutdown.draining()).toBe(true);
  });
});
