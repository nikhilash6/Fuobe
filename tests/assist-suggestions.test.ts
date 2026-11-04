import { beforeAll, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 60_000 });
const dir = tempDir("fuobe-assist-sugg-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const tools = await import("@/server/assist/tools");
const { db } = await import("@/server/db");
const { ASSIST_SUGGESTIONS } = await import("@/lib/assist");

beforeAll(() => setSetting("demoMode", "auto"));

type Job = Record<string, unknown>;
const jobsOf = (p: ReturnType<typeof agent.offlinePlan>) => ((p?.input as { jobs?: Job[] }).jobs ?? []) as Job[];

describe("Assist's suggestion chips on the offline planner (R4-04)", () => {
  it.each(["cloud", "open"] as const)("plans every chip into jobs that price without errors (%s)", (engine) => {
    for (const s of ASSIST_SUGGESTIONS) {
      const p = agent.offlinePlan(s, engine);
      expect(p, s).not.toBeNull();
      expect(["generate", "create_storyboard"], s).toContain(p!.tool);
      const plan = tools.planFor(p!.tool, p!.input, { engine });
      expect(plan.error, s).toBeUndefined();
      expect(plan.jobs.length, s).toBeGreaterThan(0);
      expect(plan.jobs.filter((j) => j.error).map((j) => j.error), s).toEqual([]);
    }
  });

  it("hero still, then animate it: a still, then a 3-shot clip made from it", () => {
    const p = agent.offlinePlan(ASSIST_SUGGESTIONS[0], "cloud")!;
    const plan = tools.planFor(p.tool, p.input, { engine: "cloud" });
    expect(plan.jobs.map((j) => [j.kind, j.op])).toEqual([
      ["image", "t2i"],
      ["video", "i2v"],
    ]);
    expect(jobsOf(p)[1]).toMatchObject({ after: 0, shots: 3 });
  });

  it("four portraits, then pick the best: four takes of one portrait, and a question instead of animating the first", () => {
    const p = agent.offlinePlan(ASSIST_SUGGESTIONS[1], "cloud")!;
    const jobs = jobsOf(p);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ model_id: "nano-banana-pro", outputs: 4, prompt: "Moody portrait of a model in a black velvet suit, 35mm film" });
    expect(jobs[0].after).toBeUndefined();
    expect((p.input as { summary: string }).summary).toMatch(/^Pick the best of 4 stills/);
    expect(p.say).toMatch(/4 stills first.*tell me which one to animate/);
    const plan = tools.planFor(p.tool, p.input, { engine: "cloud" });
    expect(plan.jobs).toMatchObject([{ kind: "image", op: "t2i", count: 4 }]);
    // The same request with a plural noun and a "best one" also asks.
    const fox = agent.offlinePlan("Make 3 portraits of a fox in a trench coat, then animate the best one into a 5 s video", "open")!;
    expect(jobsOf(fox)).toEqual([expect.objectContaining({ model_id: "oss-ideogram-4", outputs: 3, prompt: "Portrait of a fox in a trench coat" })]);
    // "… then animate them": every still gets its own clip.
    const all = agent.offlinePlan("Two posters of a jazz club, then animate them", "cloud")!;
    expect(jobsOf(all).map((j) => [j.model_id, j.after])).toEqual([
      ["nano-banana-pro", undefined],
      ["minimax-h3", 0],
      ["nano-banana-pro", undefined],
      ["minimax-h3", 2],
    ]);
  });

  it("a 6-frame storyboard has six frames", () => {
    expect(agent.offlinePlan(ASSIST_SUGGESTIONS[2], "cloud")).toMatchObject({ tool: "create_storyboard", input: { frames: 6 } });
  });

  it("a 10-second vertical video with sound: the length the model lists and its own soundtrack", () => {
    expect(jobsOf(agent.offlinePlan(ASSIST_SUGGESTIONS[3], "cloud"))).toEqual([
      expect.objectContaining({ model_id: "minimax-h3", aspect_ratio: "9:16", duration: 10 }),
    ]);
    // MiniMax H3 lists 10 s on both engines and always makes its own sound, so there is no sound switch to send.
    const open = jobsOf(agent.offlinePlan(ASSIST_SUGGESTIONS[3], "open"))[0];
    expect(open).toMatchObject({ model_id: "oss-minimax-h3", aspect_ratio: "9:16", duration: 10 });
    expect(open.generate_audio).toBeUndefined();
  });

  it("drops the count from a counted prompt so each take is one picture", () => {
    expect(jobsOf(agent.offlinePlan("4 portraits of a jazz singer in a smoky club", "cloud"))[0]).toMatchObject({ outputs: 4, prompt: "Portrait of a jazz singer in a smoky club" });
    // Without a count the words stay as written.
    expect(jobsOf(agent.offlinePlan("a cozy cafe", "cloud"))[0]).toMatchObject({ prompt: "a cozy cafe" });
    // "versions" and "takes" count takes wherever they are, and leave the prompt.
    expect(jobsOf(agent.offlinePlan("a red fox in the snow, 3 versions", "cloud"))[0]).toMatchObject({ outputs: 3, prompt: "A red fox in the snow" });
    expect(jobsOf(agent.offlinePlan("Make 3 different versions of a bakery logo", "cloud"))[0]).toMatchObject({ outputs: 3, prompt: "A bakery logo" });
  });

  it("keeps a count that describes what's in the picture", () => {
    // The card shows 3 icons: that's the picture, not 3 takes of it.
    const card = jobsOf(agent.offlinePlan("a birthday card with 3 icons of balloons", "cloud"))[0];
    expect(card.prompt).toBe("a birthday card with 3 icons of balloons");
    expect(card.outputs).toBe(2);
    const collage = jobsOf(agent.offlinePlan("a collage of 3 photos of my dog at the beach", "cloud"))[0];
    expect(collage.prompt).toBe("a collage of 3 photos of my dog at the beach");
    // A still with a counted detail, then animated: one still, the detail kept.
    const poster = agent.offlinePlan("a poster with 2 icons of a rocket, then animate it", "cloud")!;
    expect(jobsOf(poster).map((j) => [j.prompt, j.outputs, j.after])).toEqual([
      ["A poster with 2 icons of a rocket", undefined, undefined],
      [expect.stringMatching(/^A poster with 2 icons of a rocket\. The still comes to life/), undefined, 0],
    ]);
  });
});

