import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 40_000 });
const dir = tempDir("fuobe-runner-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { db } = await import("@/server/db");
const { mockProvider } = await import("@/server/providers/mock");
const live = await import("@/server/live");

beforeAll(() => setSetting("demoMode", "auto"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(f: () => T | undefined | null | false, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(100);
  }
}

const row = (id: string) => db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as { status: string; external_id: string | null; error: string | null; created_at: number };
const settle = (id: string, ms = 20_000) => until(() => {
  const g = gens.getGeneration(id)!;
  return ["succeeded", "failed", "canceled"].includes(g.status) ? g : undefined;
}, ms);

const image = (prompt = "a red fox") => gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", prompt })[0];

describe("timeouts (S3)", () => {
  it("measure from submission, not creation: a step created long ago still gets its full time", async () => {
    const g = image("created two hours ago");
    await until(() => row(g.id).external_id);
    // As if the chain that made it had been waiting for two hours.
    db().prepare("UPDATE generations SET created_at = ? WHERE id = ?").run(Date.now() - 2 * 3_600_000, g.id);
    const done = await settle(g.id);
    expect(done.status).toBe("succeeded");
  });

  /** Make the demo provider report `state` for one job (by its external id) until restored. */
  const holdAt = (externalId: () => string | null, state: "queued" | "running") => {
    const poll = mockProvider.poll;
    mockProvider.poll = async (ctx) => (ctx.externalId === externalId() ? { state, message: `held ${state}` } : poll(ctx));
    return () => {
      mockProvider.poll = poll;
    };
  };

  it("time out a job that has run too long, and stop it at the provider", async () => {
    const cancel = vi.fn(async () => {});
    mockProvider.cancel = cancel;
    const g = image("runs forever");
    const restore = holdAt(() => row(g.id).external_id, "running");
    try {
      await until(() => row(g.id).external_id);
      db().prepare("UPDATE generation_runs SET started_at = ? WHERE id = ?").run(Date.now() - 46 * 60_000, g.id);
      const done = await settle(g.id);
      expect(done.status).toBe("failed");
      expect(done.error).toMatch(/Timed out after 45 minutes/);
      expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ externalId: row(g.id).external_id }));
    } finally {
      restore();
      delete mockProvider.cancel;
    }
  });

  it("collect a job that finished at the provider while the server was away, however late", async () => {
    const cancel = vi.fn(async () => {});
    mockProvider.cancel = cancel;
    try {
      const g = image("finished while the laptop slept");
      await until(() => row(g.id).external_id);
      // An hour later: the provider has long finished it (the demo job "started" an hour ago too).
      const hourAgo = Date.now() - 60 * 60_000;
      const meta = JSON.parse((db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").get(g.id) as { external_meta_json: string }).external_meta_json);
      db().prepare("UPDATE generations SET external_meta_json = ? WHERE id = ?").run(JSON.stringify({ ...meta, startedAt: hourAgo }), g.id);
      db().prepare("UPDATE generation_runs SET submitted_at = ?, started_at = ? WHERE id = ?").run(hourAgo, hourAgo, g.id);
      const done = await settle(g.id);
      expect(done.status, done.error ?? "").toBe("succeeded");
      expect(done.outputs[0]).toMatchObject({ kind: "image", url: expect.stringMatching(/^\/api\/files\//) });
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      delete mockProvider.cancel;
    }
  });

  it("give a job that never left the queue a longer, separate limit", async () => {
    const g = image("stuck in the queue");
    const restore = holdAt(() => row(g.id).external_id, "queued");
    try {
      await until(() => row(g.id).external_id);
      db().prepare("UPDATE generation_runs SET submitted_at = ?, started_at = NULL WHERE id = ?").run(Date.now() - 5 * 3_600_000, g.id);
      const done = await settle(g.id);
      expect(done.error).toMatch(/took too long to start/);
    } finally {
      restore();
    }
  });

  it("give a job that leaves the queue late its full running time", async () => {
    const g = image("finally on the GPU");
    await until(() => row(g.id).external_id);
    // Waited 5 hours in the queue, but the provider has just started it: it runs to the end.
    db().prepare("UPDATE generation_runs SET submitted_at = ?, started_at = NULL WHERE id = ?").run(Date.now() - 5 * 3_600_000, g.id);
    const restore = holdAt(() => row(g.id).external_id, "running");
    try {
      await until(() => (db().prepare("SELECT started_at FROM generation_runs WHERE id = ?").get(g.id) as { started_at: number | null }).started_at);
      expect(gens.getGeneration(g.id)!.status).toBe("running");
    } finally {
      restore();
    }
    expect((await settle(g.id)).status).toBe("succeeded");
  });
});

describe("restarts (S7)", () => {
  it("instrumentation starts the runner at boot", async () => {
    const { register } = await import("@/instrumentation");
    process.env.NEXT_RUNTIME = "nodejs";
    await register();
    expect(globalThis.__fuobeRunner).toBeDefined();
    expect(globalThis.__fuobeRunner?.fastTimer).toBeDefined();
  });

  it("fails jobs a restart cut off mid-submit on any tick, but not ones still being submitted here", async () => {
    gens.ensureRunner();
    const insert = (id: string) =>
      db()
        .prepare(
          `INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at)
           VALUES (?, 'image', 'nano-banana-pro', 'cloud', 'fal', 't2i', 'image', 'queued', '{"feature":"image","modelId":"nano-banana-pro"}', '[]', ?, ?)`,
        )
        .run(id, Date.now() - 5 * 60_000, Date.now() - 5 * 60_000);
    insert("cut-off-1");
    insert("uploading-1");
    globalThis.__fuobeSubmitting!.add("uploading-1");
    try {
      await until(() => row("cut-off-1").status === "failed", 5000);
      expect(row("cut-off-1").error).toBe("This run stopped before it started. Press Retry.");
      await sleep(1700);
      expect(row("uploading-1").status).toBe("queued");
    } finally {
      globalThis.__fuobeSubmitting!.delete("uploading-1");
    }
  });
});

describe("cancel while submitting (S13)", () => {
  it("cancels the provider's job when it lands, and keeps the row canceled", async () => {
    const real = mockProvider.submit;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const cancel = vi.fn(async () => {});
    mockProvider.submit = async (ctx) => {
      await gate;
      return real(ctx);
    };
    mockProvider.cancel = cancel;
    try {
      const g = image("slow upload");
      await sleep(50);
      await gens.cancelGeneration(g.id);
      expect(row(g.id).status).toBe("canceled");
      release();
      await until(() => cancel.mock.calls.length > 0, 3000);
      expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ externalId: expect.stringMatching(/^demo_/) }));
      await sleep(1700);
      expect(row(g.id).status).toBe("canceled");
    } finally {
      mockProvider.submit = real;
      delete mockProvider.cancel;
    }
  });

  it("doesn't turn a canceled job into a failed one when the submit then fails", async () => {
    const real = mockProvider.submit;
    let fail!: () => void;
    const gate = new Promise<void>((_, rej) => (fail = () => rej(new Error("upload failed"))));
    mockProvider.submit = async () => gate.then(() => ({ externalId: "never" }));
    try {
      const g = image("doomed upload");
      await sleep(50);
      await gens.cancelGeneration(g.id);
      fail();
      await sleep(100);
      expect(row(g.id).status).toBe("canceled");
    } finally {
      mockProvider.submit = real;
    }
  });
});

describe("colour match on video (S17)", () => {
  it("stores the result as a video and needs the video", () => {
    expect(() => gens.createGenerations({ feature: "video-color", modelId: "oss-palette-video", op: "color-match", inputs: { images: ["/api/files/x.png"] } })).toThrow(/Add the video/);
    const [g] = gens.createGenerations({ feature: "video-color", modelId: "oss-palette-video", op: "color-match", inputs: { video: "/api/files/placeholder.mp4", images: ["/api/files/placeholder.png"] } });
    expect(g.kind).toBe("video");
    expect(gens.outputKind("color-match", { kind: "image" })).toBe("image");
  });
});

describe("result latency (U19)", () => {
  it("polls a nearly finished job every 500 ms, without waiting for the 1.5 s tick", async () => {
    gens.ensureRunner();
    const runner = globalThis.__fuobeRunner!;
    const near = image("almost there");
    const far = image("just started");
    await until(() => row(near.id).external_id && row(far.id).external_id);
    // Hold the regular tick; only the fast lane may poll now.
    await until(() => !runner.busy, 5000);
    runner.busy = true;
    try {
      const done = (meta: string, ms: number) => JSON.stringify({ ...JSON.parse(meta), startedAt: Date.now() - ms });
      const m = (id: string) => (db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").get(id) as { external_meta_json: string }).external_meta_json;
      db().prepare("UPDATE generations SET status = 'running', progress = 0.95, external_meta_json = ? WHERE id = ?").run(done(m(near.id), 10_000), near.id);
      db().prepare("UPDATE generations SET status = 'running', progress = 0.2, external_meta_json = ? WHERE id = ?").run(done(m(far.id), 10_000), far.id);
      db().prepare("UPDATE generation_runs SET started_at = ? WHERE id = ?").run(Date.now() - 1000, far.id);
      const t0 = Date.now();
      await until(() => row(near.id).status === "succeeded", 3000);
      expect(Date.now() - t0).toBeLessThan(1500);
      expect(row(far.id).status).toBe("running");
    } finally {
      runner.busy = false;
    }
  });
});

describe("live updates", () => {
  it("emits every insert and update as the Generation JSON, and deletes as {id}", async () => {
    gens.ensureRunner();
    const events: { type: string; data: unknown }[] = [];
    const off = live.subscribe((e) => events.push({ type: e.type, data: JSON.parse(e.json) }));
    try {
      const g = image("live fox");
      await settle(g.id);
      await sleep(50);
      const mine = events.filter((e) => (e.data as { id: string }).id === g.id);
      expect(mine[0]).toMatchObject({ type: "generation", data: { id: g.id, status: "queued" } });
      expect(mine.some((e) => (e.data as Generation).status === "running")).toBe(true);
      const last = mine.at(-1)!.data as Generation;
      expect(last.status).toBe("succeeded");
      // Exactly what the REST list returns for it.
      expect(last).toEqual(JSON.parse(JSON.stringify(gens.listGenerations({ limit: 200 }).find((x) => x.id === g.id))));
      gens.deleteGeneration(g.id);
      await sleep(50);
      expect(events.at(-1)).toEqual({ type: "deleted", data: { id: g.id } });
    } finally {
      off();
    }
    expect(live.listenerCount()).toBe(0);
  });

  it("streams server-sent events with pings, and drops the listener when the client goes away", async () => {
    const before = live.listenerCount();
    const ac = new AbortController();
    const res = live.generationEventStream(ac.signal, { pingMs: 100 });
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("no-transform");
    expect(live.listenerCount()).toBe(before + 1);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const g = image("streamed fox");
    const until2 = Date.now() + 8000;
    while (!(text.includes(": ping") && text.includes(`"id":"${g.id}"`)) && Date.now() < until2) {
      const { value } = await reader.read();
      text += dec.decode(value);
    }
    expect(text).toMatch(/^retry: 2000\n/);
    expect(text).toContain("event: generation\ndata: {");
    expect(text).toContain(": ping\n\n");
    ac.abort();
    expect(live.listenerCount()).toBe(before);
    await gens.cancelGeneration(g.id);
  });
});
