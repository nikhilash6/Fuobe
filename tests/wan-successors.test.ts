import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel, MODELS } from "@/lib/catalog";
import { MOTION_MODELS } from "@/lib/av/katana";
import { onEngine } from "@/lib/catalog/engines";
import { chooseMaker, getMaker, makersFor, MAKERS, ORIGINALS, planGenjutsu, type GenjutsuPlanInput, type Maker } from "@/lib/catalog/genjutsu";
import { isHostedUntested } from "@/lib/catalog/hosted-untested";
import { fitLoras } from "@/lib/catalog/loras";
import { buildPayload } from "@/lib/catalog/payload";
import { estimateCost } from "@/lib/catalog/plan";
import { currentModelId, migrateRequest, replacementOf } from "@/lib/catalog/replaced";
import { WAN_VACE_ENDS } from "@/lib/catalog/shorts";
import type { LoraRef, ModelRoute } from "@/lib/catalog/types";

/*
 * fal removes its Wan 2.1 / 2.2 line on 2027-01-04 and names a successor on each endpoint's page: Wan 2.7 text to image
 * for Wan 2.2 A14B stills, MiniMax H3 Max Recast for Wan 2.2 Animate (move and replace), H3 Max Reframe for Wan VACE
 * reframe. Wan VACE's masked inpainting and depth routes have no successor that does the same job: they stay, and say
 * when they end before a run.
 */

const ROOT = path.resolve(__dirname, "..");
const falSchema = (endpoint: string) => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/provider-schemas/fal", `${endpoint.replaceAll("/", "__")}.json`), "utf8"));
  const ref: string = doc.paths[`/${endpoint}`].post.requestBody.content["application/json"].schema.$ref;
  return doc.components.schemas[ref.split("/").pop()!] as { properties: Record<string, { enum?: string[]; anyOf?: { enum?: string[] }[] }>; required: string[] };
};
const liveSchema = (endpoint: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/provider-schemas/fal/live-routes.json"), "utf8")).endpoints[endpoint].input as {
    properties: Record<string, { enum?: string[] }>;
    required: string[];
  };

const cloudRoute = (id: string, op: string): ModelRoute => {
  const m = getModel(id)!;
  const r = onEngine(m, "cloud").routes.find((x) => x.op === op && x.provider !== "comfyui");
  if (!r) throw new Error(`${id} has no cloud ${op} route`);
  return r;
};

/** fal-ai/wan/v2.2-14b/animate, fal-ai/wan-vace-14b/reframe and fal-ai/wan/v2.2-a14b/text-to-image, as any route names them. */
const MOVED = /^fal-ai\/(wan\/v2\.2-14b\/animate\/|wan-vace-14b\/reframe|wan\/v2\.2-a14b\/text-to-image)/;