describe("picking a take", () => {
  it("reads short replies that name one take", () => {
    expect(agent.pickedTake("animate 2")).toEqual({ take: 2, animate: true });
    expect(agent.pickedTake("Animate the second one, please.")).toEqual({ take: 2, animate: true });
    expect(agent.pickedTake("2")).toEqual({ take: 2, animate: false });
    expect(agent.pickedTake("#3")).toEqual({ take: 3, animate: false });
    expect(agent.pickedTake("the third one")).toEqual({ take: 3, animate: false });
    expect(agent.pickedTake("go with the last one")).toEqual({ take: -1, animate: false });
    expect(agent.pickedTake("number 1")).toEqual({ take: 1, animate: false });
    // New requests aren't picks.
    expect(agent.pickedTake("Animate 2 portraits of a cat")).toBeNull();
    expect(agent.pickedTake("a lighthouse at dawn")).toBeNull();
    expect(agent.pickedTake("2 cats on a sofa")).toBeNull();
    expect(agent.pickedTake("make it 2 seconds longer and moodier")).toBeNull();
    // Lengths, formats and times aren't take numbers.
    expect(agent.pickedTake("animate it for 5 seconds")).toEqual({ take: 0, animate: true });
    expect(agent.pickedTake("animate it in 9:16")).toEqual({ take: 0, animate: true });
    expect(agent.pickedTake("animate 2 for 5 seconds")).toEqual({ take: 2, animate: true });
    expect(agent.pickedTake("animate the third one in 16:9 at 24 fps")).toEqual({ take: 3, animate: true });
    expect(agent.pickedTake("animate it")).toEqual({ take: 0, animate: true });
    expect(agent.pickedTake("for 5 seconds")).toBeNull();
  });

  it("animate it: the only still moves; with several it asks which", async () => {
    const outputs = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `/api/files/outputs/it-${n}-${i + 1}.png`, kind: "image", contentType: "image/png" }));
    // One still: "animate it for 5 seconds" animates it, 5 s long.
    const one = agent.createThread({ agent: "offline", engine: "cloud", autoApprove: true });
    agent.addMessage(one.id, "a cat in a hat, 1 version");
    await agent.run(one.id, agent.offline);
    let v = agent.getThread(one.id)!;
    db().prepare("UPDATE generations SET status = 'succeeded', outputs_json = ? WHERE id = ?").run(JSON.stringify(outputs(1)), v.generations[0].id);
    agent.addMessage(one.id, "animate it for 5 seconds");
    await agent.run(one.id, agent.offline);
    v = agent.getThread(one.id)!;
    const clip = v.generations.find((g) => g.kind === "video")!;
    expect(clip.request).toMatchObject({ modelId: "minimax-h3", inputs: { images: ["/api/files/outputs/it-1-1.png"] }, params: expect.objectContaining({ duration: 5 }) });

    // Two stills (a plain request makes 2 takes): it asks, and a bare number then answers.
    const two = agent.createThread({ agent: "offline", engine: "cloud", autoApprove: true });
    agent.addMessage(two.id, "a cat in a hat");
    await agent.run(two.id, agent.offline);
    v = agent.getThread(two.id)!;
    db().prepare("UPDATE generations SET status = 'succeeded', outputs_json = ? WHERE id = ?").run(JSON.stringify(outputs(2)), v.generations[0].id);
    agent.addMessage(two.id, "animate it for 5 seconds");
    await agent.run(two.id, agent.offline);
    v = agent.getThread(two.id)!;
    expect((v.thread.items.at(-1) as { text: string }).text).toBe('There are 2 stills — tell me which one to animate: reply "animate 2" (they\'re numbered in order).');
    agent.addMessage(two.id, "2");
    await agent.run(two.id, agent.offline);
    v = agent.getThread(two.id)!;
    expect(v.generations.find((g) => g.kind === "video")?.request.inputs?.images).toEqual(["/api/files/outputs/it-2-2.png"]);
  });

  it("picks the best on the open engine too, where each take is its own generation", async () => {
    const t = agent.createThread({ agent: "offline", engine: "open", autoApprove: true });
    agent.addMessage(t.id, ASSIST_SUGGESTIONS[1]);
    await agent.run(t.id, agent.offline);
    let v = agent.getThread(t.id)!;
    expect(v.generations).toHaveLength(4);
    expect(v.generations.every((g) => g.request.modelId === "oss-ideogram-4")).toBe(true);
    // Done out of order: the numbers follow the order they were started in, like the chat shows them.
    for (const g of [...v.generations].reverse()) {
      db()
        .prepare("UPDATE generations SET status = 'succeeded', outputs_json = ? WHERE id = ?")
        .run(JSON.stringify([{ url: `/api/files/outputs/open-${g.id}.png`, kind: "image", contentType: "image/png" }]), g.id);
    }
    agent.addMessage(t.id, "animate 2");
    await agent.run(t.id, agent.offline);
    v = agent.getThread(t.id)!;
    const stills = v.generations.filter((g) => g.kind === "image").sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const clip = v.generations.find((g) => g.kind === "video")!;
    expect(clip).toBeTruthy();
    expect(clip.request.modelId).toBe("oss-minimax-h3");
    const started = (v.thread.items.find((i) => i.role === "generations") as { ids: string[] } | undefined)?.ids ?? stills.map((g) => g.id);
    expect(clip.request.inputs?.images).toEqual([`/api/files/outputs/open-${started[1]}.png`]);
    expect(v.thread.items.filter((i) => i.role === "assistant").map((i) => (i as { text: string }).text)).toContain("I'll animate take 2 with the default video model.");
  });

  it("asks which still to animate, then animates the one picked", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud", autoApprove: true });
    agent.addMessage(t.id, ASSIST_SUGGESTIONS[1]);
    await agent.run(t.id, agent.offline);
    let v = agent.getThread(t.id)!;
    const said = v.thread.items.filter((i) => i.role === "assistant").map((i) => (i as { text: string }).text);
    expect(said.at(-1)).toMatch(/tell me which one to animate: reply "animate 2"/);
    expect(v.generations).toHaveLength(1);
    const still = v.generations[0];
    expect(still.request.params?.numOutputs).toBe(4);

    // Still rendering: it says so.
    db().prepare("UPDATE generations SET status = 'running' WHERE id = ?").run(still.id);
    agent.addMessage(t.id, "2");
    await agent.run(t.id, agent.offline);
    v = agent.getThread(t.id)!;
    expect((v.thread.items.at(-1) as { text: string }).text).toMatch(/still rendering/);

    const outputs = [1, 2, 3, 4].map((n) => ({ url: `/api/files/outputs/take-${n}.png`, kind: "image", contentType: "image/png" }));
    db().prepare("UPDATE generations SET status = 'succeeded', outputs_json = ? WHERE id = ?").run(JSON.stringify(outputs), still.id);
    // Asked again after the "still rendering" reply: a bare number still answers it.
    agent.addMessage(t.id, "animate 2");
    await agent.run(t.id, agent.offline);
    v = agent.getThread(t.id)!;
    const clip = v.generations.find((g) => g.kind === "video")!;
    expect(clip).toBeTruthy();
    expect(clip.request).toMatchObject({ modelId: "minimax-h3", inputs: { images: ["/api/files/outputs/take-2.png"] } });
    expect(clip.request.prompt).toMatch(/^Moody portrait of a model in a black velvet suit, 35mm film\. The still comes to life/);
    expect(v.thread.items.filter((i) => i.role === "assistant").map((i) => (i as { text: string }).text)).toContain("I'll animate take 2 with the default video model.");
  });

  it("a number with no stills in the chat is a new request", async () => {
    const t = agent.createThread({ agent: "offline", engine: "cloud" });
    agent.addMessage(t.id, "animate 2");
    await agent.run(t.id, agent.offline);
    const v = agent.getThread(t.id)!;
    expect(v.thread.items.some((i) => i.role === "approval")).toBe(true);
  });
});
