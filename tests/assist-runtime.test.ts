import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

vi.setConfig({ testTimeout: 60_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-assist-rt-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const tools = await import("@/server/assist/tools");
const gens = await import("@/server/generations");
const { db } = await import("@/server/db");

type Msg = Anthropic.Beta.BetaMessage;
type Block = Anthropic.Beta.BetaContentBlock;
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as unknown as Block;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as Block;
const reply = (content: Block[], stop: Anthropic.Beta.BetaStopReason) => ({ content, stop_reason: stop, stop_details: null }) as Msg;

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

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const dependsOn = (id: string) => (db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(id) as { depends_on: string | null }).depends_on;

describe("offline planner (U18)", () => {
  it("makes a still, then animates it, for 'hero still, then animate it' — with the shots it asked for", () => {
    const p = agent.offlinePlan("A 3-shot product ad for a matte black perfume bottle — hero still, then animate it", "cloud")!;
    expect(p.tool).toBe("generate");
    const jobs = (p.input as { jobs: Record<string, unknown>[] }).jobs;
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ model_id: "nano-banana-pro", prompt: "A product ad for a matte black perfume bottle — hero still" });
    expect(jobs[0].after).toBeUndefined();
    // MiniMax H3, the Video studio's default, makes one shot a clip: a 3-shot clip runs on the next model in Best that cuts shots.
    expect(jobs[1]).toMatchObject({ model_id: "seedance-2-5", after: 0, shots: 3 });
    expect(p.say).toMatch(/still first, then animate it as a 3-shot clip/);
    // The open engine picks the open defaults (the Image studio's is Ideogram 4).
    expect((agent.offlinePlan("A photo of a lighthouse, then animate it", "open")!.input as { jobs: { model_id: string }[] }).jobs.map((j) => j.model_id)).toEqual(["oss-ideogram-4", "oss-minimax-h3"]);
  });

  it("reads 'N portraits' as N takes and 'N-shot' video as one multi-shot clip", () => {
    expect(agent.offlinePlan("4 portraits of a jazz singer in a smoky club", "cloud")).toMatchObject({ input: { jobs: [{ model_id: "nano-banana-pro", outputs: 4 }] } });
    const shot = agent.offlinePlan("a 3-shot video of a fox running through snow", "cloud")!;
    expect(shot.input).toMatchObject({ jobs: [{ model_id: "seedance-2-5", shots: 3 }] });
    expect(agent.offlinePlan("a 3-shot video of a fox running through snow", "open")).toMatchObject({ input: { jobs: [{ model_id: "oss-ltx25", shots: 3 }] } });
    expect(agent.offlinePlan("a video of a fox running through snow", "cloud")).toMatchObject({ input: { jobs: [{ model_id: "minimax-h3" }] } });
    expect((shot.input as { jobs: { outputs?: number }[] }).jobs[0].outputs).toBeUndefined();
    // Still a storyboard when it asks for frames.
    expect(agent.offlinePlan("6 frames of a heist in Paris", "cloud")).toMatchObject({ tool: "create_storyboard", input: { frames: 6 } });
  });

  it("sends translations and scripts to the text model", () => {
    expect(agent.offlinePlan("Translate into Spanish: Welcome to our studio", "cloud")).toMatchObject({
      input: { jobs: [{ model_id: "text-llm", op: "translate", prompt: "Welcome to our studio", target_language: "Spanish" }] },
    });
    expect(agent.offlinePlan("Write a 30-second voice-over script about cold brew", "open")).toMatchObject({ input: { jobs: [{ model_id: "oss-text-llm", op: "write" }] } });
    // Songs are still music.
    expect(agent.offlinePlan("Write a lo-fi song for studying", "open")).toMatchObject({ input: { jobs: [{ model_id: "oss-ace-step" }] } });
  });

  it("says it's the offline planner under its plan, then runs the chained plan end to end", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    agent.addMessage(t.id, "A 3-shot product ad for a matte black perfume bottle — hero still, then animate it");
    await agent.run(t.id, agent.offline);
    let v = agent.getThread(t.id)!;
    expect(v.thread.status).toBe("waiting");
    const said = v.thread.items.find((i) => i.role === "assistant") as { text: string };
    // A quiet line right under the plan card, not part of the reply.
    expect(said.text).not.toContain(agent.OFFLINE_NOTE);
    const at = v.thread.items.findIndex((i) => i.role === "approval");
    expect(v.thread.items[at + 1]).toMatchObject({ role: "notice", tone: "info", text: agent.OFFLINE_NOTE });
    expect(agent.OFFLINE_NOTE).toBe("Offline planner — connect a model in Settings → AI helper (Anthropic, OpenAI, Google, OpenRouter… or a local model) for better plans.");
    const card = v.thread.items.find((i) => i.role === "approval") as { jobs: { kind: string; op: string; error?: string }[] };
    expect(card.jobs.map((j) => [j.kind, j.op, j.error])).toEqual([
      ["image", "t2i", undefined],
      ["video", "i2v", undefined],
    ]);
    await agent.answerApproval(t.id, true);
    await agent.run(t.id, agent.offline);
    v = agent.getThread(t.id)!;
    expect(v.generations).toHaveLength(2);
    const [still, clip] = v.generations;
    expect(dependsOn(clip.id)).toBe(still.id);
    expect(clip.request.chain).toEqual([{ slot: "images", position: "first" }]);
    expect(clip.request.params?.shots).toHaveLength(3);
    // The follow-up fits what ran: the chain ends in a video, which needs no animating.
    const last = v.thread.items.filter((i) => i.role === "assistant").at(-1) as { text: string };
    expect(last.text).toMatch(/another take/);
    expect(last.text).not.toMatch(/animate/);
  });

  it("offers a text follow-up after a script, and notes itself under jobs it starts right away", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud", autoApprove: true });
    agent.addMessage(t.id, "Write a 30-second voice-over script about cold brew");
    await agent.run(t.id, agent.offline);
    const v = agent.getThread(t.id)!;
    const roles = v.thread.items.map((i) => i.role);
    expect(roles.indexOf("notice")).toBe(roles.indexOf("generations") + 1);
    expect((v.thread.items.at(-1) as { text: string }).text).toMatch(/shorter, in another tone, or voiced/);
  });
});

