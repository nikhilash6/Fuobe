import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { planGeneration } from "@/lib/catalog/plan";
import type { GenerationRequest } from "@/lib/catalog/types";
import { framePrompt, heuristicScenes, parseScenes, planStoryboard, STORYBOARD_MODELS } from "@/lib/catalog/storyboard";

const plan = (r: GenerationRequest) => planGeneration(r, getModel, getPreset);
const graph = (r: GenerationRequest) => { const p = plan(r); return p.model.routes.find((x) => x.op === p.op)!.endpoint; };

describe("storyboard", () => {
  it("parses LLM answers as a JSON array or a numbered list", () => {
    expect(parseScenes('Sure! ["a girl waits at a bus stop", "the bus arrives", "she boards"]', 3)).toEqual(["a girl waits at a bus stop", "the bus arrives", "she boards"]);
    expect(parseScenes("1. A girl waits at the stop\n2. Headlights wash over her\n3. She boards the bus", 2)).toEqual(["A girl waits at the stop", "Headlights wash over her"]);
    expect(parseScenes("no", 3)).toBeNull();
  });

  it("falls back to a shot list offline", () => {
    const s = heuristicScenes("a heist in Paris.", 3);
    expect(s).toHaveLength(3);
    expect(s[0]).toBe("establishing wide shot: a heist in Paris — beat 1 of 3");
  });

  it("tells chained frames which image is the previous one", () => {
    expect(framePrompt("the bus arrives", 1, { refs: 2, chainFrom: "last" })).toMatch(/Image 3 is the previous frame/);
    expect(framePrompt("the bus arrives", 1, { refs: 1, chainFrom: "first" })).toBe("Next Scene: the bus arrives.");
    expect(framePrompt("a girl waits", 0, { refs: 1, chainFrom: "last", style: "35mm film" })).toBe(
      "Frame 1 of a storyboard: a girl waits. Use the reference image for the characters and look. Style: 35mm film. Cinematic still, consistent production design.",
    );
  });

  it("uses edit-capable models for follow-up frames on both engines", () => {
    for (const m of Object.values(STORYBOARD_MODELS)) {
      expect(getModel(m.next)?.routes.some((r) => r.op === "edit")).toBe(true);
      expect(getModel(m.first)?.routes.some((r) => r.op === "t2i")).toBe(true);
      expect(getModel(m.firstWithRefs)?.routes.some((r) => r.op === "edit")).toBe(true);
    }
  });

  it("makes frame 1 on Qwen-Image 2.1 on your GPU (text to image, or an edit of up to 4 references); the next frames and the cloud stay", () => {
    expect(STORYBOARD_MODELS.open).toMatchObject({ first: "oss-qwen-image-21", firstWithRefs: "oss-qwen-image-21", next: "oss-qwen-next-scene", chainFrom: "first" });
    expect(STORYBOARD_MODELS.cloud).toMatchObject({ first: "z-image-turbo-cloud", firstWithRefs: "qwen-image-edit-2511-cloud", next: "qwen-image-edit-2509-cloud" });
    const scenes = ["a girl waits at a bus stop", "the bus arrives"];
    const plain = planStoryboard({ engine: "open", scenes, aspectRatio: "21:9", resolution: "1K" });
    expect(plain[0]).toMatchObject({ modelId: "oss-qwen-image-21", params: { aspectRatio: "21:9", resolution: "1K" } });
    expect(plain[0].inputs).toBeUndefined();
    expect(graph(plain[0])).toBe("qwen-image-21-t2i");
    expect(plain[1].modelId).toBe("oss-qwen-next-scene");
    const refs = ["/api/files/a.png", "/api/files/b.png", "/api/files/c.png", "/api/files/d.png", "/api/files/e.png"];
    const withRefs = planStoryboard({ engine: "open", scenes, references: refs });
    expect(withRefs[0]).toMatchObject({ modelId: "oss-qwen-image-21", inputs: { images: refs.slice(0, 4) } });
    expect(graph(withRefs[0])).toBe("qwen-image-21-edit");
  });
});
