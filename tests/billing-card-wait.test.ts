import { describe, expect, it } from "vitest";
import { freshBody, waitUntilReady } from "@/lib/hosted";

/** A clock that moves only when the wait sleeps. */
function fakeTime() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

const answer = (body: unknown, ok = true) => new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { "Content-Type": "application/json" } });

describe("the billing card's wait", () => {
  it("asks the address at its pace until it answers ready, through odd answers and failures", async () => {
    const time = fakeTime();
    const asked: number[] = [];
    const replies = [answer({ ready: false }), answer({}, false), answer("nope"), answer({ ready: true })];
    const fetcher = (async (url: string, init?: RequestInit) => {
      expect(url).toBe("/ready");
      expect(init?.cache).toBe("no-store");
      asked.push(time.now());
      const r = replies.shift();
      if (!r) throw new Error("asked too often");
      return r;
    }) as typeof fetch;
    expect(await waitUntilReady("/ready", 4000, { fetcher, ...time })).toBe(true);
    expect(asked).toEqual([4000, 8000, 12000, 16000]);
  });

  it("stops after its time, when stopped, or for an address on another site", async () => {
    const time = fakeTime();
    let n = 0;
    const fetcher = (async () => {
      n++;
      return answer({ ready: false });
    }) as typeof fetch;
    expect(await waitUntilReady("/ready", 60_000, { fetcher, mostMs: 10 * 60_000, ...time })).toBe(false);
    expect(n).toBe(10);
    const stop = new AbortController();
    stop.abort();
    expect(await waitUntilReady("/ready", 1000, { fetcher, signal: stop.signal, ...time })).toBe(false);
    expect(await waitUntilReady("https://evil.example/ready", 1000, { fetcher, ...time })).toBe(false);
    expect(await waitUntilReady("//evil.example/ready", 1000, { fetcher, ...time })).toBe(false);
    expect(n).toBe(10);
  });

  it("sends the run again as a new press: a fresh request id, the rest as it was", () => {
    const body = JSON.stringify({ modelId: "m", prompt: "p", requestId: "old" });
    expect(JSON.parse(freshBody(body, () => "new"))).toEqual({ modelId: "m", prompt: "p", requestId: "new" });
    expect(freshBody('{"modelId":"m"}', () => "new")).toBe('{"modelId":"m"}');
    expect(freshBody("not json", () => "new")).toBe("not json");
  });
});
