import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claudeStream } from "./fixtures/claude-sse";
import type Anthropic from "@anthropic-ai/sdk";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-assist-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const { apiTools } = await import("@/server/assist/tools");
const { db } = await import("@/server/db");

type Msg = Anthropic.Beta.BetaMessage;
type Block = Anthropic.Beta.BetaContentBlock;

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const text = (t: string) => ({ type: "text", text: t, citations: null }) as Block;
const use = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as unknown as Block;
const reply = (content: Block[], stop: Anthropic.Beta.BetaStopReason, extra: Partial<Msg> = {}) => ({ content, stop_reason: stop, stop_details: null, ...extra }) as Msg;

/** A model that answers from a script and records each request. */
function scripted(...turns: Msg[]) {
  const seen: Anthropic.Beta.BetaMessageParam[][] = [];
  const call: import("@/server/assist/agent").ModelCall = async ({ messages }) => {
    seen.push(structuredClone(messages));
    const next = turns.shift();
    if (!next) throw new Error("script ran out");
    return next;
  };
  return { call, seen };
}

const history = (id: string) => JSON.parse((db().prepare("SELECT messages_json FROM assist_threads WHERE id = ?").get(id) as { messages_json: string }).messages_json) as Anthropic.Beta.BetaMessageParam[];

const job = { model_id: "nano-banana-pro", prompt: "a red fox in snow, golden hour" };

describe("assist tools", () => {
  it("sends closed, constraint-free schemas, strict only where the API's strict budget allows", () => {
    const tools = apiTools();
    const json = JSON.stringify(tools);
    expect(json).not.toMatch(/"(maximum|minimum|maxItems|minLength|\$schema)"/);
    const objects: Record<string, unknown>[] = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === "object") {
        if ((n as { type?: string }).type === "object") objects.push(n as Record<string, unknown>);
        Object.values(n).forEach(walk);
      }
    };
    tools.forEach((t) => walk(t.input_schema));
    // Closed, but for a map that says what its values are (run_skill's values by input id).
    expect(objects.every((o) => o.additionalProperties === false || (!o.properties && typeof o.additionalProperties === "object"))).toBe(true);
    expect(objects.some((o) => typeof o.additionalProperties === "object")).toBe(true);
    expect(json).not.toMatch(/"propertyNames"/);
    // generate has more optional fields than strict mode allows per request (zod validates it instead).
    expect(tools.find((t) => t.name === "generate")?.strict).toBeUndefined();
    expect(tools.find((t) => t.name === "create_storyboard")?.strict).toBe(true);
    expect(tools.find((t) => t.name === "search_models")?.strict).toBeUndefined();
  });
});

