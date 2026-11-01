import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers call connection() (no request scope in a test).
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000 });

/**
 * Skills W3: a chat that ran becomes a skill (draftFromThread), and a saved skill with a recipe runs from Assist, MCP
 * and the offline planner through run_skill, priced on one card.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-assist-skill-tools-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: open models run on the demo provider, and there's no LLM.
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const tools = await import("@/server/assist/tools");
const { chatFacts } = await import("@/server/assist/context");
const builder = await import("@/server/recipe-builder");
const recipes = await import("@/server/recipes");
const skills = await import("@/server/skills");
const gens = await import("@/server/generations");
const { db } = await import("@/server/db");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const draftRoute = await import("@/app/api/assist/skills/draft/route");
const nameRoute = await import("@/app/api/assist/skills/draft/name/route");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let photo = "";
let clip = "";
beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
  photo = saveFile({ data: encodePng({ width: 64, height: 48, data: Buffer.alloc(64 * 48 * 4, 180) }), contentType: "image/png", source: "upload", name: "lamp.png" }).url;
  clip = saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "talk.mp4" }).url;
});

type Block = Anthropic.Beta.BetaContentBlock;
type Msg = Anthropic.Beta.BetaMessage;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as Block;
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as unknown as Block;
const reply = (content: Block[], stop: Anthropic.Beta.BetaStopReason) => ({ content, stop_reason: stop, stop_details: null }) as Msg;

/** A model that answers from a script. */
const scripted = (...turns: Msg[]): import("@/server/assist/agent").ModelCall => async () => {
  const next = turns.shift();
  if (!next) throw new Error("script ran out");
  return next;
};

async function settle(ids: string[], ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    const all = ids.map((id) => gens.getGeneration(id, { includeDeleted: true })!);
    if (all.every((g) => ["succeeded", "failed", "canceled"].includes(g.status))) return all;
    if (Date.now() > until) throw new Error(`timed out: ${all.map((g) => `${g.id} ${g.status} ${g.message}`).join(", ")}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const threadIds = (id: string) => agent.getThread(id)!.thread.items.flatMap((i) => (i.role === "generations" ? i.ids : []));
const json = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** A stored chat whose messages are written as the agent stores them (tool calls and their results). */
function storedChat(calls: { id: string; name: string; input: unknown; result: unknown; error?: boolean }[], said = "Make my lamp turn on a plinth") {
  const t = agent.createThread({ agent: "offline", engine: "cloud" });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: [{ type: "text", text: `${said}\n\nAttached files (pass these URLs as inputs):\n- image 1: ${photo}` }] }];
  for (const c of calls) {
    messages.push({ role: "assistant", content: [toolUse(c.id, c.name, c.input)] as never });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: c.id, content: typeof c.result === "string" ? c.result : JSON.stringify(c.result), ...(c.error && { is_error: true }) }] });
  }
  db().prepare("UPDATE assist_threads SET messages_json = ? WHERE id = ?").run(JSON.stringify(messages), t.id);
  return t.id;
}

/** A finished row written straight into the table (a studio's result): only what the builder reads. */
function row(o: { id: string; request: Record<string, unknown>; feature: string; op: string; kind: string; outputs: { url: string; kind: string }[] }) {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO generations (id, batch_id, feature, preset_id, model_id, engine, provider, op, kind, status, progress, message, prompt, request_json, provider_input_json, external_id, external_meta_json, outputs_json, error, cost_usd, favorite, created_at, updated_at, completed_at, depends_on)
       VALUES (@id, NULL, @feature, NULL, @model, 'cloud', 'mock', @op, @kind, 'succeeded', NULL, NULL, NULL, @request, NULL, NULL, NULL, @outputs, NULL, 0, 0, @now, @now, @now, NULL)`,
    )
    .run({ id: o.id, feature: o.feature, model: o.request.modelId as string, op: o.op, kind: o.kind, request: JSON.stringify(o.request), outputs: JSON.stringify(o.outputs), now });
  return o.id;
}

