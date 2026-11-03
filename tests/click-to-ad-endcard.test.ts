import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/catalog/marketing";
import { tempDir } from "./helpers/temp-dir";

// Click to Ad's animated end card: the rendered clip replaces the still and its push-in, the joins stay. Cloud: the
// clip gets its silent track (mux) and merge-videos joins it after the ad. Open: one join that keeps the ad's sound,
// with the ad put first by the chain. Still: exactly the steps it had before.

vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-c2a-motion-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const mk = await import("@/server/marketing");
const { withChainInputs } = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { endCardSteps } = await import("@/lib/catalog/marketing");

beforeAll(() => setSetting("demoMode", "auto"));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 7)]);
const upload = (name = "p.png") => saveFile({ data: PNG, contentType: "image/png", name, source: "upload" }).url;
const product = (): Product => ({ id: "p1", brandId: null, name: "Barrier Cream", sellingPoints: ["Calms red skin overnight"], images: [upload()], createdAt: 0, updatedAt: 0 });
const SCRIPT = "Okay so this cream fixed my skin in a week and I am not even joking about it at all honestly.";
const base = { ad: "captions", feature: "click-to-ad", title: "Clean Minimal · Barrier Cream", aspectRatio: "9:16", resolution: "480p" };

describe("the end card's steps with a rendered clip", () => {
  it("cloud: no overlay or push-in; the clip gets its silent track at once, then merge-videos after the ad", () => {
    const { steps, final } = endCardSteps({ ...base, engine: "cloud", card: "/api/files/poster.png", clip: "/api/files/card.mp4", silence: "/api/files/silence.wav" });
    expect(final).toBe("endcard");
    expect(steps.map((s) => s.key)).toEqual(["endcardSound", "endcard"]);
    expect(steps.some((s) => s.request.modelId === "ken-burns" || s.request.modelId === "overlay-image")).toBe(false);
    expect(steps[0]).toEqual({ key: "endcardSound", label: "End card sound", request: { feature: "click-to-ad-step", modelId: "merge-audio-video", op: "mux", inputs: { video: "/api/files/card.mp4", audio: "/api/files/silence.wav" } } });
    expect(steps[0].after).toBeUndefined();
    expect(steps[1]).toMatchObject({ after: ["captions", "endcardSound"], chain: [{ slot: "videos" }, { slot: "videos" }], request: { feature: "click-to-ad", title: base.title, modelId: "join-clips", op: "concat" } });
    expect(() => endCardSteps({ ...base, engine: "cloud", clip: "/api/files/card.mp4" })).toThrow(/silent sound track/);
  });

  it("open: one oss-join-sound1 step with the clip, the ad put first by the chain", () => {
    for (const adEncodedBy of ["comfyui", "other"] as const) {
      const { steps } = endCardSteps({ ...base, engine: "open", clip: "/api/files/card.webm", adEncodedBy });
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({
        key: "endcard",
        after: ["captions"],
        chain: [{ slot: "videos", position: "first" }],
        request: { feature: "click-to-ad", title: base.title, modelId: "oss-join-sound1", op: "concat", inputs: { videos: ["/api/files/card.webm"] }, params: { aspectRatio: "9:16", resolution: "480p" } },
      });
      const joined = withChainInputs({ ...steps[0].request, chain: steps[0].chain }, ["/api/files/ad.mp4"]);
      expect(joined.inputs?.videos).toEqual(["/api/files/ad.mp4", "/api/files/card.webm"]);
    }
  });

  it("still: the steps are exactly what they were", () => {
    for (const o of [
      { ...base, engine: "cloud" as const, card: "/api/files/card.png", silence: "/api/files/s.wav" },
      { ...base, engine: "open" as const, card: "/api/files/card.png" },
      { ...base, engine: "open" as const, card: "/api/files/card.png", adEncodedBy: "other" as const },
    ]) {
      expect(JSON.stringify(endCardSteps({ ...o, clip: undefined }))).toBe(JSON.stringify(endCardSteps(o)));
      expect(endCardSteps(o).steps.some((s) => JSON.stringify(s).includes(".mp4"))).toBe(false);
    }
  });
});

describe("Click to Ad with the animated card", () => {
  it("takes the clip and its style in the request, and refuses an unknown style or a link", () => {
    const ok = mk.ClickToAdBody.safeParse({ engine: "cloud", productId: "p1", styleId: "clean-minimal", endCard: { image: "/api/files/a.png", clip: "/api/files/a.mp4", seconds: 2.5, variant: "iris" } });
    expect(ok.success).toBe(true);
    expect(mk.ClickToAdBody.safeParse({ engine: "cloud", productId: "p1", styleId: "x", endCard: { clip: "/api/files/a.mp4", variant: "spin" } }).success).toBe(false);
    expect(mk.ClickToAdBody.safeParse({ engine: "cloud", productId: "p1", styleId: "x", endCard: { clip: "https://elsewhere.example/a.mp4" } }).success).toBe(false);
  });

  it("plans both engines with the clip, notes the animated card and keeps it in the run", () => {
    const clip = saveFile({ data: Buffer.from("ftyp"), contentType: "video/mp4", name: "card.mp4", source: "upload" }).url;
    const poster = upload("poster.png");
    const cloud = mk.planClickToAd({ engine: "cloud", productId: "p1", styleId: "clean-minimal", endCard: { image: poster, clip, variant: "draw-on" } }, { product: product(), script: SCRIPT, silence: "/api/files/silence.wav" });
    expect(cloud.steps.slice(-2).map((s) => s.key)).toEqual(["endcardSound", "endcard"]);
    expect(cloud.meta).toMatchObject({ endCard: poster, endCardClip: clip, endCardVariant: "draw-on" });
    expect(cloud.notes).toContain("Ends on your animated logo card for 2.5 s");
    const open = mk.planClickToAd({ engine: "open", productId: "p1", styleId: "clean-minimal", voiceSample: upload("v.png"), endCard: { image: poster, clip, seconds: 3, variant: "split" } }, { product: product(), script: SCRIPT });
    expect(open.steps.at(-1)).toMatchObject({ key: "endcard", request: { modelId: "oss-join-sound1", inputs: { videos: [clip] } }, chain: [{ slot: "videos", position: "first" }] });
    expect(open.notes).toContain("Ends on your animated logo card for 3 s");
  });

  it("prices both paths (the estimate uses stand-in files)", () => {
    // The estimate reads the product from the studio's own list: one saved there.
    const db = mk as unknown as { estimatePlan: typeof mk.estimatePlan };
    const cloud = mk.planClickToAd({ engine: "cloud", productId: "p1", styleId: "clean-minimal", endCard: { image: "/api/files/placeholder.png", clip: "/api/files/placeholder.mp4" } }, { product: product(), script: SCRIPT, silence: "/api/files/placeholder.wav" });
    const cEst = db.estimatePlan(cloud);
    expect(cEst.steps.map((s) => s.key).slice(-2)).toEqual(["endcardSound", "endcard"]);
    expect(cEst.blocker).toBeFalsy();
    const open = mk.planClickToAd({ engine: "open", productId: "p1", styleId: "clean-minimal", voiceSample: upload("v.png"), endCard: { image: "/api/files/placeholder.png", clip: "/api/files/placeholder.mp4" } }, { product: product(), script: SCRIPT });
    const oEst = db.estimatePlan(open);
    expect(oEst.steps.at(-1)!.key).toBe("endcard");
    expect(oEst.blocker).toBeFalsy();
  });
});
