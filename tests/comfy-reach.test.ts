import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

vi.setConfig({ testTimeout: 30_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-comfy-reach-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { comfyProvider, comfyRam, probeComfy } = await import("@/server/providers/comfyui");
const { REACH } = await import("@/server/providers/reach");
const gens = await import("@/server/generations");
const { db } = await import("@/server/db");
const { saveFile } = await import("@/server/storage");

const RAM = 16 * 2 ** 30;
/** A stand-in ComfyUI: /system_stats answers `status` after `delay` ms (a busy CPU server answers late, but takes the connection). */
let delay = 0;
let status = 200;
let asked = 0;
const server = http.createServer((req, res) => {
  if (req.url !== "/system_stats") return void res.writeHead(404).end();
  asked++;
  setTimeout(() => {
    if (res.destroyed) return;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ system: { comfyui_version: "0.41.0", ram_total: RAM }, devices: [] }));
  }, delay);
});
let comfyUrl = "";
const reach = { ...REACH };

/** A port nothing listens on: connecting is refused at once. */
async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as net.AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

/** What `f` gives once it's truthy (polled every 100 ms, for at most `ms`). */
const until = async <T>(f: () => T | undefined | null | false, ms = 20_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** Forget what the probes found, as a fresh start does. */
const forget = () => {
  globalThis.__fuobeComfyReach = undefined;
  globalThis.__fuobeReachChecks?.delete("comfy");
};

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  comfyUrl = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  // Checks give up sooner here, so a late answer is quick to make (a 3 s answer still makes the longer look).
  Object.assign(REACH, { answerMs: 300, connectMs: 1000, lookMs: 5000 });
  setSetting("demoMode", "auto");
});
afterAll(() => {
  Object.assign(REACH, reach);
  server.closeAllConnections();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  delay = 0;
  status = 200;
  setSetting("comfyUrl", comfyUrl);
  forget();
});

