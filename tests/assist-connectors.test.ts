import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeStream } from "./fixtures/claude-sse";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-assist-conn-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;

const { setSetting } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const connectors = await import("@/server/assist/connectors");
const lib = await import("@/lib/assist-connectors");
const listRoute = await import("@/app/api/assist/connectors/route");
const oneRoute = await import("@/app/api/assist/connectors/[connectorId]/route");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const TOKEN = "sk-live-0123456789abcdef";

describe("connector URLs", () => {
  const check = lib.checkConnectorUrl;
  it("takes https anywhere and http only on this machine", () => {
    expect(check("https://mcp.example.com/mcp")).toEqual({ url: "https://mcp.example.com/mcp" });
    expect(check("  https://mcp.example.com  ")).toEqual({ url: "https://mcp.example.com/" });
    expect(check("http://localhost:8787/mcp")).toMatchObject({ url: "http://localhost:8787/mcp", warning: expect.stringMatching(/public tunnel/) });
    expect(check("http://127.0.0.1:3001/mcp")).toMatchObject({ url: "http://127.0.0.1:3001/mcp" });
    expect(check("http://[::1]:3001/mcp")).toMatchObject({ url: "http://[::1]:3001/mcp" });
    expect(check("http://mcp.example.com/mcp")).toEqual({ error: "Use https:// — plain http is only allowed for localhost" });
    expect(check("http://192.168.1.20/mcp")).toEqual({ error: "Use https:// — plain http is only allowed for localhost" });
  });

  it("FUOBE_ALLOW_PRIVATE_URLS=1 allows plain http elsewhere, with a warning", () => {
    expect(check("http://192.168.1.20/mcp", true)).toMatchObject({ url: "http://192.168.1.20/mcp", warning: expect.stringMatching(/public tunnel/) });
    expect(check("http://mcp.example.com/mcp", true)).toMatchObject({ url: "http://mcp.example.com/mcp", warning: expect.stringMatching(/unencrypted/) });
  });

  it("refuses other schemes, credentials in the URL, garbage and very long URLs", () => {
    expect(check("ftp://mcp.example.com")).toEqual({ error: "Connectors use https:// URLs" });
    expect(check("javascript:alert(1)")).toEqual({ error: "Connectors use https:// URLs" });
    expect(check("file:///etc/passwd")).toEqual({ error: "Connectors use https:// URLs" });
    expect(check("https://user:pw@mcp.example.com/")).toEqual({ error: "Put the token in the token field, not in the URL" });
    expect(check("mcp.example.com")).toEqual({ error: "Enter a full URL, like https://mcp.example.com/mcp" });
    expect(check("")).toEqual({ error: "Enter the connector's URL" });
    expect(check(`https://mcp.example.com/${"a".repeat(2100)}`)).toMatchObject({ error: expect.stringMatching(/too long/) });
    // https to a private address is allowed (Anthropic's servers make the call) but flagged.
    expect(check("https://10.0.0.5/mcp")).toMatchObject({ warning: expect.stringMatching(/public tunnel/) });
  });

  it("masks the query and id-like path segments (keys often live there), names connectors and cleans pasted tokens", () => {
    expect(lib.maskConnectorUrl("https://mcp.example.com/mcp?key=SECRET")).toBe("https://mcp.example.com/mcp?••••");
    // Zapier's URL is itself the secret: /api/mcp/s/<secret>/mcp.
    expect(lib.maskConnectorUrl("https://mcp.zapier.com/api/mcp/s/ODk1YjQ2NzQtSECRET0123456789/mcp")).toBe("https://mcp.zapier.com/api/mcp/s/…/mcp");
    expect(lib.maskConnectorUrl("https://mcp.pipedream.net/6d1c3f2a-58e1-4b55-9e0a-0123456789ab/notion")).toBe("https://mcp.pipedream.net/…/notion");
    expect(lib.maskConnectorUrl("https://server.example.com/u/Abc123/k/Def456/v1/sse")).toBe("https://server.example.com/u/…/k/…/v1/sse");
    expect(lib.maskConnectorUrl("https://x.example.com/Secret_Token-xyz/another-one#frag")).toBe("https://x.example.com/…?••••");
    expect(lib.maskConnectorUrl("https://mcp.example.com/")).toBe("https://mcp.example.com");
    expect(lib.maskConnectorUrl("not a url")).toBe("••••");
    expect(lib.connectorSlug("Notion (work)")).toBe("notion-work");
    expect(lib.connectorSlug("Ünïcode Tööls")).toBe("unicode-tools");
    expect(lib.connectorSlug("Notion", ["notion", "notion-2"])).toBe("notion-3");
    expect(lib.connectorSlug("!!!")).toBe("connector");
    expect(lib.cleanToken("Bearer abc.def")).toBe("abc.def");
    expect(lib.cleanToken("Authorization: Bearer abc")).toBe("abc");
  });

  it("masks short tokens harder than long API keys", () => {
    expect(lib.maskToken(TOKEN)).toBe("sk-l••••cdef");
    expect(lib.maskToken("abcd12wxyz")).toBe("••••yz");
    expect(lib.maskToken("lin_api_SECRETSECRET")).toBe("••••ET");
    expect(lib.maskToken("short")).toBe("••••");
    expect(lib.maskToken("")).toBe("");
  });

  it("reads an allow-list of tool names", () => {
    expect(lib.parseToolList("search_pages, get_page\nget_page  list-items")).toEqual({ tools: ["search_pages", "get_page", "list-items"] });
    expect(lib.parseToolList(["a.b", "c"])).toEqual({ tools: ["a.b", "c"] });
    expect(lib.parseToolList("  ")).toEqual({ tools: null });
    expect(lib.parseToolList(null)).toEqual({ tools: null });
    expect(lib.parseToolList("search pages!")).toMatchObject({ error: expect.stringMatching(/“pages!” isn't a tool name/) });
    expect(lib.parseToolList(Array.from({ length: 65 }, (_, i) => `t${i}`))).toMatchObject({ error: expect.stringMatching(/at most 64/) });
  });
});

describe("connectors in Settings", () => {
  it("keeps the token on the server: every view masks it, and the API never returns it", async () => {
    const c = connectors.createConnector({ name: "Notion", url: "https://mcp.notion.com/mcp?workspace=SECRET", token: `Bearer ${TOKEN}` });
    expect(c).toMatchObject({ name: "Notion", slug: "notion", url: "https://mcp.notion.com/mcp?••••", hasToken: true, enabled: true, token: "sk-l••••cdef" });
    const res = await listRoute.GET();
    const body = await res.text();
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain("SECRET");
    expect(JSON.parse(body).items).toHaveLength(1);
    // Created through the route: the response is masked too.
    const created = await listRoute.POST(new Request("http://x/api/assist/connectors", { method: "POST", body: JSON.stringify({ name: "Linear", url: "https://mcp.linear.app/mcp", token: "lin_api_SECRETSECRET" }) }));
    expect(created.status).toBe(201);
    const text = await created.text();
    expect(text).not.toContain("lin_api_SECRETSECRET");
    expect(JSON.parse(text)).toMatchObject({ slug: "linear", hasToken: true, token: "••••ET", tools: null });
    // The secret is only what the Claude request reads.
    expect(connectors.activeConnectors().map((x) => [x.slug, x.token])).toEqual([
      ["notion", TOKEN],
      ["linear", "lin_api_SECRETSECRET"],
    ]);
  });

  it("never sends a secret kept in the URL's path to the browser", async () => {
    const secret = "ODk1YjQ2NzQtZmFrZS1zZWNyZXQtMTIzNDU2";
    const c = connectors.createConnector({ name: "Zapier", url: `https://mcp.zapier.com/api/mcp/s/${secret}/mcp` });
    expect(c.url).toBe("https://mcp.zapier.com/api/mcp/s/…/mcp");
    const body = await (await listRoute.GET()).text();
    expect(body).not.toContain(secret);
    // The full URL stays on the server: the duplicate check and the Claude request use it.
    expect(() => connectors.createConnector({ name: "Zapier again", url: `https://mcp.zapier.com/api/mcp/s/${secret}/mcp` })).toThrow(/already/);
    expect(connectors.activeConnectors().find((x) => x.slug === "zapier")?.url).toContain(secret);
    connectors.deleteConnector(c.id);
  });

  it("validates input, refuses duplicates and caps the list", async () => {
    expect(() => connectors.createConnector({ name: "", url: "https://a.example.com" })).toThrow(/name/);
    expect(() => connectors.createConnector({ name: "Plain", url: "http://a.example.com" })).toThrow(/https/);
    expect(() => connectors.createConnector({ name: "Again", url: "https://mcp.linear.app/mcp" })).toThrow(/already/);
    expect(() => connectors.createConnector({ name: "Spaces", url: "https://b.example.com", token: "two words" })).toThrow(/only the token/);
    expect(() => connectors.createConnector({ name: "Tools", url: "https://c.example.com", tools: "rm -rf /" })).toThrow(/isn't a tool name/);
    const bad = await listRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ name: "x", url: "ftp://x" }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Connectors use https:// URLs");
  });

  it("edits keep the token unless a new one is given; off connectors aren't sent", async () => {
    const [notion] = connectors.listConnectors();
    const ctx = { params: Promise.resolve({ connectorId: notion.id }) };
    const r = await oneRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "Notion work", enabled: false }) }), ctx);
    expect(await r.json()).toMatchObject({ name: "Notion work", slug: "notion", enabled: false, hasToken: true });
    expect(connectors.activeConnectors().map((x) => x.slug)).toEqual(["linear"]);
    await oneRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ enabled: true, token: "" }) }), ctx);
    expect(connectors.activeConnectors().find((x) => x.slug === "notion")?.token).toBeNull();
    await oneRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ token: TOKEN }) }), ctx);
    expect(connectors.activeConnectors().find((x) => x.slug === "notion")?.token).toBe(TOKEN);
    // An allow-list: set, kept by other edits, cleared with "" (or null).
    const limited = await oneRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ tools: "search_pages, get_page" }) }), ctx);
    expect(await limited.json()).toMatchObject({ tools: ["search_pages", "get_page"] });
    await oneRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "Notion work" }) }), ctx);
    expect(connectors.activeConnectors().find((x) => x.slug === "notion")?.tools).toEqual(["search_pages", "get_page"]);
    const bad = await oneRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ tools: "search pages!" }) }), ctx);
    expect(bad.status).toBe(400);
  });
});

