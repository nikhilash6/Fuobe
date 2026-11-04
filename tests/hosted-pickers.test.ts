import { describe, expect, it } from "vitest";
import { poolRulesOf, poolRunsModel, poolRunsPreset, tryFreeFor } from "@/lib/pool-rules";

/*
 * For a visitor with no GPU of its own (hosted runs), pickers leave out what this studio's GPUs keep off (the policy's
 * model and app lists and its kinds), the same rules the server checks on every run; and "Try free" on preset cards.
 */

describe("what pickers leave out for a visitor with no GPU of its own", () => {
  const open = (id: string, kind: "image" | "video" | "model3d" = "image") => ({ id, kind, engine: "open" });
  it("the policy's lists and kinds, made into rules only when they keep something off", () => {
    expect(poolRulesOf({ pool: {} })).toBeUndefined();
    expect(poolRulesOf({ pool: { deny: [] }, kinds: { image: true } })).toBeUndefined();
    expect(poolRulesOf({ pool: { allow: ["a"], deny: ["b"], apps: { deny: ["app-x"] } }, kinds: { model3d: false, video: true } })).toEqual({
      allow: ["a"],
      deny: ["b"],
      apps: { deny: ["app-x"] },
      kinds: { model3d: false },
    });
  });
  it("models: the deny list, the allow list and the kinds; cloud models are never theirs to judge", () => {
    const rules = poolRulesOf({ pool: { deny: ["oss-x"] }, kinds: { model3d: false } });
    expect(poolRunsModel(rules, open("oss-x"))).toBe(false);
    expect(poolRunsModel(rules, open("oss-y"))).toBe(true);
    expect(poolRunsModel(rules, open("oss-3d", "model3d"))).toBe(false);
    expect(poolRunsModel(rules, { id: "oss-x", kind: "image", engine: "cloud" })).toBe(true);
    expect(poolRunsModel({ allow: ["oss-y"] }, open("oss-z"))).toBe(false);
    expect(poolRunsModel(undefined, open("oss-x"))).toBe(true);
  });
  it("apps, camera motions and effects: by their own lists", () => {
    expect(poolRunsPreset({ apps: { deny: ["app-x"] } }, "app-x")).toBe(false);
    expect(poolRunsPreset({ apps: { allow: ["app-y"] } }, "app-x")).toBe(false);
    expect(poolRunsPreset({ apps: { allow: ["app-y"] } }, "app-y")).toBe(true);
    expect(poolRunsPreset({ deny: ["m"] }, "app-x")).toBe(true);
  });
  it("agree with the server's own check of every run", async () => {
    const { poolAllows } = await import("@/server/hosted");
    const policies = [{}, { allow: ["m"] }, { deny: ["m"] }, { allow: ["n"] }, { apps: { deny: ["app-x"] } }, { apps: { allow: ["app-y"] } }];
    for (const pool of policies) {
      const rules = poolRulesOf({ pool });
      for (const [model, app] of [["m", undefined], ["n", undefined], ["m", "app-x"], ["m", "app-y"]] as const) {
        const client = poolRunsModel(rules, open(model)) && (!app || poolRunsPreset(rules, app));
        expect(client, JSON.stringify({ pool, model, app })).toBe(poolAllows({ pool }, model, app));
      }
    }
  });
});

describe("Try free on preset cards", () => {
  const card = { id: "app-x", open: true };
  it("only with hosted runs on, for a viewer whose runs go to this studio's GPUs, on presets they run", () => {
    expect(tryFreeFor(undefined, "both")).toBeNull();
    expect(tryFreeFor({ gpu: { connected: false } }, "both")).toBeNull();
    expect(tryFreeFor({ hosted: true, gpu: { connected: false } }, "cloud")).toBeNull();
    expect(tryFreeFor({ hosted: true, gpu: { connected: true } }, "both")).toBeNull();
    expect(tryFreeFor({ hosted: true, gpu: { connected: true }, prefer: "pool" }, "both")?.(card)).toBe(true);
    const guest = tryFreeFor({ hosted: true, gpu: { connected: false }, pool: { apps: { deny: ["app-x"] } } }, "both")!;
    expect(guest(card)).toBe(false);
    expect(guest({ id: "app-y", open: true })).toBe(true);
    expect(guest({ id: "app-y", open: false })).toBe(false);
  });
});
