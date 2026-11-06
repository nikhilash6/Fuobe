import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * fal's H3 Max lip sync, relight and insert, held to fal's own schemas (https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=
 * minimax/h3-max/lip-sync/image-to-video, …/relight, …/insert-video, read 2026-11-06): a seed inside 0–2147483647 where the
 * schema bounds it (FieldMap.seedRange), and the resolution in each endpoint's own case (lip sync and relight "768P", insert
 * "768p"). Before, a typed seed past 2147483647, a batch's seed + index past it, or "768p" on lip sync went out as given, and fal
 * answers 422 to each. Pure functions only.
 */
process.env.FUOBE_DATA_DIR = tempDir("fuobe-h3max-tools-fields-");
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { getModel, getPreset } = await import("@/lib/catalog");
const { buildPayload } = await import("@/lib/catalog/payload");
const { planGeneration, routesFor } = await import("@/lib/catalog/plan");
type Req = import("@/lib/catalog/types").GenerationRequest;

const IMG = "https://example.com/a.png";
const CLIP = "https://example.com/a.mp4";
const VOICE = "https://example.com/a.mp3";
const INPUTS: Record<string, Req["inputs"]> = {
  "minimax-h3-max-lipsync": { images: [IMG], audio: VOICE },
  "minimax-h3-max-relight": { video: CLIP, images: [IMG] },
  "minimax-h3-max-insert": { video: CLIP },
};
const FEATURE: Record<string, string> = { "minimax-h3-max-lipsync": "lipsync", "minimax-h3-max-relight": "video-tools", "minimax-h3-max-insert": "video-edit" };

/** The body the route sends for a run with these params (the server's plan; the seed as the hand-over sets it: the batch's + index). */
function body(modelId: string, params: Record<string, unknown>, seed?: number) {
  const plan = planGeneration(
    { feature: FEATURE[modelId], modelId, prompt: "", inputs: INPUTS[modelId], params: { startTime: 2, endTime: 3, sourceDuration: 8, ...params } } as Req,
    getModel,
    getPreset,
  );
  const r = routesFor(plan.model, plan.op)[0];
  return buildPayload(r.map!, { ...plan.params, prompt: plan.prompt, ...INPUTS[modelId], ...(seed !== undefined && { seed }) } as never);
}

describe("H3 Max lip sync, relight and insert: the fields as fal's schemas take them", () => {
  it("a seed stays inside 0–2147483647 on lip sync and insert: a typed seed past it, and a batch's seed + index", () => {
    for (const id of ["minimax-h3-max-lipsync", "minimax-h3-max-insert"]) {
      for (const seed of [2147483647, 2147483648, 4000000000, 9999999999]) {
        const s = body(id, {}, seed).seed as number;
        expect(Number.isInteger(s), `${id} ${seed}`).toBe(true);
        expect(s, `${id} ${seed}`).toBeGreaterThanOrEqual(0);
        expect(s, `${id} ${seed}`).toBeLessThanOrEqual(2147483647);
      }
      // A seed inside the range goes as it is.
      expect(body(id, {}, 123456789).seed).toBe(123456789);
    }
    // Relight's seed has no bounds in its schema: sent as it is.
    expect(body("minimax-h3-max-relight", {}, 9999999999).seed).toBe(9999999999);
    expect(getModel("minimax-h3-max-lipsync")!.routes[0].map!.seedRange).toEqual([0, 2147483647]);
  });

  it("the resolution goes in each endpoint's own case, whatever case an API call or Assist sends", () => {
    expect(body("minimax-h3-max-lipsync", { resolution: "768p" }).resolution).toBe("768P");
    expect(body("minimax-h3-max-lipsync", { resolution: "2k" }).resolution).toBe("2K");
    expect(body("minimax-h3-max-relight", { resolution: "1080p" }).resolution).toBe("1080P");
    expect(body("minimax-h3-max-insert", { resolution: "768P" }).resolution).toBe("768p");
    expect(body("minimax-h3-max-insert", { resolution: "480P" }).resolution).toBe("480p");
    // The composer's own values are unchanged.
    expect(body("minimax-h3-max-lipsync", { resolution: "1080P" }).resolution).toBe("1080P");
    expect(body("minimax-h3-max-insert", { resolution: "768p" }).resolution).toBe("768p");
  });
});

describe("H3 Max relight, insert and looks take no field their schema doesn't name (additionalProperties: false)", () => {
  it("an API caller's unknown params.extra key is left out; the schema's own optional fields still go", () => {
    // Relight's schema has enable_safety_checker; insert's has color_match.
    for (const [id, own] of [["minimax-h3-max-relight", "enable_safety_checker"], ["minimax-h3-max-insert", "color_match"]] as const) {
      const sent = body(id, { extra: { foo: 1, [own]: false } });
      expect(sent, id).not.toHaveProperty("foo");
      expect(sent[own], id).toBe(false);
      expect(getModel(id)!.routes[0].map!.closedFields, id).toContain(own);
    }
    const vhs = getModel("minimax-h3-max-look-vhs")!.routes[0];
    const sent = buildPayload(vhs.map!, { prompt: "a dancer", extra: { damage_level: "heavy", tape_speed: "lp" } } as never);
    expect(sent).toMatchObject({ prompt: "a dancer", damage_level: "heavy" });
    expect(sent).not.toHaveProperty("tape_speed");
  });

  it("an open schema (lip sync) still takes any key, as fal ignores it there", () => {
    expect(getModel("minimax-h3-max-lipsync")!.routes[0].map!.closedFields).toBeUndefined();
    expect(body("minimax-h3-max-lipsync", { extra: { enable_transcription: false } }).enable_transcription).toBe(false);
  });
});

describe("H3 Max Turbo from words or frames: the values fal's schemas take", () => {
  // fal's minimax/h3-max-turbo/{text,image}-to-video: resolution 480P | 768P | 1080P; aspect_ratio 21:9 … 9:16 (no "auto").
  const turbo = (op: "t2v" | "i2v", params: Record<string, unknown>) => {
    const r = getModel("minimax-h3-max-turbo")!.routes.find((x) => x.op === op)!;
    return buildPayload(r.map!, { prompt: "a slow push-in", images: op === "i2v" ? [IMG] : [], ...params } as never);
  };

  it("an API caller's 2K or 4K goes as 1080P, the largest it makes", () => {
    for (const op of ["t2v", "i2v"] as const) {
      expect(turbo(op, { resolution: "2K" }).resolution, op).toBe("1080P");
      expect(turbo(op, { resolution: "4K" }).resolution, op).toBe("1080P");
      expect(turbo(op, { resolution: "768p" }).resolution, op).toBe("768P");
    }
  });

  it("from words, a shape it doesn't take goes as the nearest it does", () => {
    expect(turbo("t2v", { aspectRatio: "2:3" }).aspect_ratio).toBe("3:4");
    expect(turbo("t2v", { aspectRatio: "21:9" }).aspect_ratio).toBe("21:9");
  });
});
