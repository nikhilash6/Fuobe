import { describe, expect, it } from "vitest";
import { modelOwnSetup, pickerRules, poolRulesOf, poolRunsModel, poolRunsPreset, presetOffered, tryFreeFor } from "@/lib/pool-rules";

/*
 * For a visitor with no GPU of its own (hosted runs), pickers label what this studio's GPUs keep off (the policy's
 * model and app lists and its kinds) with the visitor's own setup, the same rules the server checks on every run; and
 * "Try free" on preset cards. (The labels themselves: tests/own-setup-labels.test.ts.)
 */

describe("what pickers label for a visitor with no GPU of its own", () => {
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
  it("a camera motion or effect with a cloud route stays in the pickers of the cloud engine, whatever this studio's GPUs run", () => {
    // Videos kept off this studio's GPUs: every motion and effect on an open model is in the rules' deny list.
    const rules = { apps: { deny: ["motion-both", "motion-open"] }, kinds: { video: false } };
    const both = { id: "motion-both", open: { modelId: "oss-clip" }, cloud: { modelId: "cloud-clip" } };
    const openOnly = { id: "motion-open", open: { modelId: "oss-clip" }, cloud: null };
    const cloudOnly = { id: "motion-cloud", open: null, cloud: { modelId: "cloud-clip" } };
    // On the cloud engine (an account with its own key): the ones with a cloud route.
    expect(presetOffered(rules, both, "cloud")).toBe(true);
    expect(presetOffered(rules, cloudOnly, "cloud")).toBe(true);
    // On the open engine: only what this studio's GPUs run.
    expect(presetOffered(rules, both, "open")).toBe(false);
    expect(presetOffered(rules, openOnly, "open")).toBe(false);
    expect(presetOffered(rules, cloudOnly, "open")).toBe(true);
    // A gallery (either engine) keeps every card that has a cloud route, as before.
    expect(presetOffered(rules, both)).toBe(true);
    expect(presetOffered(rules, openOnly)).toBe(false);
    // No rules: every preset.
    expect(presetOffered(undefined, openOnly, "open")).toBe(true);
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

describe("labels for a viewer with a GPU of its own (hosted runs)", () => {
  const pool = { deny: ["oss-x"] };
  const open = { id: "oss-x", kind: "image" as const, engine: "open" };
  const gpu = { connected: true };
  it("its runs go to this studio's GPUs (their default, or its pick of them or its key): what they keep off is labelled", () => {
    for (const v of [{ hosted: true, prefer: "pool" as const, gpu, pool }, { hosted: true, runOn: "site", gpu, pool }, { hosted: true, runOn: "key", gpu, pool }]) {
      expect(pickerRules(v)).toEqual(pool);
      expect(modelOwnSetup(pickerRules(v), open)?.need).toBe("gpu");
    }
  });
  it("its runs go to its own GPU (its pick, or an install that puts it first): no labels", () => {
    expect(pickerRules({ hosted: true, prefer: "pool", runOn: "gpu", gpu, pool })).toBeUndefined();
    expect(pickerRules({ hosted: true, gpu, pool })).toBeUndefined();
  });
  it("no GPU of its own: labelled as before; hosted runs off or nothing kept off: none", () => {
    expect(pickerRules({ hosted: true, gpu: { connected: false }, pool })).toEqual(pool);
    expect(pickerRules({ hosted: false, gpu: { connected: false }, pool })).toBeUndefined();
    expect(pickerRules({ hosted: true, gpu: { connected: false } })).toBeUndefined();
    expect(pickerRules(undefined)).toBeUndefined();
  });
});

describe("presets kept off with their model or the kind they make", () => {
  const presets = [
    { id: "app-face", model: { id: "oss-face", kind: "image" as const } },
    { id: "app-portrait", model: { id: "oss-portrait", kind: "image" as const } },
    { id: "motion-orbit", model: { id: "oss-clip", kind: "video" as const } },
    { id: "effect-melt", model: { id: "oss-clip", kind: "video" as const } },
    { id: "app-cloud-only" },
  ];
  const tryFree = (pool: Parameters<typeof poolRulesOf>[0]) => tryFreeFor({ hosted: true, cardText: "Try free", gpu: { connected: false }, pool: poolRulesOf(pool, presets) }, "both")!.runs;

  it("a preset on a model the policy denies, or of a kind it keeps off, says no Try free and is labelled in the pickers", () => {
    const denied = tryFree({ pool: { deny: ["oss-face"] } });
    expect(denied({ id: "app-face", open: true })).toBe(false);
    expect(denied({ id: "app-portrait", open: true })).toBe(true);
    expect(denied({ id: "motion-orbit", open: true })).toBe(true);
    const noVideo = tryFree({ pool: {}, kinds: { video: false } });
    expect(noVideo({ id: "motion-orbit", open: true })).toBe(false);
    expect(noVideo({ id: "effect-melt", open: true })).toBe(false);
    expect(noVideo({ id: "app-face", open: true })).toBe(true);
    // The rules the gallery and the motion and effect pickers filter by say the same.
    const rules = poolRulesOf({ pool: { deny: ["oss-face"] }, kinds: { video: false } }, presets);
    expect(presets.filter((p) => poolRunsPreset(rules, p.id)).map((p) => p.id)).toEqual(["app-portrait", "app-cloud-only"]);
  });

  it("a preset whose end frame is made first on a model these GPUs can't run is kept off with it, labelled with what its press needs", async () => {
    const { presetOwnSetup } = await import("@/lib/pool-rules");
    const chained = [...presets, { id: "effect-bloom", model: { id: "oss-clip", kind: "video" as const }, steps: [{ id: "oss-edit", kind: "image" as const }] }];
    const free = tryFreeFor({ hosted: true, cardText: "Try free", gpu: { connected: false }, pool: poolRulesOf({ pool: { deny: ["oss-edit"] } }, chained) }, "both")!.runs;
    expect(free({ id: "effect-bloom", open: true })).toBe(false);
    expect(free({ id: "effect-melt", open: true })).toBe(true);
    // No GPU here holds the edit model: its card says what the visitor's own setup needs for it.
    const own = { "oss-edit": { need: "gpu" as const, vramGb: 48 } };
    const rules = poolRulesOf({}, chained, own);
    expect(poolRunsPreset(rules, "effect-bloom")).toBe(false);
    expect(presetOwnSetup(rules, { id: "effect-bloom", open: { modelId: "oss-clip" }, cloud: null }, "open")).toEqual({ need: "gpu" });
    expect(poolRunsPreset(rules, "effect-melt")).toBe(true);
    // A press these GPUs can't run in whole (a step none of them runs, its model otherwise run): kept off with that label.
    const whole = poolRulesOf({}, presets, {}, { "effect-melt": { need: "gpu", vramGb: 32 } });
    expect(poolRunsPreset(whole, "effect-melt")).toBe(false);
    expect(presetOwnSetup(whole, { id: "effect-melt", open: { modelId: "oss-clip" }, cloud: null }, "open")).toEqual({ need: "gpu", vramGb: 32 });
    expect(poolRunsPreset(whole, "motion-orbit")).toBe(true);
  });

  it("keeps the shorter list, and the policy's own app lists", () => {
    // Most presets kept off: the ones still on are listed instead.
    expect(poolRulesOf({ pool: { allow: ["oss-portrait"] } }, presets)?.apps).toEqual({ allow: ["app-portrait", "app-cloud-only"] });
    // An app allow list of the policy's own only loses what its models keep off.
    expect(poolRulesOf({ pool: { deny: ["oss-face"], apps: { allow: ["app-face", "motion-orbit"] } } }, presets)?.apps).toEqual({ allow: ["motion-orbit"] });
    expect(poolRulesOf({ pool: { deny: ["oss-face"], apps: { deny: ["effect-melt"] } } }, presets)?.apps).toEqual({ deny: ["effect-melt", "app-face"] });
    // Nothing kept off: nothing to send.
    expect(poolRulesOf({ pool: { deny: [] } }, presets)).toBeUndefined();
  });

  it("agree with the server: a preset says Try free only when the run it makes would be taken", async () => {
    const { poolAllows } = await import("@/server/hosted");
    const { kindAllowed } = await import("@/server/hosted-run");
    const policies = [{ pool: {} }, { pool: { deny: ["oss-face"] } }, { pool: { allow: ["oss-clip"] } }, { pool: {}, kinds: { video: false } }, { pool: { apps: { deny: ["app-portrait"] } } }];
    for (const p of policies) {
      const free = tryFreeFor({ hosted: true, cardText: "Try free", gpu: { connected: false }, pool: poolRulesOf(p, presets) }, "both")!.runs;
      for (const preset of presets.filter((x) => x.model)) {
        const server = poolAllows(p, preset.model!.id, preset.id) && kindAllowed(p, preset.model!.kind);
        expect(free({ id: preset.id, open: true }), JSON.stringify({ p, preset: preset.id })).toBe(server);
      }
    }
  });
});

describe("Try free on preset cards", () => {
  const card = { id: "app-x", open: true };
  const words = "Try free";
  it("only with hosted runs on, for a viewer whose runs go to this studio's GPUs, on presets they run", () => {
    expect(tryFreeFor(undefined, "both")).toBeNull();
    expect(tryFreeFor({ gpu: { connected: false }, cardText: words }, "both")).toBeNull();
    expect(tryFreeFor({ hosted: true, cardText: words, gpu: { connected: false } }, "cloud")).toBeNull();
    expect(tryFreeFor({ hosted: true, cardText: words, gpu: { connected: true } }, "both")).toBeNull();
    expect(tryFreeFor({ hosted: true, cardText: words, gpu: { connected: true }, prefer: "pool" }, "both")?.runs(card)).toBe(true);
    const guest = tryFreeFor({ hosted: true, cardText: words, gpu: { connected: false }, pool: { apps: { deny: ["app-x"] } } }, "both")!;
    expect(guest.text).toBe(words);
    expect(guest.runs(card)).toBe(false);
    expect(guest.runs({ id: "app-y", open: true })).toBe(true);
    expect(guest.runs({ id: "app-y", open: false })).toBe(false);
  });

  it("says only the server's words: none from it, no words on any card", () => {
    expect(tryFreeFor({ hosted: true, gpu: { connected: false } }, "both")).toBeNull();
    expect(tryFreeFor({ hosted: true, cardText: "", gpu: { connected: false } }, "both")).toBeNull();
    expect(tryFreeFor({ hosted: true, cardText: "Included", gpu: { connected: false } }, "both")?.text).toBe("Included");
  });
});
