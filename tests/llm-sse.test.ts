import { describe, expect, it } from "vitest";
import { readChatStream, StreamError } from "@/server/llm/sse";

/*
 * The Chat Completions stream reader that every hosted provider goes through: the shapes their docs
 * describe (comment lines, tool arguments in pieces, Gemini signatures in a chunk with no text,
 * Mistral's content chunks, the three places usage turns up, errors inside a 200 stream).
 */

/** A body that arrives in awkward pieces: `cut` characters at a time, splitting lines and JSON. */
function body(events: (string | object)[], cut = 7): ReadableStream<Uint8Array> {
  const text = events.map((e) => (typeof e === "string" ? e : `data: ${JSON.stringify(e)}\n\n`)).join("");
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + cut));
      i += cut;
    },
  });
}

const chunk = (delta: object, finish: string | null = null, extra: object = {}) => ({ id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta, finish_reason: finish }], ...extra });

describe("readChatStream", () => {
  it("skips comment and empty lines, joins text, and ends at [DONE]", async () => {
    const r = await readChatStream(body([": OPENROUTER PROCESSING\n\n", ": keep-alive\n\n", chunk({ role: "assistant", content: "Hel" }), chunk({ content: "lo" }), chunk({}, "stop"), "data: [DONE]\n\n", "data: {not json after done\n\n"]));
    expect(r.text).toBe("Hello");
    expect(r.finish).toBe("stop");
    expect(r.toolCalls).toEqual([]);
  });

  it("joins tool arguments split over chunks, for two parallel calls, keeping the first id and name", async () => {
    const r = await readChatStream(
      body([
        chunk({ tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "search_models", arguments: '{"ki' } }] }),
        chunk({ tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "list_elements", arguments: "" } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'nd":"image"}' } }] }),
        chunk({ tool_calls: [{ index: 1, function: { arguments: "{}" } }] }),
        chunk({}, "tool_calls"),
        "data: [DONE]\n\n",
      ]),
    );
    expect(r.toolCalls).toEqual([
      { id: "call_a", name: "search_models", arguments: '{"kind":"image"}' },
      { id: "call_b", name: "list_elements", arguments: "{}" },
    ]);
    expect(r.finish).toBe("tool_calls");
  });

  it("keeps Gemini's signature when it arrives in a chunk with no text", async () => {
    const sig = { google: { thought_signature: "c2lnLTE=" } };
    const r = await readChatStream(
      body([chunk({ tool_calls: [{ index: 0, id: "f1", type: "function", function: { name: "generate", arguments: "{}" } }] }), chunk({ content: "", tool_calls: [{ index: 0, extra_content: sig }] }), chunk({}, "tool_calls")]),
    );
    expect(r.toolCalls[0]).toEqual({ id: "f1", name: "generate", arguments: "{}", extra: sig });
  });

  it("reads Mistral's content chunks: thinking apart from the answer", async () => {
    const r = await readChatStream(
      body([chunk({ content: [{ type: "thinking", thinking: [{ type: "text", text: "Let me think." }] }] }), chunk({ content: [{ type: "text", text: "A fox" }] }), chunk({ content: " in snow." }, "stop")]),
    );
    expect(r.text).toBe("A fox in snow.");
    expect(r.reasoning).toEqual({ field: "thinking", text: "Let me think." });
  });

  it("reads reasoning_content and reasoning under their own names, and OpenRouter's reasoning_details", async () => {
    const a = await readChatStream(body([chunk({ reasoning_content: "Step 1. " }), chunk({ reasoning_content: "Step 2." }), chunk({ content: "Done" }, "stop")]));
    expect(a.reasoning).toEqual({ field: "reasoning_content", text: "Step 1. Step 2." });
    const b = await readChatStream(
      body([
        chunk({ reasoning: "Hm", reasoning_details: [{ type: "reasoning.text", text: "Hm", index: 0 }] }),
        chunk({ reasoning: "m.", reasoning_details: [{ type: "reasoning.text", text: "m.", index: 0, signature: "sig" }] }),
        chunk({ reasoning_details: [{ type: "reasoning.encrypted", data: "ZW5j", index: 1 }] }),
        chunk({ content: "Ok" }, "stop"),
      ]),
    );
    expect(b.reasoning).toEqual({ field: "reasoning", text: "Hmm." });
    expect(b.details).toEqual([
      { type: "reasoning.text", text: "Hmm.", index: 0, signature: "sig" },
      { type: "reasoning.encrypted", data: "ZW5j", index: 1 },
    ]);
  });

  it("finds usage in all three places providers put it", async () => {
    // OpenAI: a last chunk with no choices.
    const a = await readChatStream(body([chunk({ content: "x" }, "stop"), { id: "c1", choices: [], usage: { prompt_tokens: 900, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 800 } } }]));
    expect(a.usage).toEqual({ input: 900, output: 20, cached: 800 });
    // OpenRouter: one choice with an empty delta.
    const b = await readChatStream(body([chunk({ content: "x" }), chunk({}, "stop", { usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } } })]));
    expect(b.usage).toEqual({ input: 10, output: 5, reasoning: 3 });
    // Together: details flat in usage.
    const c = await readChatStream(body([chunk({ content: "x" }, "stop", { usage: { prompt_tokens: 7, completion_tokens: 2, cached_tokens: 4 } })]));
    expect(c.usage).toEqual({ input: 7, output: 2, cached: 4 });
  });

  it("fails on an error chunk or finish_reason error, with the provider's words", async () => {
    await expect(readChatStream(body([chunk({ content: "x" }), { error: { message: "Provider returned error", code: 502 }, choices: [{ index: 0, delta: {}, finish_reason: "error" }] }]))).rejects.toMatchObject({
      message: "Provider returned error",
      status: 502,
    });
    await expect(readChatStream(body([chunk({ content: "x" }, "error")]))).rejects.toBeInstanceOf(StreamError);
  });

  it("turns MiniMax's base_resp errors in a 200 stream into statuses", async () => {
    const err = (code: number) => readChatStream(body([{ id: "x", choices: [], base_resp: { status_code: code, status_msg: `code ${code}` } }]), { errorEnvelope: "minimax" });
    await expect(err(1002)).rejects.toMatchObject({ status: 429 });
    await expect(err(1004)).rejects.toMatchObject({ status: 401 });
    await expect(err(1008)).rejects.toMatchObject({ status: 402 });
    await expect(err(2013)).rejects.toMatchObject({ status: 400 });
    // status_code 0 is success.
    const ok = await readChatStream(body([chunk({ content: "fine" }, "stop", { base_resp: { status_code: 0, status_msg: "" } })]), { errorEnvelope: "minimax" });
    expect(ok.text).toBe("fine");
  });

  it("gives up when nothing arrives for too long, but keep-alives count", async () => {
    const enc = new TextEncoder();
    let n = 0;
    const alive = new ReadableStream<Uint8Array>({
      async pull(c) {
        await new Promise((r) => setTimeout(r, 40));
        if (n++ < 4) c.enqueue(enc.encode(": keep-alive\n\n"));
        else {
          c.enqueue(enc.encode(`data: ${JSON.stringify(chunk({ content: "late" }, "stop"))}\n\n`));
          c.close();
        }
      },
    });
    expect((await readChatStream(alive, { idleMs: 120 })).text).toBe("late");
    const silent = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    await expect(readChatStream(silent, { idleMs: 60 })).rejects.toMatchObject({ idle: true });
  });

  it("reads a body that ends without [DONE] or a final blank line", async () => {
    const r = await readChatStream(body([chunk({ content: "a" }), `data: ${JSON.stringify(chunk({ content: "b" }, "stop"))}`], 3));
    expect(r.text).toBe("ab");
    expect(r.finish).toBe("stop");
  });
});
