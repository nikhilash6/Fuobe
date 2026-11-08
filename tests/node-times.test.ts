import { describe, expect, it } from "vitest";
import { cleanNodeTimes, NODE_TIMES, NodeClock } from "@/lib/node-times";

describe("node times", () => {
  it("times each node from its start to the next, with the time before its first step", () => {
    const c = new NodeClock();
    c.executing("11", 0); // text encoder
    c.executing("3", 4_000); // sampler: loads its model, then 6 steps
    c.progress("3", 6, 54_000);
    c.progress("3", 6, 60_000);
    c.executing("8", 86_000); // decode
    c.executing(null, 89_000);
    const graph = { "3": { class_type: "KSampler" }, "8": { class_type: "VAEDecode" }, "11": { class_type: "CLIPTextEncode" } };
    expect(c.times(graph)).toEqual([
      { node: "3", type: "KSampler", ms: 82_000, beforeStepsMs: 50_000, steps: 6 },
      { node: "11", type: "CLIPTextEncode", ms: 4_000 },
      { node: "8", type: "VAEDecode", ms: 3_000 },
    ]);
  });

  it("ends the last node with the prompt, adds up a node that runs twice, and leaves out the quick ones", () => {
    const c = new NodeClock();
    c.executing("5", 0);
    c.executing("6", 10);
    c.executing("5", 1_010);
    c.end(2_010);
    expect(c.times()).toEqual([
      { node: "5", ms: 1_010 },
      { node: "6", ms: 1_000 },
    ]);
  });

  it("keeps at most the slowest few; a step before any node, or after the end, counts for none", () => {
    const c = new NodeClock();
    c.progress("1", 4, 0);
    for (let i = 0; i < 20; i++) c.executing(String(i), i * 1_000 + i * i);
    c.end(30_000);
    c.progress("19", 4, 30_001);
    const t = c.times();
    expect(t).toHaveLength(NODE_TIMES.most);
    expect(t[0].node).toBe("19");
    expect(t.every((n) => n.steps === undefined)).toBe(true);
  });

  it("cleans what a report or the database holds", () => {
    expect(cleanNodeTimes(undefined)).toBeUndefined();
    expect(cleanNodeTimes([{ node: "3", ms: 5 }, { node: "../x", ms: 1 }, { node: "4", ms: -1 }, { node: "5", type: "<b>", ms: 2.6, beforeStepsMs: 9, steps: 1.5 }])).toEqual([
      { node: "3", ms: 5 },
      { node: "5", ms: 3, beforeStepsMs: 3 },
    ]);
    expect(cleanNodeTimes([{ node: "3", type: "KSampler", ms: 9e9, steps: 6 }], 60_000)).toEqual([{ node: "3", type: "KSampler", ms: 60_000, steps: 6 }]);
    expect(cleanNodeTimes(Array.from({ length: 40 }, (_, i) => ({ node: String(i), ms: i })))).toHaveLength(NODE_TIMES.most);
  });
});
