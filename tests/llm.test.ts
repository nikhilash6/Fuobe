import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

vi.setConfig({ testTimeout: 40_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-llm-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const llm = await import("@/server/providers/llm");
const { getModel, modelsFor } = await import("@/lib/catalog");
const { probeComfy } = await import("@/server/providers/comfyui");

// A stand-in Ollama: answers numbered subtitle lines line by line, anything else with a prefix.
const seen: { system: string; user: string; model: string }[] = [];
const server = http.createServer((req, res) => {
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }] }));
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body) as { model: string; messages: { role: string; content: string }[] };
    const system = j.messages[0].content;
    const user = j.messages[1].content;
    seen.push({ system, user, model: j.model });
    const lang = /into (\w+)/.exec(system)?.[1] ?? "??";
    const content = /^\[\d+\]/.test(user)
      ? user
          .split("\n")
          .map((l) => l.replace(/^\[(\d+)\]\s*/, (_, n) => `[${n}] (${lang}) `))
          .join("\n")
      : `<think>hmm</think>(${lang}) ${user}`;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: { role: "assistant", content } }));
  });
});
let ollama = "";

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  ollama = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  setSetting("demoMode", "auto");
});
afterAll(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  seen.length = 0;
  setSetting("anthropicKey", "");
  setSetting("engineMode", "");
  setSetting("enhanceProvider", "");
  setSetting("demoMode", "auto");
});

