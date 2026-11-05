import { describe, expect, it } from "vitest";
import { getModel, PRESETS } from "@/lib/catalog";
import { ownSetupOnly } from "@/lib/own-setup";
import { modelOwnSetup, poolOwnSetup, poolRulesOf, poolRunsModel, presetOwnSetup } from "@/lib/pool-rules";
import { poolRunState, type HostedCheck } from "@/lib/hosted";
import { needsGpu, poolOwnSetups, requestOwnSetup, requestSetupIds } from "@/server/pool-own-setup";
import { loadIndex } from "@/server/gpu/index-file";

/**
 * What runs on a visitor's own setup only, as the hosted runs see it: the static items a request asks for (a model, or a
 * mode or option of it), the open models this install's GPUs can't run right now (in the "own setup" shape), and how the
 * pickers and Run read both.
 */
const H3 = "oss-minimax-h3";
const comfyEndpoint = (id: string) => getModel(id)!.routes.find((r) => r.provider === "comfyui")!.endpoint;

describe("a request's own setup", () => {
  it("is asked by its model, then by the modes and options of it that have an id of their own", () => {
    expect(requestSetupIds({ feature: "image", modelId: "oss-z-image-turbo", op: "t2i", params: {} })).toEqual(["oss-z-image-turbo"]);
    expect(requestSetupIds({ feature: "video", modelId: H3, op: "t2v", params: { resolution: "2K" } })).toContain("regenerate:h3-2k");
    expect(requestSetupIds({ feature: "video", modelId: H3, op: "t2v", params: { resolution: "768p" } })).not.toContain("regenerate:h3-2k");
    expect(requestSetupIds({ feature: "video", modelId: "oss-kandinsky6", op: "t2v", params: { extra: { quality: "pro" } } })).toContain("oss-kandinsky6:pro");
  });

  it("is the first static item it asks for, or none", () => {
    expect(requestOwnSetup({ feature: "image", modelId: "oss-z-image-turbo", op: "t2i", params: {}, engine: "open" })).toBeNull();
    expect(requestOwnSetup({ feature: "video", modelId: H3, op: "t2v", params: { resolution: "2K" }, engine: "open" })).toEqual(ownSetupOnly("regenerate:h3-2k"));
    expect(requestOwnSetup({ feature: "video", modelId: "oss-h3-regenerate", op: "upscale-video", params: {}, engine: "open" })).toEqual(ownSetupOnly("oss-h3-regenerate"));
  });
});

describe("the open models this install's GPUs can't run right now", () => {
  it("names each with a GPU of the visitor's own, and the memory its workflow needs when the index says", () => {
    const off = comfyEndpoint("oss-z-image-turbo");
    const out = poolOwnSetups(
      (e) => e !== off,
      (id) => id === H3,
    );
    expect(out["oss-z-image-turbo"]).toMatchObject({ need: "gpu" });
    const gb = loadIndex().workflows[off]?.vramGb;
    if (typeof gb === "number" && gb > 0) expect(out["oss-z-image-turbo"]).toEqual({ need: "gpu", vramGb: Math.ceil(gb) });
    // A card that can't run it: a GPU of its own, whatever the memory.
    expect(out[H3]).toEqual({ need: "gpu" });
    // Everything else runs there.
    expect(out["oss-wan22-14b"]).toBeUndefined();
    expect(poolOwnSetups(() => true, () => false)).toEqual({});
  });

  it("needsGpu names the memory only when the index has it", () => {
    expect(needsGpu()).toEqual({ need: "gpu" });
    expect(needsGpu("no-such-workflow")).toEqual({ need: "gpu" });
  });
});

describe("the pickers' labels", () => {
  const own = { "oss-z-image-turbo": { need: "gpu" as const, vramGb: 12 } };

  it("a model these GPUs can't run is kept off with what runs it; a denied model needs any GPU of its own", () => {
    const rules = poolRulesOf({ pool: { deny: ["oss-wan22-14b"] } }, [], own)!;
    expect(rules.own).toEqual(own);
    expect(poolRunsModel(rules, { id: "oss-z-image-turbo", kind: "image", engine: "open" })).toBe(false);
    expect(poolOwnSetup(rules, { id: "oss-z-image-turbo", kind: "image", engine: "open" })).toEqual(own["oss-z-image-turbo"]);
    expect(poolOwnSetup(rules, { id: "oss-wan22-14b", kind: "video", engine: "open" })).toEqual({ need: "gpu" });
    expect(poolOwnSetup(rules, { id: "oss-flux3-klein", kind: "image", engine: "open" })).toBeNull();
    // A cloud model is the visitor's own key's: these rules have no say.
    expect(poolOwnSetup(rules, { id: "oss-z-image-turbo", kind: "image", engine: "cloud" })).toBeNull();
    // No rules (hosted runs off, or an account with its own GPU): no label.
    expect(poolOwnSetup(undefined, { id: "oss-z-image-turbo", kind: "image", engine: "open" })).toBeNull();
  });

  it("the static items come first", () => {
    expect(modelOwnSetup(undefined, { id: "oss-h3-regenerate", kind: "video", engine: "open" })).toEqual(ownSetupOnly("oss-h3-regenerate"));
    expect(modelOwnSetup(poolRulesOf({}, [], own), { id: "oss-z-image-turbo", kind: "image", engine: "open" })).toEqual(own["oss-z-image-turbo"]);
  });

  it("a preset kept off says what its open model needs; one that runs there has no label", () => {
    const preset = PRESETS.find((p) => p.open?.modelId === "oss-z-image-turbo");
    if (!preset) return;
    const rules = poolRulesOf({}, [{ id: preset.id, model: { id: "oss-z-image-turbo", kind: "image" } }], own);
    expect(presetOwnSetup(rules, preset)).toEqual(own["oss-z-image-turbo"]);
    expect(presetOwnSetup(undefined, preset)).toBeNull();
  });

  it("Run opens the own setup a price check names instead of staying off", () => {
    const setup = { need: "gpu" as const, vramGb: 48 };
    const check = { quote: { allowed: false, amount: 0, priceVersion: "", text: "Runs on your own GPU · 48 GB", code: "not-offered", ownSetup: setup } } as unknown as HostedCheck;
    expect(poolRunState(check)).toMatchObject({ refused: true, setup });
    const plain = { quote: { allowed: false, amount: 0, priceVersion: "", text: "Busy", code: "busy" } } as unknown as HostedCheck;
    expect(poolRunState(plain)?.setup).toBeUndefined();
  });
});
