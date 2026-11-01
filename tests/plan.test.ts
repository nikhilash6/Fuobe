import { describe, expect, it } from "vitest";
import { getModel, getPreset, PRESETS } from "@/lib/catalog";
import { onEngine } from "@/lib/catalog/engines";
import { composePrompt, estimateCost, inferOperation, missingInputs, planGeneration } from "@/lib/catalog/plan";

describe("inferOperation", () => {
  const veo = getModel("veo-3-1")!;
  it("picks the video operation from attachments", () => {
    expect(inferOperation(veo, {})).toBe("t2v");
    expect(inferOperation(veo, { inputs: { images: ["a"] } })).toBe("i2v");
    expect(inferOperation(veo, { inputs: { images: ["a"], endImage: "b" } })).toBe("flf2v");
  });
  it("switches image models to edit when an image is attached", () => {
    const nb = getModel("nano-banana-pro")!;
    expect(inferOperation(nb, {})).toBe("t2i");
    expect(inferOperation(nb, { inputs: { images: ["a"] } })).toBe("edit");
  });
});

describe("composePrompt", () => {
  it("fills prompt and option placeholders and tidies punctuation", () => {
    const preset = { options: [{ key: "style", label: "Style", choices: [{ value: "anime", label: "Anime", prompt: "an anime frame" }] }] };
    expect(composePrompt("Redraw as {option:style}. {prompt}.", "", preset, {})).toBe("Redraw as an anime frame.");
    expect(composePrompt("{prompt}. Slow dolly in", "  a cat ", null, undefined)).toBe("a cat. Slow dolly in");
  });
});

describe("planGeneration", () => {
  it("splits batches for models that can't batch", () => {
    const plan = planGeneration({ feature: "video", modelId: "kling-2-5-turbo", prompt: "x", params: { numOutputs: 3 } }, getModel, getPreset);
    expect(plan.jobs).toBe(3);
    expect(plan.perJobOutputs).toBe(1);
  });

  it("keeps native batching for image models", () => {
    const plan = planGeneration({ feature: "image", modelId: "nano-banana-pro", prompt: "x", params: { numOutputs: 4 } }, getModel, getPreset);
    expect(plan.jobs).toBe(1);
    expect(plan.params.numOutputs).toBe(4);
  });

  it("applies motion presets to any video model, LoRAs only to the preset's own model", () => {
    const preset = getPreset("motion-crash-zoom-in")!;
    const plan = planGeneration({ feature: "video", presetId: preset.id, modelId: "veo-3-1", prompt: "a man", inputs: { images: ["a"] } }, getModel, getPreset);
    expect(plan.op).toBe("i2v");
    expect(plan.prompt).toMatch(/^a man\. .*crash zoom/i);
    expect(plan.loras).toEqual([]);
  });

  it("explains missing inputs", () => {
    expect(() => planGeneration({ feature: "edit", modelId: "nano-banana-pro", op: "edit", prompt: "x" }, getModel, getPreset)).toThrow(/Add an image/);
    expect(missingInputs("lipsync", { inputs: { video: "v" } })).toMatch(/voice/);
    expect(missingInputs("i2v", { inputs: { images: ["a"] } })).toBeNull();
  });

  it("requires a prompt for text-to-X", () => {
    expect(() => planGeneration({ feature: "image", modelId: "nano-banana-pro" }, getModel, getPreset)).toThrow(/prompt/);
  });
});

