import http from "node:http";

/*
 * A stand-in for the hosted LLM providers, on an OS-chosen port of this machine. It speaks OpenAI's
 * Chat Completions (streamed, as Fuobe always asks), OpenAI's Responses API, the free model lists
 * and OpenRouter's key check. In a strict `mode` it answers 400 the way each provider's docs say it
 * does when a request breaks one of its rules, so a wrong request body fails the test that sent it.
 */

export interface Seen {
  method: string;
  url: string;
  auth?: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown> & { messages?: WireMsg[] };
}

export type WireMsg = {
  role: string;
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string }; extra_content?: unknown }[];
  reasoning_content?: string;
  reasoning?: string;
  reasoning_details?: unknown[];
};

/** One scripted reply: a stream of chunks built from it, or an error. */
export interface Reply {
  text?: string;
  calls?: { id?: string; name: string; args: unknown; extra?: unknown }[];
  reasoning?: { field: "reasoning_content" | "reasoning"; text: string };
  details?: unknown[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  finish?: string;
  /** An HTTP error instead: status, body and headers. */
  status?: number;
  error?: unknown;
  headers?: Record<string, string>;
  /** Responses API: the output items of response.completed. */
  output?: unknown[];
  /** Responses API: end with response.incomplete (max_output_tokens). */
  incomplete?: boolean;
}

export type Mode =
  | "openai"
  | "meta"
  | "moonshot"
  | "deepseek"
  | "google"
  | "zai"
  | "minimax"
  | "cohere"
  | "cerebras"
  | "groq"
  | "openrouter"
  | "fireworks"
  | "mistral"
  | "together"
  | "qwen"
  | "xai"
  | "huggingface"
  /** A local OpenAI-compatible server (llama-server, vLLM…): answers unstreamed calls too. */
  | "local";

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

/** The rule a request breaks in this provider's docs, or null. */
function broken(mode: Mode, b: Seen["body"], issued: Set<string>): string | null {
  const msgs = b.messages ?? [];
  const tools = Array.isArray(b.tools) && b.tools.length > 0;
  if (b.stream !== true) return "stream must be true";
  for (const t of (b.tools as { type?: string; function?: { name?: string; parameters?: unknown } }[] | undefined) ?? []) {
    if (t.type !== "function" || !t.function?.name || !t.function.parameters) return "tools must be {type: function, function: {name, parameters}}";
  }
  if (msgs[0]?.role !== (mode === "cohere" ? "developer" : "system")) return `the first message must be ${mode === "cohere" ? "developer" : "system"}`;
  if (msgs.slice(1).some((m) => m.role === "system" || m.role === "developer")) return "one system message, first";
  // Every result answers a call of the assistant turn before it.
  const calls = new Set<string>();
  for (const m of msgs) {
    if (m.role === "assistant") for (const c of m.tool_calls ?? []) calls.add(c.id);
    if (m.role === "tool" && !calls.has(m.tool_call_id ?? "")) return `tool_call_id ${m.tool_call_id} answers no call`;
  }
  for (const m of msgs) {
    for (const c of m.tool_calls ?? []) {
      try {
        JSON.parse(c.function.arguments);
      } catch {
        return "tool arguments must be a JSON string";
      }
    }
  }
  const temps = ["temperature", "top_p", "n", "presence_penalty", "frequency_penalty"];
  switch (mode) {
    case "meta":
      if (tools && b.tool_choice !== "auto") return "tool_choice must be auto";
      if ("max_output_tokens" in b || "max_tokens" in b) return "use max_completion_tokens";
      break;
    case "moonshot":
      for (const k of temps) if (k in b) return `${k} can't be changed on this model`;
      break;
    case "deepseek":
      if (tools) {
        for (const m of msgs) {
          if (m.role === "assistant" && typeof m.reasoning_content !== "string") return "The reasoning_content in the thinking mode must be passed back to the API.";
          for (const c of m.tool_calls ?? []) if (!issued.has(c.id)) return `tool call ${c.id} was not made by this model`;
        }
      }
      break;
    case "google": {
      // The first call of each step carries its signature (the documented dummy for other models' turns).
      for (const m of msgs) {
        const first = m.tool_calls?.[0] as { extra_content?: { google?: { thought_signature?: string } } } | undefined;
        if (first && !first.extra_content?.google?.thought_signature) return "Function call is missing a thought_signature";
      }
      if ("thinking_config" in b && "reasoning_effort" in b) return "reasoning_effort and thinking_config can't both be set";
      if (["minimal", "none"].includes(String(b.reasoning_effort))) return "this model doesn't take that reasoning_effort";
      break;
    }
    case "zai":
      if ("tool_choice" in b && b.tool_choice !== "auto") return "tool_choice only supports auto";
      break;
    case "minimax":
      if ("tool_choice" in b) return "tool_choice is not supported";
      break;
    case "cerebras":
      for (const m of msgs) {
        if (!Array.isArray(m.content)) continue;
        for (const p of m.content as { type: string; image_url?: { url?: string } }[]) {
          if (p.type === "image_url" && !/^data:image\/(png|jpeg);base64,/.test(p.image_url?.url ?? "")) return "images must be base64 PNG or JPEG";
        }
      }
      if (Number(b.max_completion_tokens) > 16_384) return "max_completion_tokens is charged up front: too large";
      break;
    case "groq":
      if (msgs.some((m) => "name" in m)) return "'messages.name' is not supported";
      break;
    case "openrouter":
      if (msgs.some((m) => m.role === "tool") && !tools) return "tools must be sent on every request";
      if ("HTTP-Referer" in b) return "no";
      break;
    case "fireworks":
      if (b.context_length_exceeded_behavior !== "error") return "expected context_length_exceeded_behavior";
      break;
    case "mistral":
      for (const m of msgs) {
        for (const c of m.tool_calls ?? []) if (!/^[A-Za-z0-9]{9}$/.test(c.id)) return "Tool call id has to be 9 letters and digits";
        if (m.role === "tool" && !/^[A-Za-z0-9]{9}$/.test(m.tool_call_id ?? "")) return "Tool call id has to be 9 letters and digits";
      }
      break;
  }
  return null;
}

/**
 * The Responses API's rules: stateless, instructions apart, flat tools that aren't strict, results that answer
 * a call in the input, and a call this model made carrying its reasoning item back (OpenAI refuses a
 * function_call "provided without its required reasoning item").
 */
function brokenResponses(b: Record<string, unknown>, needs: Map<string, string>): string | null {
  if (b.store !== false) return "store must be false";
  if (b.stream !== true) return "stream must be true";
  if (typeof b.instructions !== "string" || !b.instructions) return "instructions expected";
  if ("messages" in b) return "Unsupported parameter: messages";
  for (const t of (b.tools as Record<string, unknown>[] | undefined) ?? []) {
    if (t.type !== "function" || typeof t.name !== "string" || "function" in t || t.strict !== false) return "tools must be flat, with strict false";
  }
  const input = (b.input as Record<string, unknown>[] | undefined) ?? [];
  const calls = new Set<string>();
  const reasoning = new Set<string>();
  for (const i of input) {
    if (i.type === "reasoning" && typeof i.encrypted_content === "string") reasoning.add(i.encrypted_content);
    if (i.type === "function_call") {
      calls.add(String(i.call_id));
      // An item that names the stored call (its fc_ id) comes with the reasoning it followed.
      const need = typeof i.id === "string" ? needs.get(i.id) : undefined;
      if (need && !reasoning.has(need)) return `Item of type 'function_call' was provided without its required 'reasoning' item`;
    }
    if (i.type === "function_call_output" && !calls.has(String(i.call_id))) return `No tool call found for function call output with call_id ${i.call_id}`;
    if (i.role === "system") return "use instructions";
  }
  return null;
}

/** The Chat Completions stream for a reply, in small chunks (arguments split in two, the signature in a chunk of its own). */
function chatStream(r: Reply, model: string, mode: Mode): string {
  const chunk = (delta: object, finish: string | null = null, extra: object = {}) => sse({ id: "c1", object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra });
  let out = ": keep-alive\n\n";
  if (r.reasoning) out += chunk({ [r.reasoning.field]: r.reasoning.text });
  if (r.details) out += chunk({ reasoning_details: r.details });
  if (r.text) {
    const half = Math.ceil(r.text.length / 2);
    out += chunk({ role: "assistant", content: r.text.slice(0, half) }) + chunk({ content: r.text.slice(half) });
  }
  (r.calls ?? []).forEach((c, i) => {
    const args = JSON.stringify(c.args ?? {});
    const cut = Math.ceil(args.length / 2);
    out += chunk({ tool_calls: [{ index: i, id: c.id ?? `call_${i}`, type: "function", function: { name: c.name, arguments: args.slice(0, cut) } }] });
    out += chunk({ tool_calls: [{ index: i, function: { arguments: args.slice(cut) } }] });
    if (c.extra !== undefined) out += chunk({ tool_calls: [{ index: i, extra_content: c.extra }] });
  });
  const finish = r.finish ?? (r.calls?.length ? "tool_calls" : "stop");
  const usage = r.usage ?? { prompt_tokens: 900, completion_tokens: 40 };
  // Usage where each provider puts it: OpenRouter's one choice with an empty delta, Fireworks' on the finish chunk, else a last chunk with no choices.
  if (mode === "fireworks") out += chunk({}, finish, { usage });
  else if (mode === "openrouter") out += chunk({}, finish) + chunk({}, null, { usage });
  else out += chunk({}, finish) + sse({ id: "c1", object: "chat.completion.chunk", model, choices: [], usage });
  return `${out}data: [DONE]\n\n`;
}

/** A Responses API stream: typed events, the whole response in response.completed. */
function responsesStream(r: Reply, model: string): string {
  const output =
    r.output ??
    [
      ...(r.text ? [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: r.text, annotations: [] }] }] : []),
      ...(r.calls ?? []).map((c, i) => ({ type: "function_call", id: `fc_${i}`, call_id: c.id ?? `call_${i}`, name: c.name, arguments: JSON.stringify(c.args ?? {}), status: "completed" })),
    ];
  const response = { id: "resp_1", object: "response", model, status: r.incomplete ? "incomplete" : "completed", output, usage: { input_tokens: 900, output_tokens: 40, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 12 } }, ...(r.incomplete && { incomplete_details: { reason: "max_output_tokens" } }) };
  const ev = (type: string, o: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
  let out = ev("response.created", { response: { ...response, status: "in_progress", output: [] } });
  if (r.text) out += ev("response.output_text.delta", { delta: r.text });
  out += r.incomplete ? ev("response.incomplete", { response }) : ev("response.completed", { response });
  return out;
}

