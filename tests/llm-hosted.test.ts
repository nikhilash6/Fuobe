import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { getLlmModel, getLlmProvider, GEMINI_DUMMY_SIGNATURE, type LlmModelDef } from "@/lib/catalog/llm-providers";
import { fakeLlm, type FakeLlm, type Mode } from "./helpers/fake-llm";

/*
 * The hosted providers' Chat Completions path, against fakes that enforce each provider's documented
 * rules: the request body per provider (quirks), history with turns from other models (DeepSeek's
 * flattened calls, Gemini's dummy signatures), what comes back for the next turn (replay), the errors
 * in plain words with the key taken out, and the security rules (no redirects with a key, never inside
 * an account's work, never a key over plain http to a public host).
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-llm-hosted-"));
process.env.FUOBE_DATA_DIR = dir;
for (const k of Object.keys(process.env)) if (/_API_KEY$|HF_TOKEN$|^FUOBE_LLM_TEST_BASE$/.test(k)) delete process.env[k];

const { setSetting } = await import("@/server/settings");
const hosted = await import("@/server/llm/hosted");
const { toHostedMessages } = await import("@/server/llm/hosted-messages");
const { ContextError, FreeLimitError, HostedError, hostedError } = await import("@/server/llm/hosted-errors");
const { runAsTenant } = await import("@/server/tenant");

type Stored = Anthropic.Beta.BetaMessageParam & { replay?: unknown };
const system = { stable: "You are Fuobe Assist.", turn: "Today: 2026-10-31." };
const tools = [
  { name: "search_models", description: "Find models", parameters: { type: "object", properties: { kind: { type: "string" } } } },
  { name: "generate", description: "Run jobs", parameters: { type: "object", properties: { jobs: { type: "array" } } } },
];
/** A 1×1 WebP, as an attachment the user sent. */
const WEBP = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