describe("assist loop", () => {
  it("pauses on a paid plan, then answers every call of that turn in one message", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    agent.addMessage(t.id, "Make a fox photo");
    const m = scripted(
      reply([text("Let me check models."), use("toolu_a", "search_models", { kind: "image" }), use("toolu_b", "generate", { summary: "A fox photo", jobs: [job] })], "tool_use"),
      reply([text("Your fox is on the way.")], "end_turn"),
    );
    await agent.run(t.id, m.call);
    let v = agent.getThread(t.id)!;
    expect(v.thread.status).toBe("waiting");
    const card = v.thread.items.find((i) => i.role === "approval");
    expect(card).toMatchObject({ status: "pending", summary: "A fox photo", jobs: [{ modelId: "nano-banana-pro", count: 1, demo: true }] });
    expect(v.thread.items.some((i) => i.role === "tool")).toBe(true);
    expect(history(t.id).map((x) => x.role)).toEqual(["user", "assistant"]);

    await agent.answerApproval(t.id, true);
    await agent.run(t.id, m.call);
    v = agent.getThread(t.id)!;
    expect(v.thread.status).toBe("idle");
    expect(v.thread.items.find((i) => i.role === "approval")).toMatchObject({ status: "approved" });
    expect(v.generations).toHaveLength(1);
    // The resumed request carried both results, in the order of the calls.
    const results = m.seen[1].at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["toolu_a", "toolu_b"]);
    expect(results[1].is_error).toBeUndefined();
    expect(v.thread.items.at(-1)).toMatchObject({ role: "assistant", text: "Your fox is on the way." });
    expect(v.thread.title).toBe("Make a fox photo");
  });

  it("treats a new message as declining the plan, with the results before the text", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    agent.addMessage(t.id, "Fox video");
    await agent.run(t.id, scripted(reply([use("toolu_c", "generate", { summary: "Fox", jobs: [job] })], "tool_use")).call);
    agent.addMessage(t.id, "Actually make it a wolf");
    const last = history(t.id).at(-1)!;
    const content = last.content as { type: string; is_error?: boolean; text?: string }[];
    expect(content[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(content[1]).toMatchObject({ type: "text", text: "Actually make it a wolf" });
    expect(agent.getThread(t.id)!.thread.items.find((i) => i.role === "approval")).toMatchObject({ status: "declined" });
    await agent.run(t.id, scripted(reply([text("Wolf it is.")], "end_turn")).call);
  });

  it("runs gated tools straight away when auto-run is on", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud", autoApprove: true });
    agent.addMessage(t.id, "Two foxes");
    await agent.run(t.id, scripted(reply([use("toolu_d", "generate", { summary: "Foxes", jobs: [{ ...job, outputs: 2 }] })], "tool_use"), reply([text("Done.")], "end_turn")).call);
    const v = agent.getThread(t.id)!;
    expect(v.thread.items.some((i) => i.role === "approval")).toBe(false);
    expect(v.thread.items.find((i) => i.role === "generations")).toBeTruthy();
    expect(v.thread.status).toBe("idle");
  });

  it("doesn't run a tool call cut off by max_tokens", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud", autoApprove: true });
    agent.addMessage(t.id, "Fox");
    const m = scripted(reply([use("toolu_e", "generate", { summary: "Fo" })], "max_tokens"), reply([text("Retried.")], "end_turn"));
    await agent.run(t.id, m.call);
    const res = (m.seen[1].at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(res).toMatchObject({ tool_use_id: "toolu_e", is_error: true });
    expect(agent.getThread(t.id)!.generations).toHaveLength(0);
  });

  it("returns invalid tool input to the model as an error", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud", autoApprove: true });
    agent.addMessage(t.id, "Fox");
    const m = scripted(reply([use("toolu_f", "search_models", { kind: "smell" })], "tool_use"), reply([text("Oops.")], "end_turn"));
    await agent.run(t.id, m.call);
    expect((m.seen[1].at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]).toMatchObject({ is_error: true });
  });

  it("keeps the history valid after a refusal", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    agent.addMessage(t.id, "something");
    await agent.run(t.id, scripted(reply([], "refusal", { stop_details: { type: "refusal", category: null, explanation: "Not this one." } as Msg["stop_details"] })).call);
    const v = agent.getThread(t.id)!;
    expect(v.thread.items.at(-1)).toMatchObject({ role: "notice", text: "Not this one." });
    agent.addMessage(t.id, "something else");
    const h = history(t.id);
    expect(h).toHaveLength(1);
    expect((h[0].content as { text: string }[]).map((b) => b.text)).toEqual(["something", "something else"]);
    await agent.run(t.id, scripted(reply([text("Sure.")], "end_turn")).call);
  });

  it("refuses a message while a reply is still running", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    agent.addMessage(t.id, "one");
    let release!: () => void;
    const slow: import("@/server/assist/agent").ModelCall = () => new Promise((r) => (release = () => r(reply([text("ok")], "end_turn"))));
    const p = agent.run(t.id, slow);
    expect(() => agent.addMessage(t.id, "two")).toThrow(/Still working/);
    expect(agent.getThread(t.id)!.thread.status).toBe("running");
    release();
    await p;
  });
});

describe("offline planner", () => {
  it("reads counts, formats and attachments into one tool call", () => {
    expect(agent.offlinePlan("Make three vertical videos of a fox running", "cloud")).toMatchObject({
      tool: "generate",
      input: { jobs: [{ model_id: "minimax-h3", aspect_ratio: "9:16", outputs: 3 }] },
    });
    expect(agent.offlinePlan("Put a hat on him\n\nAttached files (pass these URLs as inputs):\n- image 1: /api/files/a.png", "open")).toMatchObject({
      input: { jobs: [{ model_id: "oss-qwen-image-21", images: ["/api/files/a.png"] }] },
    });
    expect(agent.offlinePlan("A storyboard in 6 frames: a heist in Paris", "cloud")).toMatchObject({ tool: "create_storyboard", input: { frames: 6 } });
    expect(agent.offlinePlan("Write a lo-fi song for studying", "open")).toMatchObject({ input: { jobs: [{ model_id: "oss-ace-step" }] } });
    expect(agent.offlinePlan("   ", "cloud")).toBeNull();
  });

  it("plans, waits for approval and starts demo generations end to end", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    agent.addMessage(t.id, "A cozy cabin in the snow, square");
    await agent.run(t.id, agent.offline);
    expect(agent.getThread(t.id)!.thread.status).toBe("waiting");
    await agent.answerApproval(t.id, true);
    await agent.run(t.id, agent.offline);
    const v = agent.getThread(t.id)!;
    expect(v.thread.status).toBe("idle");
    expect(v.generations.length).toBeGreaterThan(0);
    expect(v.generations[0].request.params?.aspectRatio).toBe("1:1");
    expect(v.thread.items.at(-1)).toMatchObject({ role: "assistant" });
  });
});