describe("draftFromThread", () => {
  it("keeps an approved generate chain and an auto-run call; leaves out a declined call and one whose results all failed", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    // 1. Asked first, approved: a still of the lamp, then animated (one generate call, chained with after).
    agent.addMessage(t.id, "Put my lamp on a travertine plinth, then make it turn", [photo]);
    await agent.run(
      t.id,
      scripted(
        reply(
          [
            toolUse("toolu_chain", "generate", {
              summary: "Lamp on a plinth, then a turntable",
              jobs: [
                { model_id: "nano-banana-pro", op: "edit", prompt: "a matte black desk lamp on a travertine plinth, soft window light", images: [photo], aspect_ratio: "1:1" },
                { model_id: "kling-3", op: "i2v", prompt: "slow turntable of the desk lamp", after: 0, duration: 5 },
              ],
            }),
          ],
          "tool_use",
        ),
      ),
    );
    expect(agent.getThread(t.id)!.thread.status).toBe("waiting");
    await agent.answerApproval(t.id, true);
    await agent.run(t.id, scripted(reply([text("Here it comes.")], "end_turn")));
    // 2. Declined on its card.
    agent.addMessage(t.id, "Also a poster of it");
    await agent.run(t.id, scripted(reply([toolUse("toolu_declined", "generate", { summary: "Poster", jobs: [{ model_id: "nano-banana-pro", prompt: "a poster of a desk lamp" }] })], "tool_use")));
    await agent.answerApproval(t.id, false);
    await agent.run(t.id, scripted(reply([text("Okay.")], "end_turn")));
    // 3. Auto-run (no card): a voice-over. 4. Auto-run too, but every result failed.
    await agent.updateThread(t.id, { autoApprove: true });
    agent.addMessage(t.id, "Add a voice-over, and a jingle");
    await agent.run(
      t.id,
      scripted(
        reply([toolUse("toolu_auto", "generate", { summary: "Voice-over", jobs: [{ model_id: "elevenlabs-v4", op: "tts", prompt: "Meet Lumen, the lamp that follows the sun." }] })], "tool_use"),
        reply([toolUse("toolu_failed", "generate", { summary: "Jingle", jobs: [{ model_id: "nano-banana-pro", prompt: "a jingle cover" }] })], "tool_use"),
        reply([text("Done.")], "end_turn"),
      ),
    );
    const items = agent.getThread(t.id)!.thread.items;
    // The auto-run calls started without a card.
    expect(items.filter((i) => i.role === "approval")).toHaveLength(2);
    const all = threadIds(t.id);
    await settle(all);
    // The jingle's results all failed.
    const history = JSON.parse((db().prepare("SELECT messages_json FROM assist_threads WHERE id = ?").get(t.id) as { messages_json: string }).messages_json) as { content: unknown }[];
    const failedResult = history.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b: { tool_use_id?: string }) => b.tool_use_id === "toolu_failed") as { content: string };
    const failedIds = [...failedResult.content.matchAll(/"started":\s*\["([\w-]+)"/g)].map((m) => m[1]);
    expect(failedIds.length).toBeGreaterThan(0);
    db().prepare(`UPDATE generations SET status = 'failed' WHERE id IN (${failedIds.map(() => "?").join(",")})`).run(...failedIds);

    const { draft, refusals, words } = builder.draftFromThread(t.id);
    expect(refusals).toEqual([]);
    expect(draft).not.toBeNull();
    const steps = draft!.recipe.steps.filter((s) => s.kind === "generate");
    expect(steps.map((s) => s.request.modelId)).toEqual(["nano-banana-pro", "kling-3", "elevenlabs-v4"]);
    // The chain stays a chain: the clip waits for the still and takes it as its start frame.
    expect(steps[1].after).toBe(steps[0].key);
    expect(steps[1].chain).toMatchObject([{ slot: "images" }]);
    expect(steps[2].after).toBeUndefined();
    // The lamp photo the person attached is a media candidate (Fixed, as every candidate starts).
    expect(draft!.candidates.find((c) => c.kind === "media")).toMatchObject({ type: "image", example: photo });
    expect(draft!.recipe.params).toEqual([]);
    expect(draft!.recipe.source).toMatchObject({ from: "assist", thread: t.id });
    expect(draft!.description).toMatch(/Made in an Assist chat/);
    expect(draft!.notes.join(" ")).toMatch(/1 plan you declined and 1 that didn't run/);
    expect(words).toEqual(["Put my lamp on a travertine plinth, then make it turn", "Also a poster of it", "Add a voice-over, and a jingle"]);

    // The route answers the same (the words stay on the server, for the naming pass).
    const res = await draftRoute.POST(json({ thread: t.id }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { recipe: unknown }; refusals: unknown[]; words?: unknown };
    expect(body.draft.recipe).toEqual(draft!.recipe);
    expect(body.words).toBeUndefined();
    // No LLM here: the naming pass has nothing to say.
    expect(await (await nameRoute.POST(json({ thread: t.id }))).json()).toEqual({ naming: null });
  });

  it("merges a result passed on by hand into a later generate call as a step reference", async () => {
    const still = gens.createGenerations({ feature: "assist", modelId: "nano-banana-pro", op: "edit", prompt: "the lamp on a plinth", inputs: { images: [photo] } });
    await settle(still.map((g) => g.id));
    const out = gens.getGeneration(still[0].id)!.outputs[0].url;
    const clipGen = gens.createGenerations({ feature: "assist", modelId: "kling-3", op: "flf2v", prompt: "the lamp turns", inputs: { images: [photo], endImage: out }, params: { duration: 5 } });
    await settle(clipGen.map((g) => g.id));
    // An earlier try of the still with other words: replaced by the later one.
    const early = gens.createGenerations({ feature: "assist", modelId: "nano-banana-pro", op: "edit", prompt: "the lamp, first try", inputs: { images: [photo] } });
    await settle(early.map((g) => g.id));
    const id = storedChat([
      { id: "toolu_early", name: "generate", input: { summary: "First try", jobs: [{ model_id: "nano-banana-pro", prompt: "the lamp, first try", images: [photo] }] }, result: [{ model: "nano-banana-pro", started: early.map((g) => g.id) }] },
      { id: "toolu_still", name: "generate", input: { summary: "Still", jobs: [{ model_id: "nano-banana-pro", prompt: "the lamp on a plinth", images: [photo] }] }, result: [{ model: "nano-banana-pro", started: still.map((g) => g.id) }] },
      { id: "toolu_clip", name: "generate", input: { summary: "Clip", jobs: [{ model_id: "kling-3", prompt: "the lamp turns", images: [photo], end_image: out }] }, result: [{ model: "kling-3", started: clipGen.map((g) => g.id) }] },
    ]);
    const { draft, refusals } = builder.draftFromThread(id);
    expect(refusals).toEqual([]);
    const steps = draft!.recipe.steps as Extract<(typeof draft & object)["recipe"]["steps"][number], { kind: "generate" }>[];
    expect(steps.map((s) => s.request.prompt)).toEqual(["the lamp on a plinth", "the lamp turns"]);
    // end_image (endImage on the request) → the endImage chain slot; the photo stays a file of its own.
    expect(steps[1].after).toBe(steps[0].key);
    expect(steps[1].chain).toEqual([{ slot: "endImage" }]);
    expect(steps[1].request.inputs).toEqual({ images: [photo] });
    expect(draft!.notes.join(" ")).toMatch(/An earlier try of a step was left out/);
  });

  it("makes a studio call one tool step with the input it ran with, and refuses a reference into it", async () => {
    const video = gens.createGenerations({ feature: "assist", modelId: "kling-3", op: "i2v", prompt: "the lamp turns", inputs: { images: [photo] }, params: { duration: 5 } });
    await settle(video.map((g) => g.id));
    const made = gens.getGeneration(video[0].id)!.outputs[0].url;
    const captioned = row({ id: "cap-from-gen", feature: "captions", op: "captions", kind: "video", request: { feature: "captions", modelId: "veed-captions", op: "captions", inputs: { video: made } }, outputs: [{ url: clip, kind: "video" }] });
    const id = storedChat([
      { id: "toolu_video", name: "generate", input: { summary: "Clip", jobs: [{ model_id: "kling-3", prompt: "the lamp turns", images: [photo] }] }, result: [{ model: "kling-3", started: video.map((g) => g.id) }] },
      { id: "toolu_caps", name: "add_captions", input: { video: made, translate_to: "Spanish" }, result: { started: [captioned], href: "/video-tools/captions" } },
    ]);
    const { draft, refusals } = builder.draftFromThread(id);
    expect(refusals).toEqual([{ id: captioned, title: expect.any(String), reason: builder.STUDIO_WAIT }]);
    expect(draft!.recipe.steps.map((s) => s.kind)).toEqual(["generate"]);

    // On its own, the studio call is the skill: its exact input, its file a candidate.
    const solo = row({ id: "cap-solo", feature: "captions", op: "captions", kind: "video", request: { feature: "captions", modelId: "veed-captions", op: "captions", inputs: { video: clip } }, outputs: [{ url: clip, kind: "video" }] });
    const alone = builder.draftFromThread(storedChat([{ id: "toolu_solo", name: "add_captions", input: { video: clip, translate_to: "German" }, result: { started: [solo] } }]));
    expect(alone.refusals).toEqual([]);
    expect(alone.draft!.recipe.steps).toEqual([{ key: expect.any(String), kind: "tool", label: "Captions", tool: "add_captions", input: { video: clip, translate_to: "German" } }]);
    expect(alone.draft!.candidates).toEqual([expect.objectContaining({ kind: "media", type: "video", example: clip, at: [{ step: alone.draft!.recipe.steps[0].key, path: ["video"] }] })]);
  });

  it("says when nothing in a chat ran, and 404s an unknown chat", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    expect(builder.draftFromThread(t.id)).toMatchObject({ draft: null, refusals: [{ id: t.id, reason: expect.stringMatching(/Nothing in it has run yet/) }] });
    expect((await draftRoute.POST(json({ thread: "nope" }))).status).toBe(404);
    expect((await draftRoute.POST(json({ thread: "" }))).status).toBe(400);
  });
});

