/**
 * Live edit's renders on the server path end, whatever ComfyUI does: against the ComfyUI stand-in, a graph identical to
 * the last one still sends its picture (the save node is never cached), an old copy of the nodes that serves it from
 * the cache fails instead of hanging, a render ComfyUI never starts hits its deadline, one dropped from the queue is
 * noticed, and a render stopped before or while it is posted never runs. Plus the session caps (sessions per person,
 * bytes per session).
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildLiveGraph, slotBindings } from "@/lib/live/graph";
import { inputName } from "@/lib/live/names";
import { startLocalComfy, type IndexLike, type LocalComfy } from "./helpers/fake-local-comfy";

vi.mock("server-only", () => ({}));

const has = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/requirements.json"), "utf8")) as IndexLike;
const fake: LocalComfy = await startLocalComfy({ cors: "off", stepMsAt512: 5, latencyMs: 2, has }, 3357);
process.env.COMFYUI_URL = fake.url;
const live = await import("@/server/live/comfy-live");
const sessions = await import("@/server/live/sessions");

let base = "";

beforeAll(async () => {
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 256, height: 320, channels: 3, background: { r: 120, g: 90, b: 60 } } }).png().toBuffer();
  const { name } = await inputName(png, "png");
  await live.stageInput(name, png, "image/png", true);
  base = name;
});
afterAll(async () => {
  globalThis.__fuobeLiveSocket?.ws?.close();
  await fake.close();
});

const graph = (prompt: string, slot: "live" | "keep" = "keep") =>
  buildLiveGraph({ prompt, seed: 7, base, ...slotBindings(slot, { liveSize: 384, keepRes: 1024, hasMask: false, to: "socket" }) }).graph;
const noop = () => {};
const posts = () => fake.log.filter((l) => l.path === "/prompt" && l.method === "POST").length;
/** ComfyUI restarted with other options: wait until the live socket has seen it go and come back. */
async function restart(o: Parameters<LocalComfy["restart"]>[0]) {
  fake.restart(o);
  await new Promise((r) => setTimeout(r, 150));
  expect(await live.waitOnline(5000)).toBe(true);
}
const later = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const deletes = () => fake.log.filter((l) => l.path === "/queue" && (l.body as { delete?: string[] } | undefined)?.delete?.length);

describe("a render always ends", () => {
  it("the same graph twice sends its picture twice (a keep of the text just settled)", async () => {
    const g = graph("a red scarf");
    const a = await live.renderLive(g, new AbortController().signal, noop);
    const b = await live.renderLive(structuredClone(g), new AbortController().signal, noop);
    expect(a.data.length).toBeGreaterThan(100);
    expect(b.data.length).toBeGreaterThan(100);
  });

  it("an old copy of the nodes served from ComfyUI's cache fails at once instead of hanging", async () => {
    await restart({ oldLiveNodes: true });
    try {
      const g = graph("a blue scarf");
      await live.renderLive(g, new AbortController().signal, noop);
      const t0 = Date.now();
      await expect(live.renderLive(structuredClone(g), new AbortController().signal, noop)).rejects.toMatchObject({ code: "failed" });
      expect(Date.now() - t0).toBeLessThan(2000);
      expect((await live.liveFacts()).outdated).toBe(true);
    } finally {
      await restart({ oldLiveNodes: false });
    }
  });

  it("a render ComfyUI never starts hits its deadline and is taken off the queue", async () => {
    await restart({ stall: true });
    try {
      const before = deletes().length;
      await expect(live.renderLive(graph("a green scarf", "live"), new AbortController().signal, noop, 600)).rejects.toMatchObject({ code: "failed" });
      await later();
      expect(deletes().length).toBeGreaterThan(before);
    } finally {
      await restart({ stall: false });
    }
  });

  it("a render dropped from ComfyUI's queue (Clear queue) is noticed", async () => {
    await restart({ stall: true });
    try {
      const p = live.renderLive(graph("a yellow scarf", "live"), new AbortController().signal, noop, 60_000);
      await new Promise((r) => setTimeout(r, 200));
      await fetch(`${fake.url}/queue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clear: true }) });
      const t0 = Date.now();
      await expect(p).rejects.toMatchObject({ code: "failed" });
      expect(Date.now() - t0).toBeLessThan(live.GONE_CHECK_MS * 3 + 1000);
    } finally {
      await restart({ stall: false });
    }
  }, 20_000);

  it("a render stopped before it is posted never reaches ComfyUI", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const before = posts();
    await expect(live.renderLive(graph("a pink scarf", "live"), ctl.signal, noop)).rejects.toMatchObject({ code: "stopped" });
    expect(posts()).toBe(before);
  });

  it("a render stopped while it is posted is deleted again once ComfyUI has it", async () => {
    await restart({ stall: true });
    try {
      const ctl = new AbortController();
      const before = deletes().length;
      const sent = posts();
      const p = live.renderLive(graph("a white scarf", "live"), ctl.signal, noop);
      // Abort the moment the prompt reaches ComfyUI, before its answer is back.
      while (posts() === sent) await later(1);
      ctl.abort();
      await expect(p).rejects.toMatchObject({ code: "stopped" });
      await later();
      expect(deletes().length - before).toBeGreaterThanOrEqual(1);
      const q = (await (await fetch(`${fake.url}/queue`)).json()) as { queue_pending: unknown[][] };
      expect(q.queue_pending).toHaveLength(0);
    } finally {
      await restart({ stall: false });
    }
  });
});

describe("live sessions are capped", () => {
  it("a person has at most 4 sessions: a fifth ends the one used longest ago", () => {
    const opened = Array.from({ length: 5 }, () => sessions.openSession("acct:cap", undefined));
    expect(sessions.sessionOf("acct:cap", opened[0].id)).toBeNull();
    for (const s of opened.slice(1)) expect(sessions.sessionOf("acct:cap", s.id)).not.toBeNull();
    // Someone else's sessions don't count.
    expect(sessions.sessionOf("acct:other", opened[1].id)).toBeNull();
  });

  it("a session holds at most SESSION_BYTES of pictures", async () => {
    const s = sessions.openSession("acct:bytes", undefined);
    const big = (i: number) => {
      // A PNG header and a large body: the stand-in takes any bytes.
      const b = new Uint8Array(30 * 2 ** 20);
      b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 1, 0]);
      b[100] = i;
      return b;
    };
    for (let i = 0; i < 8; i++) await sessions.stage(s, big(i), async () => big(i));
    expect(sessions.heldBytes(s)).toBeLessThanOrEqual(sessions.SESSION_BYTES);
    expect(s.staged.size).toBe(8);
  }, 30_000);
});
