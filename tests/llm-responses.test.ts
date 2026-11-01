import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { getLlmModel, getLlmProvider } from "@/lib/catalog/llm-providers";
import { fakeLlm, type FakeLlm } from "./helpers/fake-llm";

/*
 * OpenAI direct, on the Responses API (GPT-6.x call tools only there): a stateless request
 * (store: false) with the system prompt as instructions and flat, non-strict tools; calls and results
 * paired by call_id; OpenAI's own turn sent back as the items it came as, so its encrypted reasoning
 * stays with its calls (the fake refuses a call without it); and a reply cut off by the output limit.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-llm-responses-"));
process.env.FUOBE_DATA_DIR = dir;
for (const k of Object.keys(process.env)) if (/_API_KEY$|^FUOBE_LLM_TEST_BASE$/.test(k)) delete process.env[k];

const { setSetting } = await import("@/server/settings");
const hosted = await import("@/server/llm/hosted");
const { toHostedMessages } = await import("@/server/llm/hosted-messages");
const { responsesBody } = await import("@/server/llm/responses");

type Stored = Anthropic.Beta.BetaMessageParam & { replay?: unknown };
const system = { stable: "You are Fuobe Assist.", turn: "Today: 2026-10-31." };
const tools = [{ name: "generate", description: "Run jobs", parameters: { type: "object", properties: { jobs: { type: "array" } } } }];
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";

let f: FakeLlm;
beforeAll(async () => {
  f = fakeLlm("openai", "sk-proj-test0123456789abcdef");
  await f.start();
  setSetting("openaiKey", f.key);
  process.env.FUOBE_LLM_TEST_BASE = `openai=${f.url}/v1`;
});
afterAll(async () => {
  await f.close();
  delete process.env.FUOBE_LLM_TEST_BASE;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const sol = () => getLlmModel("openai", "gpt-6.1-sol")!;
async function step(msgs: Stored[], model = sol(), effort: "low" | "medium" | "max" = "medium") {
  const ep = hosted.endpointFor("openai")!;
  return hosted.chatHosted(ep, model, { messages: toHostedMessages(system, msgs as never, { provider: getLlmProvider("openai")!, model }), tools, effort });
}

describe("OpenAI's Responses API", () => {
  it("sends a stateless request: instructions, input items, flat tools that aren't strict, the effort", () => {
    const b = responsesBody(sol(), {
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "A fox", images: [{ data: PNG, contentType: "image/png" }] },
      ],
      tools,
      effort: "max",
      maxTokens: 64_000,
    });
    expect(b).toMatchObject({ model: "gpt-6.1-sol", instructions: "Be brief.", store: false, stream: true, tool_choice: "auto", parallel_tool_calls: true, reasoning: { effort: "max" }, max_output_tokens: 64_000 });
    expect(b.tools).toEqual([{ type: "function", name: "generate", description: "Run jobs", parameters: tools[0].parameters, strict: false }]);
    expect(b.input).toEqual([{ role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${PNG}` }, { type: "input_text", text: "A fox" }] }]);
    expect(b).not.toHaveProperty("messages");
    // A level the model doesn't offer sends none.
    expect(responsesBody(getLlmModel("openai", "gpt-5.4-mini")!, { messages: [{ role: "user", content: "x" }], effort: "max", maxTokens: 10 })).not.toHaveProperty("reasoning");
  });

  it("runs a tool loop: OpenAI's turn goes back with its encrypted reasoning, results pair by call_id", async () => {
    const turn = [
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "gAAAA-secret-thinking" },
      { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Making it.", annotations: [] }] },
      { type: "function_call", id: "fc_1", call_id: "call_abc123", name: "generate", arguments: '{"jobs":[]}', status: "completed" },
    ];
    f.replies = [{ output: turn }];
    const first: Stored[] = [{ role: "user", content: "A fox in snow" }];
    const r = await step(first);
    expect(r).toMatchObject({ text: "Making it.", stop: "tool_use", thought: true, toolCalls: [{ id: "call_abc123", name: "generate", input: { jobs: [] } }] });
    expect(r.replay).toMatchObject({ provider: "openai", model: "gpt-6.1-sol", items: turn });
    expect(r.usage).toMatchObject({ input: 900, output: 40, reasoning: 12 });

    f.replies = [{ text: "Started." }];
    const second: Stored[] = [
      ...first,
      { role: "assistant", content: [{ type: "text", text: "Making it." }, { type: "tool_use", id: "call_abc123", name: "generate", input: { jobs: [] } }], replay: r.replay } as Stored,
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_abc123", content: '{"started":["g1"]}' }] },
    ];
    expect((await step(second)).text).toBe("Started.");
    const input = f.chats().at(-1)!.input as Record<string, unknown>[];
    expect(input.slice(1, 4)).toEqual(turn);
    expect(input[4]).toEqual({ type: "function_call_output", call_id: "call_abc123", output: '{"started":["g1"]}' });

    // Another OpenAI model gets the turn as plain items (no stored item ids, no reasoning), which it takes.
    f.replies = [{ text: "Terra here." }];
    expect((await step(second, getLlmModel("openai", "gpt-6.1-terra")!)).text).toBe("Terra here.");
    const plain = f.chats().at(-1)!.input as Record<string, unknown>[];
    expect(plain.some((i) => i.type === "reasoning")).toBe(false);
    expect(plain).toContainEqual({ type: "function_call", call_id: "call_abc123", name: "generate", arguments: '{"jobs":[]}' });
    // The stored call without the reasoning it followed is what OpenAI (and the fake) refuse.
    const broken = second.map((m) => (m.replay ? { ...m, replay: { ...(m.replay as object), items: turn.slice(1) } } : m));
    await expect(step(broken)).rejects.toThrow(/required 'reasoning' item/);
  });

  it("sends another model's turn as plain items, and says when the reply hit the output limit", async () => {
    f.replies = [{ incomplete: true, output: [{ type: "reasoning", id: "rs_9", summary: [] }] }];
    const msgs: Stored[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_01Claude", name: "generate", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01Claude", content: "ok" }, { type: "text", text: "now?" }] },
    ];
    const r = await step(msgs);
    expect(r.stop).toBe("length");
    const input = f.chats().at(-1)!.input as Record<string, unknown>[];
    expect(input[1]).toEqual({ type: "function_call", call_id: "toolu_01Claude", name: "generate", arguments: "{}" });
    expect(input[2]).toEqual({ type: "function_call_output", call_id: "toolu_01Claude", output: "ok" });
  });

  it("turns a failed key into plain words, without the key", async () => {
    setSetting("openaiKey", "sk-proj-wrong0123456789abcdef");
    const e = (await step([{ role: "user", content: "hi" }]).catch((x) => x)) as Error;
    setSetting("openaiKey", f.key);
    expect(e.message).toMatch(/OpenAI rejected the key/);
    expect(e.message).not.toContain("wrong0123456");
  });
});
