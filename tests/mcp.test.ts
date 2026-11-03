import { beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

const dir = tempDir("fuobe-mcp-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
const { handleMcp } = await import("@/server/mcp");
// Placeholders where nothing is connected, as these runs were written for ("auto": code in this process only).
beforeAll(async () => (await import("@/server/settings")).setSetting("demoMode", "auto"));

const rpc = (method: string, params?: unknown) => handleMcp({ jsonrpc: "2.0", id: 1, method, params });

describe("MCP server", () => {
  it("negotiates the protocol version", async () => {
    expect(await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })).toMatchObject({
      result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fuobe" } },
    });
    const r = (await rpc("initialize", { protocolVersion: "1999-01-01" })) as { result: { protocolVersion: string } };
    expect(r.result.protocolVersion).toBe("2025-11-25");
  });

  it("answers requests but not notifications", async () => {
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await rpc("ping")).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect(await rpc("nope")).toMatchObject({ error: { code: -32601 } });
    expect(await handleMcp({ method: "ping" })).toMatchObject({ error: { code: -32600 } });
  });

  it("lists the studio's tools with closed schemas and hints", async () => {
    const r = (await rpc("tools/list")) as { result: { tools: { name: string; description: string; inputSchema: { additionalProperties: boolean }; annotations: { readOnlyHint: boolean } }[] } };
    const names = r.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["search_models", "generate", "create_storyboard", "check_generations", "estimate_cost"]));
    const gen = r.result.tools.find((t) => t.name === "generate")!;
    expect(gen.annotations.readOnlyHint).toBe(false);
    expect(gen.description).toMatch(/estimate_cost/);
    expect(gen.description).not.toMatch(/approval card|plan card/i);
    expect(r.result.tools.every((t) => t.inputSchema.additionalProperties === false)).toBe(true);
  });

  it("prices a plan without running it, and reports bad input as a tool error", async () => {
    const r = (await rpc("tools/call", { name: "estimate_cost", arguments: { summary: "x", jobs: [{ model_id: "nano-banana-pro", prompt: "fox", outputs: 2 }] } })) as {
      result: { structuredContent: { jobs: { count: number; modelName: string }[] }; isError: boolean };
    };
    expect(r.result.isError).toBe(false);
    expect(r.result.structuredContent.jobs[0]).toMatchObject({ modelName: "Nano Banana Pro", count: 2 });
    expect(await rpc("tools/call", { name: "estimate_cost", arguments: { jobs: "nope" } })).toMatchObject({ result: { isError: true } });
    expect(await rpc("tools/call", { name: "search_models", arguments: { kind: "smell" } })).toMatchObject({ result: { isError: true } });
    expect(await rpc("tools/call", { name: "rm_rf" })).toMatchObject({ error: { code: -32602 } });
  });

  it("serves run_skill (W3): listed, priced by estimate_job, and named in the instructions of version 1.3.0", async () => {
    const init = (await rpc("initialize", { protocolVersion: "2025-06-18" })) as { result: { serverInfo: { version: string }; instructions: string } };
    expect(init.result.serverInfo.version).toBe("1.3.0");
    expect(init.result.instructions).toMatch(/run_skill/);
    const r = (await rpc("tools/list")) as { result: { tools: { name: string; description: string; inputSchema: { properties: Record<string, { enum?: string[] } & Record<string, unknown>> }; annotations: { readOnlyHint: boolean; openWorldHint: boolean } }[] } };
    const run = r.result.tools.find((t) => t.name === "run_skill")!;
    expect(run).toBeDefined();
    expect(run.annotations).toEqual({ readOnlyHint: false, openWorldHint: true });
    expect(run.description).toMatch(/estimate_job/);
    expect(Object.keys(run.inputSchema.properties)).toEqual(["name", "values", "rows", "engine"]);
    const estimate = r.result.tools.find((t) => t.name === "estimate_job")!;
    expect(estimate.inputSchema.properties.tool.enum).toContain("run_skill");
    // A skill without a recipe is a tool error that names the skills that run by themselves.
    const est = (await rpc("tools/call", { name: "estimate_job", arguments: { tool: "run_skill", arguments: { name: "product-photoshoot" } } })) as { result: { isError: boolean; content: { text: string }[] } };
    expect(est.result.isError).toBe(true);
    expect(est.result.content[0].text).toMatch(/doesn't run by itself/);
  });

  it("runs a tool and returns MCP content", async () => {
    const r = (await rpc("tools/call", { name: "search_models", arguments: { kind: "video", query: "kling" } })) as { result: { content: { type: string; text: string }[] } };
    const body = JSON.parse(r.result.content[0].text) as { models: { id: string }[] };
    expect(body.models[0].id).toMatch(/kling/);
  });
});
