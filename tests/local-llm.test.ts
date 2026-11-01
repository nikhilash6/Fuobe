import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Generation } from "@/lib/catalog/types";

/*
 * Local LLM servers besides Ollama: LM Studio, Unsloth Studio and any OpenAI-compatible server
 * (llama.cpp's llama-server here). The wire builders and parsers are tested on their own; then
 * stand-in servers on this machine answer Fuobe's real code paths (Enhance, a storyboard split, a
 * text step, an Assist chat with a tool call, /api/status and /api/llm).
 */

vi.setConfig({ testTimeout: 60_000 });
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-local-llm-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
// Keys from this machine's environment must not reach the stand-ins.
for (const k of ["LM_API_TOKEN", "LMSTUDIO_API_TOKEN", "UNSLOTH_API_KEY", "UNSLOTH_STUDIO_AUTH_TOKEN", "FUOBE_LLM_URL", "FUOBE_LLM_API_KEY", "FUOBE_LLM_PROVIDER", "FUOBE_ENHANCE_PROVIDER"]) delete process.env[k];

const { parseContext, publicSettings, setSetting, validateSetting } = await import("@/server/settings");
const local = await import("@/server/llm");
const wire = await import("@/server/llm/wire");
const messages = await import("@/server/llm/messages");
const { interpret } = await import("@/server/llm/probe");
const { httpError, rejectsJson } = await import("@/server/llm/errors");
const llm = await import("@/server/providers/llm");
const gens = await import("@/server/generations");
const { enhancePrompt, llmText } = await import("@/server/enhance");
const { splitStory } = await import("@/server/storyboard");
const agent = await import("@/server/assist/agent");

type Body = Record<string, unknown> & { messages?: { role: string; content: string | null; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[]; tool_call_id?: string }[] };
interface Seen {
  method: string;
  url: string;
  auth?: string;
  body: Body;
}

