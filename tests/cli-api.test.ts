import { beforeAll, describe, expect, it, vi } from "vitest";
import { MODELS } from "@/lib/catalog";
import { findModels, toModelInfo } from "@/lib/model-list";
import { tempDir } from "./helpers/temp-dir";

/** The REST routes the fuobe CLI added: GET /api/models and POST /api/generations?preview=1. */

// Route handlers are called directly, outside a Next request: connection() has nothing to wait for.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-cli-api-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
const { GET: listModels } = await import("@/app/api/models/route");
const { POST: postGeneration } = await import("@/app/api/generations/route");
const { listGenerations } = await import("@/server/generations");
const { setSetting } = await import("@/server/settings");
// Placeholders where nothing is connected, as the studio once did by default ("auto": code in this process only).
beforeAll(() => setSetting("demoMode", "auto"));

type ModelsBody = {
  engineMode: string;
  demoMode: string;
  defaults: Record<string, { cloud?: string; open?: string }>;
  items: (ReturnType<typeof toModelInfo> & { connected: boolean; runs: "real" | "demo" | "refused" })[];
  error?: string;
};
const models = async (query = "") => {
  const res = await listModels(new Request(`http://localhost/api/models${query}`));
  return { status: res.status, body: (await res.json()) as ModelsBody };
};

describe("GET /api/models", () => {
  it("filters by kind, engine, operation and search words, and leaves hidden helpers out", async () => {
    const { body } = await models("?kind=video&engine=open");
    expect(body.items.length).toBeGreaterThan(3);
    expect(body.items.every((m) => m.kind === "video" && m.engine === "open")).toBe(true);
    const kling = (await models("?q=kling%20motion")).body.items.map((m) => m.id);
    expect(kling).toContain("kling-motion-control");
    expect(kling.every((id) => id.includes("kling"))).toBe(true);
    const tts = (await models("?op=tts")).body.items;
    expect(tts.length).toBeGreaterThan(2);
    expect(tts.every((m) => m.opIds.includes("tts"))).toBe(true);
    const all = (await models()).body.items;
    expect(all.some((m) => m.hidden)).toBe(false);
    expect((await models("?hidden=1")).body.items.some((m) => m.hidden)).toBe(true);
  });

  it("gives what a request needs: operation ids, sizes, lengths, voices, and whether it would run as a demo", async () => {
    const { body } = await models("?q=kling-3");
    const k = body.items.find((m) => m.id === "kling-3")!;
    expect(k).toMatchObject({ name: "Kling 3.0", engine: "cloud", kind: "video", connected: false });
    expect(k.opIds).toEqual(expect.arrayContaining(["t2v", "i2v"]));
    expect(k.durations?.length).toBeGreaterThan(0);
    expect(k.aspectRatios).toContain("16:9");
    const voice = (await models("?q=elevenlabs-v4")).body.items.find((m) => m.id === "elevenlabs-v4")!;
    expect(voice.voices?.length).toBeGreaterThan(5);
    // No field maps or endpoints beyond the route list.
    expect(Object.keys(k)).not.toContain("options");
  });

  it("names the studios' default models, and follows the engine mode", async () => {
    expect((await models()).body.defaults).toMatchObject({ image: { cloud: "nano-banana-pro", open: "oss-ideogram-4" }, video: { cloud: "minimax-h3", open: "oss-minimax-h3" } });
    setSetting("engineMode", "open");
    try {
      const { body } = await models("?kind=image");
      expect(body.engineMode).toBe("open");
      expect(body.items.every((m) => m.engine === "open")).toBe(true);
      expect(body.defaults.image).toEqual({ open: "oss-ideogram-4" });
    } finally {
      setSetting("engineMode", "both");
    }
  });

  it("names the models that clone a voice sample, alone and as a dialogue's two speakers", async () => {
    const { defaults, items } = (await models("?kind=audio")).body;
    expect(defaults).toMatchObject({
      audio: { cloud: "elevenlabs-v4", open: "oss-chatterbox" },
      dialogue: { cloud: "elevenlabs-dialogue", open: "oss-chatterbox-dialogue" },
      clone: { cloud: "chatterbox-cloud", open: "oss-chatterbox" },
    });
    // ElevenLabs' dialogue speaks in premade voices only: no cloud model clones two speakers.
    expect(defaults.cloneDialogue).toEqual({ open: "oss-chatterbox-dialogue" });
    const byId = new Map(items.map((m) => [m.id, m]));
    expect(byId.get("chatterbox-cloud")?.voiceClone).toBe(true);
    expect(byId.get("oss-chatterbox-dialogue")?.voiceClone).toBe(true);
    expect(byId.get("elevenlabs-v4")).not.toHaveProperty("voiceClone");
  });

  it("says how a run goes today, following Settings → Placeholder results the way routing does", async () => {
    const runs = async () => {
      const { body } = await models("?q=nano-banana-pro");
      const m = body.items.find((x) => x.id === "nano-banana-pro")!;
      return { demoMode: body.demoMode, connected: m.connected, runs: m.runs };
    };
    // The default (placeholders off), no key: refused, the connect card's case.
    setSetting("demoMode", "");
    expect(await runs()).toEqual({ demoMode: "off", connected: false, runs: "refused" });
    // auto (code in this process only), no key: a free demo.
    setSetting("demoMode", "auto");
    expect(await runs()).toEqual({ demoMode: "auto", connected: false, runs: "demo" });
    try {
      setSetting("demoMode", "off");
      expect(await runs()).toEqual({ demoMode: "off", connected: false, runs: "refused" });
      setSetting("falKey", "fal-test-key");
      expect(await runs()).toEqual({ demoMode: "off", connected: true, runs: "real" });
      // Placeholder results on send every run to the demo provider, key or not.
      setSetting("demoMode", "on");
      expect(await runs()).toEqual({ demoMode: "on", connected: true, runs: "demo" });
    } finally {
      setSetting("falKey", "");
      setSetting("demoMode", "auto");
    }
  });

  it("refuses unknown filters with a sentence", async () => {
    expect(await models("?kind=smell")).toMatchObject({ status: 400, body: { error: "kind is one of image, video, audio, text, model3d" } });
    expect((await models("?engine=gpu")).status).toBe(400);
    expect((await models("?op=dance")).body.error).toBe("Unknown operation dance");
  });

  it("matches every word, in the catalog's order (pure helper)", () => {
    expect(findModels(MODELS, { q: "wan zzqx" })).toEqual([]);
    const open = findModels(MODELS, { q: "wan 2.2", engine: "open", kind: "video" });
    expect(open.length).toBeGreaterThan(0);
    // The words match the name, id or description: Fuobe DoP is an Original on Wan 2.2 and says so.
    expect(open.every((m) => m.engine === "open" && /wan/i.test(`${m.name} ${m.id} ${m.tagline}`))).toBe(true);
    expect(open.map((m) => m.id)).toContain("fuobe-dop");
  });

  it("lists an Original for an operation only on the engines whose routes run it", async () => {
    // Fuobe DoP films keyframes on the GPU only: the cloud list for keyframes leaves it out.
    expect(findModels(MODELS, { engine: "cloud", op: "keyframes" }).map((m) => m.id)).not.toContain("fuobe-dop");
    expect(findModels(MODELS, { engine: "open", op: "keyframes" }).map((m) => m.id)).toContain("fuobe-dop");
    expect((await models("?engine=cloud&op=keyframes")).body.items.map((m) => m.id)).not.toContain("fuobe-dop");
  });
});

