import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-ollama-reach-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const llm = await import("@/server/providers/llm");
const { REACH } = await import("@/server/providers/reach");

/**
 * The busy-vs-down rules of main's Ollama check (Fixes 5), through the local LLM layer (src/server/llm/probe.ts),
 * which applies them to every local server. Ollama is pinned here so no other local server on this machine is asked.
 */

/** A stand-in Ollama: /api/tags answers `status` after `delay` ms (busy loading a model, it answers late but takes the connection). */
let delay = 0;
let status = 200;
let asked = 0;
const server = http.createServer((req, res) => {
  if (req.url !== "/api/tags") return void res.writeHead(404).end();
  asked++;
  setTimeout(() => {
    if (res.destroyed) return;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }] }));
  }, delay);
});
let ollamaUrl = "";
const reach = { ...REACH };
/** An open-source translation: a local model runs it when one answers (ComfyUI, its fallback, is off here). */
const ROUTE = { endpoint: "ollama", op: "translate" as const };

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

/** The one cached entry (Ollama is the only server asked here). */
const entry = () => [...(globalThis.__fuobeLocalProbes?.values() ?? [])][0];

/** Forget what the probes found, as a fresh start does. */
const forget = () => {
  globalThis.__fuobeLocalProbes?.clear();
  globalThis.__fuobeLocalProbing?.clear();
};

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  ollamaUrl = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  // Checks give up sooner here, so a late answer is quick to make (a 3 s answer still makes the longer look).
  Object.assign(REACH, { answerMs: 300, connectMs: 1000, lookMs: 5000 });
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "ollama");
  setSetting("llmProvider", "ollama");
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
  setSetting("ollamaUrl", ollamaUrl);
  forget();
});

describe("Local server reachability under load (Ollama)", () => {
  it("a busy Ollama that answered before stays reachable, with its models", async () => {
    expect(await llm.probeOllama(true)).toBe(true);
    // Busy with a long generation: the answer comes long after the check gives up.
    delay = 2000;
    for (let i = 0; i < 2; i++) expect(await llm.probeOllama(true)).toBe(true);
    expect(llm.llmBackends(ROUTE)).toEqual(["local"]);
    delay = 0;
    expect(await llm.probeOllama(true)).toBe(true);
    expect(entry()?.seen).toBeGreaterThan(Date.now() - 1000);
  });

  it("a refused port is unreachable at once, in the blocking first check and the background one", async () => {
    setSetting("ollamaUrl", `http://127.0.0.1:${await closedPort()}`);
    let t0 = Date.now();
    expect(llm.llmBackends(ROUTE)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1500);
    t0 = Date.now();
    expect(await llm.probeOllama(true)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("an HTTP error is down at once, without the longer look", async () => {
    status = 503;
    asked = 0;
    const t0 = Date.now();
    expect(await llm.probeOllama(true)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(asked).toBe(1);
  });

  it("the first check of a slow but alive Ollama says reachable (blocking, then in the longer look)", async () => {
    delay = 3000;
    const t0 = Date.now();
    expect(llm.llmBackends(ROUTE)).toEqual(["local"]);
    expect(Date.now() - t0).toBeLessThan(3000);
    forget();
    expect(await llm.probeOllama(true)).toBe(true);
  });

  it("a port that takes the connection but never answers is unreachable after the longer look", async () => {
    const silent = net.createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r));
    try {
      setSetting("ollamaUrl", `http://127.0.0.1:${(silent.address() as net.AddressInfo).port}`);
      // The blocking check only sees the connection taken, as for a busy server; the background check says for sure.
      expect(llm.llmBackends(ROUTE)).toEqual(["local"]);
      await until(() => entry() && !entry()!.busy && entry()!.silent);
      expect(llm.llmBackends(ROUTE)).toEqual([]);
      // Found silent: no longer look again for a while, so the next checks are quick.
      const t0 = Date.now();
      for (let i = 0; i < 2; i++) expect(await llm.probeOllama(true)).toBe(false);
      expect(Date.now() - t0).toBeLessThan(2 * REACH.answerMs + 500);
    } finally {
      silent.close();
    }
  });

  it("Assist reads the same check: a busy Ollama keeps chats on it, with the models it last listed", async () => {
    const agent = await import("@/server/assist/agent");
    expect(await llm.probeOllama(true)).toBe(true);
    delay = 1500;
    expect(await llm.probeOllama(true)).toBe(true);
    expect(await agent.availability()).toMatchObject({ local: { ok: true, models: ["qwen3:8b"] } });
    setSetting("enhanceProvider", "auto");
    try {
      expect(await agent.resolveAgent()).toBe("local");
    } finally {
      setSetting("enhanceProvider", "ollama");
    }
    setSetting("ollamaUrl", `http://127.0.0.1:${await closedPort()}`);
    expect(await agent.availability()).toMatchObject({ local: { ok: false, models: [] } });
  });

  it("Assist doesn't wait on a server that takes the connection but never answers: it reads the check, which goes on behind", async () => {
    const agent = await import("@/server/assist/agent");
    const silent = net.createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r));
    try {
      setSetting("ollamaUrl", `http://127.0.0.1:${(silent.address() as net.AddressInfo).port}`);
      let t0 = Date.now();
      expect(await agent.availability()).toMatchObject({ local: { ok: true, models: [] } });
      expect(Date.now() - t0).toBeLessThan(2500);
      await until(() => entry() && !entry()!.busy && entry()!.silent);
      t0 = Date.now();
      expect(await agent.availability()).toMatchObject({ local: { ok: false } });
      expect(await agent.resolveMode({ mode: "free" })).toMatchObject({ agent: "offline" });
      expect(Date.now() - t0).toBeLessThan(300);
      // Its cache is old: the answer it has, at once, and a fresh check in the background.
      entry()!.at = Date.now() - 60_000;
      t0 = Date.now();
      expect(await agent.availability()).toMatchObject({ local: { ok: false } });
      expect(Date.now() - t0).toBeLessThan(300);
      await until(() => Date.now() - (entry()?.at ?? 0) < 10_000);
    } finally {
      silent.close();
    }
  });
});
