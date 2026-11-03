import { describe, expect, it } from "vitest";
import { againKeys, katanaSteps, type KatanaJobView } from "@/lib/av/katana";
import type { Generation } from "@/lib/catalog/types";
import { againPrice, againWhere, paidSuffix } from "@/lib/demo-mode";
import { draftRenderPaid } from "@/lib/output-actions";

describe("a one-tap Run again says what it spends", () => {
  const off = { placeholders: false };
  const on = { placeholders: true };

  it("on your GPU, on the studio's GPUs, paid in the cloud", () => {
    expect(againWhere({ engine: "open" }, off)).toBe(" on your GPU");
    expect(againWhere({ engine: "open", place: "pool" }, off)).toBe(" on the studio's GPUs");
    expect(againWhere({ engine: "cloud" }, off)).toBe(" · paid");
  });

  it("says the cloud price when the estimate is known, else paid", () => {
    expect(againWhere({ engine: "cloud" }, off, 0.42)).toBe(" · ≈ $0.42");
    expect(againWhere({ engine: "cloud" }, off, 0.045)).toBe(" · ≈ $0.045");
    expect(againWhere({ engine: "cloud" }, off, 3.5)).toBe(" · ≈ $3.50");
    expect(againWhere({ engine: "cloud" }, off, 0.004)).toBe(" · under $0.01");
    expect(againWhere({ engine: "cloud" }, off, null)).toBe(" · paid");
    expect(againWhere({ engine: "cloud" }, off, 0)).toBe(" · paid");
    // A price never shows on your GPU, on a studio's GPUs, or while placeholders are on.
    expect(againWhere({ engine: "open" }, off, 0.42)).toBe(" on your GPU");
    expect(againWhere({ engine: "cloud", place: "pool" }, off, 0.42)).toBe(" on the studio's GPUs");
    expect(againWhere({ engine: "cloud" }, on, 0.42)).toBe("");
    expect(paidSuffix(undefined)).toBe(" · paid");
    expect(paidSuffix(0.04)).toBe(" · ≈ $0.04");
  });

  it("follows the placeholder switch as it is now, not the old result", () => {
    // An old placeholder result, placeholders now off: the rerun is real and says so.
    expect(againWhere({ engine: "cloud", provider: "mock" } as { engine: string }, off)).toBe(" · paid");
    // An old real result, placeholders now on: the rerun is a free stand-in, so nothing is added.
    expect(againWhere({ engine: "cloud", provider: "fal" } as { engine: string }, on)).toBe("");
    expect(againWhere({ engine: "open" }, on)).toBe("");
  });

  it("adds nothing before the run is known", () => {
    expect(againWhere(undefined, off)).toBe("");
    expect(againWhere(null, off)).toBe("");
  });

  it("marks a draft's 1080p render as paid unless placeholders are on", () => {
    expect(draftRenderPaid(false)).toBe(" · paid");
    expect(draftRenderPaid(undefined)).toBe(" · paid");
    expect(draftRenderPaid(true)).toBe("");
  });
});

describe("a rerun's price comes from the estimates its runs were priced at", () => {
  it("sums them, and knows nothing when one is missing, unpriced or a placeholder", () => {
    expect(againPrice([{ costUsd: 0.1, provider: "fal" }, { costUsd: 0.25, provider: "fal" }])).toBe(0.35);
    expect(againPrice([{ costUsd: 0.1, provider: "fal" }, { costUsd: 0, provider: "fal" }])).toBe(0.1);
    expect(againPrice([{ costUsd: 0.1, provider: "fal" }, { costUsd: null, provider: "fal" }])).toBeNull();
    expect(againPrice([{ costUsd: 0.1, provider: "fal" }, undefined])).toBeNull();
    // A placeholder's estimate says nothing about the real run.
    expect(againPrice([{ costUsd: 0, provider: "mock" }])).toBeNull();
    expect(againPrice([])).toBeNull();
  });

  it("prices a Katana Run again on every step, and Retry failed steps on the failed ones and after", () => {
    const input = {
      engine: "cloud" as const,
      reference: "/api/files/ref.mp4",
      photos: ["/api/files/me.png"],
      segments: [
        { start: 0, end: 4 },
        { start: 4, end: 8 },
      ],
      motionModel: "kling-o3",
      keepAudio: true,
    };
    const steps = katanaSteps(input);
    const prices: Record<string, number> = { key0: 0.15, move0: 1.2, key1: 0.15, move1: 1.2 };
    const gen = (key: string, status: Generation["status"]): Generation => ({ id: `g-${key}`, status, provider: "fal", engine: "cloud", costUsd: prices[key] ?? 0 }) as Generation;
    const job = (failed: string[]): KatanaJobView => {
      const ids = Object.fromEntries(steps.map((s) => [s.key, `g-${s.key}`]));
      const generations = Object.fromEntries(steps.map((s) => [`g-${s.key}`, gen(s.key, failed.includes(s.key) ? "failed" : "succeeded")]));
      return { ...input, id: "k1", title: "Edit", batchId: "b1", steps: ids, final: "final", createdAt: 1, updatedAt: 1, generations };
    };
    const priceOf = (j: KatanaJobView, all: boolean) => againPrice(againKeys(j, all)!.map((k) => j.generations[j.steps[k]]));
    // Run again: every step.
    expect(priceOf(job([]), true)).toBe(2.7);
    // Segment 2's motion failed: it, the join and the soundtrack are made again.
    expect(againKeys(job(["move1"]), false)).toEqual(["move1", "join", "final"]);
    expect(priceOf(job(["move1"]), false)).toBe(1.2);
    // Its picture failed: the picture and everything after it.
    expect(priceOf(job(["key1"]), false)).toBe(1.35);
    expect(againWhere(job(["move1"]), { placeholders: false }, priceOf(job(["move1"]), false))).toBe(" · ≈ $1.20");
    // A step made as a placeholder: no price, so the button says "· paid".
    const j = job(["move1"]);
    j.generations["g-move1"] = { ...j.generations["g-move1"], provider: "mock" } as Generation;
    expect(priceOf(j, false)).toBeNull();
    expect(againWhere(j, { placeholders: false }, priceOf(j, false))).toBe(" · paid");
  });
});