/** The research's turntable as a saved skill: a product photo and its name, cut out, staged, turned. */
function lampSkill(name = "lamp-turntable") {
  if (skills.getSkill(name)) return name;
  skills.createSkill({ name, title: "Lamp turntable", description: "A product turntable from a photo.", body: "# Turntable\n\n1. Cut out, stage, spin." });
  recipes.saveRecipe(name, {
    fuobeRecipe: 1,
    params: [
      { id: "product", label: "Product photo", type: "image", required: true, example: photo },
      { id: "name", label: "Product name", type: "text", required: true, example: "Lumen desk lamp", max: 200 },
      { id: "aspect", label: "Shape", type: "choice", options: ["1:1", "9:16", "16:9"], default: "1:1" },
    ],
    steps: [
      { key: "cutout", kind: "generate", request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: ["{{product}}"] } } },
      { key: "scene", kind: "generate", after: ["cutout"], chain: [{ slot: "images", position: "first" }], request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{name}} on a travertine plinth", params: { aspectRatio: "{{aspect}}" } } },
      { key: "spin", kind: "generate", after: ["scene"], chain: [{ slot: "images" }], request: { feature: "skill", modelId: "kling-3", op: "i2v", prompt: "slow turntable of the {{name}}", params: { duration: 5 } } },
    ],
  });
  return name;
}

