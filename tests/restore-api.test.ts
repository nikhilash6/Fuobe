import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

vi.setConfig({ testTimeout: 120_000 });

// /api/restore end to end in demo mode (no keys, no ComfyUI, no LLM): a run on either engine becomes one pipeline of
// ordinary generations the mock provider runs through; estimates with a fal key price the real LTX-2.3 route.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-restore-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { db } = await import("@/server/db");
const createRoute = await import("@/app/api/restore/route");
const estimateRoute = await import("@/app/api/restore/estimate/route");
const promptRoute = await import("@/app/api/restore/prompt/route");
const tools = await import("@/server/assist/tools");
const { handleMcp } = await import("@/server/mcp");

const json = (body?: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let clip = "";
beforeAll(() => {
  setSetting("demoMode", "auto");
  // A 12 s, 16 fps, 72×128 clip with a sound track: 192 frames.
  clip = saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "reel.mp4" }).url;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function settle(id: string, ms = 90_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const batchOf = (id: string) => {
  const b = (db().prepare("SELECT batch_id FROM generations WHERE id = ?").get(id) as { batch_id: string }).batch_id;
  return db().prepare("SELECT id, model_id, op, feature, engine FROM generations WHERE batch_id = ? ORDER BY rowid").all(b) as { id: string; model_id: string; op: string; feature: string; engine: string }[];
};

const src = { duration: 12, fps: 16, width: 72, height: 128, hasAudio: true };
const body = (over: Record<string, unknown> = {}) => ({ engine: "open", source: { url: clip, name: "reel.mp4", ...src }, prompt: "a harbour in the 1930s, natural colour", ...over });

describe("Restore: estimates", () => {
  it("the GPU is free: three windows, the canvas, the tiles, the gated download said while no HF token is set", async () => {
    const e = await (await estimateRoute.POST(json(body()))).json();
    expect(e).toMatchObject({ engine: "open", pieces: 3, costUsd: 0, canvas: { width: 1088, height: 1920 }, hfToken: false, dropped: 7 });
    expect(e.notes.join(" ")).toMatch(/LTX-2.5 22B distilled with tiled latent fusion/);
    expect(e.notes.join(" ")).toMatch(/gated on Hugging Face/);
    const four = await (await estimateRoute.POST(json(body({ refine: true })))).json();
    expect(four.refined).toEqual({ width: 2176, height: 3840 });
  });

  it("refuses Restore to 4K and deinterlacing in the cloud, and a clip over two minutes, in words", async () => {
    const r = await estimateRoute.POST(json(body({ engine: "cloud", refine: true })));
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/Restore to 4K runs on your GPU/);
    expect((await (await estimateRoute.POST(json(body({ engine: "cloud", deinterlace: true })))).json()).error).toMatch(/Deinterlacing runs on your GPU/);
    expect((await (await estimateRoute.POST(json(body({ source: { url: clip, ...src, duration: 200 } })))).json()).error).toMatch(/up to 2 minutes/);
  });

  describe("with a fal key (estimates submit nothing)", () => {
    beforeAll(() => setSetting("falKey", "fal-test-key"));
    afterAll(() => setSetting("falKey", ""));

    it("prices each piece per megapixel of video at the tier's size for the clip's shape, then the joins and the sound", async () => {
      const e = await (await estimateRoute.POST(json(body({ engine: "cloud" })))).json();
      expect(e).toMatchObject({ engine: "cloud", demo: false, pieces: 2, resolution: "720p", canvas: { width: 704, height: 1280 } });
      // Two pieces of 97 and 89 frames at 704 × 1280: 87.4 + 80.2 MP → (88 + 81) × $0.001805, plus the helpers.
      expect(e.costUsd).toBeGreaterThanOrEqual((88 + 81) * 0.001805);
      expect(e.costUsd).toBeLessThan((88 + 81) * 0.001805 + 0.05);
      const hd = await (await estimateRoute.POST(json(body({ engine: "cloud", resolution: "1080p" })))).json();
      expect(hd.costUsd).toBeGreaterThan(e.costUsd * 1.8);
    });

    it("refuses a paid cloud restoration before it starts while no Hugging Face token is set (the LoRA goes as Fuobe's copy)", async () => {
      setSetting("huggingfaceDownloadToken", "");
      const before = (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
      const r = await createRoute.POST(json(body({ engine: "cloud" })));
      expect(r.status).toBe(422);
      expect((await r.json()).error).toMatch(/gated Hugging Face repo: accept its licence on https:\/\/huggingface\.co\/Lightricks\/LTX-2\.5-22b-IC-LoRA-Restore .*Settings → LoRAs.*never your token/);
      expect((db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n).toBe(before);
    });
  });

  it("Engine mode holds: paid APIs only refuses the GPU run and says it runs on your GPU", async () => {
    setSetting("engineMode", "cloud");
    try {
      const r = await estimateRoute.POST(json(body()));
      expect(r.status).toBe(422);
      expect((await r.json()).error).toMatch(/paid cloud APIs only .* runs on your GPU \(open source\)/);
    } finally {
      setSetting("engineMode", "both");
    }
  });
});

describe("Restore: the prompt writer", () => {
  it("offline (no Claude key, no local model): the template from your words, and the default negative", async () => {
    const r = await (await promptRoute.POST(json({ engine: "open", hint: "fishing boats in a harbour in the 1930s" }))).json();
    expect(r.by).toBe("offline");
    expect(r.prompt).toMatch(/^fishing boats in a harbour in 1930s, .*natural colour/);
    expect(r.negative).toMatch(/modern cars.*blocky compression/);
  });
});

describe("Restore: runs in demo mode", () => {
  it("GPU: the windows chained by their prefix, the packet-copy join and the sound back, all done", async () => {
    const res = await createRoute.POST(json(body({ seed: 3 })));
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.by).toBe("you");
    const rows = batchOf(out.final.id);
    expect(rows.map((r) => [r.model_id, r.op])).toEqual([
      ["fuobe-restore", "restore-video"],
      ["fuobe-restore", "restore-video"],
      ["fuobe-restore", "restore-video"],
      ["oss-join-encoded", "concat"],
      ["oss-mux", "mux"],
    ]);
    expect(rows.filter((r) => r.feature === "restore")).toHaveLength(1);
    const done = await settle(out.final.id);
    expect(done.status).toBe("succeeded");
    const req = JSON.parse((db().prepare("SELECT request_json FROM generations WHERE id = ?").get(out.final.id) as { request_json: string }).request_json);
    expect(req.title).toMatch(/^Restored · A harbour in the 1930s · reel$/);
  });

  it("cloud: cut pieces, a hand-off frame, the join and the sound, written words kept", async () => {
    const res = await createRoute.POST(json(body({ engine: "cloud", prompt: "", hint: "a harbour" })));
    const out = await res.json();
    expect(out.by).toBe("offline");
    expect(out.prompt).toMatch(/natural colour/);
    const ops = batchOf(out.final.id).map((r) => r.op);
    expect(ops).toEqual(expect.arrayContaining(["trim", "frame", "restore-video", "concat", "mux"]));
    expect((await settle(out.final.id)).status).toBe("succeeded");
  });
});

describe("Restore: the Assist / MCP tool", () => {
  const plan = (input: unknown, engine: "cloud" | "open" = "open") => tools.planFor("restore_video", input, { engine });

  it("prices the clip as the tool does and opens in Restore & colourise; GPU-only options refused in the cloud, in words", async () => {
    const p = plan({ video: clip, hint: "a harbour" });
    expect(p.studio).toBe("Restore & colourise");
    expect(p.jobs).toMatchObject([{ tool: "restore_video", modelId: "fuobe-restore", op: "restore-video", costUsd: 0, atomic: true }]);
    expect(p.jobs[0].note).toMatch(/^3 windows at 1088×1920/);
    expect(plan({ video: clip, restore_to_4k: true }, "cloud").jobs[0].error).toMatch(/Restore to 4K runs on your GPU/);
    const est = (await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "estimate_job", arguments: { tool: "restore_video", arguments: { video: clip } } } })) as {
      result: { structuredContent: { studio?: string; jobs: { error?: string }[] }; isError: boolean };
    };
    expect(est.result.isError).toBe(false);
    expect(est.result.structuredContent.studio).toBe("Restore & colourise");
  });

  it("runs one restoration with the words written for it; a clip it can't read is one generation in the Library", async () => {
    const out = await tools.executeTool("restore_video", { video: clip, hint: "fishing boats, 1930s" }, { engine: "open" });
    const res = JSON.parse(out.content as string);
    expect(res).toMatchObject({ studio: "Restore & colourise", href: "/video-tools/restore", writtenBy: "offline" });
    expect(res.prompt).toMatch(/natural colour/);
    expect((await settle(res.results[0])).status).toBe("succeeded");
    const lost = plan({ video: "/api/files/uploads/gone.mp4" });
    expect(lost.fallback).toMatch(/couldn't read this clip/);
    expect(lost.jobs).toMatchObject([{ modelId: "fuobe-restore", op: "restore-video" }]);
  });
});