describe("the Claude request", () => {
  it("builds one mcp_servers entry and one mcp_toolset per connector, joined by name", () => {
    expect(connectors.mcpParams([])).toBeNull();
    expect(
      connectors.mcpParams([
        { id: "a", name: "Notion", slug: "notion", url: "https://mcp.notion.com/mcp", token: TOKEN, tools: ["search_pages", "get_page"], enabled: true },
        { id: "b", name: "Docs", slug: "docs", url: "https://docs.example.com/mcp", token: null, tools: null, enabled: true },
      ]),
    ).toEqual({
      mcp_servers: [
        { type: "url", url: "https://mcp.notion.com/mcp", name: "notion", authorization_token: TOKEN },
        { type: "url", url: "https://docs.example.com/mcp", name: "docs" },
      ],
      toolsets: [
        // An allow-list: every tool off by default, the listed ones on.
        { type: "mcp_toolset", mcp_server_name: "notion", default_config: { enabled: false }, configs: { search_pages: { enabled: true }, get_page: { enabled: true } } },
        { type: "mcp_toolset", mcp_server_name: "docs" },
      ],
    });
  });

  it("sends the connectors through the SDK with the MCP beta, and the chat shows the connector tools used", async () => {
    setSetting("anthropicKey", "sk-ant-test");
    const sent: { headers: Headers; body: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    let turn = 0;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Record<string, unknown> });
      turn++;
      // First reply: Claude used two Notion tools on Anthropic's side (one failed), then answered.
      return claudeStream(
        turn === 1
          ? {
              content: [
                { type: "mcp_tool_use", id: "mcptoolu_1", name: "search_pages", server_name: "notion", input: { query: "launch plan" } },
                { type: "mcp_tool_result", tool_use_id: "mcptoolu_1", is_error: false, content: [{ type: "text", text: "Launch plan: 3 ads" }] },
                { type: "mcp_tool_use", id: "mcptoolu_2", name: "get_page", server_name: "notion", input: { id: "x" } },
                { type: "mcp_tool_result", tool_use_id: "mcptoolu_2", is_error: true, content: [{ type: "text", text: "not found" }] },
                { type: "text", text: "Your launch plan asks for 3 ads." },
              ],
              stop_reason: "end_turn",
            }
          : { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" },
      );
    }) as typeof fetch;
    try {
      const r = await agent.resolveMode({ mode: "smart" });
      const t = agent.createThread({ engine: "cloud", agent: r.agent, mode: r.mode, model: r.model, effort: r.effort });
      agent.addMessage(t.id, "What does my launch plan in Notion say?");
      await agent.run(t.id);
      const body = sent[0].body;
      expect(sent[0].headers.get("anthropic-beta")).toContain(connectors.MCP_BETA);
      expect(body.mcp_servers).toEqual([
        { type: "url", url: "https://mcp.notion.com/mcp?workspace=SECRET", name: "notion", authorization_token: TOKEN },
        { type: "url", url: "https://mcp.linear.app/mcp", name: "linear", authorization_token: "lin_api_SECRETSECRET" },
      ]);
      const tools = body.tools as { type?: string; name?: string; mcp_server_name?: string }[];
      expect(tools.filter((x) => x.type === "mcp_toolset")).toEqual([
        { type: "mcp_toolset", mcp_server_name: "notion", default_config: { enabled: false }, configs: { search_pages: { enabled: true }, get_page: { enabled: true } } },
        { type: "mcp_toolset", mcp_server_name: "linear" },
      ]);
      // Claude is told the connector tools run without asking, and to check first in an Ask-first chat.
      const system = JSON.stringify(body.system);
      expect(system).toContain("Connected apps (custom MCP connectors): Notion work, Linear.");
      expect(system).toContain("say what you'll do and wait for the user's OK in chat");
      // Fuobe's own tools are still there, first.
      expect(tools[0].name).toBeTruthy();
      const items = agent.getThread(t.id)!.thread.items;
      expect(items.filter((i) => i.role === "tool")).toMatchObject([
        { text: "Notion work · search_pages", connector: "Notion work" },
        { text: "Notion work · get_page", connector: "Notion work", failed: true },
      ]);
      expect(items.find((i) => i.role === "assistant")).toMatchObject({ text: "Your launch plan asks for 3 ads." });

      // The connector is deleted: the next request doesn't name it, and its history goes as text.
      connectors.deleteConnector(connectors.listConnectors().find((c) => c.slug === "notion")!.id);
      agent.addMessage(t.id, "Thanks");
      await agent.run(t.id);
      const second = sent[1].body;
      expect((second.mcp_servers as { name: string }[]).map((m) => m.name)).toEqual(["linear"]);
      const history = JSON.stringify(second.messages);
      expect(history).not.toContain('"mcp_tool_use"');
      expect(history).toContain("[Used notion · search_pages — that connector is no longer available]");
      // The stored history keeps what Claude returned.
      expect(JSON.stringify(agent.getThread(t.id))).toContain("Your launch plan");
    } finally {
      globalThis.fetch = realFetch;
      setSetting("anthropicKey", "");
    }
  });

  it("no connectors: no MCP fields and no MCP beta", async () => {
    for (const c of connectors.listConnectors()) connectors.updateConnector(c.id, { enabled: false });
    setSetting("anthropicKey", "sk-ant-test");
    const sent: { headers: Headers; body: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return claudeStream({ content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn" });
    }) as typeof fetch;
    try {
      const t = agent.createThread({ engine: "cloud", agent: "claude", mode: "smart" });
      agent.addMessage(t.id, "Hi");
      await agent.run(t.id);
      expect(sent[0].body.mcp_servers).toBeUndefined();
      expect(sent[0].headers.get("anthropic-beta")).not.toContain("mcp-client");
    } finally {
      globalThis.fetch = realFetch;
      setSetting("anthropicKey", "");
      for (const c of connectors.listConnectors()) connectors.updateConnector(c.id, { enabled: true });
    }
  });

  it("a chat started without connectors (a scheduled run that leaves them off) sends none", async () => {
    setSetting("anthropicKey", "sk-ant-test");
    const sent: Record<string, unknown>[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return claudeStream({ content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn" });
    }) as typeof fetch;
    try {
      expect(connectors.activeConnectors().length).toBeGreaterThan(0);
      const t = agent.createThread({ engine: "cloud", agent: "claude", mode: "smart", connectors: false });
      agent.addMessage(t.id, "Hi");
      await agent.run(t.id);
      expect(sent[0].mcp_servers).toBeUndefined();
      expect(JSON.stringify(sent[0].system)).not.toContain("Connected apps");
      // Nor does it get the "connectors need Claude" note on another agent.
      const o = agent.createThread({ engine: "cloud", agent: "offline", mode: "free", connectors: false });
      expect(agent.getThread(o.id)!.thread.items).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
      setSetting("anthropicKey", "");
    }
  });

  it("a chat on Ollama or the offline planner says connectors need Claude, once", async () => {
    const t = agent.createThread({ engine: "cloud", agent: "offline", mode: "free" });
    const notes = () => agent.getThread(t.id)!.thread.items.filter((i) => i.role === "notice" && /Connectors work in Claude chats/.test(i.text));
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toMatchObject({ text: expect.stringContaining("(Linear)") });
    await agent.updateThread(t.id, { mode: { mode: "free" } });
    expect(notes()).toHaveLength(1);
    // Claude chats don't get it.
    const c = agent.createThread({ engine: "cloud", agent: "claude", mode: "smart" });
    expect(agent.getThread(c.id)!.thread.items).toEqual([]);
  });

  it("history from a connector that's gone becomes text in the request only", () => {
    type Msg = Anthropic.Beta.BetaMessageParam;
    const messages: Msg[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "mcp_tool_use", id: "m1", name: "find", server_name: "old", input: {} },
          { type: "mcp_tool_result", tool_use_id: "m1", is_error: false, content: [{ type: "text", text: "found it" }] },
          { type: "mcp_tool_use", id: "m2", name: "list", server_name: "kept", input: {} },
          { type: "text", text: "ok" },
        ],
      },
    ];
    const out = connectors.withoutMissingServers(messages, new Set(["kept"]));
    expect(out[1].content).toEqual([
      { type: "text", text: "[Used old · find — that connector is no longer available]" },
      { type: "text", text: "[Result: found it]" },
      { type: "mcp_tool_use", id: "m2", name: "list", server_name: "kept", input: {} },
      { type: "text", text: "ok" },
    ]);
    expect(messages[1].content).toHaveLength(4);
    expect((messages[1].content as { type: string }[])[0].type).toBe("mcp_tool_use");
    expect(connectors.withoutMissingServers(messages, new Set(["old", "kept"]))).toBe(messages);
  });
});