describe("run_skill", () => {
  it("prices a pipeline as one atomic plan titled by the skill, and runs it in demo mode", async () => {
    const name = lampSkill();
    const input = { name, values: { product: photo, name: "Halo floor lamp" } };
    const plan = tools.planFor("run_skill", input, { engine: "cloud" });
    expect(plan.error).toBeUndefined();
    expect(plan.jobs.map((j) => j.modelId)).toEqual(["birefnet-cloud", "nano-banana-pro", "kling-3"]);
    expect(plan.jobs.every((j) => j.atomic && j.demo && !j.error && j.tool === "run_skill")).toBe(true);
    expect(tools.cardTitle("run_skill", input)).toBe("Lamp turntable");
    const out = await tools.executeTool("run_skill", input, { engine: "cloud" });
    expect(out.isError).toBeFalsy();
    const body = JSON.parse(out.content as string) as { skill: string; engine: string; demo: boolean; runs: { started: string[]; batch: string }[] };
    expect(body).toMatchObject({ skill: name, engine: "cloud", demo: true });
    const ids = body.runs[0].started;
    expect(out.items).toEqual([{ id: "", role: "generations", ids }]);
    const done = await settle(ids);
    expect(done.every((g) => g.status === "succeeded" && g.provider === "mock")).toBe(true);
    expect(done[1].request.prompt).toBe("Halo floor lamp on a travertine plinth");
    // The skill's own stamp, so its runs are its runs.
    expect(done[0].request.skill).toMatchObject({ name });
  });

  it("sends bad values back as an error naming the inputs, before any card", async () => {
    const name = lampSkill();
    const ctx = { engine: "cloud" as const };
    expect(tools.validateInput("run_skill", { name, values: {} }, ctx)).toBe(`/${name} needs product (image) and name (text)`);
    expect(tools.validateInput("run_skill", { name, values: { product: photo, name: "x", colour: "red" } }, ctx)).toMatch(/has no input “colour”: it takes product \(image\), name \(text\) and aspect \(1:1 \| 9:16 \| 16:9\)/);
    expect(tools.validateInput("run_skill", { name: "product-photoshoot" }, ctx)).toMatch(/doesn't run by itself.*lamp-turntable/);
    expect(tools.validateInput("run_skill", { name: "nope" }, ctx)).toMatch(/No skill called “nope”/);
    // Through the agent: the call goes back to the model as an error, and no card is shown.
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    agent.addMessage(t.id, "Run my lamp skill");
    await agent.run(t.id, scripted(reply([toolUse("toolu_bad", "run_skill", { name, values: { name: "Halo" } })], "tool_use"), reply([text("Which photo?")], "end_turn")));
    expect(agent.getThread(t.id)!.thread.items.some((i) => i.role === "approval")).toBe(false);
    // A value of the wrong kind is priced as an error the card shows.
    const bad = tools.planFor("run_skill", { name, values: { product: "not a file", name: "Halo" } }, ctx);
    expect(bad.jobs[0].error).toMatch(/Product photo/);
  });

  it("is marked in the skills index and the system prompt says to use it", () => {
    const name = lampSkill();
    const facts = chatFacts({ engine: "cloud", autoApprove: false, projectId: null, skills: [] });
    expect(facts.find((f) => f.section === "skills" && f.key === name)?.text).toMatch(/^- \/lamp-turntable — Lamp turntable \(runs by itself: run_skill with product, name, aspect\):/);
  });
});

describe("the offline planner", () => {
  it("turns /lamp-turntable plus an attachment into one run_skill card, and runs it", async () => {
    const name = lampSkill();
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    agent.addMessage(t.id, `/${name}`, [photo]);
    await agent.run(t.id, agent.offline);
    const view = agent.getThread(t.id)!.thread;
    expect(view.status).toBe("waiting");
    const card = view.items.find((i) => i.role === "approval");
    expect(card).toMatchObject({ summary: "Lamp turntable", status: "pending" });
    expect(card?.role === "approval" && card.jobs.map((j) => j.modelId)).toEqual(["birefnet-cloud", "nano-banana-pro", "kling-3"]);
    const history = JSON.parse((db().prepare("SELECT messages_json FROM assist_threads WHERE id = ?").get(t.id) as { messages_json: string }).messages_json) as { role: string; content: Block[] }[];
    const call = history.at(-1)!.content.find((b) => b.type === "tool_use") as { name: string; input: unknown };
    // The photo from the attachment; the name from the values it was made with (no words were typed); the shape's default.
    expect(call).toMatchObject({ name: "run_skill", input: { name, values: { product: photo, name: "Lumen desk lamp", aspect: "1:1" } } });
    await agent.answerApproval(t.id, true);
    await agent.run(t.id, agent.offline);
    const ids = threadIds(t.id);
    expect(ids).toHaveLength(3);
    expect((await settle(ids)).every((g) => g.status === "succeeded")).toBe(true);
    expect(agent.getThread(t.id)!.thread.items.some((i) => i.role === "assistant" && /On it/.test(i.text))).toBe(true);
  });

  it("takes the words for the first text input, and asks for a file that wasn't attached", async () => {
    const name = lampSkill();
    expect(agent.offlineSkillRun(`Halo floor lamp\n\nAttached files (pass these URLs as inputs):\n- image 1: ${photo}`, name, "Lamp turntable", recipes.getRecipe(name).recipe)).toMatchObject({
      tool: "run_skill",
      input: { name, values: { product: photo, name: "Halo floor lamp", aspect: "1:1" } },
    });
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    agent.addMessage(t.id, `/${name} Halo floor lamp`);
    await agent.run(t.id, agent.offline);
    const items = agent.getThread(t.id)!.thread.items;
    expect(items.some((i) => i.role === "approval")).toBe(false);
    expect(items.findLast((i) => i.role === "assistant")).toMatchObject({ text: `Lamp turntable needs Product photo (an image). Attach it and send /${name} again.` });
  });
});
