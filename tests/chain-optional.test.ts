import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { ANCHOR_FALLBACK } from "@/lib/catalog/character-swap";
import { tempDir } from "./helpers/temp-dir";

// An optional chain input (ChainSlot.optional, Genjutsu's anchor first frame): when its step fails the step reading it
// runs without it, with the fallback's prompt, and says so; a retry puts the request back as it was planned.

vi.setConfig({ testTimeout: 90_000 });

const dir = tempDir("fuobe-optional-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { createPipeline } = await import("@/server/chains");
const { saveFile } = await import("@/server/storage");
const { db } = await import("@/server/db");

beforeAll(() => setSetting("demoMode", "auto"));

async function settle(id: string, ms = 80_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** A step that stays "running" until the test lets go of it. */
function held(): { id: string; fail: () => void } {
  const id = `held${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO generations (id, batch_id, feature, preset_id, model_id, engine, provider, op, kind, status, progress, message, prompt, request_json, provider_input_json, external_id, external_meta_json, outputs_json, error, cost_usd, favorite, created_at, updated_at, completed_at, depends_on)
       VALUES (?, NULL, 't', NULL, 'nano-banana-2', 'cloud', 'mock', 'edit', 'image', 'running', NULL, 'Held for the test', NULL, ?, NULL, NULL, NULL, '[]', NULL, 0, 0, ?, ?, NULL, NULL)`,
    )
    .run(id, JSON.stringify({ feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "held" }), now, now);
  return { id, fail: () => db().prepare("UPDATE generations SET status = 'failed', error = 'Refused', completed_at = ? WHERE id = ?").run(Date.now(), id) };
}

const hero = () => saveFile({ data: fs.readFileSync(path.join(process.cwd(), "public/samples/grade-sample.jpg")), contentType: "image/jpeg", source: "upload" }).url;
const optional = { prompt: "Swap without the anchor", notice: ANCHOR_FALLBACK };

describe("optional chain inputs", () => {
  it("withoutSkipped: the fallback's prompt and notice, and what was left out", () => {
    const req = { feature: "t", modelId: "nano-banana-2", op: "edit" as const, prompt: "Swap with the anchor" };
    const slots = [{ slot: "video" as const }, { slot: "images" as const, optional }];
    expect(gens.withoutSkipped(req, slots, [1])).toEqual({ ...req, prompt: "Swap without the anchor", notice: ANCHOR_FALLBACK, chainSkipped: { slots: [1], prompt: "Swap with the anchor" } });
    // A notice from before is kept; no fallback prompt keeps the planned one.
    expect(gens.withoutSkipped({ ...req, notice: "Earlier" }, [{ slot: "images", optional: { notice: "Left out" } }], [0])).toMatchObject({ prompt: "Swap with the anchor", notice: "Earlier · Left out", chainSkipped: { slots: [0] } });
  });

  it("a failed anchor: the swap runs without it, says so, and the next step says so too; a retry is the planned request", async () => {
    const anchor = held();
    const image = hero();
    const p = createPipeline(
      [
        {
          key: "swap",
          request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Swap with the anchor", inputs: { images: [image] } },
          after: ["anchor"],
          chain: [{ slot: "images", position: "last", optional }],
        },
        { key: "after", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Grade it" }, after: ["swap"], chain: [{ slot: "images" }] },
      ],
      { existing: { anchor: anchor.id } },
    );
    expect(gens.getGeneration(p.byKey.swap.id)!.status).toBe("queued");
    anchor.fail();
    const swap = await settle(p.byKey.swap.id);
    expect(swap.status, swap.error ?? "").toBe("succeeded");
    expect(swap.request).toMatchObject({ prompt: "Swap without the anchor", notice: ANCHOR_FALLBACK, chainSkipped: { slots: [0], prompt: "Swap with the anchor" } });
    expect(swap.request.inputs?.images).toEqual([image]);
    const next = await settle(p.byKey.after.id);
    expect(next.status, next.error ?? "").toBe("succeeded");
    expect(next.request.notice).toBe(ANCHOR_FALLBACK);
    // Back as planned: the planned prompt, no notice, the character alone.
    const back = gens.unfilledRequest(swap.request, 1);
    expect(back.prompt).toBe("Swap with the anchor");
    expect(back.notice).toBeUndefined();
    expect(back.chainSkipped).toBeUndefined();
    expect(back.inputs?.images).toEqual([image]);
  });

  it("an anchor that came through goes in last; a required input that fails still fails the step", async () => {
    const image = hero();
    const p = createPipeline([
      { key: "anchor", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Put the character in", inputs: { images: [image] } } },
      { key: "swap", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Swap with the anchor", inputs: { images: [image] } }, after: ["anchor"], chain: [{ slot: "images", position: "last", optional }] },
    ]);
    const swap = await settle(p.byKey.swap.id);
    expect(swap.status, swap.error ?? "").toBe("succeeded");
    expect(swap.request.prompt).toBe("Swap with the anchor");
    expect(swap.request.notice).toBeUndefined();
    expect(swap.request.inputs?.images).toEqual([image, gens.getGeneration(p.byKey.anchor.id)!.outputs[0].url]);

    const cut = held();
    const q = createPipeline(
      [{ key: "swap", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Swap", inputs: { images: [image] } }, after: ["cut"], chain: [{ slot: "images" }] }],
      { existing: { cut: cut.id } },
    );
    cut.fail();
    expect(await settle(q.byKey.swap.id)).toMatchObject({ status: "failed", error: "An earlier step didn't finish" });
  });
});
