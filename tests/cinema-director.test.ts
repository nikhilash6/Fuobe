import { describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

// The AI Director answers questions instead of storyboarding them, and keeps an LLM's prose answer.
const dir = tempDir("fuobe-cinema-director-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const llm = vi.hoisted(() => ({ answer: null as string | null }));
vi.mock("@/server/enhance", async (orig) => ({ ...(await orig<typeof import("@/server/enhance")>()), llmText: async () => llm.answer }));

const cinema = await import("@/server/cinema");
const { askDirector, isQuestion, offlineDirector, prose } = await import("@/server/cinema-director");


const empty = { brief: { title: "", body: "" }, director: {} };

describe("AI Director", () => {
  it("answers a craft question with a tip, not a storyboard", () => {
    expect(isQuestion("Which lens should I use for a close-up?")).toBe(true);
    expect(isQuestion("how do I light a night interior")).toBe(true);
    expect(isQuestion("Generate an 8-shot storyboard for a sci-fi chase scene")).toBe(false);
    expect(isQuestion("Can you write a script about a lighthouse keeper?")).toBe(false);
    expect(isQuestion("What if a cat ran a bakery?")).toBe(false);
    expect(isQuestion("She opens the letter?\nHer hands shake.")).toBe(false);

    const lens = offlineDirector("Which lens should I use for a close-up?", empty);
    expect(lens.shots).toEqual([]);
    expect(lens.reply).toMatch(/85mm/);
    expect(offlineDirector("How should I light a candle-lit dinner?", empty).reply).toMatch(/Practicals/);
    expect(offlineDirector("What should I do next?", empty).reply).toMatch(/storyboard/);
  });

  it("uses “an” before a vowel", () => {
    const r = offlineDirector("A heist crew escapes across the rooftops at night", empty);
    expect(r.shots.length).toBeGreaterThan(0);
    expect(r.reply).toMatch(/with an action look/);
    expect(offlineDirector("A detective smokes in the rain", empty).reply).toMatch(/with a noir look/);
  });

  it("keeps an LLM's prose answer instead of replacing it with the offline breakdown", async () => {
    const p = cinema.createProject({ name: "Prose" });
    llm.answer = "Use an 85mm lens at f/2 — it compresses the background and keeps the eyes sharp.";
    const messages = await askDirector(p.id, "Which lens for a close-up?");
    expect(messages[1]).toMatchObject({ role: "assistant", source: "llm", text: llm.answer });
    expect(messages[1].shots).toBeUndefined();

    llm.answer = '{"reply":"Two shots.","shots":[{"title":"Open","prompt":"Wide of the harbour","duration":5}]}';
    const json = await askDirector(p.id, "Storyboard the harbour opening");
    expect(json[3]).toMatchObject({ source: "llm", text: "Two shots." });
    expect(json[3].shots).toHaveLength(1);

    llm.answer = null;
    const offline = await askDirector(p.id, "Which lens for a close-up?");
    expect(offline[5]).toMatchObject({ source: "offline" });
    expect(offline[5].text).toMatch(/85mm/);
    expect(prose("```\nHello\n```")).toBe("Hello");
  });
});
