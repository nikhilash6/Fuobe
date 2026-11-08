import { describe, expect, it } from "vitest";
import { faceScore, photoBox, sampleTimes, sharpness } from "@/lib/fix-faces/face-frame";

const flat = (w: number, h: number, v = 128) => new Array(w * h).fill(v);
const checker = (w: number, h: number) => Array.from({ length: w * h }, (_, i) => ((i % w) + Math.floor(i / w)) % 2 ? 255 : 0);

describe("Fix Faces' face frame", () => {
  it("measures sharpness: a flat patch has none, fine detail has a lot", () => {
    expect(sharpness(flat(16, 16), 16, 16)).toBe(0);
    expect(sharpness(checker(16, 16), 16, 16)).toBeGreaterThan(10000);
    expect(sharpness([1, 2, 3], 3, 1)).toBe(0);
  });

  it("prefers a sure, large, sharp face that is fully in the frame", () => {
    const face = { x: 400, y: 100, width: 120, height: 150, score: 0.9 };
    const base = faceScore(face, 1024, 768, 900);
    expect(faceScore({ ...face, score: 0.5 }, 1024, 768, 900)).toBeLessThan(base);
    expect(faceScore(face, 1024, 768, 100)).toBeLessThan(base);
    expect(faceScore({ ...face, width: 40, height: 50 }, 1024, 768, 900)).toBeLessThan(base);
    expect(faceScore({ ...face, x: 0 }, 1024, 768, 900)).toBe(base / 2);
    // Larger than a quarter of the frame height earns no more.
    expect(faceScore({ ...face, height: 300 }, 1024, 768, 900)).toBe(faceScore({ ...face, height: 200 }, 1024, 768, 900));
  });

  it("cuts a square photo around the head, inside the frame", () => {
    const box = photoBox({ x: 500, y: 40, width: 60, height: 80, score: 1 }, 1024, 768);
    expect(box.size).toBe(192);
    expect(box.y).toBe(0);
    expect(box.x + box.size).toBeLessThanOrEqual(1024);
    const edge = photoBox({ x: 1000, y: 700, width: 20, height: 60, score: 1 }, 1024, 768);
    expect(edge.x + edge.size).toBe(1024);
    expect(edge.y + edge.size).toBe(768);
  });

  it("looks at moments spread over the clip, away from its ends", () => {
    const t = sampleTimes(5.17);
    expect(t).toHaveLength(16);
    expect(t[0]).toBeGreaterThan(0.25);
    expect(t[15]).toBeLessThan(5.17 - 0.25);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(sampleTimes(0)).toEqual([0]);
  });
});

describe("Fix Faces app", () => {
  it("sends Genjutsu's Finish with the Fix faces tool, the first 10 seconds, the photo and the app", async () => {
    const { fixFacesBody, FIX_FACES } = await import("@/lib/catalog/fix-faces");
    const body = fixFacesBody({ clip: { url: "/api/files/a.mp4", name: "a.mp4", duration: 14.2, width: 1920, height: 1080 }, photo: "/api/files/face.jpg", style: "mouth", requestId: "abcdefgh12" });
    expect(body).toMatchObject({
      engine: "open",
      mode: "finish",
      modelId: FIX_FACES.model,
      source: { url: "/api/files/a.mp4", duration: 14.2, width: 1920, height: 1080 },
      range: { start: 0, end: 10 },
      references: ["/api/files/face.jpg"],
      finish: { tool: "faces", faceStyle: "mouth" },
      app: "app-fix-faces",
    });
    const { GenjutsuBodySchema } = await import("@/server/genjutsu");
    expect(GenjutsuBodySchema.safeParse(body).success).toBe(true);
    // An unknown clip length leaves the range to the server.
    expect(fixFacesBody({ clip: { url: "/api/files/b.mp4" }, photo: "/api/files/f.jpg", style: "photo" })).not.toHaveProperty("range");
  });

  it("is an app with its own tool, cover and route, defaulting to Follow the mouth", async () => {
    const { getPreset } = await import("@/lib/catalog");
    const { FIX_FACES_STYLES } = await import("@/lib/catalog/fix-faces");
    const app = getPreset("app-fix-faces");
    expect(app?.type).toBe("app");
    expect(app?.tool).toBe("fix-faces");
    expect(FIX_FACES_STYLES[0].value).toBe("mouth");
    const { OPENJUTSU_LIMITS } = await import("@/lib/catalog/genjutsu");
    const { FIX_FACES } = await import("@/lib/catalog/fix-faces");
    expect(FIX_FACES.maxSeconds).toBe(OPENJUTSU_LIMITS.facesMaxSeconds);
    const { PRESET_PREVIEWS } = await import("@/lib/preset-previews.generated");
    expect(PRESET_PREVIEWS["app-fix-faces"]?.video).toMatch(/app-fix-faces\.mp4\?v=/);
  });
});

describe("the Fix faces action on a finished video", () => {
  it("opens Fix Faces with the clip, and an H3 video's start picture as the face", async () => {
    const { outputActions } = await import("@/lib/output-actions");
    const g = (over: Record<string, unknown>) =>
      ({ id: "g1", status: "succeeded", modelId: "oss-minimax-h3", engine: "open", feature: "studio", op: "i2v", prompt: "", outputs: [{ kind: "video", url: "/api/files/v.mp4" }], request: { inputs: { images: ["/api/files/start.png"] } }, ...over }) as never;
    const h3 = outputActions(g({}), 0).find((a) => a.id === "fix-faces");
    expect(h3?.href).toBe("/apps/app-fix-faces?video=%2Fapi%2Ffiles%2Fv.mp4&photo=%2Fapi%2Ffiles%2Fstart.png");
    expect(h3?.ownSetup).toBe("oss-h3-fix-faces");
    const other = outputActions(g({ modelId: "wan-2-2", request: { inputs: { images: ["/api/files/start.png"] } } }), 0).find((a) => a.id === "fix-faces");
    expect(other?.href).toBe("/apps/app-fix-faces?video=%2Fapi%2Ffiles%2Fv.mp4");
    expect(outputActions(g({ feature: "app:app-fix-faces" }), 0).some((a) => a.id === "fix-faces")).toBe(false);
  });
});
