/**
 * The Fuobe tab's runner (src/lib/computer-runner.ts) when something takes its request and never answers: a ComfyUI
 * busy at full load, or a studio that is restarting. A beat still ends, so the next one can try again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerRunner } from "@/lib/computer-runner";

/** A request that never answers, but ends when its signal aborts, as the browser's does. */
const hang = (_url: string, init: RequestInit = {}) =>
  new Promise<Response>((_ok, fail) => init.signal?.addEventListener("abort", () => fail(init.signal?.reason ?? new Error("aborted")), { once: true }));

function runner(o: { api?: typeof hang; local?: typeof hang }) {
  const beats: Record<string, unknown>[] = [];
  const api =
    o.api ??
    (async (p: string, init: RequestInit = {}) => {
      if (p === "/api/gpu/computer/beat") beats.push(JSON.parse(String(init.body)));
      return Response.json({ runner: true, heldElsewhere: false, waiting: 0, stops: [] });
    });
  const local = o.local ?? (async () => Response.json({ system: { ram_total: 1 }, devices: [] }));
  const r = new ComputerRunner({ api, local, sha256: async () => "", origin: "http://x", sleep: async () => {} }, { device: "device-0001", port: 8188, clientId: "client-0001" });
  return { r, beats };
}

afterEach(() => vi.useRealTimers());

describe("a beat when nothing answers", () => {
  it("a ComfyUI that takes the request and never answers: the beat still goes out, saying it isn't ready", async () => {
    vi.useFakeTimers();
    const { r, beats } = runner({ local: hang });
    const beat = r.beat();
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(beat).resolves.toMatchObject({ runner: true });
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ ready: false });
    expect(r.view.comfy).toBe("down");
  });

  it("a studio that takes the beat and never answers: the beat gives up, and the next one can go", async () => {
    vi.useFakeTimers();
    const { r } = runner({ api: hang });
    const beat = r.beat().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await beat) as Error).toHaveProperty("name", "TimeoutError");
    expect(vi.getTimerCount()).toBe(0);
  });
});
