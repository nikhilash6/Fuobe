import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { planGeneration } from "@/lib/catalog/plan";
import { oneEachCall, opTakes, routeDrops, settingUnavailable, takesFromMap } from "@/lib/catalog/route-takes";
import type { ModelDef } from "@/lib/catalog/types";
import { settingsShape } from "@/lib/composer";
import { slimModel } from "@/lib/studio-catalog";

/**
 * The composer's settings follow what the run's routes send: a setting no route sends isn't offered, and a value no
 * route takes stays in view, muted, with why and the closest one it does. The browser reads the same summary
 * (route.takes, kept by slimModel) as the server reads from the field maps.
 */
const model = (id: string) => {
  const m = getModel(id);
  if (!m) throw new Error(`no ${id}`);
  return m;
};

describe("what a route sends", () => {
  it("reads the same in the browser as on the server", () => {
    for (const id of ["kling-4", "vidu-q4", "nano-banana-pro", "kling-o3", "wan-2-2-a14b-cloud"]) {
      const full = model(id);
      const slim = slimModel(full);
      for (const op of new Set(full.routes.map((r) => r.op))) expect(opTakes(slim, op)).toEqual(opTakes(full, op));
    }
  });

  it("takes everything on a GPU graph or a route Fuobe sizes itself", () => {
    expect(takesFromMap({ op: "t2i", provider: "comfyui", map: {} }, "oss-x")).toBeUndefined();
    expect(takesFromMap({ op: "t2i", provider: "fal", map: { seed: "seed" } }, "fuobe-soul")).toBeUndefined();
  });

  it("has nothing to pick for a setting no route of the operation sends", () => {
    const o3 = model("kling-o3");
    const v2v = settingsShape(slimModel(o3), "v2v", "video", true);
    // Kling O3's video edit keeps the clip's shape and length.
    expect(v2v.aspect).toBeNull();
    expect(v2v.duration).toBeNull();
  });

  it("says a ratio a route doesn't take is unavailable, with the closest it does", () => {
    const k4 = model("kling-4");
    const takes = opTakes(k4, "t2v");
    expect(takes.aspectRatios).not.toContain("auto");
    const auto = settingUnavailable(k4, "t2v", "aspect", "auto", takes);
    expect(auto?.why).toMatch(/Auto keeps a start frame's shape/);
    expect(auto?.instead).toBeDefined();
    expect(settingUnavailable(k4, "t2v", "aspect", "16:9", takes)).toBeUndefined();
  });

  it("fits a size to the closest one taken", () => {
    const takes = { aspect: true, resolution: true, duration: true, seed: true, negativePrompt: true, audio: true, resolutions: ["480p", "720p"], durations: [5, 10] };
    const m = { name: "Wan" } as Pick<ModelDef, "name">;
    expect(settingUnavailable(m, "t2v", "resolution", "580p", takes)).toEqual({ why: "Wan doesn't make 580p from words alone", instead: "480p" });
    expect(settingUnavailable(m, "i2v", "duration", 15, takes)).toEqual({ why: "Wan makes 5s or 10s clips from a start frame", instead: 10 });
    expect(settingUnavailable(m, "i2v", "duration", 10, takes)).toBeUndefined();
  });

  it("knows a sound switch and a seed the route doesn't send", () => {
    const vidu = model("vidu-q4");
    expect(opTakes(vidu, "i2v").audio).toBe(false);
    expect(opTakes(vidu, "ref2v").audio).toBe(true);
    expect(opTakes(model("seedance-2-5"), "t2v").seed).toBe(false);
  });
});

describe("several results from a route with no count field", () => {
  it("runs one job a result", () => {
    // Ideogram's vectorizer lists 4 results, and its route makes one a call.
    const z = model("ideogram-vector");
    expect(oneEachCall(z, "vectorize")).toBe(true);
    const plan = planGeneration({ feature: "image", modelId: z.id, op: "vectorize", prompt: "", inputs: { images: ["https://example.com/a.png"] }, params: { numOutputs: 3 } }, getModel, getPreset);
    expect(plan.jobs).toBe(3);
    expect(plan.perJobOutputs).toBe(1);
  });

  it("keeps one call where every route takes a count", () => {
    const m = MODELS.find((x) => x.engine === "cloud" && (x.options.maxOutputs ?? 1) > 1 && x.routes.some((r) => r.op === "t2i") && x.routes.filter((r) => r.op === "t2i").every((r) => r.map?.numOutputs));
    if (!m) throw new Error("no such model");
    expect(oneEachCall(m, "t2i")).toBe(false);
    const plan = planGeneration({ feature: "image", modelId: m.id, prompt: "a red chair in a white room", params: { numOutputs: 2 } }, getModel, getPreset);
    expect(plan.jobs).toBe(1);
  });

  it("names the settings the route a run goes to has no field for", () => {
    const nb = model("nano-banana-pro");
    const rep = nb.routes.find((r) => r.provider === "replicate" && r.op === "t2i")!;
    const fal = nb.routes.find((r) => r.provider === "fal" && r.op === "t2i")!;
    expect(routeDrops(rep, nb.id, { params: { seed: 7 } })).toEqual(["a seed"]);
    expect(routeDrops(fal, nb.id, { params: { seed: 7 } })).toEqual([]);
    expect(routeDrops(rep, nb.id, { params: {} })).toEqual([]);
    expect(routeDrops(rep, nb.id, { params: { numOutputs: 3 } })).toEqual(["a number of results"]);
  });
});