describe("a preset on the model its preview was made with, or on its own", () => {
  const open = (id: string) => (getModel(id) ? onEngine(getModel(id)!, "open") : undefined);
  const run = (presetId: string, modelId: string, extra: Partial<Parameters<typeof planGeneration>[0]> = {}) =>
    planGeneration({ feature: "app", presetId, modelId, prompt: "", inputs: { images: ["a.png", "b.png"] }, ...extra }, open, getPreset);

  it("runs an app on its recipe and on its own route, and refuses any other model naming both", () => {
    expect(run("app-headshot-generator", "oss-qwen-image-21-turbo").model.id).toBe("oss-qwen-image-21-turbo");
    expect(run("app-headshot-generator", "oss-qwen-image-21").model.id).toBe("oss-qwen-image-21");
    expect(() => run("app-headshot-generator", "oss-krea2-edit")).toThrow("Headshot Generator runs on oss-qwen-image-21-turbo or oss-qwen-image-21, not oss-krea2-edit");
  });

  it("uses the matched route's operation and words", () => {
    const qwen = run("app-face-swap", "oss-qwen-image-21-turbo");
    expect(qwen.op).toBe("edit");
    expect(qwen.prompt).toMatch(/^Replace the face of the person in <image1> with the face of the person in <image2>/);
    const reactor = run("app-face-swap", "oss-reactor");
    expect(reactor.op).toBe("face-swap");
    // A two-image app's words name its pictures as the encoder does, on the Turbo only.
    expect(run("app-character-swap", "oss-qwen-image-21-turbo").prompt).toMatch(/<image1>.*<image2>|<image2>.*<image1>/);
    expect(run("app-character-swap", "oss-qwen-image-21").prompt).toMatch(/the first image/);
    // Specialist options fill in; the recipe's full words replace the old prefix.
    expect(run("app-relight", "oss-qwen-image-21-turbo", { presetOptions: { light: "neon-night", dir: "left" } }).prompt).toMatch(/^Relight <image1> with pink and blue neon lights at night coming from the left/);
  });

  it("gives an H3 run its Quality, orbit and length", () => {
    const one = { inputs: { images: ["a.png"] } };
    const truck = run("motion-truck-left", "oss-minimax-h3", one);
    expect(truck.op).toBe("i2v");
    expect(truck.params).toMatchObject({ duration: 5 });
    expect(truck.params.extra?.quality).toBeUndefined();
    expect(truck.loras).toEqual([]);
    // Quality is a control the composer shows: it starts at the route's Best and sends it; Auto sends none, which is
    // H3's default (Fast), even on a preset made at Best.
    expect(run("motion-crash-zoom-in", "oss-minimax-h3", { ...one, params: { extra: { quality: "best" } } }).params.extra).toMatchObject({ quality: "best" });
    expect(run("motion-crash-zoom-in", "oss-minimax-h3", { ...one, params: { extra: { quality: "fast" } } }).params.extra).toMatchObject({ quality: "fast" });
    expect(run("motion-crash-zoom-in", "oss-minimax-h3", one).params.extra?.quality).toBeUndefined();
    // The composer sends the Quality it shows; the route's orbit stays under it.
    const orbit = run("motion-360-orbit", "oss-minimax-h3", { ...one, prompt: "a dancer mid-leap", params: { duration: 3, extra: { quality: "fast" } } });
    expect(orbit.params).toMatchObject({ duration: 3, extra: { orbit: true, quality: "fast" } });
    expect(orbit.prompt).toMatch(/^One frozen instant\. Only the camera moves\. In a continuous 360 orbit\..* a dancer mid-leap$/);
    // Hosted H3: 5 s, the orbit's words, no LoRA.
    const hosted = planGeneration({ feature: "motion", presetId: "motion-360-orbit", modelId: "minimax-h3", prompt: "", ...one }, getModel, getPreset);
    expect(hosted.params.duration).toBe(5);
    expect(hosted.prompt).toMatch(/^One frozen instant/);
    // Fuobe DoP picked: its LoRAs and trigger, as before.
    const jib = getPreset("motion-jib-up")!;
    const dop = run("motion-jib-up", "fuobe-dop", one);
    expect(dop.loras.map((l) => l.file)).toEqual((jib.open!.loras ?? []).map((l) => l.file));
  });

  it("runs AI Influencer on its GPU model on the open engine, and refuses the cloud's Original there", () => {
    const plan = planGeneration({ feature: "app", presetId: "app-ai-influencer", modelId: "oss-zimage-soul-cast", prompt: "a surfer from Lisbon" }, open, getPreset);
    expect(plan.model.id).toBe("oss-zimage-soul-cast");
    expect(() => planGeneration({ feature: "app", presetId: "app-ai-influencer", modelId: "fuobe-soul", prompt: "a surfer from Lisbon" }, open, getPreset)).toThrow(
      /runs on oss-zimage-soul-cast, not fuobe-soul/,
    );
  });
});

describe("estimateCost", () => {
  it("prices per image, per second and free for open models", () => {
    expect(estimateCost(getModel("nano-banana-pro")!, { numOutputs: 2 })).toBeCloseTo(0.3);
    expect(estimateCost(getModel("kling-2-5-turbo")!, { duration: 10 })).toBeCloseTo(0.7);
    expect(estimateCost(getModel("oss-wan22-14b")!, {})).toBe(0);
  });
});

describe("motion mix", () => {
  const base = { feature: "motion", presetId: "motion-crash-zoom-in", prompt: "a boxer in the ring" };
  it("adds the second preset's words, worded by strength", () => {
    const strong = planGeneration({ ...base, modelId: "kling-2-5-turbo", inputs: { images: ["a.png"] }, mix: { presetId: "motion-handheld", strength: 0.9 } }, getModel, getPreset);
    expect(strong.prompt).toMatch(/^a boxer in the ring\. .+ At the same time: /);
    const faint = planGeneration({ ...base, modelId: "kling-2-5-turbo", inputs: { images: ["a.png"] }, mix: { presetId: "motion-handheld", strength: 0.2 } }, getModel, getPreset);
    expect(faint.prompt).toMatch(/With a slight hint of this: /);
    expect(() => planGeneration({ ...base, modelId: "kling-2-5-turbo", inputs: { images: ["a.png"] }, mix: { presetId: "app-relight", strength: 0.5 } }, getModel, getPreset)).toThrow(/camera motion or effect/);
  });

  it("stacks LoRAs on the open model, scaled by each strength", () => {
    const withLora = PRESETS.filter((p) => /motion|effect/.test(p.type) && p.open?.modelId === "fuobe-dop" && p.open.loras?.length);
    const a = withLora[0];
    // A second preset with other files (presets that share a LoRA, like Handheld and Documentary Snap, stack it once).
    const b = withLora.find((p) => p.open!.loras!.every((l) => !a.open!.loras!.some((x) => x.file === l.file)))!;
    const open = (id: string) => (id === "fuobe-dop" ? onEngine(getModel(id)!, "open") : getModel(id));
    const plan = planGeneration(
      { feature: "motion", presetId: a.id, modelId: "fuobe-dop", prompt: "x", inputs: { images: ["a.png"] }, presetStrength: 0.5, mix: { presetId: b.id, strength: 0.5 } },
      open,
      getPreset,
    );
    expect(plan.loras).toHaveLength(a.open!.loras!.length + b.open!.loras!.length);
    expect(plan.loras[0].strength).toBeCloseTo((a.open!.loras![0].strength ?? 1) * 0.5);
    expect(plan.loras.at(-1)!.strength).toBeCloseTo((b.open!.loras!.at(-1)!.strength ?? 1) * 0.5);
  });
});