const fakes: FakeLlm[] = [];
async function fake(mode: Mode, provider: string = mode): Promise<FakeLlm> {
  const f = fakeLlm(mode);
  await f.start();
  fakes.push(f);
  const p = getLlmProvider(provider)!;
  setSetting(p.keySetting as never, f.key);
  const bases = (process.env.FUOBE_LLM_TEST_BASE ?? "").split(",").filter((x) => x && !x.startsWith(`${provider}=`));
  process.env.FUOBE_LLM_TEST_BASE = [...bases, `${provider}=${f.url}/v1`].join(",");
  return f;
}
afterAll(async () => {
  await Promise.all(fakes.map((f) => f.close()));
  delete process.env.FUOBE_LLM_TEST_BASE;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

/**
 * A chat two models wrote: Claude asked for search_models (no replay), then this provider's model asked
 * for generate (with its replay), then the results; the user's latest turn has a picture.
 */
function history(provider: string, model: LlmModelDef, own: { id: string; reasoning?: string; extra?: unknown }): Stored[] {
  return [
    { role: "user", content: [{ type: "text", text: "A fox in snow" }] },
    { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "toolu_01AbCdEf", name: "search_models", input: { kind: "image" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01AbCdEf", content: '{"models":["flux"]}' }] },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: own.id, name: "generate", input: { jobs: [] } }],
      replay: { provider, model: model.id, ...(own.reasoning && { reasoning: { field: "reasoning_content", text: own.reasoning } }), ...(own.extra !== undefined && { extra: { [own.id]: own.extra } }) },
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: own.id, content: '{"started":["g1"]}' },
        { type: "text", text: "Make it brighter" },
        { type: "image", source: { type: "base64", media_type: "image/webp", data: WEBP } },
      ],
    },
  ] as Stored[];
}

async function call(provider: string, modelId: string, msgs: Stored[], extra: Partial<Parameters<typeof hosted.chatHosted>[2]> = {}) {
  const ep = hosted.endpointFor(provider)!;
  const model = getLlmModel(provider, modelId)!;
  return hosted.chatHosted(ep, model, { messages: toHostedMessages(system, msgs as never, { provider: ep.provider, model }), tools, effort: "medium", ...extra });
}

describe("the request body per provider", () => {
  const body = (provider: string, model: string, effort: "low" | "medium" | "high" | "xhigh" | "max" = "medium") =>
    hosted.chatBody(getLlmProvider(provider)!, getLlmModel(provider, model)!, { messages: [{ role: "system", content: "s" }, { role: "user", content: "hi" }], tools, effort });

  it("streams, sends tools nested with tool_choice auto, and names the max-tokens field the docs give", () => {
    const b = body("meta", "muse-spark-1.3");
    expect(b).toMatchObject({ model: "muse-spark-1.3", stream: true, tool_choice: "auto", max_completion_tokens: 32_000, reasoning_effort: "medium" });
    expect(b.tools).toEqual(tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })));
    expect(body("deepseek", "deepseek-v4-pro")).toMatchObject({ max_tokens: 32_000, thinking: { type: "enabled" } });
    expect(body("deepseek", "deepseek-v4-pro", "max")).toMatchObject({ max_tokens: 64_000, reasoning_effort: "max" });
  });

  it("maps efforts per model: Gemini never minimal, DeepSeek medium → high, OpenRouter's reasoning object, Qwen's budget", () => {
    expect(body("google", "gemini-3.8-flash", "xhigh")).toMatchObject({ reasoning_effort: "high" });
    expect(body("google", "gemini-3.8-flash", "low")).toMatchObject({ reasoning_effort: "low" });
    expect(body("deepseek", "deepseek-v4-pro", "medium").reasoning_effort).toBe("high");
    const or = body("openrouter", "x-ai/grok-4.7", "max");
    expect(or.reasoning).toEqual({ effort: "xhigh" });
    expect(or).not.toHaveProperty("reasoning_effort");
    expect(body("qwen", "qwen3.8-max", "low")).toMatchObject({ thinking_budget: 2048, enable_thinking: true, stream_options: { include_usage: true } });
    expect(body("qwen", "qwen3.8-max", "max")).not.toHaveProperty("thinking_budget");
    // A model with no effort levels gets no effort field.
    expect(body("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free")).not.toHaveProperty("reasoning");
    expect(body("minimax", "MiniMax-M3")).not.toHaveProperty("reasoning_effort");
  });

  it("leaves tool_choice out where it isn't documented, and sends Cohere's system prompt as developer", () => {
    expect(body("minimax", "MiniMax-M3.1-Flash")).not.toHaveProperty("tool_choice");
    const co = body("cohere", "command-a-plus-05-2026");
    expect(co).not.toHaveProperty("tool_choice");
    expect((co.messages as { role: string }[])[0].role).toBe("developer");
  });

  it("caps output room where requests are charged up front, and adds each provider's fixed fields", () => {
    expect(body("cerebras", "gpt-oss-120b", "max")).toMatchObject({ max_completion_tokens: 16_384 });
    expect(body("fireworks", "accounts/fireworks/models/glm-5p3")).toMatchObject({ context_length_exceeded_behavior: "error", max_tokens: 32_000 });
    expect(body("groq", "openai/gpt-oss-120b")).toMatchObject({ reasoning_format: "parsed" });
    // Never temperature or sampling fields (Kimi refuses them; Gemini says to leave them out).
    for (const p of ["moonshot", "google"]) for (const k of ["temperature", "top_p", "n", "presence_penalty", "frequency_penalty"]) expect(body(p, p === "moonshot" ? "kimi-k3" : "gemini-3.8-flash")).not.toHaveProperty(k);
  });
});