export interface FakeLlm {
  url: string;
  seen: Seen[];
  /** Chat Completions (or Responses) request bodies, in order. */
  chats: () => Seen["body"][];
  mode: Mode;
  key: string;
  /** Replies, in order; the last one repeats. Setting them starts from the first again. */
  replies: Reply[];
  /** Answers GET …/key (OpenRouter's limits). */
  keyInfo?: Record<string, unknown>;
  /** A redirect for every request, to this URL. */
  redirect?: string;
  models: string[];
  /** Ids this fake's model made (DeepSeek refuses calls it didn't). */
  issued: Set<string>;
  /** Responses: a function_call item's id → the encrypted reasoning that must come back with it. */
  needs: Map<string, string>;
  start: () => Promise<void>;
  close: () => Promise<void>;
}

export function fakeLlm(mode: Mode, key = "sk-test-0123456789abcdefghij"): FakeLlm {
  const seen: Seen[] = [];
  let served = 0;
  let replies: Reply[] = [{ text: "OK" }];
  const f: FakeLlm = {
    url: "",
    seen,
    chats: () => seen.filter((r) => r.method === "POST").map((r) => r.body),
    mode,
    key,
    get replies() {
      return replies;
    },
    set replies(r: Reply[]) {
      replies = r;
      served = 0;
    },
    models: [],
    issued: new Set(),
    needs: new Map(),
    start: () => new Promise<void>((done) => server.listen(0, "127.0.0.1", () => ((f.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`), done()))),
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: Seen["body"] = {};
      try {
        body = raw ? (JSON.parse(raw) as Seen["body"]) : {};
      } catch {}
      const r: Seen = { method: req.method ?? "GET", url: req.url ?? "/", auth: req.headers.authorization, headers: req.headers, body };
      seen.push(r);
      const json = (status: number, o: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(o));
      };
      if (f.redirect) {
        res.writeHead(302, { location: f.redirect });
        return res.end();
      }
      if (r.auth !== `Bearer ${f.key}`) return json(401, { error: { message: `Incorrect API key provided: ${(r.auth ?? "").slice(7, 19)}…`, type: "invalid_request_error", code: "invalid_api_key" } });
      if (r.method === "GET" && /\/models$/.test(r.url)) return json(200, { object: "list", data: f.models.map((id) => ({ id, object: "model", owned_by: mode })) });
      if (r.method === "GET" && /\/key$/.test(r.url)) return f.keyInfo ? json(200, { data: f.keyInfo }) : json(404, { error: { message: "Not found" } });
      const reply = replies[Math.min(served, replies.length - 1)];
      served++;
      if (reply.status) return json(reply.status, reply.error ?? { error: { message: `error ${reply.status}` } }, reply.headers);
      const model = String(body.model ?? "m");
      if (/\/responses$/.test(r.url)) {
        const bad = brokenResponses(body, f.needs);
        if (bad) return json(400, { error: { message: bad, type: "invalid_request_error" } });
        const out = (reply.output ?? []) as Record<string, unknown>[];
        const enc = out.find((i) => i.type === "reasoning")?.encrypted_content;
        if (typeof enc === "string") for (const i of out) if (i.type === "function_call") f.needs.set(String(i.id), enc);
        res.writeHead(200, { "content-type": "text/event-stream" });
        return res.end(responsesStream(reply, model));
      }
      if (mode === "local" && body.stream !== true) {
        const calls = (reply.calls ?? []).map((c, i) => ({ id: c.id ?? `call_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } }));
        return json(200, { id: "c1", object: "chat.completion", model, choices: [{ index: 0, finish_reason: calls.length ? "tool_calls" : "stop", message: { role: "assistant", content: reply.text ?? "", ...(calls.length && { tool_calls: calls }) } }] });
      }
      const wrong = broken(mode, body, f.issued);
      if (wrong) return json(400, { error: { message: wrong, type: "invalid_request_error" } });
      for (const c of reply.calls ?? []) if (c.id) f.issued.add(c.id);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(chatStream(reply, model, mode));
    });
  });
  return f;
}