describe("ComfyUI reachability under load", () => {
  it("a busy server that answered before stays reachable, with its RAM", async () => {
    expect(await probeComfy(true)).toBe(true);
    expect(comfyRam()).toBe(RAM);
    // Busy with a job: the answer comes long after the check gives up.
    delay = 2000;
    for (let i = 0; i < 2; i++) expect(await probeComfy(true)).toBe(true);
    expect(comfyRam()).toBe(RAM);
    expect(comfyProvider.isConfigured()).toBe(true);
    // Back to answering: still reachable, and the answer counts again.
    delay = 0;
    expect(await probeComfy(true)).toBe(true);
    expect(globalThis.__fuobeComfyReach?.seen).toBeGreaterThan(Date.now() - 1000);
  });

  it("a refused port is unreachable at once, in the blocking first check and the background one", async () => {
    setSetting("comfyUrl", `http://127.0.0.1:${await closedPort()}`);
    let t0 = Date.now();
    expect(comfyProvider.isConfigured()).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1500);
    t0 = Date.now();
    expect(await probeComfy(true)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(comfyRam()).toBeUndefined();
  });

  it("no answer in time is busy when the server answered lately, unreachable when it didn't and its port refuses", async () => {
    const url = `http://127.0.0.1:${await closedPort()}`;
    setSetting("comfyUrl", url);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;
    try {
      expect(await probeComfy(true)).toBe(false);
      // It answered a minute ago: busy, so still reachable.
      globalThis.__fuobeComfyReach = { ok: true, at: Date.now() - 60_000, url, ram: RAM, seen: Date.now() - 60_000 };
      expect(await probeComfy(true)).toBe(true);
      expect(comfyRam()).toBe(RAM);
      // Its last answer is long past, and nothing takes the connection.
      globalThis.__fuobeComfyReach = { ok: true, at: Date.now() - 60_000, url, seen: Date.now() - REACH.answeredLatelyMs - 1000 };
      expect(await probeComfy(true)).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("the first check of a slow but alive server says reachable (blocking, then in the longer look)", async () => {
    delay = 3000;
    // The routing question right after start: the server takes the connection while it's busy.
    const t0 = Date.now();
    expect(comfyProvider.isConfigured()).toBe(true);
    expect(Date.now() - t0).toBeLessThan(3000);
    forget();
    expect(await probeComfy(true)).toBe(true);
    // Callers while a check runs share it: one quick ask, one longer look.
    forget();
    asked = 0;
    expect(await Promise.all([probeComfy(true), probeComfy(true), probeComfy()])).toEqual([true, true, true]);
    expect(asked).toBe(2);
  });

  it("a port that takes the connection but never answers (a tunnel or proxy whose ComfyUI is gone) is unreachable after the longer look", async () => {
    const silent = net.createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r));
    try {
      setSetting("comfyUrl", `http://127.0.0.1:${(silent.address() as net.AddressInfo).port}`);
      // The first, blocking check can only see the connection taken, as for a busy server; the background check says for sure.
      comfyProvider.isConfigured();
      await until(() => globalThis.__fuobeComfyReach?.ok === false);
      // Found silent: no longer look again for a while, so the next checks are quick.
      const t0 = Date.now();
      for (let i = 0; i < 2; i++) expect(await probeComfy(true)).toBe(false);
      expect(Date.now() - t0).toBeLessThan(2 * REACH.answerMs + 500);
      expect(comfyProvider.isConfigured()).toBe(false);
    } finally {
      silent.close();
    }
  });

  it("a late server that answers the longer look is reachable; a check of an address changed meanwhile keeps to itself", async () => {
    delay = 1000;
    const old = probeComfy(true);
    // While that check runs, the address changes and the new one is checked.
    setSetting("comfyUrl", `http://127.0.0.1:${await closedPort()}`);
    expect(await probeComfy(true)).toBe(false);
    const now = globalThis.__fuobeComfyReach;
    expect(await old).toBe(true);
    expect(globalThis.__fuobeComfyReach).toBe(now);
    setSetting("comfyUrl", comfyUrl);
    forget();
    expect(await probeComfy(true)).toBe(true);
    expect(globalThis.__fuobeComfyReach?.seen).toBeGreaterThan(Date.now() - 1000);
    expect(comfyRam()).toBe(RAM);
  });
});

describe("a chain step after real ComfyUI steps", () => {
  /** A step that ran for real on ComfyUI: a clip (oss-fit-clip), or a still (oss-z-image-turbo). */
  const ranOnComfy = (kind: "video" | "image" = "video") => {
    const id = `comfy-${kind}-${Math.random().toString(36).slice(2, 8)}`;
    const contentType = kind === "video" ? "video/mp4" : "image/png";
    const file = saveFile({ data: Buffer.from(`not really a ${kind}`), contentType, source: "generation" }).url;
    const [model, op] = kind === "video" ? ["oss-fit-clip", "video-fit"] : ["oss-z-image-turbo", "text-to-image"];
    db()
      .prepare(
        `INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, external_id, created_at, updated_at, completed_at)
         VALUES (?, 'canvas', ?, 'open', 'comfyui', ?, ?, 'succeeded', ?, ?, 'x', ?, ?, ?)`,
      )
      .run(id, model, op, kind, JSON.stringify({ feature: "canvas", modelId: model }), JSON.stringify([{ url: file, kind, contentType }]), Date.now(), Date.now(), Date.now());
    return id;
  };
  /** Two clips that ran on ComfyUI, and the join waiting for them. */
  const join = () =>
    gens.createGenerations({ feature: "canvas", modelId: "oss-join-encoded", op: "concat", chain: [{ slot: "videos" }, { slot: "videos" }] }, { dependsOn: [ranOnComfy(), ranOnComfy()] })[0];
  /** A missed check, as a busy server that didn't answer in time left it. */
  const missed = () => (globalThis.__fuobeComfyReach = { ok: false, at: Date.now(), url: comfyUrl });
  const launched = (id: string) => until(() => {
    const g = gens.getGeneration(id)!;
    return (g.provider === "comfyui" && g.message !== "Waits for the earlier steps") || g.status === "failed" ? g : undefined;
  });

  it("isn't failed on one missed check: ComfyUI is asked again and the step runs on it", async () => {
    missed();
    const g = join();
    const done = await launched(g.id);
    expect(done.error ?? "").not.toMatch(/needs ComfyUI to continue/);
    expect(done.provider).toBe("comfyui");
  });

  it("waits while ComfyUI doesn't answer, then runs on it when it does", async () => {
    status = 503;
    missed();
    const g = join();
    const waiting = await until(() => {
      const x = gens.getGeneration(g.id)!;
      return x.message === "Waits for ComfyUI to answer" ? x : undefined;
    });
    expect(waiting.status).toBe("queued");
    // Still waiting a few sweeps later.
    await new Promise((r) => setTimeout(r, 3500));
    expect(gens.getGeneration(g.id)!.status).toBe("queued");
    status = 200;
    expect(await probeComfy(true)).toBe(true);
    const done = await launched(g.id);
    expect(done.provider).toBe("comfyui");
    expect(done.error ?? "").not.toMatch(/needs ComfyUI to continue/);
  });

  it("doesn't wait for ComfyUI when the step runs on the cloud (an Original on its cloud engine)", async () => {
    status = 503;
    missed();
    const g = gens.createGenerations(
      { feature: "canvas", modelId: "fuobe-dop", engine: "cloud", prompt: "A slow push in", chain: [{ slot: "images" }] },
      { dependsOn: ranOnComfy("image") },
    )[0];
    // No cloud key here: it's settled at once, as before, by chainMode naming the cloud provider (not by a minute's wait).
    const done: Generation = await until(() => {
      const x = gens.getGeneration(g.id)!;
      return x.status === "failed" ? x : undefined;
    }, 15_000);
    expect(done.error).toMatch(/Fuobe DoP needs (fal\.ai|Replicate) to continue/);
  });

  it("fails as before once the wait is over and ComfyUI still doesn't answer", async () => {
    const wait = gens.COMFY_WAIT.ms;
    gens.COMFY_WAIT.ms = 1000;
    try {
      status = 503;
      missed();
      const g = join();
      const done: Generation = await until(() => {
        const x = gens.getGeneration(g.id)!;
        return x.status === "failed" ? x : undefined;
      });
      expect(done.error).toMatch(/Join clips.*needs ComfyUI to continue what the earlier steps made for real/);
    } finally {
      gens.COMFY_WAIT.ms = wait;
    }
  });
});