describe("a chat on each provider's fake, with a turn from another model", () => {
  beforeAll(async () => {
    for (const m of ["meta", "moonshot", "deepseek", "google", "zai", "minimax", "cohere", "cerebras", "groq", "openrouter", "fireworks", "mistral", "together", "xai"] as Mode[]) await fake(m);
  });

  const cases: [Mode, string][] = [
    ["meta", "muse-spark-1.3"],
    ["moonshot", "kimi-k3"],
    ["zai", "glm-5.3-flash"],
    ["minimax", "MiniMax-M3.1-Flash"],
    ["cohere", "command-a-plus-05-2026"],
    ["groq", "qwen/qwen3.8-27b"],
    ["openrouter", "x-ai/grok-4.7"],
    ["fireworks", "accounts/fireworks/models/glm-5p3"],
    ["together", "moonshotai/Kimi-K3"],
    ["xai", "grok-4.7"],
  ];
  for (const [mode, model] of cases) {
    it(`${mode}: the fake accepts the whole history and the reply comes back with a tool call`, async () => {
      const f = fakes.find((x) => x.mode === mode)!;
      f.replies = [{ text: "On it.", calls: [{ id: "call_x1", name: "generate", args: { jobs: [{ model_id: "flux" }] } }] }];
      const r = await call(mode, model, history(mode, getLlmModel(mode, model)!, { id: "toolu_own1" }));
      expect(r.text).toBe("On it.");
      expect(r.stop).toBe("tool_use");
      expect(r.toolCalls).toEqual([{ id: "call_x1", name: "generate", input: { jobs: [{ model_id: "flux" }] } }]);
      expect(r.usage).toMatchObject({ input: 900, output: 40 });
    });
  }

  it("xAI: names the chat in x-grok-conv-id (a hash, not the chat's id) and gets pictures as PNG", async () => {
    const f = fakes.find((x) => x.mode === "xai")!;
    f.replies = [{ text: "Fine." }];
    await call("xai", "grok-4.7", history("xai", getLlmModel("xai", "grok-4.7")!, { id: "toolu_own1" }), { threadKey: "chat-123" });
    const last = f.seen.at(-1)!;
    expect(last.headers["x-grok-conv-id"]).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(last.body)).not.toContain("chat-123");
    expect(JSON.stringify(last.body)).toContain("data:image/png;base64,");
  });

  it("Cerebras: the WebP picture goes as a base64 PNG", async () => {
    const f = fakes.find((x) => x.mode === "cerebras")!;
    f.replies = [{ text: "Brighter it is." }];
    const r = await call("cerebras", "qwen-3.8-27b", history("cerebras", getLlmModel("cerebras", "qwen-3.8-27b")!, { id: "toolu_own1" }), { effort: "max" });
    expect(r.text).toBe("Brighter it is.");
    expect(JSON.stringify(f.seen.at(-1)!.body)).toContain("data:image/png;base64,");
  });

  it("Mistral: tool ids go as nine letters and digits, and the picture as a plain image_url string", async () => {
    const f = fakes.find((x) => x.mode === "mistral")!;
    f.replies = [{ text: "Done." }];
    const r = await call("mistral", "mistral-large-4", history("mistral", getLlmModel("mistral", "mistral-large-4")!, { id: "toolu_own1" }));
    expect(r.text).toBe("Done.");
    const user = (f.seen.at(-1)!.body.messages ?? []).findLast((m) => m.role === "user")!;
    expect((user.content as { type: string; image_url?: unknown }[]).find((p) => p.type === "image_url")!.image_url).toMatch(/^data:image\/webp;base64,/);
  });

  it("DeepSeek: its own turn carries its reasoning back, another model's calls become text, and the picture stays out (text-only model)", async () => {
    const f = fakes.find((x) => x.mode === "deepseek")!;
    f.issued.add("call_ds1");
    f.replies = [{ reasoning: { field: "reasoning_content", text: "Brighter means more exposure." }, text: "Brightening.", calls: [{ id: "call_ds2", name: "generate", args: { jobs: [] } }] }];
    const r = await call("deepseek", "deepseek-v4-pro", history("deepseek", getLlmModel("deepseek", "deepseek-v4-pro")!, { id: "call_ds1", reasoning: "Thinking about foxes." }));
    expect(r.toolCalls[0].id).toBe("call_ds2");
    expect(r.replay).toMatchObject({ provider: "deepseek", model: "deepseek-v4-pro", reasoning: { field: "reasoning_content", text: "Brighter means more exposure." } });
    const sent = f.seen.at(-1)!.body.messages!;
    expect(sent.find((m) => m.tool_calls?.[0]?.id === "call_ds1")!.reasoning_content).toBe("Thinking about foxes.");
    expect(JSON.stringify(sent)).toContain("search_models");
    expect(sent.some((m) => m.tool_calls?.some((c) => c.id === "toolu_01AbCdEf"))).toBe(false);
    expect(JSON.stringify(sent)).not.toContain("data:image");
  });

  it("Gemini: its own signature goes back on its call, and other models' first calls get the documented dummy", async () => {
    const f = fakes.find((x) => x.mode === "google")!;
    const sig = { google: { thought_signature: "c2lnLTE=" } };
    f.replies = [{ text: "Here.", calls: [{ id: "function-call-1", name: "generate", args: { jobs: [] }, extra: { google: { thought_signature: "c2lnLTI=" } } }] }];
    const r = await call("google", "gemini-3.8-flash", history("google", getLlmModel("google", "gemini-3.8-flash")!, { id: "toolu_own1", extra: sig }), { effort: "max" });
    const sent = f.seen.at(-1)!.body;
    expect(sent.reasoning_effort).toBe("high");
    const steps = sent.messages!.filter((m) => m.tool_calls?.length);
    expect(steps[0].tool_calls![0].extra_content).toEqual({ google: { thought_signature: GEMINI_DUMMY_SIGNATURE } });
    expect(steps[1].tool_calls![0].extra_content).toEqual(sig);
    expect(r.replay?.extra).toEqual({ "function-call-1": { google: { thought_signature: "c2lnLTI=" } } });
  });

  it("OpenRouter: reasoning_details go back as received to the same model only", async () => {
    const f = fakes.find((x) => x.mode === "openrouter")!;
    const details = [{ type: "reasoning.encrypted", data: "enc", index: 0 }];
    f.replies = [{ reasoning: { field: "reasoning", text: "hm" }, details, text: "Ok." }];
    const r = await call("openrouter", "x-ai/grok-4.7", [{ role: "user", content: "hi" }]);
    expect(r.replay).toMatchObject({ provider: "openrouter", model: "x-ai/grok-4.7", details });
    const msgs: Stored[] = [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "text", text: "Ok." }], replay: r.replay } as Stored, { role: "user", content: "and?" }];
    await call("openrouter", "x-ai/grok-4.7", msgs);
    expect(f.seen.at(-1)!.body.messages![2]).toMatchObject({ role: "assistant", reasoning_details: details, reasoning: "hm" });
    await call("openrouter", "openai/gpt-6.1-sol", msgs);
    expect(f.seen.at(-1)!.body.messages![2]).not.toHaveProperty("reasoning_details");
  });

  it("keeps a provider id that fits Anthropic's pattern, and stores another one with the original kept for replay", async () => {
    const f = fakes.find((x) => x.mode === "zai")!;
    f.replies = [{ calls: [{ id: "call:7/odd id", name: "search_models", args: {} }] }];
    const r = await call("zai", "glm-5.3", [{ role: "user", content: "hi" }]);
    const stored = r.toolCalls[0].id;
    expect(stored).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(r.replay?.toolIds).toEqual({ [stored]: "call:7/odd id" });
  });
});

