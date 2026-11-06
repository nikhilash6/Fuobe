import { describe, expect, it } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { withKeyAction, type TroubleAction } from "@/lib/diagnose";
import type { PoolRules } from "@/lib/pool-rules";
import { shownTroubleActions, siteRunOf } from "@/lib/site-run";

/** "Run on {Place}" on a failed run (hosted runs): offered only for what this studio's GPUs take, on its open version. */
const trouble = { cause: "gpu-offline", words: "Your GPU isn't answering.", actions: [], retryable: false } as unknown as Generation["trouble"];
const run = (o: Partial<Generation>) =>
  ({ status: "failed", engine: "open", kind: "image", modelId: "oss-z-image-turbo", op: "t2i", presetId: null, trouble, ...o }) as Parameters<typeof siteRunOf>[0];

describe("Run on the place, on a run that failed on the person's own GPU or key", () => {
  it("an open run on its own GPU: the same model, while hosted runs are on", () => {
    expect(siteRunOf(run({}), true, undefined)).toEqual({ modelId: "oss-z-image-turbo" });
  });

  it("never off hosted runs, on a run there already, a run that didn't fail, or one with no trouble of its own", () => {
    expect(siteRunOf(run({}), false, undefined)).toBeNull();
    expect(siteRunOf(run({ place: "pool" }), true, undefined)).toBeNull();
    expect(siteRunOf(run({ status: "canceled" }), true, undefined)).toBeNull();
    expect(siteRunOf(run({ trouble: undefined }), true, undefined)).toBeNull();
  });

  it("never for what they don't take: a model that runs on an own setup only, or one their rules keep off", () => {
    expect(siteRunOf(run({ kind: "video", modelId: "oss-h3-regenerate", op: "upscale-video" }), true, undefined)).toBeNull();
    const rules: PoolRules = { deny: ["oss-z-image-turbo"] } as PoolRules;
    expect(siteRunOf(run({}), true, rules)).toBeNull();
    const apps: PoolRules = { apps: { deny: ["app-face-swap"] } } as PoolRules;
    expect(siteRunOf(run({ engine: "cloud", modelId: "nano-banana-pro", op: "edit", presetId: "app-face-swap" }), true, apps)).toBeNull();
  });

  it("a run its key turned down: the item's open version (an app's open route, a Fuobe Original on Open source)", () => {
    expect(siteRunOf(run({ engine: "cloud", modelId: "nano-banana-pro", op: "edit", presetId: "app-face-swap" }), true, undefined)).toEqual({
      modelId: "oss-qwen-image-21-turbo",
      op: "edit",
      engine: "open",
    });
    expect(siteRunOf(run({ engine: "cloud", modelId: "fuobe-soul" }), true, undefined)).toEqual({ modelId: "fuobe-soul", engine: "open" });
    // A cloud model with no open version: nothing to offer.
    expect(siteRunOf(run({ engine: "cloud", modelId: "nano-banana-pro", op: "edit" }), true, undefined)).toBeNull();
  });
});

describe("a failed run's key offer", () => {
  const unpriced = withKeyAction("fal", "nano-banana-pro");
  const priced = withKeyAction("fal", "nano-banana-pro", undefined, "≈ $0.04");
  const add: TroubleAction = { kind: "add-credit", label: "Add credit on fal.ai", target: "https://fal.ai" } as TroubleAction;

  it("shows only with its price while hosted runs are on", () => {
    expect(shownTroubleActions([add, unpriced], true)).toEqual([add]);
    expect(shownTroubleActions([add, priced], true)).toEqual([add, priced]);
  });

  it("is unchanged with hosted runs off", () => {
    const actions = [add, unpriced];
    expect(shownTroubleActions(actions, false)).toBe(actions);
  });
});

describe("a pick made anywhere moves the studios' engine", () => {
  it("to Cloud for the key, back to Open source away from it, and leaves the switch alone otherwise", async () => {
    const { keyEngine } = await import("@/lib/run-on");
    expect(keyEngine("site", "key")).toBe("cloud");
    expect(keyEngine(null, "key")).toBe("cloud");
    expect(keyEngine("key", "site")).toBe("open");
    expect(keyEngine("key", "gpu")).toBe("open");
    expect(keyEngine("gpu", "site")).toBeNull();
    expect(keyEngine(undefined, "gpu")).toBeNull();
  });
});

describe("a run refused there only for its LoRAs", () => {
  it("carries the way on to the composer's line", async () => {
    const { poolRunState } = await import("@/lib/hosted");
    const quote = { allowed: false, amount: 0, priceVersion: "", text: "LoRAs run on your own GPU", code: "not-offered", ownSetup: { need: "gpu" as const }, withoutLoras: true as const };
    expect(poolRunState({ quote } as never)).toMatchObject({ refused: true, withoutLoras: true, setup: { need: "gpu" } });
    expect(poolRunState({ quote: { ...quote, withoutLoras: undefined } } as never)?.withoutLoras).toBeUndefined();
  });
});
