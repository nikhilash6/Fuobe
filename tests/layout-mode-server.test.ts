import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LayoutDraft } from "@/lib/layout-prompt";

// N7-2: a layout run never goes through Fuobe's prompt enhancer (it would rewrite the boxes), even when the request asks
// for it; a plain prompt still does. Demo mode (no keys, no GPU): the mock provider makes the picture.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-layout-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const enhanced = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/server/enhance", async (orig) => ({
  ...(await orig<typeof import("@/server/enhance")>()),
  enhancePrompt: async (p: string) => {
    enhanced.calls.push(p);
    return `${p}, cinematic, richly detailed`;
  },
}));

const { setSetting } = await import("@/server/settings");
const { createGenerations, getGeneration, previewGeneration } = await import("@/server/generations");

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const poster: LayoutDraft = {
  summary: { caption: "A candle sale poster", meta: [], canvas: "single" },
  items: [{ label: "text", caption: "Bold serif", text: "30% OFF", box: [0.1, 0.05, 0.9, 0.2] }],
};

const settled = async (id: string) => {
  await vi.waitFor(() => expect(getGeneration(id)?.status).not.toBe("queued"), { timeout: 5000 });
  return getGeneration(id)!;
};

describe("a layout request on the server", () => {
  it("ignores enhancePrompt and keeps the compiled layout as the prompt", async () => {
    enhanced.calls.length = 0;
    const [g] = createGenerations({ feature: "image", modelId: "moss-image", prompt: "A candle sale poster", params: { aspectRatio: "1:1", enhancePrompt: true, extra: { layout: poster } } });
    const done = await settled(g.id);
    expect(enhanced.calls).toEqual([]);
    expect(done.provider).toBe("mock");
    expect(JSON.parse(done.prompt!)).toMatchObject({ summary: { caption: "A candle sale poster" }, items: [{ text: "30% OFF", bbox: [-461, -410, -307, 410] }], bbox_coord_space: "abs_centralized" });
    // The stored request keeps the draft and the person's words, for Reuse and Edit layout.
    expect(done.request.prompt).toBe("A candle sale poster");
    expect(done.request.params?.extra?.layout).toEqual(poster);
  });

  it("still enhances a plain prompt that asks for it", async () => {
    enhanced.calls.length = 0;
    const [g] = createGenerations({ feature: "image", modelId: "moss-image", prompt: "a candle", params: { aspectRatio: "1:1", enhancePrompt: true } });
    const done = await settled(g.id);
    expect(enhanced.calls).toEqual(["a candle"]);
    expect(done.prompt).toBe("a candle, cinematic, richly detailed");
  });

  it("previews the compiled prompt at the canvas both engines render", () => {
    const cloud = previewGeneration({ feature: "image", modelId: "moss-image", prompt: "A candle sale poster", params: { aspectRatio: "16:9", extra: { layout: poster } } });
    const open = previewGeneration({ feature: "image", modelId: "oss-moss-image", prompt: "A candle sale poster", params: { aspectRatio: "16:9", extra: { layout: poster } } });
    expect(cloud.prompt).toBe(open.prompt);
    expect(cloud.costUsd).toBe(0);
    expect(() => previewGeneration({ feature: "image", modelId: "moss-image", prompt: "x", params: { extra: { layout: { ...poster, items: [{ ...poster.items[0], text: "" }] } } } })).toThrow("Type the words for box 1");
  });
});