describe("the routes fal names a successor for", () => {
  it("no model calls Wan 2.2 Animate, Wan VACE reframe or Wan 2.2 A14B stills any more", () => {
    const left = MODELS.flatMap((m) => m.routes.filter((r) => MOVED.test(r.endpoint) || MOVED.test(r.loraEndpoint ?? "")).map((r) => `${m.id} ${r.op} ${r.endpoint}`));
    expect(left).toEqual([]);
  });

  it("Wan 2.2 A14B Image's hosted route is Wan 2.7 text to image, named as such, at fal's $0.03 an image", () => {
    const m = getModel("wan-2-2-a14b-image-cloud")!;
    const r = cloudRoute(m.id, "t2i");
    expect(r).toMatchObject({ provider: "fal", endpoint: "fal-ai/wan/v2.7/text-to-image" });
    expect(r.loraEndpoint).toBeUndefined();
    expect(m.name).toContain("Wan 2.7");
    expect(r.note).toMatch(/Wan 2\.7.*no LoRAs/);
    expect(m.pricing).toMatchObject({ unit: "image", usd: 0.03 });
    expect(estimateCost(m, { aspectRatio: "16:9" }, 1, "t2i")).toBeCloseTo(0.03, 5);
    // Never sent with a real key yet: an account runs it on its own fal.ai key until a live call passes.
    expect(isHostedUntested(m.id, r)).toBe(true);
  });

  it("its requests fit fal's saved Wan 2.7 schema for every shape the composer offers", () => {
    const schema = falSchema("fal-ai/wan/v2.7/text-to-image");
    const r = cloudRoute("wan-2-2-a14b-image-cloud", "t2i");
    const sizes = schema.properties.image_size.anyOf!.flatMap((a) => a.enum ?? []);
    for (const aspectRatio of getModel("wan-2-2-a14b-image-cloud")!.options.aspectRatios!) {
      const p = buildPayload(r.map!, { prompt: "a red coat on a city street", aspectRatio, negativePrompt: "blur", seed: 7, numOutputs: 2 });
      for (const k of Object.keys(p)) expect(Object.keys(schema.properties), `${aspectRatio}: ${k}`).toContain(k);
      expect(sizes).toContain(p.image_size);
      expect(p).toMatchObject({ prompt: "a red coat on a city street", negative_prompt: "blur", seed: 7, num_images: 2 });
      expect(p).not.toHaveProperty("loras");
    }
  });

  it("a run's LoRAs are left out on Wan 2.7, with the reason", () => {
    const lora: LoraRef = { file: "wan-style.safetensors", name: "Wan style", url: "https://example.com/wan-style.safetensors", strength: 0.8 } as LoraRef;
    const fit = fitLoras([lora], cloudRoute("wan-2-2-a14b-image-cloud", "t2i"));
    expect(fit.loras).toEqual([]);
    expect(fit.notes.join(" ")).toMatch(/takes no LoRAs in the cloud/);
  });

  it("Genjutsu's motion transfer runs on H3 Max Recast in the cloud, the open graph as it was", () => {
    const schema = liveSchema("minimax/h3-max/recast");
    for (const [id, res] of [
      [ORIGINALS.motion, "1080P"],
      [ORIGINALS.motionLite, "768P"],
    ] as const) {
      const m = getModel(id)!;
      const r = cloudRoute(id, "motion-transfer");
      expect(r.endpoint).toBe("minimax/h3-max/recast");
      const p = buildPayload(r.map!, { video: "https://x/clip.mp4", images: ["https://x/hero.png"], resolution: onEngine(m, "cloud").defaults?.resolution });
      expect(p).toMatchObject({ video_url: "https://x/clip.mp4", reference_image_urls: ["https://x/hero.png"], resolution: res });
      for (const k of Object.keys(p)) expect(Object.keys(schema.properties), k).toContain(k);
      expect(schema.properties.resolution.enum).toContain(p.resolution);
      // No words: Recast finds the person itself.
      expect(p).not.toHaveProperty("prompt");
      // The GPU half is Wan Animate 2, unchanged.
      expect(onEngine(m, "open").routes.map((x) => `${x.provider}:${x.endpoint}`)).toEqual(["comfyui:wan-animate2"]);
    }
  });

  it("Genjutsu cuts the cloud motion into 5–15 s pieces and keeps Recast's own sound", () => {
    const clip = { url: "/api/files/clip.mp4", duration: 40, fps: 30, width: 1280, height: 720, hasAudio: true };
    const plan = (maker: Maker, end: number) =>
      planGenjutsu({ engine: "cloud", mode: "motion", title: "Genjutsu", source: clip, range: { start: 0, end }, quality: "1080p", references: ["/api/files/hero.png"], maker } as GenjutsuPlanInput);
    const full = getMaker(ORIGINALS.motion, "cloud")!;
    expect(full).toMatchObject({ minSeconds: 5, maxSeconds: 15, keepsSound: true, qualities: ["768p", "1080p"] });
    expect(full.billFps).toBeUndefined();
    const one = plan(full, 12);
    const make = one.steps.filter((s) => s.request.modelId === ORIGINALS.motion);
    expect(make).toHaveLength(1);
    expect(make[0].request).toMatchObject({ op: "motion-transfer", inputs: { images: ["/api/files/hero.png"] }, params: { resolution: "1080p" } });
    const long = plan(full, 30).steps.filter((s) => s.request.modelId === ORIGINALS.motion);
    expect(long.length).toBeGreaterThanOrEqual(2);
    expect(getMaker(ORIGINALS.motionLite, "cloud")).toMatchObject({ qualities: ["768p"], keepsSound: true });
  });

  it("Katana's cloud motion segments start at Recast's 5 s", () => {
    expect(MOTION_MODELS.cloud.find((m) => m.id === ORIGINALS.motion)).toMatchObject({ min: 5 });
    expect(MOTION_MODELS.open.find((m) => m.id === ORIGINALS.motion)).toMatchObject({ min: 1, max: 5 });
  });

  it("stored Wan 2.2 Animate Replace and Wan VACE Reframe runs open on fal's named successors", () => {
    const replace = ["wan", "22", "animate", "replace"].join("-");
    const reframe = ["wan", "vace", "reframe"].join("-");
    expect(getModel(replace)).toBeUndefined();
    expect(getModel(reframe)).toBeUndefined();
    expect(currentModelId(replace)).toBe("h3-max-recast");
    expect(currentModelId(reframe)).toBe("minimax-h3-max-reframe");
    expect(replacementOf(replace, "video-swap")).toMatchObject({ id: "h3-max-recast", original: false });
    const moved = migrateRequest({ modelId: reframe, op: "reframe" as const, inputs: { videos: ["/api/files/c.mp4"] } });
    expect(moved.request.modelId).toBe("minimax-h3-max-reframe");
    expect(moved.note).toMatch(/H3 Max Reframe/);
    expect(chooseMaker({ engine: "cloud", mode: "character", modelId: replace })).toMatchObject({ maker: { id: "h3-max-recast" } });
    // H3 Max Reframe takes what the old route's reframe sent: the clip and the new shape.
    const r = cloudRoute("minimax-h3-max-reframe", "reframe");
    const p = buildPayload(r.map!, { video: "https://x/clip.mp4", aspectRatio: "9:16", resolution: "768p" });
    expect(p).toMatchObject({ video_url: "https://x/clip.mp4", aspect_ratio: "9:16" });
    expect(liveSchema("minimax/h3-max/reframe-video").properties.aspect_ratio.enum).toContain(p.aspect_ratio);
  });
});