async function settle(id: string, ms = 20_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

const useOllama = async (up: boolean) => {
  setSetting("ollamaUrl", up ? ollama : "http://127.0.0.1:9");
  await llm.probeOllama(true);
};

const CUES = JSON.stringify([
  { start: 0, end: 1.8, text: "Hello there." },
  { start: 2, end: 4.25, text: "This is a test\nwith two lines." },
]);

describe("text models", () => {
  it("are registered as text models with a cloud and an open route", () => {
    expect(getModel("text-llm")).toMatchObject({ kind: "text", engine: "cloud" });
    expect(getModel("oss-text-llm")).toMatchObject({ kind: "text", engine: "open" });
    // Only pickers that ask for text see them.
    expect(modelsFor({ kind: "image" }).some((m) => m.kind === "text")).toBe(false);
    expect(modelsFor({ kind: "text", ops: ["translate"] }).map((m) => m.id)).toEqual(expect.arrayContaining(["text-llm", "oss-text-llm"]));
  });
});

describe("LLM provider", () => {
  it("translates subtitles cue by cue on Ollama and keeps the timing", async () => {
    await useOllama(true);
    const [g] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: CUES, params: { targetLanguage: "Spanish" } });
    expect(g.provider).toBe("llm");
    expect(g.kind).toBe("text");
    expect(g.costUsd).toBe(0);
    const done = await settle(g.id);
    expect(done.status, done.error ?? "").toBe("succeeded");
    const out = done.outputs[0];
    expect(out).toMatchObject({ kind: "text", contentType: "application/x-subrip" });
    expect(out.url).toMatch(/\.srt$/);
    expect(out.meta?.cues).toEqual([
      { start: 0, end: 1.8, text: "(Spanish) Hello there." },
      { start: 2, end: 4.25, text: "(Spanish) This is a test\nwith two lines." },
    ]);
    expect(out.text).toBe("(Spanish) Hello there.\n(Spanish) This is a test\nwith two lines.");
    // One call for the batch, multi-line cues kept together.
    expect(seen).toHaveLength(1);
    expect(seen[0].user).toBe("[1] Hello there.\n[2] This is a test <br> with two lines.");
    expect(seen[0].model).toBe("qwen3:8b");
  });

  it("translates SRT and plain text too", async () => {
    await useOllama(true);
    const srt = "1\n00:00:01,000 --> 00:00:02,500\nBonjour\n\n2\n00:00:03,000 --> 00:00:04,000\nÇa va ?\n";
    const [a] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: srt, params: { targetLanguage: "English" } });
    const [b] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: "Good morning, friends.", params: { targetLanguage: "German" } });
    const [da, db] = [await settle(a.id), await settle(b.id)];
    expect(da.outputs[0].meta?.cues).toEqual([
      { start: 1, end: 2.5, text: "(English) Bonjour" },
      { start: 3, end: 4, text: "(English) Ça va ?" },
    ]);
    expect(db.outputs[0]).toMatchObject({ kind: "text", contentType: "text/plain", text: "(German) Good morning, friends." });
    expect(db.outputs[0].url).toMatch(/\.txt$/);
  });

  it("writes from a brief with an optional system prompt", async () => {
    await useOllama(true);
    const [g] = gens.createGenerations({ feature: "ads", modelId: "text-llm", op: "write", prompt: "Three hooks for a perfume ad", params: { extra: { system: "You write punchy hooks into French." } } });
    const done = await settle(g.id);
    expect(done.status).toBe("succeeded");
    expect(seen[0].system).toBe("You write punchy hooks into French.");
    expect(done.outputs[0].text).toBe("(French) Three hooks for a perfume ad");
  });

  it("uses Claude when a key is set (falling back to Ollama), never on the open model", async () => {
    await useOllama(true);
    setSetting("anthropicKey", "sk-ant-test");
    expect(llm.llmBackends({ endpoint: "auto" })).toEqual(["claude", "local"]);
    expect(llm.llmBackends({ endpoint: "ollama" })).toEqual(["local"]);
    setSetting("engineMode", "open");
    expect(llm.llmBackends({ endpoint: "auto" })).toEqual(["local"]);
    expect(() => gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: "x", params: { targetLanguage: "Spanish" } })).toThrow(/open source only/);
    setSetting("engineMode", "");
    setSetting("enhanceProvider", "none");
    expect(llm.llmBackends({ endpoint: "auto" })).toEqual([]);
    setSetting("enhanceProvider", "");

    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    let status = 200;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("api.anthropic.com")) return realFetch(url, init);
      sent.push({ url: String(url), body: JSON.parse(String(init!.body)) });
      const body =
        status === 200
          ? { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "Hola, amigos." }], stop_reason: "end_turn", stop_sequence: null, stop_details: null, usage: { input_tokens: 1, output_tokens: 1 } }
          : { type: "error", error: { type: "invalid_request_error", message: "nope" } };
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const [g] = gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: "Hello, friends.", params: { targetLanguage: "Spanish" } });
      expect(g.costUsd).toBe(0.02);
      const done = await settle(g.id);
      expect(done.outputs[0].text).toBe("Hola, amigos.");
      expect(sent[0].body).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "low" }, fallbacks: "default" });
      expect(String(sent[0].body.system)).toMatch(/into Spanish/);
      expect(seen).toHaveLength(0);
      // Claude fails: Ollama takes over.
      status = 400;
      const [h] = gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: "Bye.", params: { targetLanguage: "Spanish" } });
      expect((await settle(h.id)).outputs[0].text).toBe("(Spanish) Bye.");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("with no LLM: demo text in demo mode (timing kept), a clear error otherwise", async () => {
    await useOllama(false);
    const [g] = gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: CUES, params: { targetLanguage: "Italian" } });
    expect(g.provider).toBe("mock");
    const done = await settle(g.id);
    expect(done.outputs[0].meta).toMatchObject({ demo: true, cues: [{ start: 0, end: 1.8, text: "[Italian] Hello there." }, { start: 2, end: 4.25 }] });
    const [w] = gens.createGenerations({ feature: "ads", modelId: "oss-text-llm", op: "write", prompt: "A tagline for a bakery" });
    expect((await settle(w.id)).outputs[0].text).toMatch(/Demo script for: A tagline for a bakery/);
    setSetting("demoMode", "off");
    expect(() => gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: "x", params: { targetLanguage: "Italian" } })).toThrow(/Connect Claude or a local model \(Ollama, LM Studio or Unsloth Studio\) in Settings/);
    expect(() => gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "write", prompt: "x" })).toThrow(/Connect a local model \(Ollama, LM Studio or Unsloth Studio\) in Settings/);
  });

  it("asks for a language before translating", () => {
    expect(() => gens.createGenerations({ feature: "dub", modelId: "text-llm", op: "translate", prompt: "x" })).toThrow(/Pick a language/);
  });

  it("retries merged subtitle lines in smaller pieces, then cue by cue, one request at a time on Ollama", async () => {
    // A small local model: serves one request at a time, and merges every numbered batch into one line.
    let inFlight = 0;
    let most = 0;
    const users: string[] = [];
    const slow = http.createServer((req, res) => {
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [] }));
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        inFlight++;
        most = Math.max(most, inFlight);
        const user = (JSON.parse(body) as { messages: { content: string }[] }).messages[1].content;
        users.push(user);
        const lines = user.split("\n");
        const content = /^\[\d+\]/.test(user) && lines.length > 1 ? `${lines[0]} ${lines.slice(1).map((l) => l.replace(/^\[\d+\]\s*/, "")).join(" ")}` : `(es) ${user.replace(/^\[\d+\]\s*/, "")}`;
        setTimeout(() => {
          inFlight--;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ message: { content } }));
        }, 15);
      });
    });
    await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
    try {
      setSetting("ollamaUrl", `http://127.0.0.1:${(slow.address() as { port: number }).port}`);
      await llm.probeOllama(true);
      const cues = Array.from({ length: 35 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.5, text: `Line ${i + 1}` }));
      const [g] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: JSON.stringify(cues), params: { targetLanguage: "Spanish" } });
      const done = await settle(g.id);
      expect(done.status, done.error ?? "").toBe("succeeded");
      expect(done.outputs[0].meta?.cues).toEqual(cues.map((c) => ({ ...c, text: `(es) ${c.text}` })));
      // Never more than one request at Ollama, so no request's timeout runs out while it queues.
      expect(most).toBe(1);
      // 30 → three tries of 10 → cue by cue; the last 5 go cue by cue straight away.
      expect(users.filter((u) => u.split("\n").length === 30)).toHaveLength(1);
      expect(users.filter((u) => u.split("\n").length === 10)).toHaveLength(3);
      expect(users.filter((u) => u.split("\n").length === 5)).toHaveLength(1);
      expect(users.filter((u) => !u.startsWith("["))).toHaveLength(35);
    } finally {
      slow.close();
    }
  });

  it("asks Ollama itself the first time it routes to a new address, instead of falling back to demo text", async () => {
    // Ollama in its own thread, so it can answer while routing waits for it.
    const worker = new Worker(
      `const http = require("node:http");
      const { parentPort } = require("node:worker_threads");
      const s = http.createServer((req, res) => {
        if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [] }));
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => res.end(JSON.stringify({ message: { content: "(threaded) " + JSON.parse(body).messages[1].content } })));
      });
      s.listen(0, "127.0.0.1", () => parentPort.postMessage(s.address().port));`,
      { eval: true },
    );
    try {
      const port = await new Promise<number>((r) => worker.once("message", r));
      // Just changed in Settings: no probe has seen this address yet.
      setSetting("ollamaUrl", `http://127.0.0.1:${port}`);
      const [g] = gens.createGenerations({ feature: "ads", modelId: "oss-text-llm", op: "write", prompt: "A tagline for a bakery" });
      expect(g.provider).toBe("llm");
      expect((await settle(g.id)).outputs[0].text).toBe("(threaded) A tagline for a bakery");
    } finally {
      await worker.terminate();
    }
  });

  it("keeps long text out of the feed (cut inline, whole in its file) and chains the whole text", async () => {
    await useOllama(true);
    const brief = "Make it longer. ".repeat(5_000); // 80k characters
    const [g] = gens.createGenerations({ feature: "ads", modelId: "oss-text-llm", op: "write", prompt: brief });
    const done = await settle(g.id);
    expect(done.status, done.error ?? "").toBe("succeeded");
    const out = done.outputs[0];
    expect(out.text).toHaveLength(gens.MAX_INLINE_TEXT);
    expect(out.meta).toMatchObject({ truncated: true });
    const { readRef } = await import("@/server/storage");
    const full = (await readRef(out.url)).data.toString("utf8");
    expect(full.length).toBeGreaterThan(gens.MAX_INLINE_TEXT);
    expect(full.startsWith(out.text!)).toBe(true);
    // The next step reads the whole text from the file.
    const [next] = gens.createGenerations({ feature: "ads", modelId: "oss-text-llm", op: "write", prompt: "{text}", chain: [{ slot: "prompt" }] }, { dependsOn: g.id });
    const chained = await settle(next.id);
    expect(chained.request.prompt).toBe(full);
  });

  it("fails a job that a restart interrupted", async () => {
    const res = await llm.llmProvider.poll({ externalId: "llm_gone", meta: {}, route: getModel("text-llm")!.routes[0], model: getModel("text-llm")!, createdAt: Date.now() });
    expect(res).toMatchObject({ state: "failed", error: expect.stringMatching(/Interrupted/) });
  });
});

