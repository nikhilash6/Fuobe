import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStandInBilling, type StandInBilling } from "./helpers/standin-billing";
import { freeHighPort, startStandInComfy, type StandInComfy } from "./helpers/standin-comfy";
import { stepOf } from "./helpers/worker-driver";
import { plainFailure, RunWatch } from "./helpers/run-watch";

/**
 * The recovery tests' stand-ins (tests/recovery-server.test.ts): a ComfyUI that can crash, hang, fail, run out of
 * memory or lose a prompt; a billing service that can stop, start again and be slow, over HTTP or a socket; and the
 * check of what a person sees of a run.
 */

const { hookCall, hookTarget } = await import("@/server/hook-client");
const { POOL_WORDS } = await import("@/lib/relay");

const GRAPH = { "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } }, "9": { class_type: "SaveImage", inputs: { images: ["3", 0], filename_prefix: "fuobe/standin" } } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the stand-in ComfyUI", () => {
  let comfy: StandInComfy;
  beforeAll(async () => {
    comfy = await startStandInComfy({ steps: 3, stepMs: 10 });
  });
  afterAll(async () => {
    await comfy.close();
  });

  const post = (path: string, body: unknown) => fetch(`${comfy.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const prompt = async (id = crypto.randomUUID(), clientId?: string) => {
    const r = await post("/prompt", { prompt: GRAPH, prompt_id: id, ...(clientId && { client_id: clientId }) });
    return { id, status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const history = async (id: string) => ((await (await fetch(`${comfy.url}/history/${id}`)).json()) as Record<string, { status: { status_str: string } }>)[id];
  const until = async <T,>(fn: () => Promise<T>, ms = 3000) => {
    const end = Date.now() + ms;
    let v = await fn();
    while (!v && Date.now() < end) {
      await sleep(20);
      v = await fn();
    }
    return v;
  };

  it("listens on a free high port, never one of ComfyUI's own", async () => {
    expect(comfy.port).toBeGreaterThan(1024);
    expect([8188, 8189, 8190, 8191]).not.toContain(comfy.port);
    expect(await freeHighPort()).toBeGreaterThan(1024);
    const stats = (await (await fetch(`${comfy.url}/system_stats`)).json()) as { system: { comfyui_version: string } };
    expect(stats.system.comfyui_version).toBeTruthy();
  });

  it("runs a prompt: its queue, its history, its file, and its progress on the socket", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${comfy.port}/ws?clientId=watcher`);
    const events: string[] = [];
    ws.onmessage = (e) => {
      if (typeof e.data === "string") events.push((JSON.parse(e.data) as { type: string }).type);
    };
    await new Promise((r) => (ws.onopen = r));
    const p = await prompt(undefined, "watcher");
    expect(p.status).toBe(200);
    const entry = await until(() => history(p.id));
    expect(entry.status.status_str).toBe("success");
    const outputs = Object.values((entry as unknown as { outputs: Record<string, { images: { filename: string; subfolder: string }[] }> }).outputs)[0].images;
    const file = await fetch(`${comfy.url}/view?filename=${outputs[0].filename}&subfolder=${outputs[0].subfolder}&type=output`);
    expect(file.status).toBe(200);
    expect(events).toContain("progress");
    expect(events).toContain("execution_success");
    const queue = (await (await fetch(`${comfy.url}/queue`)).json()) as { queue_running: unknown[]; queue_pending: unknown[] };
    expect(queue).toEqual({ queue_running: [], queue_pending: [] });
    expect(comfy.postsOf(p.id)).toBe(1);
    ws.close();
  });

  it("frees its memory when asked (POST /free)", async () => {
    const r = await post("/free", { unload_models: true, free_memory: true });
    expect(r.status).toBe(200);
    expect(comfy.frees.at(-1)).toEqual({ unload_models: true, free_memory: true });
    expect(comfy.log().some((e) => e.path === "/free")).toBe(true);
  });

  it("crashes: nothing answers, and when it starts again its queue and history are gone (what it was asked stays counted)", async () => {
    const p = await prompt();
    await until(() => history(p.id));
    const posts = comfy.posts();
    await comfy.crash();
    expect(comfy.up()).toBe(false);
    await expect(fetch(`${comfy.url}/system_stats`)).rejects.toThrow();
    await comfy.start();
    expect(comfy.up()).toBe(true);
    expect(await history(p.id)).toBeUndefined();
    expect(comfy.posts()).toBe(posts);
  });

  it("crashes with a progress socket open: the socket ends, and the crash doesn't wait for it", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${comfy.port}/ws?clientId=crash-watcher`);
    await new Promise((r) => (ws.onopen = r));
    const closed = new Promise((r) => (ws.onclose = r));
    await comfy.crash();
    await closed;
    await comfy.start();
  });

  it("hangs: the next prompt starts and never moves", async () => {
    comfy.hang();
    const p = await prompt();
    await sleep(200);
    expect(await history(p.id)).toBeUndefined();
    const queue = (await (await fetch(`${comfy.url}/queue`)).json()) as { queue_running: unknown[][] };
    expect(queue.queue_running.map((r) => r[1])).toEqual([p.id]);
    // Stopped by hand, it is gone from the queue.
    await post("/interrupt", { prompt_id: p.id });
    await comfy.crash();
    await comfy.start();
  });

  it("stalls: nothing starts until it is told to go on", async () => {
    comfy.stall();
    try {
      const p = await prompt();
      await sleep(100);
      const queue = (await (await fetch(`${comfy.url}/queue`)).json()) as { queue_pending: unknown[][] };
      expect(queue.queue_pending.map((r) => r[1])).toContain(p.id);
    } finally {
      comfy.stall(false);
      await comfy.crash();
      await comfy.start();
    }
  });

  it("refuses a prompt, runs out of memory, or loses a prompt, once each", async () => {
    comfy.fail("missing_node");
    expect((await prompt()).status).toBe(400);
    expect((await prompt()).status).toBe(200);

    comfy.outOfMemory();
    const oom = await prompt();
    const entry = await until(() => history(oom.id));
    expect(entry.status.status_str).toBe("error");
    expect(JSON.stringify(entry)).toMatch(/out of memory/i);

    comfy.lose();
    const lost = await prompt();
    expect(lost.status).toBe(200);
    await sleep(100);
    expect(await history(lost.id)).toBeUndefined();
    const queue = (await (await fetch(`${comfy.url}/queue`)).json()) as { queue_running: unknown[][]; queue_pending: unknown[][] };
    expect([...queue.queue_running, ...queue.queue_pending].map((r) => r[1])).not.toContain(lost.id);
  });
});

describe("the stand-in billing service", () => {
  const call = (svc: StandInBilling, path: string, body?: unknown, timeoutMs = 2000) =>
    hookCall<Record<string, unknown>>({ hook: "test", target: hookTarget(svc.address)!, token: svc.token, method: body === undefined ? "GET" : "POST", path, body, timeoutMs });
  const account = { id: "acct-1", email: null, emailVerified: false, signIn: "password", createdAt: 0, adultAt: null };
  const reserve = (svc: StandInBilling, requestId: string, shown = { amount: 0, priceVersion: "free" }) => call(svc, "/v1/reserve", { requestId, account, run: {}, queue: null, shown });

  for (const socket of [false, true]) {
    describe(socket ? "on a socket" : "over HTTP", () => {
      let svc: StandInBilling;
      beforeAll(async () => {
        svc = await startStandInBilling({ socket });
      });
      afterAll(async () => {
        await svc.close();
      });

      it("makes every run free, keeps one hold per press, and keeps each report", async () => {
        expect(svc.address).toMatch(socket ? /^unix:/ : /^http:\/\/127\.0\.0\.1:\d+$/);
        expect(await call(svc, "/v1/quote", { account, run: {}, queue: null })).toEqual({ allowed: true, amount: 0, priceVersion: "free", text: "Free" });
        expect(await call(svc, "/v1/policy?account=acct-1")).toMatchObject({ hosted: true, limits: { activeRuns: 2 } });
        const a = await reserve(svc, "press-1");
        const again = await reserve(svc, "press-1");
        expect(a).toMatchObject({ ok: true, amount: 0, text: "Free", class: "free" });
        expect(again.holdId).toBe(a.holdId);
        expect(svc.holdsOf("acct-1")).toHaveLength(1);
        await call(svc, "/v1/settle", { holdId: a.holdId, generationId: "g1", rows: 1, status: "succeeded" });
        expect(svc.reportsFor("g1")).toEqual([{ holdId: a.holdId, kind: "settle", status: "succeeded" }]);
      });

      it("stops (nothing answers) and starts again with its holds kept", async () => {
        const a = await reserve(svc, "press-2");
        await svc.stop();
        expect(svc.up()).toBe(false);
        await expect(call(svc, "/v1/health")).rejects.toThrow();
        await svc.start();
        expect(await call(svc, "/v1/health")).toEqual({ ok: true });
        expect(svc.holds.has(String(a.holdId))).toBe(true);
      });

      it("comes back by itself after downFor", async () => {
        await svc.downFor(150);
        await expect(call(svc, "/v1/health")).rejects.toThrow();
        await sleep(400);
        expect(await call(svc, "/v1/health")).toEqual({ ok: true });
      });

      it("stays stopped when stopped again before downFor's time is up", async () => {
        await svc.downFor(150);
        await svc.stop();
        await sleep(400);
        expect(svc.up()).toBe(false);
        await expect(call(svc, "/v1/health")).rejects.toThrow();
        await svc.start();
      });

      it("refuses a reserve that names no request", async () => {
        const holds = svc.holds.size;
        await expect(call(svc, "/v1/reserve", { account, run: {}, queue: null, shown: { amount: 0, priceVersion: "free" } })).rejects.toThrow();
        expect(svc.callsOf("/v1/reserve").at(-1)?.body).not.toHaveProperty("requestId");
        expect(svc.holds.size).toBe(holds);
      });
    });
  }

  it("never listens again after close, even with a downFor still to come back", async () => {
    const svc = await startStandInBilling();
    await svc.downFor(100);
    await svc.close();
    await sleep(300);
    expect(svc.up()).toBe(false);
  });

  it("is slow when told to be, holds answers until others come, refuses unknown callers, prices runs when told to, and refuses a report after its hold closed", async () => {
    const svc = await startStandInBilling();
    try {
      svc.slowMs = 300;
      const t0 = Date.now();
      await call(svc, "/v1/health");
      expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
      await expect(call(svc, "/v1/health", undefined, 100)).rejects.toThrow(/no answer/);
      // (The call it gave up on is still being answered: let it end first.)
      await sleep(400);
      svc.slowMs = 0;
      // Answers to one call held until two of them come in (or the time is up).
      svc.gather = { path: "/v1/health", count: 2, maxMs: 2000 };
      const t1 = Date.now();
      const both = await Promise.all([call(svc, "/v1/health"), call(svc, "/v1/health")]);
      expect(both).toEqual([{ ok: true }, { ok: true }]);
      expect(Date.now() - t1).toBeLessThan(1500);
      const t2 = Date.now();
      await call(svc, "/v1/health", undefined, 3000);
      expect(Date.now() - t2).toBeGreaterThanOrEqual(1900);
      svc.gather = null;
      await expect(hookCall({ hook: "test", target: hookTarget(svc.address)!, token: "wrong", method: "GET", path: "/v1/health", timeoutMs: 1000 })).rejects.toThrow();

      svc.priced = true;
      expect(await call(svc, "/v1/quote", { account, run: {}, queue: null })).toMatchObject({ allowed: true, amount: 3 });
      expect(await reserve(svc, "press-3")).toMatchObject({ ok: false, code: "price-changed" });
      const held = await reserve(svc, "press-4", { amount: 3, priceVersion: "p1" });
      expect(held).toMatchObject({ ok: true, amount: 3 });

      // A hold whose deadline has passed takes no report.
      svc.holds.get(String(held.holdId))!.closeBy = Date.now() - 1;
      await expect(call(svc, "/v1/settle", { holdId: held.holdId, generationId: "g-late", rows: 1, status: "succeeded" })).rejects.toThrow();
      expect(svc.late).toEqual([{ holdId: held.holdId, generationId: "g-late" }]);
      expect(svc.reportsFor("g-late")).toEqual([]);
    } finally {
      await svc.close();
    }
  });
});

describe("what the harness checks", () => {
  it("names each call a worker makes by its step", () => {
    expect(stepOf("/api/gpu/computer/beat")).toBe("beat");
    expect(stepOf("/api/gpu/computer/claim")).toBe("claim");
    expect(stepOf("/api/gpu/computer/tasks/abc/inputs/0")).toBe("input");
    expect(stepOf("/api/gpu/computer/tasks/abc/outputs/0?offset=0&total=9", { method: "PUT" })).toBe("part");
    expect(stepOf("/api/gpu/computer/tasks/abc/outputs/0")).toBe("other");
    expect(stepOf("/api/gpu/computer/tasks/abc/release")).toBe("release");
    for (const e of ["sent", "queued", "running", "finished", "passes", "gone", "failed"]) expect(stepOf("/api/gpu/computer/tasks/abc/report", { body: JSON.stringify({ event: e }) })).toBe(e);
    expect(stepOf("/api/gpu/computer/tasks/abc/report", { body: JSON.stringify({ event: "comfy-down" }) })).toBe("other");
  });

  it("lets a run show only In line with its place, Working and its result", async () => {
    const at = (g: Record<string, unknown>) => async () => g as never;
    const good = new RunWatch({ a: at({ status: "queued", message: POOL_WORDS.inLine, queue: { place: 2, etaSeconds: 9 } }) });
    await good.look();
    expect(good.problems({ place: 2 })).toEqual([]);

    const cases: [Record<string, unknown>, RegExp][] = [
      [{ status: "failed", error: "Timed out after 45 minutes" }, /a state that isn't/],
      [{ status: "queued", message: "Waiting for a GPU · 2 ahead", queue: { place: 3 } }, /doesn't say In line/],
      [{ status: "running", message: "ComfyUI restarted" }, /doesn't say Working/],
      [{ status: "queued", message: POOL_WORDS.inLine, queue: { place: 3 } }, /place went back from 2 to 3/],
      [{ status: "succeeded", outputs: [] }, /nothing in it/],
    ];
    for (const [g, why] of cases) {
      const w = new RunWatch({ a: at(g) });
      await w.look();
      expect(w.problems({ place: 2 }).join("\n"), JSON.stringify(g)).toMatch(why);
    }
    // A waiting run shows its place.
    const placeless = new RunWatch({ a: at({ status: "queued", message: POOL_WORDS.inLine, queue: null }) });
    await placeless.look();
    expect(placeless.problems().join("\n")).toMatch(/no place in line/);
  });

  it("counts a look that can't find the run, and a run that shows to another account", async () => {
    const run = { status: "queued", message: POOL_WORDS.inLine, queue: { place: 1, etaSeconds: null } };
    const w = new RunWatch(
      {
        here: async () => run as never,
        gone: async () => null,
        broken: async () => {
          throw new Error("GET answered 500");
        },
      },
      { refused: async () => 403, "not found": async () => 404, "another account": async () => 200, failing: async () => 500 },
    );
    await w.look();
    expect(w.problems({ place: 1 })).toEqual([
      "the run is missing from gone",
      "the run is missing from broken (GET answered 500)",
      "the run answered 200 to another account, not a refusal",
      "the run answered 500 to failing, not a refusal",
    ]);
    expect(w.seen.map((s) => s.where)).toEqual(["here"]);
  });

  it("knows a run that can't finish: one plain sentence, and Not charged only when something was set aside", () => {
    expect(POOL_WORDS.failed.match(/[.!?](\s|$)/g)).toHaveLength(1);
    expect(plainFailure({ status: "failed", error: POOL_WORDS.failed, notCharged: true }, { charged: true })).toEqual([]);
    expect(plainFailure({ status: "failed", error: POOL_WORDS.failed }, { charged: true })).toEqual(["it doesn't say Not charged"]);
    // A free run: nothing was set aside, so nothing is said about a charge.
    expect(plainFailure({ status: "failed", error: POOL_WORDS.failed }, { charged: false })).toEqual([]);
    expect(plainFailure({ status: "failed", error: POOL_WORDS.failed, notCharged: true }, { charged: false })).toEqual(["it says Not charged, but nothing was set aside"]);
    expect(plainFailure({ status: "failed", error: "Can't reach ComfyUI", fix: {} }, { charged: true })).toHaveLength(3);
    expect(plainFailure({ status: "failed", error: "This one couldn't be made. Press Retry to try again." }, { charged: false })).toEqual([expect.stringMatching(/its words are/)]);
  });
});
