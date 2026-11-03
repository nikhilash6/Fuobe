import http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tooLong, type EpisodeSettings } from "@/lib/catalog/faceless";
import { tempDir } from "./helpers/temp-dir";

/*
 * Faceless Studio and the Explainer with an LLM: channel names, topics, scripts, pictures for a pasted
 * script and link summaries go through the llm provider to a stand-in Ollama that answers each brief
 * with canned JSON (the shapes the prompts ask for).
 */

vi.setConfig({ testTimeout: 60_000 });
const dir = tempDir("fuobe-faceless-llm-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
// The link below is served by the stand-in on 127.0.0.1.
process.env.FUOBE_ALLOW_PRIVATE_URLS = "1";

const { setSetting } = await import("@/server/settings");
const faceless = await import("@/server/faceless");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const seen: { system: string; user: string }[] = [];
let failTopics = false;

const LONG = "The lighthouse keeper climbed the spiral stairs every evening, one hundred and twelve steps, carrying oil, a cloth and a match, because ships far out at sea were counting on the light, and on a stormy night a single missing beam could send a whole crew onto the rocks below.";

function answer(system: string, user: string): string {
  if (system.startsWith("You name YouTube channels")) return '"Keepers of the Light"';
  if (system.startsWith("You suggest episode topics")) {
    return JSON.stringify({
      topics: [
        { title: "The last lighthouse keeper of Scotland", hook: "He switched off the light in 1998." },
        { title: "How a Fresnel lens bends light 20 miles", hook: "Glass rings that changed the sea." },
        { title: "The lighthouse that was built on a rock in the sea", hook: "It took four years and 16 storms." },
        { title: "Ghost stories of the Flannan Isles", hook: "Three keepers vanished in 1900." },
        { title: "Why lighthouses flash in patterns", hook: "Every coast has its own code." },
      ],
    });
  }
  if (system.startsWith("You write scripts for faceless videos")) {
    return [
      "Sure! Here it is:",
      "```json",
      JSON.stringify({
        title: "Keepers of the Light",
        scenes: [
          { narration: "Every night for two hundred years, someone climbed to the top of this tower.", visual: "A tall striped lighthouse at dusk on a rocky coast", motion: "slow push-in, waves crash" },
          { narration: LONG, visual: "A keeper climbing a spiral staircase with an oil can", motion: "camera follows him up" },
          { narration: "Today the lights are automatic, but the stories remain.", visual: "An empty lantern room with a modern LED beacon", motion: "slow orbit" },
        ],
      }),
      "```",
    ].join("\n");
  }
  if (system.startsWith("You plan the pictures")) {
    const n = user.split("\n").filter((l) => /^\[\d+\]/.test(l)).length;
    return JSON.stringify({ scenes: Array.from({ length: n }, (_, i) => ({ n: i + 1, visual: `Painted scene ${i + 1} of the harbour`, motion: "gentle drift" })) });
  }
  if (system.startsWith("You summarise web pages")) return "Fresnel lenses focus a lamp into a beam visible for 20 nautical miles. Augustin Fresnel designed them in 1822.";
  return "?";
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }] }));
  if (req.url === "/page") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.end("<html><head><title>The Fresnel lens</title></head><body><p>A Fresnel lens is made of concentric rings of glass prisms.</p><p>It was invented by Augustin-Jean Fresnel in 1822 for lighthouses.</p></body></html>");
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const j = JSON.parse(body) as { messages: { role: string; content: string }[] };
    const system = j.messages[0].content;
    const user = j.messages[1].content;
    seen.push({ system, user });
    if (failTopics && system.startsWith("You suggest episode topics")) {
      res.statusCode = 500;
      return res.end("model crashed");
    }
    // The name comes a moment later, as a real model's would.
    if (system.startsWith("You name YouTube channels")) await sleep(400);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: { role: "assistant", content: answer(system, user) } }));
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  setSetting("ollamaUrl", `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  setSetting("anthropicKey", "");
  setSetting("demoMode", "auto");
  // The AI helper on "auto": Ollama (no Claude key).
  setSetting("enhanceProvider", "auto");
});
afterAll(() => {
  server.close();
});

const settings: EpisodeSettings = {
  engine: "open",
  length: 60,
  animation: "animated",
  aspect: "16:9",
  subtitles: true,
  music: false,
  styleId: "watercolor-chronicle",
  styleRefs: [],
  voice: null,
  elements: [],
};

describe("Faceless with an LLM (a stand-in Ollama)", () => {
  it("names a new channel in the background: the channel is there at once, the LLM's name follows", async () => {
    const t0 = Date.now();
    const c = await faceless.createChannel({ idea: "Channel about lighthouses and their keepers", genre: "storytelling", engine: "open" });
    // No waiting for the LLM: the channel is created with a name from the idea.
    expect(Date.now() - t0).toBeLessThan(350);
    expect(c.name).toBe("Lighthouses and Their Keepers");
    await faceless.channelReady(c.id);
    expect(faceless.getChannel(c.id)!.name).toBe("Keepers of the Light");
    expect(seen.find((s) => s.system.startsWith("You name"))!.user).toMatch(/Genre: Storytelling/);

    // Renamed while the LLM was thinking: the user's name stays.
    const d = await faceless.createChannel({ idea: "Channel about lighthouses", genre: "history", engine: "open" });
    await faceless.updateChannel(d.id, { name: "My lights" });
    await faceless.channelReady(d.id);
    expect(faceless.getChannel(d.id)!.name).toBe("My lights");
  });

  it("suggests the LLM's topics, tells it what was shown, and falls back offline when it fails", async () => {
    const first = await faceless.suggestTopics({ idea: "Channel about lighthouses", genre: "history", engine: "cloud" });
    expect(first.offline).toBe(false);
    expect(first.topics).toHaveLength(5);
    expect(first.topics[0]).toEqual({ title: "The last lighthouse keeper of Scotland", hook: "He switched off the light in 1998." });
    await faceless.suggestTopics({ idea: "Channel about lighthouses", genre: "history", engine: "cloud", avoid: first.topics.map((t) => t.title), round: 1 });
    expect(seen.at(-1)!.user).toMatch(/Already suggested \(don't repeat\): The last lighthouse keeper of Scotland; How a Fresnel lens/);
    failTopics = true;
    try {
      const offline = await faceless.suggestTopics({ idea: "Channel about lighthouses", genre: "history", engine: "cloud" });
      expect(offline.offline).toBe(true);
      expect(offline.topics[0].title).toMatch(/lighthouses/);
    } finally {
      failTopics = false;
    }
  });

  it("writes the script with the LLM: its title, its scenes, and a scene too long to speak split in two", async () => {
    const c = await faceless.createChannel({ idea: "Channel about lighthouses", genre: "storytelling", engine: "open", name: "Lights" });
    const ep = faceless.createEpisode({ kind: "faceless", channelId: c.id, topic: "The keepers who kept the lights on", settings });
    await faceless.scriptWritten(ep.id);
    const v = faceless.episodeView(ep.id);
    expect(v.episode.status).toBe("review");
    expect(v.episode.title).toBe("Keepers of the Light");
    expect(v.episode.script).toMatchObject({ source: "ai" });
    expect(v.episode.script.offline).toBeUndefined();
    const blocks = v.episode.script.blocks;
    expect(blocks[0]).toMatchObject({ narration: "Every night for two hundred years, someone climbed to the top of this tower.", visual: "A tall striped lighthouse at dusk on a rocky coast", motion: "slow push-in, waves crash" });
    // The long line became several scenes, every word kept, each short enough for its scene.
    expect(tooLong(LONG)).toBe(true);
    expect(blocks.length).toBeGreaterThan(3);
    expect(blocks.slice(1, -1).map((b) => b.narration).join(" ")).toBe(LONG);
    expect(blocks.every((b) => !tooLong(b.narration) && b.seconds <= 10)).toBe(true);
    expect(blocks[2].visual).toMatch(/continued, a new angle/);
    const brief = seen.find((s) => s.system.startsWith("You write scripts"))!.user;
    expect(brief).toMatch(/Topic: The keepers who kept the lights on/);
    expect(brief).toMatch(/Write exactly 6 scenes/);
    expect(brief).toMatch(/Channel: Lights/);
  });

  it("plans the pictures for a pasted script with the LLM", async () => {
    const c = await faceless.createChannel({ idea: "Channel about harbours", genre: "history", engine: "open", name: "Harbours" });
    const script = "The harbour woke before dawn. Fishing boats slipped out one by one. By noon the market was full of silver fish and shouting traders.";
    const ep = faceless.createEpisode({ kind: "faceless", channelId: c.id, topic: "", script, settings });
    await faceless.scriptWritten(ep.id);
    const v = faceless.episodeView(ep.id);
    expect(v.episode.script.source).toBe("pasted");
    expect(v.episode.script.offline).toBeUndefined();
    expect(v.episode.script.blocks.map((b) => b.narration).join(" ")).toBe(script);
    expect(v.episode.script.blocks.map((b) => b.visual)).toEqual(v.episode.script.blocks.map((_, i) => `Painted scene ${i + 1} of the harbour`));
    expect(v.episode.script.blocks[0].motion).toBe("gentle drift");
  });

  it("summarises a link for the Explainer's writer", async () => {
    const url = `${(server.address() as { port: number }).port}`;
    const link = await faceless.summarizeLink(`http://127.0.0.1:${url}/page`, "cloud");
    expect(link).toMatchObject({ kind: "link", title: "The Fresnel lens" });
    expect(link.text).toMatch(/^Fresnel lenses focus a lamp/);
    expect(seen.at(-1)!.user).toMatch(/concentric rings of glass prisms/);
  });
});