describe("open translation without Ollama: Qwen3.5 on ComfyUI", () => {
  // A stand-in ComfyUI: runs the translate workflow by answering its instruction + text the way the
  // stand-in Ollama does, and reports the text through SaveText's history entry.
  const prompts: { instruction: string; text: string; maxTokens: unknown; clip: unknown }[] = [];
  const answers = new Map<string, string>();
  let fail: string | null = null;
  const comfy = http.createServer((req, res) => {
    const reply = (v: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(v));
    };
    if (req.url === "/system_stats") return reply({ system: { comfyui_version: "0.41.0" } });
    if (req.url === "/queue") return reply({ queue_running: [], queue_pending: [] });
    if (req.url?.startsWith("/history/")) {
      const id = req.url.slice("/history/".length);
      const text = answers.get(id);
      return reply(text === undefined ? {} : { [id]: { status: { status_str: "success", completed: true }, outputs: { "4": { text: [text], files: [{ filename: `${id}.txt`, subfolder: "fuobe", type: "output" }] } } } });
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url !== "/prompt") return reply({ error: "not found" }, 404);
      if (fail) return reply({ error: { type: "prompt_outputs_failed_validation", message: fail }, node_errors: {} }, 400);
      const wf = (JSON.parse(body) as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> }).prompt;
      const join = Object.values(wf).find((n) => n.class_type === "StringConcatenate")!.inputs;
      const gen = Object.values(wf).find((n) => n.class_type === "TextGenerate")!.inputs;
      const clip = Object.values(wf).find((n) => n.class_type === "CLIPLoader")!.inputs.clip_name;
      const instruction = String(join.string_a);
      const text = String(join.string_b);
      prompts.push({ instruction, text, maxTokens: gen.max_length, clip });
      const lang = /into (\w+)/.exec(instruction)?.[1] ?? "??";
      const id = `p${prompts.length}`;
      answers.set(id, /^\[\d+\]/.test(text) ? text.split("\n").map((l) => l.replace(/^\[(\d+)\]\s*/, (_, n) => `[${n}] (${lang}·qwen) `)).join("\n") : `(${lang}·qwen) ${text}`);
      reply({ prompt_id: id, number: prompts.length });
    });
  });
  let comfyUrl = "";

  beforeAll(async () => {
    await new Promise<void>((r) => comfy.listen(0, "127.0.0.1", r));
    comfyUrl = `http://127.0.0.1:${(comfy.address() as { port: number }).port}`;
  });
  afterAll(() => {
    comfy.close();
    setSetting("comfyUrl", "");
  });
  beforeEach(async () => {
    prompts.length = 0;
    fail = null;
    setSetting("comfyUrl", comfyUrl);
    // Routing reads the cached reachability; this server shares the test's thread, so answer it here first.
    await probeComfy(true);
  });

  it("translates subtitles in the same numbered batches on ComfyUI, keeps the timing and costs nothing", async () => {
    await useOllama(false);
    expect(llm.llmBackends({ endpoint: "ollama", op: "translate" })).toEqual(["comfyui"]);
    // Only translations: writing still needs Ollama, and the cloud model never goes to ComfyUI.
    expect(llm.llmBackends({ endpoint: "ollama", op: "write" })).toEqual([]);
    expect(llm.llmBackends({ endpoint: "auto", op: "translate" })).toEqual([]);
    const [g] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: CUES, params: { targetLanguage: "Spanish", sourceLanguage: "English" } });
    expect(g.provider).toBe("llm");
    expect(g.costUsd).toBe(0);
    const done = await settle(g.id);
    expect(done.status, done.error ?? "").toBe("succeeded");
    expect(done.outputs[0]).toMatchObject({ kind: "text", contentType: "application/x-subrip" });
    expect(done.outputs[0].meta?.cues).toEqual([
      { start: 0, end: 1.8, text: "(Spanish·qwen) Hello there." },
      { start: 2, end: 4.25, text: "(Spanish·qwen) This is a test\nwith two lines." },
    ]);
    // One prompt for the batch: the subtitle instructions, then the numbered lines, on Qwen3.5 4B.
    expect(prompts).toHaveLength(1);
    expect(prompts[0].instruction).toMatch(/^You translate subtitles from English into Spanish\./);
    expect(prompts[0].instruction.endsWith("\n\n")).toBe(true);
    expect(prompts[0].text).toBe("[1] Hello there.\n[2] This is a test <br> with two lines.");
    expect(prompts[0]).toMatchObject({ maxTokens: 4096, clip: "qwen3.5_4b_bf16.safetensors" });
    expect(seen).toHaveLength(0);
  });

  it("plain text too; with Ollama up, Ollama does it", async () => {
    await useOllama(false);
    const [a] = gens.createGenerations({ feature: "captions", modelId: "oss-text-llm", op: "translate", prompt: "Good morning, friends.", params: { targetLanguage: "German" } });
    expect((await settle(a.id)).outputs[0]).toMatchObject({ kind: "text", text: "(German·qwen) Good morning, friends." });
    await useOllama(true);
    prompts.length = 0;
    expect(llm.llmBackends({ endpoint: "ollama", op: "translate" })).toEqual(["local"]);
    const [b] = gens.createGenerations({ feature: "captions", modelId: "oss-text-llm", op: "translate", prompt: "Good night.", params: { targetLanguage: "German" } });
    expect((await settle(b.id)).outputs[0].text).toBe("(German) Good night.");
    expect(prompts).toHaveLength(0);
  });

  it("a ComfyUI error fails the step with its words; with neither running, the message names both", async () => {
    await useOllama(false);
    fail = "Value not in list: clip_name: 'qwen3.5_4b_bf16.safetensors' not in []";
    const [g] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: "Hello.", params: { targetLanguage: "French" } });
    const done = await settle(g.id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/qwen3\.5_4b_bf16\.safetensors/);
    setSetting("comfyUrl", "http://127.0.0.1:9");
    await probeComfy(true);
    expect(llm.llmBackends({ endpoint: "ollama", op: "translate" })).toEqual([]);
    setSetting("demoMode", "off");
    expect(() => gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: "x", params: { targetLanguage: "French" } })).toThrow(/Connect a local model \(Ollama, LM Studio or Unsloth Studio\), or start ComfyUI with Qwen3\.5 4B/);
  });
});