describe("approval races (S11)", () => {
  it("claims the thread before running the approved plan", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let runs = 0;
    tools.TOOLS.push({
      name: "slow_paid_tool",
      description: "test",
      schema: z.object({}),
      gated: true,
      plan: () => [],
      run: async () => {
        runs++;
        await gate;
        return { content: "done" };
      },
    });
    try {
      const t = agent.createThread({ agent: "offline", engine: "cloud" });
      agent.addMessage(t.id, "go");
      await agent.run(t.id, scripted(reply([toolUse("toolu_slow", "slow_paid_tool", {})], "tool_use")).call);
      expect(agent.getThread(t.id)!.thread.status).toBe("waiting");
      const first = agent.answerApproval(t.id, true);
      await expect(agent.answerApproval(t.id, true)).rejects.toThrow(/Nothing is waiting/);
      expect(() => agent.addMessage(t.id, "and another thing")).toThrow(/Still working/);
      // Polling the thread meanwhile doesn't mistake it for a crashed run.
      expect(agent.getThread(t.id)!.thread.items.some((i) => i.role === "notice")).toBe(false);
      release();
      await first;
      expect(runs).toBe(1);
      await agent.run(t.id, scripted(reply([text("Done.")], "end_turn")).call);
      expect(agent.getThread(t.id)!.thread.status).toBe("idle");
    } finally {
      tools.TOOLS.splice(tools.TOOLS.findIndex((x) => x.name === "slow_paid_tool"), 1);
    }
  });
});