describe("errors, in words that say what to do", () => {
  let f: FakeLlm;
  beforeAll(async () => {
    f = await fake("openai", "together");
  });
  const once = () => call("together", "moonshotai/Kimi-K3", [{ role: "user", content: "hi" }]);

  it("a rejected key says where to fix it, without the key in the text", async () => {
    const real = f.key;
    f.key = "sk-other";
    const e = (await once().catch((x) => x)) as Error;
    f.key = real;
    expect(e).toBeInstanceOf(HostedError);
    expect(e.message).toMatch(/Together AI rejected the key.*Settings → AI helper → Together AI/);
    expect(e.message).not.toContain(real.slice(3, 15));
  });

  it("no credit, a retired model, and a long chat each say so", async () => {
    f.replies = [{ status: 402, error: { error: { message: "Insufficient balance" } } }];
    await expect(once()).rejects.toThrow(/no credit/);
    f.replies = [{ status: 404, error: { error: { message: "model not found" } } }];
    await expect(once()).rejects.toThrow(/has no model moonshotai\/Kimi-K3 today/);
    f.replies = [{ status: 400, error: { error: { message: "This model's maximum context length is 1048576 tokens", code: "context_length_exceeded" } } }];
    await expect(once()).rejects.toBeInstanceOf(ContextError);
  });

  it("retries a 429 once after Retry-After, then says it's rate-limited", async () => {
    f.replies = [{ status: 429, headers: { "retry-after": "0" } }, { text: "Second time lucky" }];
    const before = f.seen.length;
    expect((await once()).text).toBe("Second time lucky");
    expect(f.seen.length - before).toBe(2);
    f.replies = [{ status: 429, headers: { "retry-after": "0" } }];
    await expect(once()).rejects.toThrow(/Together AI is rate-limited right now/);
    // A wait longer than 30 s isn't waited for.
    f.replies = [{ status: 503, headers: { "retry-after": "120" } }];
    const n = f.seen.length;
    await expect(once()).rejects.toThrow(/problem on its side/);
    expect(f.seen.length - n).toBe(1);
  });

  it("a free model's 429 is its free limit running out: OpenRouter's key check says whether for the day or the minute", async () => {
    const or = fakes.find((x) => x.mode === "openrouter")!;
    const span = async () => {
      globalThis.__fuobeOpenRouterKey = undefined;
      const e = await call("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free", [{ role: "user", content: "hi" }]).catch((x) => x);
      expect(e).toBeInstanceOf(FreeLimitError);
      return (e as InstanceType<typeof FreeLimitError>).span;
    };
    // OpenRouter's documented body is the same for both caps (its limits page).
    const documented = { error: { code: 429, message: "Rate limit exceeded", metadata: { error_type: "rate_limit_exceeded" } } };
    or.replies = [{ status: 429, headers: { "retry-after": "0" }, error: documented }];
    or.keyInfo = { is_free_tier: true, free_model_daily_requests: { used: 38, limit: 50, remaining: 12 } };
    expect(await span()).toBe("minute");
    or.keyInfo = { is_free_tier: true, free_model_daily_requests: { used: 50, limit: 50, remaining: 0 } };
    expect(await span()).toBe("day");
    // Even a message that says per-day: 12 left means it was the minute's cap.
    or.replies = [{ status: 429, headers: { "retry-after": "0" }, error: { error: { code: 429, message: "Rate limit exceeded: free-models-per-day" } } }];
    or.keyInfo = { is_free_tier: true, free_model_daily_requests: { used: 38, limit: 50, remaining: 12 } };
    expect(await span()).toBe("minute");
    // Without the key check, the words decide: a minute's cap is never read as the day's.
    or.keyInfo = undefined;
    expect(await span()).toBe("day");
    or.replies = [{ status: 429, headers: { "retry-after": "0" }, error: { error: { code: 429, message: "Rate limit exceeded: free-models-per-min" } } }];
    expect(await span()).toBe("minute");
    or.replies = [{ status: 429, headers: { "retry-after": "0" }, error: documented }];
    expect(await span()).toBe("minute");
  });

  it("reads Gemini's daily quota apart from its per-minute limit (its error codes)", () => {
    const google = getLlmProvider("google")!;
    const flash = getLlmModel("google", "gemini-3.8-flash")!;
    const err = (code: string, message: string) => hostedError(google, 429, JSON.stringify({ error: { code, message } }), flash, "AIzaKEY0123456789", { free: true }) as InstanceType<typeof FreeLimitError>;
    expect(err("quota_exceeded", "You have exceeded your daily quota.").span).toBe("day");
    expect(err("rate_limit_exceeded", "You exceeded your current quota for requests per minute.").span).toBe("minute");
    expect(err("too_many_requests", "Too many requests").span).toBe("minute");
  });

  it("a day's free limit lasts until the provider's own midnight: UTC for OpenRouter, Pacific for Gemini", () => {
    const at = Date.parse("2026-10-31T20:00:00Z");
    expect(new Date(hosted.freeResetAt("openrouter", "day", at)).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(new Date(hosted.freeResetAt("google", "day", at)).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    // Pacific winter time: midnight is 08:00 UTC.
    expect(new Date(hosted.freeResetAt("google", "day", Date.parse("2026-12-10T09:30:00Z"))).toISOString()).toBe("2026-12-11T08:00:00.000Z");
    expect(new Date(hosted.freeResetAt("google", "day", Date.parse("2026-12-10T07:30:00Z"))).toISOString()).toBe("2026-12-10T08:00:00.000Z");
    expect(hosted.freeResetAt("openrouter", "minute", at)).toBe(at + 60_000);
  });

  it("a 403 about one model or request isn't a rejected key; a key that works again (Settings → Test) is cleared", async () => {
    const q = await fake("qwen");
    setSetting("qwenWorkspace", "ws-abc123");
    q.models = ["qwen3.8-max"];
    const ep = () => hosted.endpointFor("qwen")!;
    const qwen = (m = "qwen3.8-max") => hosted.chatHosted(ep(), getLlmModel("qwen", m)!, { messages: [{ role: "user", content: "hi" }] });
    // Free Quota Only on, and this model's free quota is used up (Model Studio's docs): one model, not the key.
    q.replies = [{ status: 403, error: { code: "AllocationQuota.FreeTierOnly", message: "The free tier of the model has been exhausted." } }];
    const free = (await qwen().catch((x) => x)) as Error;
    expect(free.message).toBe("Qwen's free quota for Qwen3.8-Max is used up, and Free Quota Only is on in Model Studio. Pick another model in Manual, or turn Free Quota Only off for it.");
    expect(hosted.isRejected(ep())).toBe(false);
    // Another 403 says the provider's words, not "rejected the key".
    q.replies = [{ status: 403, error: { error: { code: "permission_denied", message: "Your API key does not have permission for this resource, or your project's API access is restricted." } } }];
    const denied = (await qwen().catch((x) => x)) as Error;
    expect(denied.message).toMatch(/refused this request \(Your API key does not have permission/);
    expect(denied.message).not.toMatch(/rejected the key/);
    expect(hosted.isRejected(ep())).toBe(false);
    // A 403 that names the key, and a 401, are the key.
    q.replies = [{ status: 403, error: { code: "InvalidApiKey", message: "Invalid API-key provided." } }];
    expect(((await qwen().catch((x) => x)) as Error).message).toMatch(/rejected the key/);
    expect(hosted.isRejected(ep())).toBe(true);
    // Settings → Test with the same key works: the key isn't marked rejected any more.
    expect(await hosted.testHosted("qwen")).toMatchObject({ ok: true });
    expect(hosted.isRejected(ep())).toBe(false);
    setSetting("qwenWorkspace", "");
    setSetting("qwenKey", "");
    process.env.FUOBE_LLM_TEST_BASE = (process.env.FUOBE_LLM_TEST_BASE ?? "").split(",").filter((x) => !x.startsWith("qwen=")).join(",");
  });

  it("stops before the call when the chat can't fit the model's context", async () => {
    const big = "word ".repeat(140_000);
    const n = f.seen.length;
    await expect(call("together", "openai/gpt-oss-120b", [{ role: "user", content: big }])).rejects.toThrow(/This chat is too long for gpt-oss-120b/);
    expect(f.seen.length).toBe(n);
    // GPT-5.4 Mini: 400K context, but 272K tokens in at most.
    const oa = await fake("openai");
    const before = oa.seen.length;
    await expect(call("openai", "gpt-5.4-mini", [{ role: "user", content: "word ".repeat(250_000) }])).rejects.toThrow(/This chat is too long for GPT-5\.4 Mini \(about 31\dK tokens\)/);
    expect(oa.seen.length).toBe(before);
  });
});

describe("keys stay where they belong", () => {
  it("never follows a redirect with the key: the second server never sees it", async () => {
    const second = fakeLlm("openai");
    await second.start();
    const first = await fake("openai", "fireworks");
    first.redirect = `${second.url}/v1/chat/completions`;
    await expect(call("fireworks", "accounts/fireworks/models/glm-5p3", [{ role: "user", content: "hi" }])).rejects.toThrow();
    expect(second.seen).toHaveLength(0);
    await second.close();
  });

  it("refuses inside an account's or a guest's work, even with the key set", async () => {
    await fake("openai", "huggingface");
    expect(hosted.endpointFor("huggingface")).not.toBeNull();
    expect(() => runAsTenant({ kind: "account", id: "a1" }, () => hosted.endpointFor("huggingface"))).toThrow(/studio's own/);
    const ep = hosted.endpointFor("huggingface")!;
    await expect(runAsTenant({ kind: "guest" }, () => hosted.chatHosted(ep, ep.provider.models[0], { messages: [{ role: "user", content: "hi" }] }))).rejects.toThrow(/studio's own/);
  });

  it("only takes a test address on this machine, and never sends a key over plain http to a public host", async () => {
    setSetting("groqKey", "gsk_testkey0123456789");
    process.env.FUOBE_LLM_TEST_BASE = "groq=http://example.com/v1";
    expect(hosted.endpointFor("groq")!.baseUrl).toBe("https://api.groq.com/openai/v1");
    const ep = { ...hosted.endpointFor("groq")!, baseUrl: "http://example.com/v1" };
    await expect(hosted.chatHosted(ep, ep.provider.models[0], { messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/plain http/);
  });

  it("builds Qwen's host from its region and a checked workspace id only", () => {
    setSetting("qwenKey", "sk-qwen0123456789");
    expect(hosted.endpointFor("qwen")).toBeNull();
    setSetting("qwenWorkspace", "ws-abc123");
    setSetting("qwenRegion", "virginia");
    expect(hosted.endpointFor("qwen")!.baseUrl).toBe("https://ws-abc123.us-east-1.maas.aliyuncs.com/compatible-mode/v1");
    expect(() => setSetting("qwenWorkspace", "evil.example.com/x")).toThrow();
  });

  it("Test lists the models with the key (a free call) and says when the key is wrong", async () => {
    const f = await fake("openai", "cerebras");
    f.models = ["gpt-oss-120b", "qwen-3.8-27b"];
    expect(await hosted.testHosted("cerebras")).toMatchObject({ ok: true, detail: expect.stringMatching(/Key works · 2 models/) });
    expect(f.seen.at(-1)).toMatchObject({ method: "GET", url: "/v1/models" });
    setSetting("cerebrasKey", "csk-wrong0123456789");
    const r = await hosted.testHosted("cerebras");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/rejected the key/);
    expect(r.detail).not.toContain("wrong0123456789");
  });
});

describe("the fake itself", () => {
  it("answers 400 to a request that breaks a rule (so the checks above mean something)", async () => {
    const f = fakeLlm("minimax");
    await f.start();
    const res = await new Promise<number>((done) => {
      const req = http.request(`${f.url}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${f.key}`, "content-type": "application/json" } }, (r) => done(r.statusCode ?? 0));
      req.end(JSON.stringify({ model: "m", stream: true, tool_choice: "auto", messages: [{ role: "system", content: "s" }] }));
    });
    expect(res).toBe(400);
    await f.close();
  });
});