/** A stand-in HTTP server on a free port: `handle` answers each request (JSON), every request is kept in `seen`. */
function stub(handle: (r: Seen, res: http.ServerResponse) => unknown) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const r: Seen = { method: req.method ?? "GET", url: req.url ?? "/", auth: req.headers.authorization, body: raw ? (JSON.parse(raw) as Body) : {} };
      seen.push(r);
      const out = await handle(r, res);
      if (out === undefined || res.writableEnded) return;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out));
    });
  });
  const s = {
    seen,
    url: "",
    chats: () => seen.filter((r) => r.url.endsWith("/chat/completions") || r.url === "/api/chat").map((r) => r.body),
    start: () => new Promise<void>((done) => server.listen(0, "127.0.0.1", () => ((s.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`), done()))),
    close: () => server.close(),
  };
  return s;
}

const fail = (res: http.ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  return body;
};

/** An OpenAI chat.completion with one choice. */
const completion = (message: Record<string, unknown>, finish = "stop", model = "qwen/qwen3-8b") =>
  ({
    id: "chatcmpl-1",
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }],
  }) as unknown as Parameters<typeof wire.parseOpenai>[0];

const lastUser = (b: Body) => (b.messages ?? []).filter((m) => m.role === "user").at(-1)?.content ?? "";
const systemOf = (b: Body) => (b.messages?.[0]?.role === "system" ? (b.messages[0].content ?? "") : "");

/** "[1] Hello" lines back as "[1] (lang) Hello", like the stand-in Ollama in llm.test.ts. */
function translate(b: Body, tag: string): string {
  const lang = /into (\w+)/.exec(systemOf(b))?.[1] ?? "??";
  const user = lastUser(b);
  return /^\[\d+\]/.test(user)
    ? user
        .split("\n")
        .map((l) => l.replace(/^\[(\d+)\]\s*/, (_, n) => `[${n}] (${lang}·${tag}) `))
        .join("\n")
    : `(${lang}·${tag}) ${user}`;
}

/**
 * A stand-in LM Studio 0.4: its own model list (one LLM trained for tool use, one embedding model),
 * load and unload, the OpenAI model list and chat completions with tools, JSON schemas and thinking.
 */
function lmStudio(opts: { token?: string; loaded?: number } = {}) {
  const state = { context: opts.loaded ?? null as number | null, loads: [] as Body[], unloads: [] as Body[], aborted: 0 };
  const s = stub((r, res) => {
    if (opts.token && r.auth !== `Bearer ${opts.token}`) return fail(res, 401, { error: "Unauthorized: this server requires an API token" });
    if (r.url === "/api/v1/models") {
      return {
        models: [
          {
            type: "llm",
            publisher: "qwen",
            key: "qwen/qwen3-8b",
            display_name: "Qwen3 8B",
            loaded_instances: state.context ? [{ id: "qwen/qwen3-8b", config: { context_length: state.context } }] : [],
            max_context_length: 32768,
            format: "gguf",
            capabilities: { vision: false, trained_for_tool_use: true },
          },
          { type: "embedding", publisher: "nomic-ai", key: "text-embedding-nomic-embed-text-v1.5", loaded_instances: [], max_context_length: 2048, format: "gguf" },
        ],
      };
    }
    if (r.url === "/v1/models") return { object: "list", data: [{ id: "qwen/qwen3-8b" }, { id: "text-embedding-nomic-embed-text-v1.5" }] };
    if (r.url === "/api/v1/models/load") {
      state.loads.push(r.body);
      state.context = r.body.context_length as number;
      return { type: "llm", instance_id: r.body.model, load_time_seconds: 2.5, status: "loaded", load_config: { context_length: r.body.context_length } };
    }
    if (r.url === "/api/v1/models/unload") {
      state.unloads.push(r.body);
      state.context = null;
      return { instance_id: r.body.instance_id };
    }
    if (r.url !== "/v1/chat/completions") return fail(res, 404, { error: "Unexpected endpoint" });
    const b = r.body;
    const user = lastUser(b);
    if (user.includes("OVERFLOW")) {
      return fail(res, 400, { error: "Trying to keep the first 9000 tokens when context the overflows. However, the model is loaded with context length of only 4096 tokens, which is not enough. Try to load the model with a larger context length" });
    }
    if (user.includes("THINK FOREVER")) return completion({ content: "", reasoning_content: "Let me think about this for a very long time…" }, "length");
    if (user.includes("SLOW")) {
      res.on("close", () => !res.writableEnded && state.aborted++);
      return undefined;
    }
    if (b.tools) {
      // Assist: look up models first, answer once the tool's result is back.
      if (!b.messages?.some((m) => m.role === "tool")) {
        return completion({ content: "Let me look.", tool_calls: [{ id: "call_8f2", type: "function", function: { name: "search_models", arguments: '{"kind":"image"}' } }] }, "tool_calls");
      }
      return completion({ content: "Nano Banana Pro is a great pick.", reasoning_content: "The search found it." });
    }
    const format = b.response_format as { json_schema?: { name?: string; schema?: { minItems?: number } } } | undefined;
    if (format?.json_schema?.name === "frames") {
      const n = format.json_schema.schema?.minItems ?? 1;
      return completion({ content: JSON.stringify(Array.from({ length: n }, (_, i) => `Frame ${i + 1}: the fox crosses the snowfield, wide shot, dusk light`)) });
    }
    if (systemOf(b).startsWith("You rewrite short creative ideas")) {
      return completion({ content: "<think>Add light and lens.</think>A red fox trotting through deep snow at golden hour, low angle, 85mm lens, soft rim light.", reasoning_content: "hidden" });
    }
    return completion({ content: translate(b, "lms") });
  });
  return Object.assign(s, { state });
}

/** A stand-in Unsloth Studio: liveness without a key, everything under /v1 with one. */
function unslothStudio(key = "sk-unsloth-test") {
  return stub((r, res) => {
    if (r.url === "/api/liveness") return { status: "alive", service: "Unsloth UI Backend", desktop_protocol_version: 1 };
    if (r.auth !== `Bearer ${key}`) return fail(res, 401, { error: { message: "Invalid or missing API key", type: "invalid_request_error", code: "invalid_api_key" } });
    if (r.url === "/v1/models") {
      return {
        object: "list",
        data: [
          { id: "unsloth/Qwen3-8B-GGUF", object: "model", owned_by: "unsloth", loaded: true, context_length: 16384, status: { value: "loaded" } },
          { id: "unsloth/gemma-3-12b-it-GGUF", object: "model", owned_by: "unsloth", loaded: false, status: { value: "unloaded" } },
          { id: "unsloth/orpheus-3b-0.1-ft-GGUF", object: "model", task: "text-to-speech", loaded: false },
        ],
      };
    }
    if (r.url === "/v1/chat/completions") return completion({ content: translate(r.body, "unsloth"), reasoning_content: null }, "stop", "unsloth/Qwen3-8B-GGUF");
    return fail(res, 404, { detail: "Not Found" });
  });
}

/** A stand-in llama-server: one model, and no structured output. */
function llamaServer() {
  return stub((r, res) => {
    if (r.url === "/v1/models") return { object: "list", data: [{ id: "gemma-3-4b-it-Q4_K_M.gguf", object: "model", owned_by: "llamacpp" }] };
    if (r.url !== "/v1/chat/completions") return fail(res, 404, { error: { code: 404, message: "File Not Found", type: "not_found_error" } });
    if (r.body.response_format) return fail(res, 400, { error: { code: 400, message: "Unsupported response_format: json_schema", type: "invalid_request_error" } });
    return completion({ content: '```json\n{"reply": "Sure — four ads coming up.", "make": null}\n```' }, "stop", "gemma-3-4b-it-Q4_K_M.gguf");
  });
}

/** A stand-in Ollama (its own API), for the order Automatic picks servers in. */
function ollama(models = [{ name: "qwen3:8b" }]) {
  return stub((r) => (r.url === "/api/tags" ? { models } : { model: "qwen3:8b", message: { role: "assistant", content: "(ollama) ok" }, done_reason: "stop" }));
}

const servers: { close: () => void }[] = [];
async function started<T extends { start: () => Promise<void>; close: () => void }>(s: T): Promise<T> {
  await s.start();
  servers.push(s);
  return s;
}

async function settle(id: string, ms = 30_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const SETTINGS = ["llmProvider", "lmstudioUrl", "lmstudioModel", "lmstudioToken", "unslothUrl", "unslothModel", "unslothKey", "llmUrl", "llmModel", "llmKey", "llmContext", "enhanceProvider", "anthropicKey", "engineMode"] as const;

beforeAll(() => setSetting("demoMode", "off"));
beforeEach(() => {
  for (const k of SETTINGS) setSetting(k, "");
  setSetting("ollamaUrl", "");
});
afterAll(() => {
  for (const s of servers) s.close();
  // Windows keeps the open SQLite file locked until the worker exits.
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

// ---------------------------------------------------------------------------

describe("the OpenAI wire", () => {
  const tools = [{ name: "search_models", description: "Find models", parameters: { type: "object", properties: { kind: { type: "string" } } } }];

  it("sends tools, tool calls with string arguments and tool results with their call's id", () => {
    const body = wire.openaiBody(
      "lmstudio",
      {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hi" },
          { role: "assistant", content: "", toolCalls: [{ id: "Ab3dE5gH9", name: "search_models", input: { kind: "image" } }] },
          { role: "tool", toolCallId: "Ab3dE5gH9", toolName: "search_models", content: '{"models":[]}' },
        ],
        tools,
        timeoutMs: 1,
      },
      "qwen/qwen3-8b",
    );
    expect(body).toMatchObject({ model: "qwen/qwen3-8b", stream: false, tool_choice: "auto", tools: [{ type: "function", function: { name: "search_models", description: "Find models", parameters: tools[0].parameters } }] });
    const msgs = body.messages as Record<string, unknown>[];
    expect(msgs[2]).toEqual({ role: "assistant", content: null, tool_calls: [{ id: "Ab3dE5gH9", type: "function", function: { name: "search_models", arguments: '{"kind":"image"}' } }] });
    expect(msgs[3]).toEqual({ role: "tool", tool_call_id: "Ab3dE5gH9", content: '{"models":[]}' });
    // Nothing a server doesn't need: no JSON format, no token cap, no Unsloth extras.
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("enable_tools");
  });

  it("asks each server for JSON the way it understands, and keeps Unsloth's server-side tools off", () => {
    const schema = { name: "ads", schema: { type: "object", properties: { ads: { type: "array" } } } };
    const req = { messages: [{ role: "user" as const, content: "x" }], json: schema, think: false, timeoutMs: 1 };
    expect(wire.openaiBody("lmstudio", req, "m").response_format).toEqual({ type: "json_schema", json_schema: { name: "ads", schema: schema.schema } });
    expect(wire.openaiBody("unsloth", req, null).response_format).toEqual({ type: "json_schema", json_schema: { name: "ads", strict: true, schema: schema.schema } });
    expect(wire.responseFormat("lmstudio", "object")).toEqual({ type: "json_schema", json_schema: { name: "answer", schema: { type: "object" } } });
    expect(wire.responseFormat("custom", "object")).toEqual({ type: "json_object" });
    // A server that can't do it: the same call without.
    expect(wire.openaiBody("custom", req, "m", false)).not.toHaveProperty("response_format");
    // Unsloth: the loaded model answers (no model named), thinking off for one-shot text, server-side tools always off.
    const unsloth = wire.openaiBody("unsloth", req, null);
    expect(unsloth).not.toHaveProperty("model");
    expect(unsloth).toMatchObject({ enable_tools: false, enable_thinking: false });
    expect(wire.openaiBody("unsloth", { ...req, think: undefined }, null)).toMatchObject({ enable_tools: false });
    expect(wire.openaiBody("unsloth", { ...req, think: undefined }, null)).not.toHaveProperty("enable_thinking");
  });

  it("reads answers: thinking dropped, tool calls parsed, the stop reason mapped", () => {
    const a = wire.parseOpenai(completion({ content: "<think>plan</think>Done.", reasoning_content: "more" }), "m");
    expect(a).toMatchObject({ text: "Done.", toolCalls: [], stop: "end", thought: true, model: "qwen/qwen3-8b" });
    const b = wire.parseOpenai(
      completion({ content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "generate", arguments: '{"summary":"x"}' } }, { id: "2", function: { name: "generate", arguments: "{jobs: [" } }] }, "tool_calls"),
      "m",
    );
    expect(b.stop).toBe("tool_use");
    expect(b.toolCalls.map((c) => c.input)).toEqual([{ summary: "x" }, { INVALID_JSON: "{jobs: [" }]);
    // Fuobe's own ids, nine letters and digits (strict templates want them; Claude accepts them).
    expect(b.toolCalls.every((c) => /^[A-Za-z0-9]{9}$/.test(c.id))).toBe(true);
    expect(wire.parseOpenai(completion({ content: "", reasoning_content: "hmm" }, "length"), "m")).toMatchObject({ text: "", stop: "length", thought: true });
    // A template that opened <think> in the prompt leaves only the closing tag; a cut-off thought leaves nothing.
    expect(wire.stripThink("weighing options</think>\n\nThe answer.")).toBe("The answer.");
    expect(wire.stripThink("Answer first.<think>and then a thought that never")).toBe("Answer first.");
  });

  it("keeps Ollama's own wire: num_ctx, think, a schema as `format`, tool names on results", () => {
    const body = wire.ollamaBody(
      {
        messages: [
          { role: "system", content: "s" },
          { role: "assistant", content: "", toolCalls: [{ id: "x", name: "search_models", input: { kind: "image" } }] },
          { role: "tool", toolName: "search_models", content: "{}" },
        ],
        json: { name: "t", schema: { type: "object" } },
        think: false,
        timeoutMs: 1,
      },
      "qwen3:8b",
      16384,
    );
    expect(body).toMatchObject({ model: "qwen3:8b", stream: false, think: false, format: { type: "object" }, options: { num_ctx: 16384 } });
    expect((body.messages as Record<string, unknown>[])[1]).toEqual({ role: "assistant", content: "", tool_calls: [{ function: { name: "search_models", arguments: { kind: "image" } } }] });
    expect((body.messages as Record<string, unknown>[])[2]).toEqual({ role: "tool", content: "{}", tool_name: "search_models" });
    expect(wire.ollamaBody({ messages: [], json: "object", timeoutMs: 1 }, "m", 0)).toMatchObject({ format: "json" });
    expect(wire.ollamaBody({ messages: [], timeoutMs: 1 }, "m", 0)).not.toHaveProperty("options");
    const r = wire.parseOllama({ message: { content: "<think>x</think>Hi", tool_calls: [{ function: { name: "generate", arguments: { a: 1 } } }] }, done_reason: "stop" }, "qwen3:8b");
    expect(r).toMatchObject({ text: "Hi", stop: "tool_use", toolCalls: [{ name: "generate", input: { a: 1 } }] });
  });
});

describe("Assist history for strict chat templates", () => {
  type Param = Anthropic.Beta.BetaMessageParam;
  const system = { stable: "You are Fuobe Assist.", turn: "Today is Friday." };
  const history = [
    { role: "user", content: [{ type: "text", text: "Make a fox." }, { type: "image", source: { type: "url", url: "/api/files/a.png" } }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "…", signature: "s" }, { type: "text", text: "Looking." }, { type: "tool_use", id: "toolu_01AbCdEfGhIjKlMnOp", name: "search_models", input: { kind: "image" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01AbCdEfGhIjKlMnOp", content: [{ type: "text", text: '{"models":[]}' }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } }] }] },
    { role: "system", content: "Context update: auto-run is on." },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_02", name: "generate", input: { summary: "x" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_02", is_error: true, content: "Invalid input: jobs" }, { type: "text", text: "Try again." }] },
    { role: "system", content: "Context update: a memory was saved." },
  ] as unknown as Param[];

  it("has one system message, folds context updates into user turns and keeps call ids matched", () => {
    const out = messages.toChatMessages(system, history, "lmstudio");
    expect(out.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "user", "assistant", "tool", "user"]);
    expect(out.filter((m) => m.role === "system")).toHaveLength(1);
    expect(out[0].content).toBe("You are Fuobe Assist.\n\nToday is Friday.");
    // Images stay out (the user's text lists their URLs); a tool's image reads as a note.
    expect(out[1].content).toBe("Make a fox.");
    expect(out[3].content).toBe('{"models":[]}\n[image omitted]');
    // After tool results, the update is a user turn of its own; after the user's words, it joins them.
    expect(out[4].content).toBe(`${messages.CONTEXT_UPDATE_LABEL}\nContext update: auto-run is on.`);
    expect(out[6]).toMatchObject({ role: "tool", content: "Error: Invalid input: jobs" });
    expect(out[7].content).toBe(`Try again.\n\n${messages.CONTEXT_UPDATE_LABEL}\nContext update: a memory was saved.`);
    // Thinking dropped; nine-character ids, the same on the call and its result, and stable.
    expect(out[2]).toMatchObject({ content: "Looking.", toolCalls: [{ name: "search_models", input: { kind: "image" } }] });
    const id = out[2].toolCalls![0].id;
    expect(id).toMatch(/^[A-Za-z0-9]{9}$/);
    expect(out[3].toolCallId).toBe(id);
    expect(messages.wireId("toolu_01AbCdEfGhIjKlMnOp")).toBe(id);
    expect(out[5].toolCalls![0].id).toBe(out[6].toolCallId);
    expect(messages.wireId("Ab3dE5gH9")).toBe("Ab3dE5gH9");
  });

  it("gives Ollama the history as before: system context updates, tool names on results", () => {
    const out = messages.toChatMessages(system, history, "ollama");
    expect(out.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "system", "assistant", "tool", "user", "system"]);
    expect(out[3]).toMatchObject({ toolName: "search_models", toolCallId: "toolu_01AbCdEfGhIjKlMnOp" });
  });

  it("reads tool calls a model wrote as text, for the offered tools only", () => {
    const names = new Set(["search_models", "generate"]);
    const hermes = messages.healToolCalls('Sure.\n<tool_call>\n{"name": "search_models", "arguments": {"kind": "video"}}\n</tool_call>', names);
    expect(hermes).toMatchObject({ text: "Sure.", calls: [{ name: "search_models", input: { kind: "video" } }] });
    const lms = messages.healToolCalls('[TOOL_REQUEST]{"name": "generate", "arguments": {"summary": "fox"}}[END_TOOL_REQUEST]', names);
    expect(lms).toMatchObject({ text: "", calls: [{ name: "generate", input: { summary: "fox" } }] });
    // Llama 3 writes "parameters"; a fenced reply that is only the call counts too.
    expect(messages.healToolCalls('```json\n{"name": "search_models", "parameters": {"kind": "audio"}}\n```', names).calls).toMatchObject([{ input: { kind: "audio" } }]);
    // Not a tool we offered, or not a call at all: the text stays.
    expect(messages.healToolCalls('<tool_call>{"name": "rm", "arguments": {}}</tool_call>', names)).toMatchObject({ calls: [], text: '<tool_call>{"name": "rm", "arguments": {}}</tool_call>' });
    expect(messages.healToolCalls('{"name": "Fox", "colour": "red"}', names).calls).toEqual([]);
  });
});

describe("reading a server's answers", () => {
  const server = (kind: "ollama" | "lmstudio" | "unsloth" | "custom", over: Partial<{ url: string; model: string; key: string }> = {}) => ({ kind, label: local.LOCAL_LABELS[kind], url: "http://127.0.0.1:1234", model: "", key: "", ...over });

  it("LM Studio: chat models only, a loaded one first, warnings for a small context, problems that say what to do", () => {
    const models = (loaded: number | null, extra: unknown[] = []) => ({
      native: {
        status: 200,
        body: {
          models: [
            { type: "embedding", key: "nomic-embed", loaded_instances: [{ id: "nomic-embed", config: { context_length: 2048 } }] },
            { type: "llm", key: "google/gemma-3-12b", loaded_instances: [], max_context_length: 131072, capabilities: { trained_for_tool_use: false } },
            { type: "llm", key: "qwen/qwen3-8b", loaded_instances: loaded ? [{ id: "qwen/qwen3-8b", config: { context_length: loaded } }] : [], max_context_length: 40960, capabilities: { trained_for_tool_use: true, reasoning: { allowed_options: ["off", "on"], default: "on" } } },
            ...extra,
          ],
        },
      },
    });
    const ready = interpret(server("lmstudio"), models(16384), 16384, 0);
    expect(ready).toMatchObject({ up: true, problem: null, model: "qwen/qwen3-8b", loaded: true, context: 16384, native: true });
    expect(ready.models.map((m) => m.id)).toEqual(["google/gemma-3-12b", "qwen/qwen3-8b"]);
    expect(ready.warning).toMatch(/thinks before it answers/);
    // Nothing loaded: the one trained for tool use.
    expect(interpret(server("lmstudio"), models(null), 16384, 0)).toMatchObject({ model: "qwen/qwen3-8b", loaded: false, problem: null });
    expect(interpret(server("lmstudio"), models(4096), 16384, 0).warning).toMatch(/loaded with 4,096 tokens of context; Assist and long texts need about 16,384\. Reload it with 16k context/);
    expect(interpret(server("lmstudio", { model: "mistral/ministral-8b" }), models(null), 16384, 0).problem).toMatch(/LM Studio has no model called mistral\/ministral-8b.*lms get mistral\/ministral-8b/);
    expect(interpret(server("lmstudio", { model: "qwen/qwen3-8b@q4_k_m" }), models(null), 16384, 0)).toMatchObject({ problem: null, model: "qwen/qwen3-8b@q4_k_m" });
    expect(interpret(server("lmstudio"), { native: { status: 200, body: { models: [] } } }, 16384, 0).problem).toMatch(/no chat models downloaded yet.*lms get/);
    expect(interpret(server("lmstudio"), { native: { status: 401, body: {} }, openai: { status: 401, body: {} } }, 16384, 0)).toMatchObject({ up: true, auth: "missing", problem: expect.stringMatching(/Manage Tokens/) });
    expect(interpret(server("lmstudio", { key: "bad" }), { native: { status: 401, body: {} } }, 16384, 0)).toMatchObject({ auth: "rejected", problem: expect.stringMatching(/rejected the API token/) });
    expect(interpret(server("lmstudio"), { native: { error: "ECONNREFUSED" }, openai: { error: "ECONNREFUSED" } }, 16384, 0).problem).toBe(
      "LM Studio isn't running at http://127.0.0.1:1234. Start LM Studio's local server and load a model: in LM Studio, Developer → Start server (or run `lms server start`).",
    );
    // Before 0.4: the OpenAI list, embeddings dropped.
    expect(interpret(server("lmstudio"), { native: { status: 404, body: {} }, openai: { status: 200, body: { data: [{ id: "text-embedding-x" }, { id: "llama-3.2-3b-instruct" }] } } }, 16384, 0)).toMatchObject({ problem: null, native: false, model: "llama-3.2-3b-instruct", loaded: null });
  });

  it("Unsloth Studio: itself (not Jupyter), its key, a loaded chat model", () => {
    const live = { status: 200, body: { status: "alive", service: "Unsloth UI Backend" } };
    const rows = { status: 200, body: { data: [{ id: "unsloth/tts", task: "text-to-speech", loaded: true }, { id: "unsloth/Qwen3-8B-GGUF", loaded: false }] } };
    expect(interpret(server("unsloth"), { live: { status: 200, body: { status: "ok" } }, openai: rows }, 16384, 0).problem).toMatch(/Something else answers at .*not Unsloth Studio/);
    expect(interpret(server("unsloth"), { live, openai: { status: 401, body: {} } }, 16384, 0)).toMatchObject({ auth: "missing", problem: expect.stringMatching(/avatar → Settings → API → Create.*sk-unsloth-/) });
    expect(interpret(server("unsloth", { key: "sk-unsloth-x" }), { live, openai: rows }, 16384, 0)).toMatchObject({ up: true, problem: expect.stringMatching(/no model loaded.*Chat page/) });
    const loaded = { status: 200, body: { data: [{ id: "unsloth/Qwen3-8B-GGUF", loaded: true, context_length: 8192 }] } };
    expect(interpret(server("unsloth", { key: "sk-unsloth-x" }), { live, openai: loaded }, 16384, 0)).toMatchObject({ problem: null, model: "unsloth/Qwen3-8B-GGUF", loaded: true, warning: expect.stringMatching(/8,192 tokens.*Load it in Unsloth Studio with a larger context/) });
    expect(interpret(server("unsloth", { model: "unsloth/Qwen3-8B-GGUF:Q4_K_M" }), { live, openai: loaded }, 16384, 0)).toMatchObject({ problem: null, model: "unsloth/Qwen3-8B-GGUF:Q4_K_M" });
  });

  it("another OpenAI-compatible server: its URL, its first model; Ollama: up whenever it answers", () => {
    expect(interpret(server("custom", { url: "" }), {}, 16384, 0).problem).toMatch(/Set the server's URL/);
    expect(interpret(server("custom"), { openai: { status: 200, body: { data: [{ id: "bge-embed" }, { id: "Qwen3-8B" }] } } }, 16384, 0)).toMatchObject({ problem: null, model: "Qwen3-8B" });
    expect(interpret(server("custom"), { openai: { status: 200, body: { data: [] } } }, 16384, 0).problem).toMatch(/lists no models/);
    expect(interpret(server("ollama", { model: "qwen3:8b" }), { tags: { status: 200, body: { models: [] } } }, 16384, 0)).toMatchObject({ up: true, problem: null, model: "qwen3:8b", warning: expect.stringMatching(/ollama pull qwen3:8b/) });
  });

  it("LM Studio: a display name finds the model and calls use its key; a model's most context ends the reload advice", () => {
    const native = (loaded: number | null, max: number) => ({
      native: {
        status: 200,
        body: { models: [{ type: "llm", key: "qwen/qwen3-8b", display_name: "Qwen3 8B", loaded_instances: loaded ? [{ id: "qwen/qwen3-8b", config: { context_length: loaded } }] : [], max_context_length: max }] },
      },
    });
    expect(interpret(server("lmstudio", { model: "Qwen3 8B" }), native(null, 40960), 16384, 0)).toMatchObject({ problem: null, model: "qwen/qwen3-8b" });
    // Loaded at its most (8k): no "Reload with 16k" (it would load 8k again), just what it can hold.
    const full = interpret(server("lmstudio"), native(8192, 8192), 16384, 0);
    expect(full.warning).toMatch(/handles only 8,192 tokens of context/);
    expect(full.warning).not.toMatch(/Reload/);
    expect(interpret(server("lmstudio"), native(4096, 8192), 16384, 0).warning).toMatch(/loaded with 4,096 tokens.*Reload it with 8k context/);
  });

  it("reads context sizes as people write them, and finds keys under their other env names", () => {
    expect(["16384", "16,384", "16 384", "16_384", "16k", "16K"].map(parseContext)).toEqual([16384, 16384, 16384, 16384, 16384, 16384]);
    expect(parseContext("0")).toBe(0);
    for (const bad of ["16", "1000", "abc", "-1", ""]) expect(parseContext(bad)).toBeNull();
    expect(() => validateSetting("llmContext", "16")).toThrow(/at least 2048/);
    expect(() => validateSetting("llmContext", "16,384")).not.toThrow();
    setSetting("llmContext", "32k");
    expect(local.llmContext()).toBe(32768);
    setSetting("llmContext", "");
    expect(local.llmContext()).toBe(16384);
    process.env.LM_API_TOKEN = "lm-alias-token-1234";
    process.env.UNSLOTH_STUDIO_AUTH_TOKEN = "sk-unsloth-alias-5678";
    try {
      const shown = Object.fromEntries(publicSettings().map((s) => [s.name, s]));
      expect(shown.lmstudioToken).toMatchObject({ isSet: true, fromEnv: true, value: "lm-a••••1234" });
      expect(shown.unslothKey).toMatchObject({ isSet: true, fromEnv: true, value: "sk-u••••5678" });
      expect(local.localServer("lmstudio").key).toBe("lm-alias-token-1234");
    } finally {
      delete process.env.LM_API_TOKEN;
      delete process.env.UNSLOTH_STUDIO_AUTH_TOKEN;
    }
  });

  it("reads Unsloth Studio's nested error bodies", () => {
    const uns = server("unsloth");
    const nested = (message: string, code?: string) => JSON.stringify({ detail: { error: { message, type: "invalid_request_error", ...(code && { code }) } } });
    expect(httpError(uns, 400, nested("Request has 20000 tokens, more than the 8192 the model was loaded with.", "context_length_exceeded"), null).message).toBe(
      "This is longer than the model's context on Unsloth Studio. Load it in Unsloth Studio with a larger context, or use shorter text.",
    );
    expect(httpError(uns, 400, nested("Too long", "context_length_exceeded"), null).message).toMatch(/^This is longer than the model's context/);
    expect(httpError(uns, 502, nested("llama-server stopped"), null).message).toBe("Unsloth Studio returned 502: llama-server stopped");
    expect(httpError(uns, 500, JSON.stringify({ detail: { message: "Backend busy" } }), null).message).toBe("Unsloth Studio returned 500: Backend busy");
  });

  it("turns failed calls into what to do about them", () => {
    const lms = server("lmstudio");
    expect(httpError(lms, 400, JSON.stringify({ error: "Trying to keep the first 9000 tokens when context the overflows. However, the model is loaded with context length of only 4096 tokens" }), "qwen/qwen3-8b").message).toBe(
      "This is longer than qwen/qwen3-8b's context (4096 tokens) on LM Studio. Reload it with 16k context (Settings → AI helper) or a larger one in LM Studio, or use shorter text.",
    );
    expect(httpError(lms, 404, JSON.stringify({ error: { message: "Model 'x/y' not found" } }), "x/y").message).toMatch(/LM Studio has no model called x\/y — download it in LM Studio \(or run `lms get x\/y`\)/);
    expect(httpError(server("unsloth"), 400, JSON.stringify({ detail: "No model loaded. Load a model first, or enable Model auto-switch (Settings > API)." }), null).message).toMatch(/^Unsloth Studio has no model loaded — load one on its Chat page/);
    expect(httpError(server("unsloth"), 401, "{}", null).message).toMatch(/^Unsloth Studio needs an API key/);
    expect(httpError(server("custom"), 500, "boom", "m").message).toBe("Your local server returned 500: boom");
    expect(httpError(server("ollama"), 404, JSON.stringify({ error: "model 'qwen3:8b' not found" }), "qwen3:8b").message).toBe("Ollama doesn't have qwen3:8b yet — run `ollama pull qwen3:8b`");
    expect(rejectsJson("custom", 400, "Unsupported response_format: json_schema")).toBe(true);
    expect(rejectsJson("custom", 500, "model crashed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Against stand-in servers, through Fuobe's own code paths

describe("LM Studio", () => {
  it("checks a typed address and model before Settings saves them (Save & test), and sends pictures as data URLs", async () => {
    const lms = await started(lmStudio({ loaded: 16384 }));
    const { POST } = await import("@/app/api/providers/test/route");
    const check = async (body: unknown) => (await (await POST(new Request("http://localhost/api/providers/test", { method: "POST", body: JSON.stringify(body) }))).json()) as { ok: boolean; detail: string };
    expect(await check({ provider: "llm", values: { lmstudioUrl: lms.url } })).toEqual({ ok: true, detail: "LM Studio · qwen/qwen3-8b ready" });
    expect(await check({ provider: "llm", values: { lmstudioUrl: lms.url, lmstudioModel: "nope/model" }, field: "lmstudioModel" })).toMatchObject({ ok: false, detail: expect.stringMatching(/^LM Studio has no model called nope\/model/) });
    // Nothing was saved.
    expect(local.localServer("lmstudio").url).not.toBe(lms.url);
    // A picture for a model that can see (Content Factory's frames, Describe my character).
    setSetting("llmProvider", "lmstudio");
    setSetting("lmstudioUrl", lms.url);
    await local.probeLocal(true);
    await llmText("Describe.", "What is in the picture?", [{ data: Buffer.from("png-bytes"), contentType: "image/png" }]);
    expect(lms.chats().at(-1)!.messages![1].content).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}` } },
      { type: "text", text: "What is in the picture?" },
    ]);
  });

  it("runs Enhance on the model it loads with 16k context, once, and drops the thinking", async () => {
    const lms = await started(lmStudio());
    setSetting("llmProvider", "lmstudio");
    setSetting("lmstudioUrl", `${lms.url}/v1`); // a URL pasted from an example: /v1 is dropped
    expect(await local.probeLocal(true)).toBe(true);
    const text = await enhancePrompt("a fox in snow", "image", "t2i");
    expect(text).toBe("A red fox trotting through deep snow at golden hour, low angle, 85mm lens, soft rim light.");
    // Not loaded yet: loaded first with the context Assist needs (the chat endpoint can't set it).
    expect(lms.state.loads).toEqual([{ model: "qwen/qwen3-8b", context_length: 16384, echo_load_config: true }]);
    const [chat] = lms.chats();
    expect(chat).toMatchObject({ model: "qwen/qwen3-8b", stream: false, messages: [{ role: "system" }, { role: "user", content: "Rewrite this as a text-to-image prompt:\n\na fox in snow" }] });
    expect(chat).not.toHaveProperty("tools");
    expect(lms.seen.every((r) => r.auth === undefined)).toBe(true);
    // Loaded now: no second load.
    await enhancePrompt("a cat on a roof", "image", "t2i");
    expect(lms.state.loads).toHaveLength(1);
    expect(lms.chats()).toHaveLength(2);
  });

  it("loads the model once for a whole text step, however many calls it makes", async () => {
    const lms = await started(lmStudio());
    setSetting("llmProvider", "lmstudio");
    setSetting("lmstudioUrl", lms.url);
    await local.probeLocal(true);
    // 35 cues: a batch of 30, then one of 5, on a model that isn't loaded when the step starts.
    const cues = Array.from({ length: 35 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.5, text: `Line ${i + 1}` }));
    const [g] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: JSON.stringify(cues), params: { targetLanguage: "German" } });
    const done = await settle(g.id);
    expect(done.status, done.error ?? "").toBe("succeeded");
    expect(done.outputs[0].meta?.cues).toEqual(cues.map((c) => ({ ...c, text: `(German·lms) ${c.text}` })));
    expect(lms.chats()).toHaveLength(2);
    expect(lms.state.loads).toHaveLength(1);
  });

  it("splits a storyboard with a JSON schema of exactly n frames", async () => {
    const lms = await started(lmStudio({ loaded: 32768 }));
    setSetting("llmProvider", "lmstudio");
    setSetting("lmstudioUrl", lms.url);
    await local.probeLocal(true);
    const scenes = await splitStory("A fox crosses a snowfield at dusk and finds its den.", 3);
    expect(scenes).toHaveLength(3);
    expect(scenes[0]).toMatch(/^Frame 1: the fox crosses/);
    expect(lms.chats()[0].response_format).toEqual({ type: "json_schema", json_schema: { name: "frames", schema: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 } } });
    expect(lms.state.loads).toHaveLength(0);
  });

  it("runs an Assist chat: tools offered, one tool call run, its result sent back under the same id", async () => {
    const lms = await started(lmStudio({ loaded: 16384 }));
    setSetting("llmProvider", "lmstudio");
    setSetting("lmstudioUrl", lms.url);
    expect(await agent.resolveAgent()).toBe("local");
    const can = await agent.availability();
    expect(can.local).toEqual({ kind: "lmstudio", label: "LM Studio", ok: true, models: ["qwen/qwen3-8b"], model: "qwen/qwen3-8b" });
    const t = agent.createThread({ engine: "open", agent: "local" });
    agent.addMessage(t.id, "Which image model should I use?");
    await agent.run(t.id);
    const [first, second] = lms.chats();
    expect(lms.chats()).toHaveLength(2);
    expect(first.model).toBe("qwen/qwen3-8b");
    expect((first.tools as { function: { name: string } }[]).map((x) => x.function.name)).toEqual(expect.arrayContaining(["search_models", "generate"]));
    expect(first.messages!.map((m) => m.role)).toEqual(["system", "user"]);
    const sent = second.messages!;
    expect(sent.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    const call = sent[2].tool_calls![0];
    expect(call).toMatchObject({ type: "function", function: { name: "search_models", arguments: '{"kind":"image"}' } });
    expect(call.id).toMatch(/^[A-Za-z0-9]{9}$/);
    expect(sent[3].tool_call_id).toBe(call.id);
    expect(JSON.parse(sent[3].content!).models.length).toBeGreaterThan(0);
    const items = agent.getThread(t.id)!.thread.items;
    expect(items.find((i) => i.role === "assistant")).toMatchObject({ text: "Let me look." });
    expect(items.at(-1)).toMatchObject({ role: "assistant", text: "Nano Banana Pro is a great pick." });
    expect(agent.getThread(t.id)!.thread.status).toBe("idle");
  });

  it("sends its token when Require Authentication is on, and says what to do without one", async () => {
    const lms = await started(lmStudio({ token: "lms-secret-1234", loaded: 16384 }));
    setSetting("llmProvider", "lmstudio");
    setSetting("lmstudioUrl", lms.url);
    expect(await local.probeLocal(true)).toBe(false);
    expect(llm.llmBackends({ endpoint: "ollama", op: "write" })).toEqual([]);
    expect(llm.llmMissing({ endpoint: "ollama", op: "write" })).toMatch(/^Connect LM Studio in Settings to run this model \(open-source text runs on your own machine\)\. LM Studio wants an API token/);
    setSetting("lmstudioToken", "lms-secret-1234");
    expect(await local.probeLocal(true)).toBe(true);
    expect(await llmText("Reply.", "hello")).toBe("(??·lms) hello");
    expect(lms.seen.at(-1)!.auth).toBe("Bearer lms-secret-1234");
  });

  it("keeps each saved token or key with the server it was saved for when Save & test tries a new address", async () => {
    const saved = await started(lmStudio({ loaded: 16384 }));
    const other = await started(lmStudio({ loaded: 16384 }));
    const { POST } = await import("@/app/api/providers/test/route");
    const check = (body: unknown) => POST(new Request("http://localhost/api/providers/test", { method: "POST", body: JSON.stringify(body) }));
    setSetting("lmstudioUrl", saved.url);
    setSetting("lmstudioToken", "saved-lmstudio-secret");
    setSetting("unslothKey", "saved-unsloth-secret");
    setSetting("llmKey", "saved-cloud-key");
    // A new address gets no saved secret, whichever server it is for.
    await check({ provider: "llm", values: { lmstudioUrl: other.url } });
    await check({ provider: "llm", values: { unslothUrl: other.url } });
    await check({ provider: "llm", values: { llmUrl: other.url } });
    expect(other.seen.length).toBeGreaterThan(0);
    expect(other.seen.filter((r) => r.auth)).toEqual([]);
    // A key typed with the new address goes to it.
    await check({ provider: "llm", values: { lmstudioUrl: other.url, lmstudioToken: "typed-token" } });
    expect(other.seen.at(-1)!.auth).toBe("Bearer typed-token");
    // The saved server, typed again (with /v1 pasted) or not, still gets its own.
    await check({ provider: "llm", values: { lmstudioUrl: `${saved.url}/v1` } });
    expect(saved.seen.at(-1)!.auth).toBe("Bearer saved-lmstudio-secret");
    expect(local.localServer("lmstudio").key).toBe("saved-lmstudio-secret");
  });

  it("explains a context overflow and a model that spent its reply thinking; a dead server, how to start it", async () => {
    const lms = await started(lmStudio({ loaded: 4096 }));
    setSetting("llmProvider", "lmstudio");
    setSetting("lmstudioUrl", lms.url);
    await local.probeLocal(true);
    const ready = (await local.activeLocal())!;
    expect(ready.status.warning).toMatch(/4,096 tokens of context/);
    const ask = (content: string) => local.chatLocal(ready, { messages: [{ role: "user", content }], timeoutMs: 10_000 });
    await expect(ask("OVERFLOW")).rejects.toThrow(/longer than qwen\/qwen3-8b's context \(4096 tokens\) on LM Studio\. Reload it with 16k context/);
    const r = await ask("THINK FOREVER");
    expect(r).toMatchObject({ text: "", stop: "length", thought: true });
    expect(local.emptyReply(ready.server, r).message).toBe("qwen/qwen3-8b on LM Studio spent its whole reply thinking. Turn thinking off for it, or pick a model that doesn't think first.");
    // The text step says the same instead of "no text".
    const [g] = gens.createGenerations({ feature: "ads", modelId: "oss-text-llm", op: "write", prompt: "THINK FOREVER" });
    expect((await settle(g.id)).error).toMatch(/spent its whole reply thinking/);
    lms.close();
    // Refused, or (the kept-alive connection it just dropped) closed under the call: either way it says how to start it.
    await expect(ask("hello")).rejects.toThrow(/^Couldn't reach LM Studio at http:\/\/127\.0\.0\.1:\d+ \((ECONNREFUSED|UND_ERR_SOCKET)\)\. Start LM Studio's local server and load a model/);
  });

  it("reloads a model loaded with too little context (Settings → Reload) through /api/llm, without keys in the answers", async () => {
    const lms = await started(lmStudio({ loaded: 4096 }));
    setSetting("llmProvider", "lmstudio");
    setSetting("lmstudioUrl", lms.url);
    setSetting("lmstudioToken", "");
    const route = await import("@/app/api/llm/route");
    const before = (await (await route.GET(new Request("http://x/api/llm?refresh=1"))).json()) as { active: string; servers: { kind: string; context: number; warning: string }[] };
    expect(before.active).toBe("lmstudio");
    expect(before.servers.map((s) => s.kind)).toEqual(["ollama", "lmstudio", "unsloth", "custom"]);
    expect(before.servers[1]).toMatchObject({ context: 4096, warning: expect.stringMatching(/Reload it with 16k context/) });
    const res = (await (await route.POST(new Request("http://x/api/llm", { method: "POST", body: JSON.stringify({ action: "load" }) }))).json()) as { ok: boolean; detail: string };
    expect(res).toMatchObject({ ok: true, detail: "LM Studio loaded qwen/qwen3-8b with 16,384 tokens of context in 2.5 s" });
    expect(lms.state.unloads).toEqual([{ instance_id: "qwen/qwen3-8b" }]);
    expect(lms.state.loads).toEqual([{ model: "qwen/qwen3-8b", context_length: 16384, echo_load_config: true }]);
    const test = (await (await route.POST(new Request("http://x/api/llm", { method: "POST", body: JSON.stringify({ action: "test", kind: "lmstudio" }) }))).json()) as { ok: boolean; detail: string };
    expect(test).toMatchObject({ ok: true, detail: expect.stringMatching(/^LM Studio answered in \d+\.\d s with qwen\/qwen3-8b/) });
    expect(lms.chats().at(-1)).toMatchObject({ max_tokens: 16, messages: [{ role: "user", content: "Reply with the word OK." }] });
  });

  it("stops a text step's call when the step is canceled", async () => {
    const lms = await started(lmStudio({ loaded: 16384 }));
    setSetting("llmProvider", "lmstudio");
    setSetting("lmstudioUrl", lms.url);
    await local.probeLocal(true);
    const [g] = gens.createGenerations({ feature: "ads", modelId: "oss-text-llm", op: "write", prompt: "SLOW please" });
    for (let i = 0; i < 100 && !lms.chats().length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(lms.chats()).toHaveLength(1);
    const { db } = await import("@/server/db");
    const handedOver = () => !!(db().prepare("SELECT external_id FROM generations WHERE id = ?").get(g.id) as { external_id: string | null }).external_id;
    for (let i = 0; i < 50 && !handedOver(); i++) await new Promise((r) => setTimeout(r, 50));
    await gens.cancelGeneration(g.id);
    for (let i = 0; i < 100 && !lms.state.aborted; i++) await new Promise((r) => setTimeout(r, 50));
    expect(lms.state.aborted).toBe(1);
    expect(gens.getGeneration(g.id)!.status).toBe("canceled");
  });
});

describe("Unsloth Studio", () => {
  it("needs its key; with it, translates subtitles on the loaded model with thinking and server-side tools off", async () => {
    const un = await started(unslothStudio());
    setSetting("llmProvider", "unsloth");
    setSetting("unslothUrl", un.url);
    expect(await local.probeLocal(true)).toBe(false);
    expect(llm.llmMissing({ endpoint: "auto" })).toMatch(/^Connect Claude or Unsloth Studio in Settings to run this model\. Unsloth Studio needs an API key: in Unsloth Studio, avatar → Settings → API → Create/);
    // Keyless at first (Unsloth's keyless access may be on): no Authorization header was sent.
    expect(un.seen.find((r) => r.url === "/v1/models")?.auth).toBeUndefined();
    const keyless = un.seen.length;
    setSetting("unslothKey", "sk-unsloth-test");
    expect(await local.probeLocal(true)).toBe(true);
    expect(llm.llmProvider.label).toBe("Claude or Unsloth Studio");
    const cues = JSON.stringify([
      { start: 0, end: 1.5, text: "Hello there." },
      { start: 2, end: 3.5, text: "Two\nlines." },
    ]);
    const [g] = gens.createGenerations({ feature: "dub", modelId: "oss-text-llm", op: "translate", prompt: cues, params: { targetLanguage: "Spanish" } });
    expect(g).toMatchObject({ provider: "llm", costUsd: 0 });
    const done = await settle(g.id);
    expect(done.status, done.error ?? "").toBe("succeeded");
    expect(done.outputs[0].meta?.cues).toEqual([
      { start: 0, end: 1.5, text: "(Spanish·unsloth) Hello there." },
      { start: 2, end: 3.5, text: "(Spanish·unsloth) Two\nlines." },
    ]);
    const [chat] = un.chats();
    expect(chat).toMatchObject({ enable_tools: false, enable_thinking: false, stream: false });
    expect(chat).not.toHaveProperty("model");
    // With the key, every call but the liveness check carries it.
    expect(un.seen.slice(keyless).filter((r) => r.url !== "/api/liveness").map((r) => r.auth)).toEqual(expect.arrayContaining(["Bearer sk-unsloth-test"]));
    expect(un.seen.slice(keyless).filter((r) => r.url !== "/api/liveness").every((r) => r.auth === "Bearer sk-unsloth-test")).toBe(true);
    expect(un.seen.filter((r) => r.url === "/api/liveness").every((r) => r.auth === undefined)).toBe(true);
    // The speech model isn't offered for chat.
    expect((await local.activeLocal())!.status.models.map((m) => m.id)).toEqual(["unsloth/Qwen3-8B-GGUF", "unsloth/gemma-3-12b-it-GGUF"]);
  });
});

describe("another OpenAI-compatible server (llama-server)", () => {
  it("asks again without JSON when the server can't do it, and uses the model it lists", async () => {
    const ls = await started(llamaServer());
    setSetting("llmProvider", "custom");
    setSetting("llmUrl", ls.url); // no /v1: added
    expect(await local.probeLocal(true)).toBe(true);
    const text = await llmText("You are an ad strategist. Answer with JSON.", "Make ads", { json: { name: "reply", schema: { type: "object" } } });
    expect(text).toMatch(/"reply": "Sure — four ads coming up\."/);
    const [withJson, without] = ls.chats();
    expect(withJson).toMatchObject({ model: "gemma-3-4b-it-Q4_K_M.gguf", response_format: { type: "json_schema", json_schema: { name: "reply", strict: true } } });
    expect(without).not.toHaveProperty("response_format");
    expect(ls.seen.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/v1/chat/completions", "/v1/chat/completions"]);
    expect(llm.llmProvider.label).toBe("Claude or your local server");
  });
});

describe("Automatic", () => {
  it("uses the first ready server in order (Ollama first, as before), and /api/status says which, without secrets", async () => {
    const ol = await started(ollama());
    const lms = await started(lmStudio({ loaded: 16384 }));
    setSetting("lmstudioUrl", lms.url);
    setSetting("lmstudioToken", "lms-never-shown-5678");
    setSetting("ollamaUrl", ol.url);
    await local.probeLocal(true);
    expect((await local.activeLocal())!.server.kind).toBe("ollama");
    expect(llm.llmProvider.label).toBe("Claude or Ollama");
    // Ollama stops: LM Studio takes over.
    setSetting("ollamaUrl", "http://127.0.0.1:9");
    await local.probeLocal(true);
    expect((await local.activeLocal())!.server.kind).toBe("lmstudio");
    expect(llm.llmProvider.label).toBe("Claude or LM Studio");
    expect(llm.llmBackends({ endpoint: "auto" })).toEqual(["local"]);
    const [g] = gens.createGenerations({ feature: "ads", modelId: "text-llm", op: "write", prompt: "A tagline" });
    expect(g.costUsd).toBe(0);
    expect((await settle(g.id)).outputs[0].text).toBe("(??·lms) A tagline");
    const { GET } = await import("@/app/api/status/route");
    const raw = await (await GET()).text();
    expect(raw).not.toContain("lms-never-shown-5678");
    const status = JSON.parse(raw) as { providers: { llm: { label: string; configured: boolean } }; llm: { helper: string; local: { kind: string; model: string; context: number }; detected: { kind: string; up: boolean }[] } };
    expect(status.providers.llm).toEqual({ label: "Claude or LM Studio", configured: true });
    expect(status.llm).toMatchObject({ helper: "auto", claude: false, provider: "auto", local: { kind: "lmstudio", label: "LM Studio", model: "qwen/qwen3-8b", loaded: true, context: 16384 } });
    expect(status.llm.detected.map((d) => [d.kind, d.up])).toEqual([
      ["ollama", false],
      ["lmstudio", true],
      ["unsloth", false],
    ]);
    // The old "ollama" AI-helper value still means local-only.
    setSetting("enhanceProvider", "ollama");
    expect(local.aiHelper()).toBe("local");
    expect(llm.llmBackends({ endpoint: "auto" })).toEqual(["local"]);
  });

  it("passes over an Ollama with no models for an LM Studio that has one, and uses Ollama alone as before", async () => {
    const empty = await started(ollama([]));
    const lms = await started(lmStudio({ loaded: 16384 }));
    setSetting("ollamaUrl", empty.url);
    setSetting("lmstudioUrl", lms.url);
    await local.probeLocal(true);
    expect((await local.activeLocal())!.server.kind).toBe("lmstudio");
    // An Ollama without the configured model is passed over too.
    const other = await started(ollama([{ name: "llama3.2:3b" }]));
    setSetting("ollamaUrl", other.url);
    await local.probeLocal(true);
    expect((await local.activeLocal())!.server.kind).toBe("lmstudio");
    // No other server: Ollama still takes calls (and names the missing model when one fails).
    setSetting("lmstudioUrl", "http://127.0.0.1:9");
    await local.probeLocal(true);
    expect((await local.activeLocal())!.server.kind).toBe("ollama");
  });
});

describe("the open text model's licence", () => {
  it("is the licence of the model the local server in use runs, LM Studio and Unsloth ids included", async () => {
    const { changeAccess, offeredModel, routeLicence } = await import("@/server/model-access");
    const { getModel } = await import("@/lib/catalog");
    const m = getModel("oss-text-llm")!;
    const route = m.routes[0];
    // Nothing answers: Ollama's model setting, as before.
    expect(routeLicence(route, m)).toMatchObject({ name: "Apache-2.0", class: "commercial", note: expect.stringContaining("on Ollama (qwen3:8b)") });
    // LM Studio pinned with a Gemma model: Gemma's terms, also with the publisher in front of the name.
    setSetting("llmProvider", "lmstudio");
    setSetting("lmstudioModel", "google/gemma-3-12b");
    expect(routeLicence(route, m)).toMatchObject({ name: "Gemma Terms of Use", class: "conditions", note: expect.stringContaining("on LM Studio (google/gemma-3-12b)") });
    // So switching off "Commercial use with conditions" reaches it, and a model with another licence brings it back.
    changeAccess([{ kind: "class", id: "conditions", on: false }]);
    try {
      expect(offeredModel(m)).toBeUndefined();
      setSetting("lmstudioModel", "qwen/qwen3-8b");
      expect(offeredModel(m)).toBe(m);
    } finally {
      changeAccess([{ kind: "class", id: "conditions", on: true }]);
    }
    // The model a ready server reports wins over the setting (Unsloth: the loaded one).
    const uns = await started(unslothStudio());
    setSetting("llmProvider", "unsloth");
    setSetting("unslothUrl", uns.url);
    setSetting("unslothKey", "sk-unsloth-test");
    await local.probeLocal(true);
    expect(routeLicence(route, m)).toMatchObject({ name: "Apache-2.0", note: expect.stringContaining("on Unsloth Studio (unsloth/Qwen3-8B-GGUF)") });
  });
});
