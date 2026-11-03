import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EpisodeSettings, FacelessEpisode } from "@/lib/catalog/faceless";
import { tempDir } from "./helpers/temp-dir";

/**
 * Placeholder results are off by default, so a studio's run with nothing connected is refused. In the owner's own
 * browser that refusal is the connect card's 422 (x-fuobe-connect-gpu, with what would run it), in every studio, not
 * only the image and video composer: never a 500, an error toast, or a request for something else first.
 */

const dir = tempDir("fuobe-connect-studios-");
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: no ComfyUI, no local text model (the offline writer splits the script).
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_DEMO_MODE;
delete process.env.FAL_KEY;
delete process.env.REPLICATE_API_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { getSetting, setSetting } = await import("@/server/settings");
const faceless = await import("@/server/faceless");
const { connectRefusal } = await import("@/server/connect-refusal");
const { ConnectComfyError } = await import("@/server/generations");
const explainerRoute = await import("@/app/api/explainer/route");
const actionRoute = await import("@/app/api/faceless/episodes/[id]/[action]/route");
const estimateRoute = await import("@/app/api/faceless/estimate/route");

beforeAll(() => setSetting("enhanceProvider", "none"));
afterAll(() => {
  globalThis.__fuobeDb?.close();
  globalThis.__fuobeDb = undefined;
});

const json = (method: string, body?: unknown) =>
  new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const cloud: EpisodeSettings = {
  engine: "cloud",
  length: 30,
  animation: "animated",
  aspect: "16:9",
  subtitles: true,
  music: false,
  styleId: "editorial-motion-graphics",
  styleRefs: [],
  voice: { kind: "preset", id: "Xb7hH8MSUJpSbSDYk0k2" },
  elements: [],
};
const open: EpisodeSettings = { ...cloud, engine: "open", voice: null, aspect: "9:16", animation: "frames" };
async function written(settings: EpisodeSettings): Promise<string> {
  const res = await explainerRoute.POST(json("POST", { prompt: "How lighthouses work", review: true, settings }));
  expect(res.status).toBe(201);
  const ep: FacelessEpisode = await res.json();
  await faceless.scriptWritten(ep.id);
  return ep.id;
}

describe("a studio run with nothing connected", () => {
  it("is off by default", () => {
    expect(getSetting("demoMode")).toBe("off");
  });

  it("an open-source episode opens the connect card for a GPU, not a request for a voice sample", async () => {
    const id = await written(open);
    const res = await actionRoute.POST(json("POST"), params({ id, action: "render" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("x-fuobe-connect-gpu")).toBe("1");
    expect(res.headers.get("x-fuobe-connect-needs")).toBe("gpu");
    const body = await res.json();
    expect(body).toMatchObject({ code: "connect-gpu", needs: "gpu" });
    expect(body.error).not.toMatch(/voice/i);
    // Nothing started: the episode can render once something is connected.
    expect(faceless.episodeView(id).episode.status).toBe("review");
  });

  it("a cloud episode opens the connect card for a key", async () => {
    const id = await written(cloud);
    const res = await actionRoute.POST(json("POST"), params({ id, action: "render" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("x-fuobe-connect-gpu")).toBe("1");
    expect(res.headers.get("x-fuobe-connect-needs")).toBe("key");
  });

  it("the price panel says to connect something, without an error status or the card", async () => {
    const res = await estimateRoute.POST(json("POST", { kind: "explainer", settings: open, blocks: [{ id: "b1", narration: "Lighthouses guide ships.", visual: "A lighthouse at dusk", seconds: 5 }] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-fuobe-connect-gpu")).toBeNull();
    expect((await res.json()).error).toMatch(/Connect ComfyUI in Settings/);
  });

  it("a script's token or a price check never gets the card; any other error is left alone", () => {
    const e = new ConnectComfyError("Connect ComfyUI in Settings to run this model", "gpu");
    expect(connectRefusal(e, json("POST"))?.status).toBe(422);
    expect(connectRefusal(e, json("POST"), true)).toBeNull();
    expect(connectRefusal(new Error("Something else"), json("POST"))).toBeNull();
  });
});
