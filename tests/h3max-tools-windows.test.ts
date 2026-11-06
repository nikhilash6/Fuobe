import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * fal's H3 Max insert and lip sync, held to fal's own limits (https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=
 * minimax/h3-max/insert-video and …/lip-sync/image-to-video, read 2026-11-06): insert's duration is 5–13 s ("minimum": 5,
 * "maximum": 13), and lip sync's audio_url is "at least 5 seconds long". Before, an API call or Assist could send a 15 s or 4 s
 * moment, and a voice a few hundredths under 5 s passed; fal answers 422 to each. Pure functions only.
 */
process.env.FUOBE_DATA_DIR = tempDir("fuobe-h3max-tools-windows-");
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { getModel, getPreset } = await import("@/lib/catalog");
const { buildPayload } = await import("@/lib/catalog/payload");
const { planGeneration, routesFor } = await import("@/lib/catalog/plan");
const { voiceWindowProblem } = await import("@/lib/catalog/clip-windows");
type Req = import("@/lib/catalog/types").GenerationRequest;

const CLIP = "https://example.com/a.mp4";

function insertBody(duration: number) {
  const plan = planGeneration(
    { feature: "video-edit", modelId: "minimax-h3-max-insert", prompt: "", inputs: { video: CLIP }, params: { startTime: 2, endTime: 3, sourceDuration: 8, duration } } as Req,
    getModel,
    getPreset,
  );
  return buildPayload(routesFor(plan.model, plan.op)[0].map!, { ...plan.params, prompt: plan.prompt, video: CLIP } as never);
}

describe("H3 Max insert and lip sync: the lengths fal takes", () => {
  it("an inserted moment is 5–13 s: a longer or shorter one is refused before it's sent", () => {
    expect(() => insertBody(15)).toThrow("MiniMax H3 Max Insert a moment makes a new moment of 5–13 s, and this run asks for 15 s: pick a length in that range");
    expect(() => insertBody(4)).toThrow(/5–13 s/);
    for (const d of [5, 7.5, 13]) expect(insertBody(d).duration).toBe(d);
  });

  it("a voice under 5 s is refused, a header a few hundredths short too", () => {
    const lip = getModel("minimax-h3-max-lipsync")!;
    expect(voiceWindowProblem(lip, 4.99)).toBe("MiniMax H3 Max Lip Sync · up to 15 min needs at least 5 s of audio, and this is 4.99 s: use a longer recording");
    expect(voiceWindowProblem(lip, 3)).toMatch(/at least 5 s of audio, and this is 3 s/);
    expect(voiceWindowProblem(lip, 5)).toBeNull();
    expect(voiceWindowProblem(lip, 900)).toBeNull();
  });
});