describe("the Wan VACE routes with no successor that does the same job", () => {
  const KEPT: [string, string][] = [
    ["fuobe-genjutsu-swap", "video-swap"],
    ["fuobe-genjutsu-swap-lite", "video-swap"],
    ["fuobe-genjutsu-restyle", "v2v"],
    ["fuobe-shorts", "v2v"],
    ["fuobe-evolution", "v2v"],
    ["wan-22-vace-inpaint", "remove-object"],
    ["wan-22-vace-inpaint", "video-swap"],
    ["wan-22-vace-inpaint", "video-insert"],
  ];

  it("stay on Wan VACE and say when it ends", () => {
    for (const [id, op] of KEPT) {
      const r = cloudRoute(id, op);
      expect(r.endpoint, id).toMatch(/^fal-ai\/wan-(22-)?vace/);
      expect(r.note, `${id} ${op}`).toBe(WAN_VACE_ENDS);
    }
    expect(getModel("wan-22-vace-inpaint")!.tagline).toContain(WAN_VACE_ENDS);
  });

  it("say so in Genjutsu's picker before a run", () => {
    const cloudVace = MAKERS.filter((m) => m.engine === "cloud" && m.window);
    expect(cloudVace.map((m) => m.id).sort()).toEqual(["fuobe-genjutsu-restyle", "fuobe-genjutsu-swap", "fuobe-genjutsu-swap-lite", "wan-22-vace-inpaint"]);
    for (const m of cloudVace) expect(m.note, m.id).toContain(WAN_VACE_ENDS);
    // The open engine's makers don't: their graphs run on your GPU.
    for (const m of MAKERS.filter((x) => x.engine === "open")) expect(m.note, m.id).not.toContain(WAN_VACE_ENDS);
    expect(makersFor("cloud", "motion").every((m) => !m.note.includes(WAN_VACE_ENDS))).toBe(true);
  });
});