describe("claude request", () => {
  it("sends adaptive thinking, effort, server-side fallback, strict tools and local images as base64", async () => {
    const { saveFile } = await import("@/server/storage");
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    const asset = saveFile({ data: png, contentType: "image/png", source: "upload" });
    setSetting("anthropicKey", "sk-ant-test");
    const t = agent.createThread({ engine: "open", agent: await agent.resolveAgent() });
    expect(t.agent).toBe("claude");
    agent.addMessage(t.id, "Animate this", [asset.url]);
    const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    const answers = [
      { content: [{ type: "tool_use", id: "toolu_1", name: "search_models", input: { kind: "video", task: "i2v" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Ready when you are." }], stop_reason: "end_turn" },
    ];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
      // Assist's Claude calls stream; the agent keeps the final message.
      return claudeStream(answers.shift()! as Parameters<typeof claudeStream>[0]);
    }) as typeof fetch;
    try {
      await agent.run(t.id);
    } finally {
      globalThis.fetch = realFetch;
      setSetting("anthropicKey", "");
    }
    expect(sent).toHaveLength(2);
    const [first, second] = sent;
    expect(first.url).toMatch(/\/v1\/messages\?beta=true$/);
    expect(first.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(first.body).toMatchObject({ model: "claude-opus-5-5", thinking: { type: "adaptive" }, output_config: { effort: "medium" }, fallbacks: "default", stream: true });
    expect(first.body.tool_choice).toBeUndefined();
    const system = first.body.system as { text: string; cache_control?: unknown }[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[1].text).toMatch(/prefers open-source/);
    const content = (first.body.messages as { content: { type: string; source?: { type: string; data?: string } }[] }[])[0].content;
    expect(content[1]).toMatchObject({ type: "image", source: { type: "base64" } });
    expect(content[1].source?.data).toBe(png.toString("base64"));
    // The stored history keeps the URL, not the bytes.
    expect(JSON.stringify(history(t.id))).not.toContain(png.toString("base64"));
    // The second request replays the assistant turn verbatim and answers its call.
    const msgs = second.body.messages as { role: string; content: { type: string; tool_use_id?: string }[] }[];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    expect(agent.getThread(t.id)!.thread.items.at(-1)).toMatchObject({ role: "assistant", text: "Ready when you are." });
  });
});

describe("local agent on Ollama", () => {
  it("talks to Ollama's chat API with tools and maps its tool calls back", async () => {
    const http = await import("node:http");
    const seen: { messages: { role: string; content: string; tool_calls?: unknown[]; tool_name?: string }[]; tools: { function: { name: string } }[]; model: string }[] = [];
    const replies = [
      { message: { role: "assistant", content: "<think>hmm</think>Let me look.", tool_calls: [{ function: { name: "search_models", arguments: { kind: "image" } } }] }, done_reason: "stop" },
      { message: { role: "assistant", content: "Nano Banana Pro is a great pick." }, done_reason: "stop" },
    ];
    const server = http.createServer((req, res) => {
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [] }));
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push(JSON.parse(body));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(replies.shift()));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    setSetting("ollamaUrl", `http://127.0.0.1:${port}`);
    setSetting("ollamaModel", "qwen3:8b");
    try {
      expect(await agent.resolveAgent()).toBe("local");
      // "ollama", the agent's old name, still makes a local chat.
      const t = agent.createThread({ engine: "open", agent: "ollama" });
      expect(t.agent).toBe("local");
      agent.addMessage(t.id, "Which image model should I use?");
      await agent.run(t.id);
      expect(seen).toHaveLength(2);
      expect(seen[0].model).toBe("qwen3:8b");
      expect(seen[0].messages[0].role).toBe("system");
      expect(seen[0].tools.map((x) => x.function.name)).toContain("generate");
      const second = seen[1].messages;
      expect(second.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
      expect(second[2].tool_calls).toHaveLength(1);
      expect(second[3].tool_name).toBe("search_models");
      expect(JSON.parse(second[3].content).models.length).toBeGreaterThan(0);
      const items = agent.getThread(t.id)!.thread.items;
      expect(items.find((i) => i.role === "assistant")).toMatchObject({ text: "Let me look." });
      expect(items.at(-1)).toMatchObject({ role: "assistant", text: "Nano Banana Pro is a great pick." });
    } finally {
      server.close();
      setSetting("ollamaUrl", "");
    }
  });
});
