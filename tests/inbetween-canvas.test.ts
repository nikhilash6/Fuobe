import { describe, expect, it } from "vitest";
import { CANVAS_TEMPLATES, planCanvas, rowsFeeding, timingFromTable } from "@/lib/catalog/canvas";

// Canvas: "Keyframes → animation", keyframe images and a table of their gaps into one In-between node.
const build = (engine: "open" | "cloud") => {
  const g = CANVAS_TEMPLATES.find((t) => t.id === "keyframes-animation")!.build(engine);
  for (const [i, n] of g.nodes.filter((x) => x.type === "image-input").entries()) n.data.url = `/api/files/u/key${i + 1}.png`;
  return g;
};

describe("Keyframes → animation on the Canvas", () => {
  it("reads the table as each gap's timing and makes one animation, not a run per row", () => {
    const g = build("open");
    const plan = planCanvas(g, { engineMode: "open" });
    expect(plan.errors).toEqual([]);
    expect(plan.steps).toHaveLength(1);
    const r = plan.steps[0].request;
    expect(r).toMatchObject({ modelId: "fuobe-animation", engine: "open", op: "keyframes", inputs: { images: ["/api/files/u/key1.png", "/api/files/u/key2.png", "/api/files/u/key3.png"] } });
    expect(r.params?.extra?.inbetween).toEqual({ gaps: [{ frames: 37, speed: 1, prompt: "she turns toward us" }, { frames: 17, speed: 3, prompt: "she waves" }], fps: 24 });
    expect(r.params?.extra?.stillMouth).toBe(true);
    expect(r.params?.keyframeTimes).toEqual([0, 1.5, 1.75]);
    expect(r.prompt).toBe("A character animation, clean lines");
    expect(plan.costUsd).toBe(0);
    expect(rowsFeeding(g, g.nodes.find((n) => n.id === "out")!)).toBeNull();
  });

  it("asks for one row per gap, and fits the speeds to the cloud", () => {
    const g = build("open");
    g.nodes.find((n) => n.id === "timing")!.data.rows = [["37", "1", ""]];
    expect(planCanvas(g, { engineMode: "open" }).errors[0].message).toMatch(/one row per gap/);
    const cloud = planCanvas(build("cloud"), { engineMode: "cloud" });
    expect(cloud.errors).toEqual([]);
    expect(cloud.steps[0].request.params?.extra?.inbetween).toMatchObject({ gaps: [{ frames: 37, speed: 1 }, { frames: 17, speed: 1 }], fps: 16 });
  });

  it("finds the columns by name", () => {
    expect(timingFromTable({ data: { columns: ["Words", "Length", "Every"], rows: [["jump", "21", "×2"]] } })).toEqual({ gaps: [{ frames: 21, speed: 2, prompt: "jump" }] });
  });
});
