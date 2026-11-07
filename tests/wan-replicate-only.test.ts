import { describe, expect, it } from "vitest";
import { getModel, PRESETS } from "@/lib/catalog";
import { onEngine } from "@/lib/catalog/engines";
import { LORA_LIBRARY, MOTION_EFFECT_LORAS } from "@/lib/catalog/lora-library.generated";
import { fitLoras, routeLoraField } from "@/lib/catalog/loras";
import { buildPayload } from "@/lib/catalog/payload";
import { estimateCost, mixLimit, mixLoras, presetRoute } from "@/lib/catalog/plan";
import type { LoraRef, Preset } from "@/lib/catalog/types";

/*
 * fal removes its Wan 2.2 A14B endpoints on 2027-01-04: Wan 2.2 A14B (hosted) and Fuobe DoP's cloud half run on
 * Replicate's fast Wan 2.2 alone, one LoRA per expert. A Mix whose second preset has no expert left can't join in the
 * cloud (the composer shows it as unavailable, with "Use it on your GPU"); on the GPU every LoRA loads.
 */
const FAL_WAN22 = /^fal-ai\/wan\/v2\.2-a14b\//;

describe("Wan 2.2 A14B (hosted) and Fuobe DoP in the cloud", () => {
  it("run on Replicate's fast Wan 2.2 only, with the start and end frames, the GPU graphs as they were", () => {
    const wan = getModel("wan-2-2-a14b-cloud")!;
    expect(wan.routes.map((r) => `${r.op} ${r.provider}:${r.endpoint}`)).toEqual([
      "t2v replicate:wan-video/wan-2.2-t2v-fast",
      "i2v replicate:wan-video/wan-2.2-i2v-fast",
      "flf2v replicate:wan-video/wan-2.2-i2v-fast",
    ]);
    const dop = getModel("fuobe-dop")!;
    expect(onEngine(dop, "cloud").routes.map((r) => `${r.op} ${r.provider}:${r.endpoint}`)).toEqual(["i2v replicate:wan-video/wan-2.2-i2v-fast", "flf2v replicate:wan-video/wan-2.2-i2v-fast"]);
    expect(onEngine(dop, "open").routes.map((r) => r.endpoint)).toEqual(expect.arrayContaining(["wan22-i2v-14b", "wan22-flf2v-14b"]));
    for (const m of [wan, dop]) {
      expect(m.routes.some((r) => FAL_WAN22.test(r.endpoint) || FAL_WAN22.test(r.loraEndpoint ?? ""))).toBe(false);
      for (const r of onEngine(m, "cloud").routes) expect(routeLoraField(r)?.shape, `${m.id} ${r.op}`).toBe("experts");
    }
    // A transition's end frame goes as last_image.
    const flf = onEngine(dop, "cloud").routes.find((r) => r.op === "flf2v")!;
    expect(buildPayload(flf.map!, { prompt: "p", images: ["https://x/a.png"], endImage: "https://x/b.png", duration: 5 })).toMatchObject({ image: "https://x/a.png", last_image: "https://x/b.png", num_frames: 81 });
  });

  it("are priced per clip at Replicate's rate", () => {
    const dop = onEngine(getModel("fuobe-dop")!, "cloud");
    expect(dop.pricing).toMatchObject({ unit: "video", usd: 0.11, byResolution: { "720p": 0.11, "480p": 0.05 } });
    expect(estimateCost(dop, { resolution: "480p", duration: 3 }, 1, "i2v")).toBeCloseTo(0.05, 6);
    expect(estimateCost(getModel("wan-2-2-a14b-cloud")!, { resolution: "720p", duration: 5 }, 1, "t2v")).toBeCloseTo(0.11, 6);
  });
});

describe("a Mix on one LoRA per expert", () => {
  const dop = getModel("fuobe-dop")!;
  const highOnly = (p: Preset) => {
    const r = presetRoute(p, "cloud");
    return r?.modelId === "fuobe-dop" && !!r.loras?.length && r.loras.every((l) => l.target === "high");
  };
  const highs = PRESETS.filter((p) => (p.type === "motion" || p.type === "effect") && highOnly(p));

  it("a second preset whose LoRA needs the expert the first holds can't join in the cloud, and says why", () => {
    expect(highs.length).toBeGreaterThanOrEqual(2);
    const [a, b] = highs;
    const why = mixLimit(dop, "cloud", "i2v", a, b);
    expect(why).toBe(`Fuobe DoP in the cloud takes one LoRA per expert (high and low noise), so ${b.name} can't join ${a.name} there`);
    // On the GPU every LoRA loads.
    expect(mixLimit(dop, "open", "i2v", a, b)).toBeUndefined();
    // The run itself: the second LoRA is left out with the reason, never sent.
    const loras: LoraRef[] = [...(presetRoute(a, "cloud")!.loras ?? []), ...mixLoras(b, dop.id, "cloud", 0.6).loras];
    const route = onEngine(dop, "cloud").routes.find((r) => r.op === "i2v")!;
    const fit = fitLoras(loras.map((l) => ({ ...l, url: l.url ?? "https://example.com/x.safetensors" })), route);
    expect(fit.notes.join(" ")).toMatch(/one LoRA per expert/);
  });

  it("a second preset on the other expert joins", () => {
    const low = PRESETS.find((p) => {
      const r = presetRoute(p, "cloud");
      return (p.type === "motion" || p.type === "effect") && r?.modelId === "fuobe-dop" && !!r.loras?.length && r.loras.every((l) => l.target === "low");
    });
    if (low) expect(mixLimit(dop, "cloud", "i2v", highs[0], low)).toBeUndefined();
  });
});

describe("the LoRA library's hosted routes", () => {
  it("name the routes that run them now, not fal's retired Wan 2.2 or Wan Animate", () => {
    const texts = [...LORA_LIBRARY.map((l) => l.hostedEndpoint ?? ""), ...MOTION_EFFECT_LORAS.map((m) => m.hostedEndpoint ?? "")];
    expect(texts.filter((t) => /fal-ai\/wan\/v2\.2-(a14b|14b\/animate)|fal-ai\/wan-t2v-lora/.test(t))).toEqual([]);
    expect(texts.some((t) => t.includes("wan-video/wan-2.2-i2v-fast"))).toBe(true);
  });
});