describe("POST /api/generations?preview=1", () => {
  const post = (body: unknown, query = "") => postGeneration(new Request(`http://localhost/api/generations${query}`, { method: "POST", body: JSON.stringify(body) }));

  it("prices a request without creating anything", async () => {
    const before = listGenerations({ limit: 200 }).length;
    const res = await post({ feature: "cli", modelId: "nano-banana-pro", prompt: "a fox", params: { numOutputs: 2 } }, "?preview=1");
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p).toMatchObject({ modelId: "nano-banana-pro", modelName: "Nano Banana Pro", engine: "cloud", kind: "image", op: "t2i", opLabel: "Text to image", outputs: 2, demo: true, providerId: "mock" });
    expect(p).not.toHaveProperty("model");
    expect(listGenerations({ limit: 200 }).length).toBe(before);
  });

  it("answers a request it can't run with the planner's reason", async () => {
    const res = await post({ feature: "cli", modelId: "kling-3", prompt: "x", op: "i2v" }, "?preview=1");
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("Add a start frame");
  });
});

describe("POST /api/generations: where an owner's run came from", () => {
  const send = (body: unknown, headers: Record<string, string> = {}) => postGeneration(new Request("http://localhost/api/generations", { method: "POST", headers, body: JSON.stringify(body) }));
  const stored = (id: string) => listGenerations({ limit: 200, steps: true }).find((g) => g.id === id)!.request;
  const idOf = async (res: Response) => {
    expect(res.status).toBeLessThan(300);
    const j = (await res.json()) as { id?: string; ids?: string[]; items?: { id: string }[] };
    return j.id ?? j.ids?.[0] ?? j.items![0]!.id;
  };

  it("keeps a script's source and name, reads an API token's run as automated, and the site's own as hands-on", async () => {
    const { createToken } = await import("@/server/auth");
    const { token } = createToken("runner");
    const tagged = await idOf(await send({ feature: "cli", modelId: "nano-banana-pro", prompt: "a fox", source: "example", sourceName: "Object Remover" }, { authorization: `Bearer ${token}` }));
    expect(stored(tagged)).toMatchObject({ source: "example", sourceName: "Object Remover" });
    const api = await idOf(await send({ feature: "cli", modelId: "nano-banana-pro", prompt: "a fox" }, { authorization: `Bearer ${token}` }));
    expect(stored(api).source).toBe("api");
    const site = await idOf(await send({ feature: "cli", modelId: "nano-banana-pro", prompt: "a fox" }));
    expect(stored(site).source).toBeUndefined();
    expect((await send({ feature: "cli", modelId: "nano-banana-pro", prompt: "a fox", source: "robot" })).status).toBe(400);
  });
});