describe("malformed gated calls (S12)", () => {
  it("go back to the model as an error instead of crashing the turn or showing a card", async () => {
    const t = agent.createThread({ agent: "ollama", engine: "open" });
    agent.addMessage(t.id, "make a fox");
    const m = scripted(reply([toolUse("toolu_bad", "generate", { INVALID_JSON: "{jobs: [" })], "tool_use"), reply([text("Let me fix that.")], "end_turn"));
    await agent.run(t.id, m.call);
    const v = agent.getThread(t.id)!;
    expect(v.thread.items.some((i) => i.role === "approval" || i.role === "notice")).toBe(false);
    const result = (m.seen[1].at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(result).toMatchObject({ tool_use_id: "toolu_bad", is_error: true, content: expect.stringMatching(/^Invalid input: .*jobs/) });
    expect(tools.planFor("generate", { summary: "x" }, { engine: "cloud" })).toMatchObject({ jobs: [], error: expect.stringMatching(/jobs/) });
  });
});

describe("new kinds and operations in the tools", () => {
  it("finds text models and runs chained jobs, returning text inline", async () => {
    const found = await tools.executeTool("search_models", { kind: "text", task: "translate" }, { engine: "open" });
    const models = JSON.parse(found.content as string).models as { id: string; engine: string }[];
    expect(models[0]).toMatchObject({ id: "oss-text-llm", engine: "open source (a local model, on this machine)" });
    expect(models.map((m) => m.id)).toContain("text-llm");

    const out = await tools.executeTool(
      "generate",
      {
        summary: "Script, then a voice-over",
        jobs: [
          { model_id: "text-llm", op: "write", prompt: "A 2-line hook for a coffee ad" },
          { model_id: "elevenlabs-v4", prompt: "{text}", after: 0 },
        ],
      },
      { engine: "cloud" },
    );
    expect(out.isError).toBeFalsy();
    const { results } = JSON.parse(out.content as string) as { results: { started: string[]; waitsFor?: string }[] };
    const voice = gens.getGeneration(results[1].started[0])!;
    expect(voice.request.chain).toEqual([{ slot: "prompt" }]);
    expect(dependsOn(voice.id)).toBe(results[0].started[0]);
    const end = Date.now() + 30_000;
    while (gens.getGeneration(voice.id)!.status !== "succeeded" && Date.now() < end) await new Promise((r) => setTimeout(r, 250));
    expect(gens.getGeneration(voice.id)!.request.prompt).toMatch(/Demo text for|Demo script for/);
    const checked = await tools.executeTool("check_generations", { ids: [results[0].started[0]] }, { engine: "cloud" });
    const summary = JSON.parse((checked.content as { text: string }[])[0].text) as { outputs: { kind: string; text?: string; meta?: { demo?: boolean } }[] }[];
    expect(summary[0].outputs[0]).toMatchObject({ kind: "text", text: expect.stringMatching(/Demo/), meta: { demo: true } });
  });

  it("re-voices an earlier recording: voice-change takes it as the audio, tts clones it", () => {
    const plan = tools.planFor(
      "generate",
      {
        summary: "Voice-over, then another voice",
        jobs: [
          { model_id: "elevenlabs-v4", prompt: "Welcome to the studio" },
          { model_id: "elevenlabs-voice-changer", op: "voice-change", prompt: "Same words, Roger's voice", voice: "CwhRBWXzGAHq8TQ4Fs17", after: 0 },
          { model_id: "chatterbox-cloud", op: "tts", prompt: "And now in that voice", after: 0 },
        ],
      },
      { engine: "cloud" },
    );
    expect(plan.jobs.map((j) => [j.op, j.error])).toEqual([
      ["tts", undefined],
      ["voice-change", undefined],
      ["tts", undefined],
    ]);
  });

  it("hands a 3D model on to be rigged", () => {
    const plan = tools.planFor(
      "generate",
      { summary: "A knight, rigged", jobs: [{ model_id: "tripo-h3-1-text", prompt: "A knight in plate armour" }, { model_id: "meshy-rigging", op: "rig-3d", prompt: "Rig it", after: 0 }] },
      { engine: "cloud" },
    );
    expect(plan.jobs.map((j) => [j.op, j.error])).toEqual([
      ["text-to-3d", undefined],
      ["rig-3d", undefined],
    ]);
  });

  it("passes a background track to mux", async () => {
    const out = await tools.executeTool(
      "generate",
      { summary: "Soundtrack", jobs: [{ model_id: "oss-mux", op: "mux", prompt: "Mix", video: "/api/files/a.mp4", audio: "/api/files/voice.wav", background_audio: "/api/files/bg.wav" }] },
      { engine: "open" },
    );
    expect(out.isError, String(out.content)).toBeFalsy();
    const [r] = JSON.parse(out.content as string) as { started: string[] }[];
    expect(gens.getGeneration(r.started[0])!.request.inputs).toEqual({ video: "/api/files/a.mp4", audio: "/api/files/voice.wav", audio2: "/api/files/bg.wav" });
  });

  it("keeps strict tools within the API's limits for one request", () => {
    // platform.claude.com structured outputs: ≤ 20 strict tools, ≤ 24 optional parameters and
    // ≤ 16 union-typed parameters across all strict schemas in a request, nested ones included.
    const strict = tools.apiTools().filter((t) => t.strict);
    let optional = 0;
    let unions = 0;
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const n = node as { type?: unknown; properties?: Record<string, unknown>; required?: string[]; anyOf?: unknown; items?: unknown };
      if (n.anyOf || Array.isArray(n.type)) unions++;
      if (n.properties) {
        optional += Object.keys(n.properties).filter((k) => !n.required?.includes(k)).length;
        Object.values(n.properties).forEach(walk);
      }
      walk(n.items);
      walk(n.anyOf);
    };
    strict.forEach((t) => walk(t.input_schema));
    expect(strict.length).toBeLessThanOrEqual(20);
    expect(optional).toBeLessThanOrEqual(24);
    expect(unions).toBeLessThanOrEqual(16);
    // generate is validated by zod instead (its jobs have more optional fields than the budget).
    expect(strict.map((t) => t.name)).not.toContain("generate");
  });

  it("prices a chained plan and points out a bad 'after'", () => {
    const plan = tools.planFor(
      "generate",
      { summary: "x", jobs: [{ model_id: "nano-banana-pro", prompt: "a fox" }, { model_id: "kling-3", prompt: "it runs", after: 0 }, { model_id: "kling-3", prompt: "nope", after: 5 }] },
      { engine: "cloud" },
    );
    expect(plan.jobs.map((j) => [j.kind, j.op])).toEqual([
      ["image", "t2i"],
      ["video", "i2v"],
      ["video", "t2i"],
    ]);
    expect(plan.jobs[2].error).toMatch(/earlier job/);
  });
});
