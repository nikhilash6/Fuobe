import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { applyMentions, findMentions, handleFor, mentionAtCaret, type StudioElement } from "@/lib/catalog/elements";
import { planGeneration } from "@/lib/catalog/plan";

const el = (over: Partial<StudioElement>): StudioElement => ({
  id: over.handle ?? "x",
  name: "Maya",
  handle: "Maya",
  kind: "character",
  description: null,
  references: ["/api/files/a.png", "/api/files/b.png", "/api/files/c.png", "/api/files/d.png"],
  loras: [],
  status: "ready",
  createdAt: 0,
  ...over,
});

const maya = el({});
const bar = el({ name: "Rooftop bar", handle: "Rooftop_bar", kind: "location", references: ["/api/files/bar.png"] });

describe("handles and mentions", () => {
  it("builds handles from names", () => {
    expect(handleFor("Maya Lopez")).toBe("Maya_Lopez");
    expect(handleFor("  Café #1 ")).toBe("Café_1");
  });
  it("finds known mentions once, case-insensitively", () => {
    expect(findMentions("@maya at @Rooftop_bar with @Maya and @nobody", [maya, bar]).map((e) => e.handle)).toEqual(["Maya", "Rooftop_bar"]);
  });
  it("detects the mention being typed", () => {
    expect(mentionAtCaret("hello @Ma", 9)).toEqual({ start: 6, query: "Ma" });
    expect(mentionAtCaret("mail@x", 6)).toBeNull();
    expect(mentionAtCaret("@", 1)).toEqual({ start: 0, query: "" });
  });
});

describe("applyMentions", () => {
  it("attaches references to an image edit model and explains which image is which", () => {
    const nb = getModel("nano-banana-pro")!;
    const { request, notes } = applyMentions({ feature: "image", modelId: nb.id, prompt: "@Maya sipping coffee at @Rooftop_bar" }, nb, [maya, bar]);
    expect(request.inputs?.images?.length).toBe(4);
    expect(request.prompt).toContain("Maya sipping coffee at Rooftop bar");
    expect(request.prompt).toContain("Maya is the person in images 1, 2 and 3");
    expect(request.prompt).toContain("Rooftop bar is the location in image 4");
    expect(notes).toEqual([]);
    expect(planGeneration(request, getModel, getPreset).op).toBe("edit");
  });

  it("switches video models with reference support to reference-to-video", () => {
    const m = getModel("seedance-2-5")!;
    expect(m.routes.some((r) => r.op === "ref2v")).toBe(true);
    const { request } = applyMentions({ feature: "video", modelId: m.id, prompt: "@Maya dances" }, m, [maya]);
    expect(request.op).toBe("ref2v");
    expect(planGeneration(request, getModel, getPreset).op).toBe("ref2v");
  });

  it("falls back to the description when the model can't take references", () => {
    const m = getModel("kling-2-5-turbo")!;
    const described = el({ description: "short copper hair, freckles." });
    const { request, notes } = applyMentions({ feature: "video", modelId: m.id, prompt: "@Maya runs" }, m, [described]);
    expect(request.inputs?.images).toBeUndefined();
    expect(request.prompt).toBe("Maya (short copper hair, freckles) runs");
    expect(notes[0]).toMatch(/described in words/);
  });

  it("uses a trained LoRA instead of references on the model it was trained for", () => {
    const m = getModel("oss-z-image-turbo")!;
    const trained = el({ loras: [{ engine: "open", modelId: m.id, file: "maya.safetensors", trigger: "mya woman" }] });
    const { request } = applyMentions({ feature: "image", modelId: m.id, prompt: "@Maya on a beach" }, m, [trained]);
    expect(request.loras).toEqual([{ file: "maya.safetensors", url: undefined, strength: 1, trigger: "mya woman" }]);
    expect(request.prompt).toBe("mya woman Maya on a beach");
    expect(planGeneration(request, getModel, getPreset).loras.map((l) => l.file)).toEqual(["maya.safetensors"]);
  });

  it("asked without LoRAs (Run without LoRAs): a trained element goes in as its photos, and the request carries none", () => {
    const m = getModel("oss-z-image-turbo")!;
    const trained = el({ loras: [{ engine: "open", modelId: m.id, file: "maya.safetensors", trigger: "mya woman" }] });
    const { request } = applyMentions({ feature: "image", modelId: m.id, prompt: "@Maya on a beach", lorasOff: true }, m, [trained]);
    expect(request.loras).toBeUndefined();
    const own = applyMentions({ feature: "image", modelId: m.id, prompt: "a beach", lorasOff: true, loras: [{ file: "x.safetensors" }] }, m, [trained]).request;
    expect(own.loras).toBeUndefined();
  });

  it("leaves requests without mentions untouched", () => {
    const nb = getModel("nano-banana-pro")!;
    const req = { feature: "image", modelId: nb.id, prompt: "email me@example.com" };
    expect(applyMentions(req, nb, [maya]).request).toBe(req);
  });
});
