import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * Kling 4.0 in the cloud (build package nm10-kling-4): fal's four kling/v4 endpoints (API open since round 4 held them
 * back) and Replicate's kwaivgi/kling-v4.0 for text and frames. Payloads are checked against the stored schemas
 * (docs/research/paid-model-apis-4.json, re-read 2026-11-01). No paid call is made: demo mode and pure functions only.
 */

const dir = tempDir("fuobe-kling-4-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";

const { getModel, getPreset, MODELS, modelsFor } =
  await import("@/lib/catalog");
const { buildPayload } = await import("@/lib/catalog/payload");
const { clipBilling, estimateCost, planGeneration, routesFor, wholeShots } =
  await import("@/lib/catalog/plan");
const { applyMentions, elementsNote } = await import("@/lib/catalog/elements");
const { planCinema } = await import("@/lib/catalog/cinema");
const {
  clipFpsProblem,
  clipSizeProblem,
  clipTotalProblem,
  clipWindowProblem,
  editClipsProblem,
  elementClipProblem,
} = await import("@/lib/catalog/clip-windows");
const { frameSupport } = await import("@/lib/catalog/keyframes");
const { genjutsuProblem, getMaker, makerPrompt } =
  await import("@/lib/catalog/genjutsu");
const { studioBest, clipBlocker, clipOutcome } = await import("@/lib/composer");
const { pickerPrice } = await import("@/lib/model-rows");
const { VIDEO_STUDIO } = await import("@/lib/studios");
const { modelLicence, isOffered } = await import("@/server/model-access");
const { mockProvider } = await import("@/server/providers/mock");
type Req = import("@/lib/catalog/types").GenerationRequest;
type Route = import("@/lib/catalog/types").ModelRoute;
type StudioElement = import("@/lib/catalog/elements").StudioElement;

type Spec = {
  type?: string;
  values?: unknown[];
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  required?: boolean;
  itemSchema?: Record<string, Spec>;
};
type Endpoint = {
  provider: string;
  endpoint: string;
  status: string;
  checked?: string;
  inputs: Record<string, Spec>;
  keyFields: Record<string, string>;
};
const research = (
  JSON.parse(
    fs.readFileSync("docs/research/paid-model-apis-4.json", "utf8"),
  ) as { endpoints: Endpoint[] }
).endpoints;
const schemaOf = (r: Route) =>
  research.find((e) => e.provider === r.provider && e.endpoint === r.endpoint)!;

const kling = getModel("kling-4")!;
const route = (op: string, provider = "fal") =>
  kling.routes.find((r) => r.op === op && r.provider === provider)!;

/** Every field the payload sends is one the stored schema has, with a value its enum and limits allow. */
function checkAgainstSchema(r: Route, payload: Record<string, unknown>) {
  const { inputs } = schemaOf(r);
  for (const [k, v] of Object.entries(payload)) {
    const spec = inputs[k];
    expect(spec, `${r.endpoint} has no ${k}`).toBeDefined();
    if (spec.values) expect(spec.values, `${r.endpoint} ${k}`).toContain(v);
    if (spec.type === "integer")
      expect(Number.isInteger(v), `${k} is whole`).toBe(true);
    if (typeof v === "number" && spec.minimum !== undefined)
      expect(v).toBeGreaterThanOrEqual(spec.minimum);
    if (typeof v === "number" && spec.maximum !== undefined)
      expect(v).toBeLessThanOrEqual(spec.maximum);
    if (Array.isArray(v) && spec.maxItems !== undefined)
      expect(v.length, `${k} items`).toBeLessThanOrEqual(spec.maxItems);
    if (Array.isArray(v) && spec.itemSchema)
      for (const item of v as Record<string, unknown>[])
        for (const f of Object.keys(item))
          expect(spec.itemSchema[f], `${k}.${f}`).toBeDefined();
  }
  for (const [k, spec] of Object.entries(inputs))
    if (spec.required)
      expect(payload[k], `${r.endpoint} requires ${k}`).toBeDefined();
}

/** Plan a request as the server does and build the payload its route sends. */
function payloadFor(req: Partial<Req>, provider = "fal") {
  const plan = planGeneration(
    {
      feature: "video",
      modelId: "kling-4",
      prompt: "A lighthouse keeper climbs the stairs",
      ...req,
    } as Req,
    getModel,
    getPreset,
  );
  const r = routesFor(plan.model, plan.op).find(
    (x) => x.provider === provider,
  )!;
  const payload = buildPayload(r.map!, {
    ...plan.params,
    prompt: plan.prompt,
    images: req.inputs?.images,
    endImage: req.inputs?.endImage,
    video: req.inputs?.video,
    videos: req.inputs?.videos,
  } as never);
  return { plan, route: r, payload };
}

const el = (over: Partial<StudioElement>): StudioElement => ({
  id: over.handle ?? "x",
  name: over.handle ?? "x",
  handle: "x",
  kind: "character",
  description: null,
  references: [],
  loras: [],
  status: "ready",
  createdAt: 0,
  ...over,
});

describe("research: Kling 4.0's API is open", () => {
  it("records all four fal endpoints as active on 2026-11-01, and Replicate's model", () => {
    for (const ep of [
      "text-to-video",
      "image-to-video",
      "reference-to-video",
      "video-to-video/edit",
    ]) {
      const e = research.find((x) => x.endpoint === `kling/v4/${ep}`)!;
      expect(e.status, ep).toBe("active");
      expect(e.checked, ep).toBe("2026-11-01");
    }
    const rep = research.find(
      (x) => x.endpoint === "kwaivgi/kling-v4.0" && x.provider === "replicate",
    )!;
    expect(rep.status).toBe("active");
    for (const f of Object.values(rep.keyFields))
      expect(rep.inputs[f], f).toBeDefined();
    // The edit's reference clips came after round 4.
    expect(
      research.find((x) => x.endpoint === "kling/v4/video-to-video/edit")!
        .inputs.video_urls.maxItems,
    ).toBe(4);
  });
});

describe("catalog", () => {
  it("is a closed cloud model with text, frames, references, edits and Genjutsu's swap and insert", () => {
    expect(kling.engine).toBe("cloud");
    expect(kling.badges).toEqual(expect.arrayContaining(["top", "30s"]));
    expect([...new Set(kling.routes.map((r) => r.op))].sort()).toEqual([
      "extend",
      "flf2v",
      "i2v",
      "ref2v",
      "t2v",
      "v2v",
      "video-insert",
      "video-swap",
    ]);
    // Extend Video continues a take from its last frame with Kling's own image-to-video (the Kling family's chain).
    expect(kling.routes.find((r) => r.op === "extend")?.note).toMatch(
      /last frame/,
    );
    expect(
      kling.routes
        .filter((r) => r.provider === "replicate")
        .map((r) => r.op)
        .sort(),
    ).toEqual(["flf2v", "i2v", "t2v"]);
    expect(kling.defaults).toMatchObject({ resolution: "1080p", duration: 5 });
    expect(kling.options.durations).toEqual(
      expect.arrayContaining([3, 5, 10, 15, 20, 30]),
    );
    expect(kling.options.aspectRatios).toEqual(
      expect.arrayContaining(["16:9", "9:16", "1:1", "21:9"]),
    );
    expect(kling.options.elements).toMatchObject({
      max: 7,
      views: 3,
      videos: 3,
      voices: false,
    });
  });

  it("is in the Video studio's Best list next to Seedance 2.5, on the cloud only", () => {
    const best = studioBest(
      MODELS,
      "cloud",
      VIDEO_STUDIO.defaultModels.cloud,
      VIDEO_STUDIO.ops,
    );
    expect(best.indexOf("kling-4")).toBe(best.indexOf("seedance-2-5") + 1);
    // "Open source only" lists open models: Kling 4.0 isn't one of them.
    expect(
      modelsFor({ kind: "video", ops: ["t2v"], engine: "open" }).map(
        (m) => m.id,
      ),
    ).not.toContain("kling-4");
    expect(
      modelsFor({ kind: "video", ops: ["v2v"], engine: "cloud" }).map(
        (m) => m.id,
      ),
    ).toContain("kling-4");
  });

  it("is a paid API in Settings → Models & licences, switched on", () => {
    const l = modelLicence(kling);
    expect(l.licence.class).toBe("paid-api");
    expect(l.licence.name).toMatch(/fal/);
    expect(l.licence.name).toMatch(/Replicate/);
    expect(l.licence.note).toMatch(/You pay per run/);
    expect(isOffered("kling-4", "cloud")).toBe(true);
  });

  it("takes Frames mode's first and last frame only (Frames stays on FLUX 3 Max)", () => {
    expect(frameSupport(kling)).toBe("ends");
  });
});

describe("payloads against the stored schemas", () => {
  it("text to video: 1080p by default, 21:9, whole seconds", () => {
    const { route: r, payload } = payloadFor({
      params: { aspectRatio: "21:9", duration: 12 },
    });
    expect(r.endpoint).toBe("kling/v4/text-to-video");
    expect(payload).toMatchObject({
      prompt: expect.any(String),
      aspect_ratio: "21:9",
      duration: 12,
      resolution: "1080p",
    });
    checkAgainstSchema(r, payload);
  });

  it("shots go as multi_prompt, the take as long as their sum (one 30 s call)", () => {
    const shots = [
      { prompt: "Wide: the storm rolls in", duration: 10 },
      { prompt: "Close: her hands on the rail", duration: 8 },
      { prompt: "A".repeat(700), duration: 12 },
    ];
    const { plan, route: r, payload } = payloadFor({ params: { shots } });
    expect(plan.params.duration).toBe(30);
    const sent = payload.multi_prompt as { prompt: string; duration: number }[];
    expect(sent.map((s) => s.duration)).toEqual([10, 8, 12]);
    expect(sent.reduce((n, s) => n + s.duration, 0)).toBe(payload.duration);
    expect(payload.prompt).toBeUndefined();
    // Each shot's prompt within the 512 characters the API takes.
    expect(Math.max(...sent.map((s) => s.prompt.length))).toBeLessThanOrEqual(
      512,
    );
    checkAgainstSchema(r, payload);
  });

  it("a long overall prompt never pushes a shot's own words out of its 512 characters", () => {
    const overall = `${"A slow, rain-soaked harbour at night with sodium lights. ".repeat(11)}End.`;
    expect(overall.length).toBeGreaterThan(600);
    const shots = [
      { prompt: "SHOT-ONE: wide on the pier", duration: 4 },
      { prompt: "SHOT-TWO: her hands on the rail", duration: 3 },
      { prompt: "SHOT-THREE: the ship's horn", duration: 3 },
    ];
    const { route: r, payload } = payloadFor({ prompt: overall, params: { shots } });
    const sent = payload.multi_prompt as { prompt: string }[];
    sent.forEach((s, i) => {
      expect(s.prompt.length).toBeLessThanOrEqual(512);
      // The shot's words whole, after as much of the overall description as fits.
      expect(s.prompt.endsWith(shots[i].prompt)).toBe(true);
      expect(s.prompt.startsWith("A slow, rain-soaked harbour")).toBe(true);
    });
    expect(new Set(sent.map((s) => s.prompt)).size).toBe(3);
    checkAgainstSchema(r, payload);
    // A shot that fills the 512 characters itself goes alone (cut at a word), with no overall part in front.
    const long = payloadFor({
      prompt: overall,
      params: {
        shots: [
          { prompt: `SHOT-LONG ${"word ".repeat(110)}`, duration: 5 },
          { prompt: "SHOT-SHORT", duration: 5 },
        ],
      },
    }).payload.multi_prompt as { prompt: string }[];
    expect(long[0].prompt.startsWith("SHOT-LONG")).toBe(true);
    expect(long[0].prompt.length).toBeLessThanOrEqual(512);
    expect(long[1].prompt.endsWith("SHOT-SHORT")).toBe(true);
    // A short overall prompt still leads each shot whole.
    const short = payloadFor({ prompt: "Night harbour", params: { shots } })
      .payload.multi_prompt as { prompt: string }[];
    expect(short[0].prompt).toBe("Night harbour. SHOT-ONE: wide on the pier");
  });

  it("shots in whole seconds, the total kept: priced as sent, on fal and Replicate", () => {
    expect(wholeShots([{ duration: 2.4 }, { duration: 2.4 }])).toEqual([
      { duration: 3 },
      { duration: 2 },
    ]);
    expect(
      wholeShots([{ duration: 0.2 }, { duration: 0.2 }, { duration: 5 }]),
    ).toEqual([{ duration: 1 }, { duration: 1 }, { duration: 3 }]);
    const shots = [
      { prompt: "Wide", duration: 2.4 },
      { prompt: "Close", duration: 2.4 },
    ];
    const fal = payloadFor({ params: { shots, resolution: "720p" } });
    expect(fal.plan.params.duration).toBe(5);
    expect(
      estimateCost(fal.plan.model, fal.plan.params, 1, fal.plan.op),
    ).toBeCloseTo(5 * 0.157, 5);
    const sent = fal.payload.multi_prompt as { duration: number }[];
    expect(sent.map((s) => s.duration)).toEqual([3, 2]);
    expect(fal.payload.duration).toBe(5);
    checkAgainstSchema(fal.route, fal.payload);
    // Replicate has no shots: they're written out, and the length is the same whole seconds.
    const rep = payloadFor({ params: { shots, resolution: "720p" } }, "replicate");
    expect(rep.payload.duration).toBe(5);
    expect(rep.payload.multi_prompt).toBeUndefined();
    checkAgainstSchema(rep.route, rep.payload);
    // Under 3 s in all is refused before the call (fal answers 422).
    expect(() =>
      payloadFor({
        params: {
          shots: [
            { prompt: "One", duration: 1 },
            { prompt: "Two", duration: 1 },
          ],
        },
      }),
    ).toThrow(/add up to 2s — Kling 4.0 makes 3s or more/);
    // Rounding up past 30 s is refused, not sent.
    expect(() =>
      payloadFor({
        params: {
          shots: [
            { prompt: "One", duration: 15.4 },
            { prompt: "Two", duration: 15.3 },
          ],
        },
      }),
    ).toThrow(/add up to 31s/);
  });

  it("'auto' shape goes only to reference-to-video; text runs leave it to the API's own 16:9", () => {
    const t2v = payloadFor({ params: { aspectRatio: "auto" } });
    expect(t2v.route.endpoint).toBe("kling/v4/text-to-video");
    expect(t2v.payload.aspect_ratio).toBeUndefined();
    checkAgainstSchema(t2v.route, t2v.payload);
    const rep = payloadFor({ params: { aspectRatio: "auto" } }, "replicate");
    expect(rep.payload.aspect_ratio).toBeUndefined();
    checkAgainstSchema(rep.route, rep.payload);
    // Shapes each route takes still go as they are.
    expect(
      payloadFor({ params: { aspectRatio: "9:16" } }, "replicate").payload
        .aspect_ratio,
    ).toBe("9:16");
    const ref = payloadFor({
      op: "ref2v",
      params: { aspectRatio: "auto" },
      inputs: { images: ["https://x/a.png"] },
    });
    expect(ref.route.endpoint).toBe("kling/v4/reference-to-video");
    expect(ref.payload.aspect_ratio).toBe("auto");
    checkAgainstSchema(ref.route, ref.payload);
  });

  it("start and end frames", () => {
    const { route: r, payload } = payloadFor({
      op: "flf2v",
      inputs: {
        images: ["https://x/start.png"],
        endImage: "https://x/end.png",
      },
    });
    expect(r.endpoint).toBe("kling/v4/image-to-video");
    expect(payload).toMatchObject({
      start_image_url: "https://x/start.png",
      end_image_url: "https://x/end.png",
    });
    checkAgainstSchema(r, payload);
    // Replicate takes the same run (a second provider), with its own names.
    const rep = payloadFor(
      {
        op: "flf2v",
        inputs: {
          images: ["https://x/start.png"],
          endImage: "https://x/end.png",
        },
      },
      "replicate",
    );
    expect(rep.payload).toMatchObject({
      start_image: "https://x/start.png",
      end_image: "https://x/end.png",
      resolution: "1080p",
    });
    expect(rep.payload.reference_images).toBeUndefined();
    checkAgainstSchema(rep.route, rep.payload);
  });

  it("references: images and clips, never the first reference as a start frame", () => {
    const { route: r, payload } = payloadFor({
      op: "ref2v",
      inputs: {
        images: ["https://x/a.png", "https://x/b.png"],
        videos: ["https://x/c.mp4"],
      },
    });
    expect(r.endpoint).toBe("kling/v4/reference-to-video");
    expect(payload).toMatchObject({
      image_urls: ["https://x/a.png", "https://x/b.png"],
      video_urls: ["https://x/c.mp4"],
    });
    expect(payload.start_image_url).toBeUndefined();
    checkAgainstSchema(r, payload);
  });

  it("an edit: the clip as @Video1, 4 reference clips, its own length (no duration sent)", () => {
    const videos = [
      "https://x/r1.mp4",
      "https://x/r2.mp4",
      "https://x/r3.mp4",
      "https://x/r4.mp4",
    ];
    const { route: r, payload } = payloadFor({
      feature: "video-edit",
      op: "v2v",
      prompt: "Make it snow",
      inputs: { video: "https://x/src.mp4", videos },
    });
    expect(r.endpoint).toBe("kling/v4/video-to-video/edit");
    expect(payload).toMatchObject({
      prompt: "Make it snow",
      video_url: "https://x/src.mp4",
      video_urls: videos,
      resolution: "1080p",
    });
    expect(payload.duration).toBeUndefined();
    checkAgainstSchema(r, payload);
  });

  it("7 elements: a frontal photo and up to 3 angles each, or a clip, out of the image and clip lists", () => {
    const r = route("ref2v");
    const images = Array.from({ length: 16 }, (_, i) => `https://x/i${i}.png`);
    const groups = [
      { images: [0, 1, 2, 3, 4] },
      { images: [5] },
      { video: 1 },
      { images: [6, 7] },
      { images: [8] },
      { images: [9] },
      { images: [10] },
      { images: [11] },
    ];
    const payload = buildPayload(r.map!, {
      prompt: "@Element1 meets @Element2",
      images,
      videos: ["https://x/ref.mp4", "https://x/el.mp4"],
      elements: groups,
    });
    const list = payload.elements as Record<string, unknown>[];
    expect(list).toHaveLength(7);
    expect(list[0]).toEqual({
      frontal_image_url: images[0],
      reference_image_urls: [images[1], images[2], images[3]],
    });
    expect(list[1]).toEqual({ frontal_image_url: images[5] });
    expect(list[2]).toEqual({ video_url: "https://x/el.mp4" });
    // The images and clip the elements took leave their lists; the rest keep their order (@Image1.., @Video1..).
    // The eighth group is past the 7 the API takes: its photo stays a reference image.
    expect(payload.image_urls).toEqual([images[4], ...images.slice(11)]);
    expect(payload.video_urls).toEqual(["https://x/ref.mp4"]);
    checkAgainstSchema(r, payload);
  });
});

describe("@mentions become Kling elements", () => {
  const maya = el({
    id: "m",
    name: "Maya",
    handle: "Maya",
    kind: "character",
    references: ["/api/files/m1.png", "/api/files/m2.png", "/api/files/m3.png"],
  });
  const cup = el({
    id: "c",
    name: "Cup",
    handle: "Cup",
    kind: "prop",
    references: ["/api/files/cup.mp4"],
  });
  const bay = el({
    id: "b",
    name: "Bay",
    handle: "Bay",
    kind: "location",
    references: ["/api/files/bay.png"],
  });

  it("characters and props as @Element1.. (a clip as a video element), locations as reference images", () => {
    const req = {
      feature: "video",
      modelId: "kling-4",
      prompt: "@Maya drinks from @Cup on @Bay",
      params: {},
    } as Req;
    const { request, notes } = applyMentions(req, kling, [maya, cup, bay]);
    expect(request.op).toBe("ref2v");
    expect(request.prompt).toMatch(/^@Element1 drinks from @Element2 on Bay/);
    expect(request.prompt).toMatch(/Bay is the location in image 1/);
    expect(request.inputs?.images).toEqual([
      "/api/files/bay.png",
      ...maya.references,
    ]);
    expect(request.inputs?.videos).toEqual(["/api/files/cup.mp4"]);
    expect(request.params?.elements).toEqual([
      { images: [1, 2, 3] },
      { video: 0 },
    ]);
    expect(notes).toEqual([]);
    const payload = buildPayload(route("ref2v").map!, {
      prompt: request.prompt,
      images: request.inputs!.images,
      videos: request.inputs!.videos,
      elements: request.params!.elements,
    });
    expect(payload.image_urls).toEqual(["/api/files/bay.png"]);
    expect(payload.elements).toEqual([
      {
        frontal_image_url: maya.references[0],
        reference_image_urls: maya.references.slice(1),
      },
      { video_url: "/api/files/cup.mp4" },
    ]);
  });

  it("in an edit, the mention goes as an element of the edit", () => {
    const req = {
      feature: "video-edit",
      modelId: "kling-4",
      op: "v2v",
      prompt: "Replace the man with @Maya",
      inputs: { video: "/api/files/src.mp4" },
    } as Req;
    const { request } = applyMentions(req, kling, [maya]);
    expect(request.op).toBe("v2v");
    expect(request.prompt).toBe("Replace the man with @Element1");
    expect(request.params?.elements).toEqual([{ images: [0, 1, 2] }]);
  });

  it("says voices aren't sent yet", () => {
    expect(elementsNote(kling)).toMatch(/voices aren't used/);
    expect(elementsNote(getModel("kling-3"))).toBeUndefined();
  });
});

describe("price", () => {
  it("text and frames: per output second by resolution (5 s at 720p = $0.785)", () => {
    expect(
      estimateCost(kling, { duration: 5, resolution: "720p" }, 1, "t2v"),
    ).toBe(0.785);
    expect(estimateCost(kling, { duration: 5 }, 1, "t2v")).toBe(1.175);
  });

  it("an edit bills max(input + output, 2x output) seconds at the clip rate", () => {
    // A 10 s clip at 1080p: 10 in + 10 out = 20 billed at $0.141.
    expect(clipBilling(kling, { sourceDuration: 10 }, "v2v")).toMatchObject({
      input: 10,
      output: 10,
      billed: 20,
      rate: 0.141,
    });
    expect(estimateCost(kling, { sourceDuration: 10 }, 1, "v2v")).toBe(2.82);
    expect(
      estimateCost(
        kling,
        { sourceDuration: 10, resolution: "720p" },
        1,
        "video-swap",
      ),
    ).toBe(1.88);
  });

  it("reference clips: input plus output, at least twice the output; their length unknown until read", () => {
    // 4 s of clips with a 10 s take: 14 < 20, so twice the output.
    expect(
      estimateCost(
        kling,
        { duration: 10, resolution: "720p", clipSeconds: 4 },
        1,
        "ref2v",
      ),
    ).toBe(1.88);
    // 15 s of clips: 25 s billed.
    expect(
      estimateCost(
        kling,
        { duration: 10, resolution: "720p", clipSeconds: 15 },
        1,
        "ref2v",
      ),
    ).toBe(2.35);
    // Reference images alone are the plain rate.
    expect(
      estimateCost(kling, { duration: 10, resolution: "720p" }, 1, "ref2v"),
    ).toBe(1.57);
    // The planner marks a run with clips, so its estimate is never the plain rate.
    const plan = planGeneration(
      {
        feature: "video",
        modelId: "kling-4",
        op: "ref2v",
        prompt: "x",
        inputs: { videos: ["/api/files/r.mp4"] },
        params: { duration: 10, resolution: "720p" },
      } as Req,
      getModel,
      getPreset,
    );
    expect(plan.params.clipSeconds).toBe(0);
    expect(estimateCost(plan.model, plan.params, 1, plan.op)).toBe(1.88);
  });

  it("Edit video shows the edit's rate in the picker and what's billed before the total", () => {
    expect(pickerPrice(kling, 0)).toBe("$0.235/sec");
    expect(pickerPrice(kling, 0, true)).toBe("$0.141/sec in+out");
    expect(
      clipOutcome(
        "v2v",
        { duration: 10, width: 1920, height: 1080 },
        {},
        kling,
      ),
    ).toBe("10 s in + 10 s out: billed on 20 s at $0.141/s");
  });
});

describe("limits checked before a paid call", () => {
  it("a clip edit takes 3–30 s, 700–4553 px a side, 30 s of clips in all", () => {
    expect(clipWindowProblem(kling, 31)).toMatch(/3–30 s/);
    expect(clipWindowProblem(kling, 30.03)).toBeNull();
    expect(clipSizeProblem(kling, 640, 360)).toMatch(/700 px/);
    expect(clipSizeProblem(kling, 1920, 1080)).toBeNull();
    expect(
      clipBlocker(
        "v2v",
        { duration: 12, width: 640, height: 360 },
        {},
        kling,
        undefined,
      ),
    ).toMatch(/700 px/);
    expect(clipTotalProblem(kling, 34)).toMatch(/30 s of clips in all/);
    expect(clipTotalProblem(kling, 30)).toBeNull();
  });
});

describe("the hosted API's other limits, in Fuobe's words before the call", () => {
  it("an edit's clip: shape 0.40–2.50 and 24–60 fps", () => {
    expect(clipSizeProblem(kling, 3000, 700)).toMatch(/crop it first/);
    expect(clipSizeProblem(kling, 720, 1920)).toMatch(/crop it first/);
    expect(clipSizeProblem(kling, 1080, 1920)).toBeNull();
    expect(clipSizeProblem(kling, 2500, 1000)).toBeNull();
    expect(clipFpsProblem(kling, 15)).toMatch(/24–60 fps.*save it at 24 fps/);
    expect(clipFpsProblem(kling, 120)).toMatch(/save it at 60 fps/);
    expect(clipFpsProblem(kling, 23.976)).toBeNull();
    expect(clipFpsProblem(kling, 60)).toBeNull();
    expect(
      clipBlocker(
        "v2v",
        { duration: 12, width: 1920, height: 1080, fps: 120 },
        {},
        kling,
        undefined,
      ),
    ).toMatch(/fps/);
    // Other models aren't held to Kling 4.0's limits: O3's edit takes its own 23–60 fps (fal's x-fal on video_url).
    const o3 = getModel("kling-o3-4k-edit") ?? { id: "x", name: "X" };
    expect(clipFpsProblem(o3, 23)).toBeNull();
    expect(clipFpsProblem(o3, 120)).toMatch(/23–60 fps/);
  });

  it("a clip element is 3–8 s", () => {
    expect(elementClipProblem(kling, 10, "Maya")).toMatch(
      /3–8 s clips as elements, and Maya's is 10 s/,
    );
    expect(elementClipProblem(kling, 2)).toMatch(/3–8 s/);
    expect(elementClipProblem(kling, 5)).toBeNull();
  });

  it("an edit takes up to 4 reference clips beside the clip it edits (clip elements apart)", () => {
    expect(editClipsProblem(kling, 5)).toMatch(/up to 4 reference clips/);
    expect(editClipsProblem(kling, 4)).toBeNull();
    const five = Array.from({ length: 5 }, (_, i) => `https://x/r${i}.mp4`);
    const edit = (params?: Req["params"]) =>
      payloadFor({
        feature: "video-edit",
        op: "v2v",
        prompt: "Make it snow",
        inputs: { video: "https://x/src.mp4", videos: five },
        params,
      });
    expect(() => edit()).toThrow(/up to 4 reference clips.*has 5: remove 1/);
    // One of the five is a clip element: four references left.
    expect(() => edit({ elements: [{ video: 4 }] })).not.toThrow();
  });
});

describe("Cinema Studio", () => {
  const SETTINGS = {} as Parameters<typeof planCinema>[0]["settings"];
  it("a 30 s multi-shot take is one Kling 4.0 call, with no extend", () => {
    const shots = [
      { prompt: "The keeper lights the lamp", duration: 12 },
      { prompt: "The beam sweeps the bay", duration: 10 },
      { prompt: "A ship turns toward the light", duration: 8 },
    ];
    const plan = planCinema(
      {
        engine: "cloud",
        mode: "video",
        action: "generate",
        modelId: "kling-4",
        prompt: "A storm at night",
        settings: SETTINGS,
        duration: 30,
        batch: 1,
        multiShot: { mode: "manual", shots },
      },
      { cloudAllowed: true },
    );
    expect(plan.model.id).toBe("kling-4");
    expect(plan.steps).toHaveLength(1);
    const req = plan.steps[0].request;
    expect(req.params?.shots?.map((s) => s.duration)).toEqual([12, 10, 8]);
    const planned = planGeneration(req, getModel, getPreset);
    expect(planned.params.duration).toBe(30);
    const r = routesFor(planned.model, planned.op).find(
      (x) => x.provider === "fal",
    )!;
    const payload = buildPayload(r.map!, {
      ...planned.params,
      prompt: planned.prompt,
    });
    expect((payload.multi_prompt as unknown[]).length).toBe(3);
    expect(payload.duration).toBe(30);
    expect(plan.costUsd).toBeCloseTo(30 * 0.235, 3);
  });

  it("any whole second from 3 to 30 for a single take", () => {
    const plan = planCinema(
      {
        engine: "cloud",
        mode: "video",
        action: "generate",
        modelId: "kling-4",
        prompt: "x",
        settings: SETTINGS,
        duration: 25,
        batch: 1,
      },
      { cloudAllowed: true },
    );
    expect(plan.steps[0].request.params?.duration).toBe(25);
    expect(plan.notes.join(" ")).not.toMatch(/makes \d+s clips/);
  });
});

describe("Genjutsu", () => {
  it("offers Kling 4.0's edit for Object swap and Insert, with @Video1 and @Image tags and its own limits", () => {
    const m = getMaker("kling-4", "cloud")!;
    expect(m.modes).toEqual(["swap", "insert"]);
    expect(
      makerPrompt({ mode: "swap", maker: m, subject: "the red car", refs: 2 }),
    ).toMatch(/^Replace the red car in @Video1 with @Image1, @Image2/);
    expect(
      makerPrompt({
        mode: "insert",
        maker: m,
        refs: 1,
        prompt: "on the table",
      }),
    ).toMatch(/^Add @Image1 to @Video1: on the table/);
    const check = {
      mode: "swap" as const,
      maker: m,
      references: 1,
      subject: "the car",
      target: "type" as const,
      range: { start: 0, end: 10 },
    };
    expect(
      genjutsuProblem({
        ...check,
        source: {
          url: "/api/files/s.mp4",
          duration: 10,
          width: 640,
          height: 360,
        },
      } as never),
    ).toMatch(/700 px/);
    expect(
      genjutsuProblem({
        ...check,
        source: {
          url: "/api/files/s.mp4",
          duration: 10,
          width: 1920,
          height: 1080,
        },
      } as never),
    ).toBeNull();
  });
});

describe("demo mode", () => {
  it("the mock provider makes a placeholder clip for every route, with no key", async () => {
    for (const r of kling.routes) {
      const sub = await mockProvider.submit({
        generationId: "g",
        model: kling,
        route: r,
        input: { prompt: "x", images: ["a.png"], video: "v.mp4", duration: 5 },
      });
      const res = await mockProvider.poll({
        externalId: sub.externalId,
        meta: { ...sub.meta, startedAt: 0 },
        route: r,
        model: kling,
        createdAt: 0,
      });
      if (res.state !== "succeeded") throw new Error(`${r.op}: ${res.state}`);
      expect(res.outputs[0].kind, r.op).toBe("video");
    }
  });
});
