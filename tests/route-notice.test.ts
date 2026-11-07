import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { anywayKeys, anywaySaid, likelyProvider, pickRoute, routeNotice, routeShortfalls, shortfallNote } from "@/lib/catalog/route-notice";
import type { ModelDef, ModelRoute, ProviderId } from "@/lib/catalog/types";
import { slimModel } from "@/lib/studio-catalog";

/** Route notice from the server catalog and the browser's slim catalog. */
const model = (id: string): ModelDef => {
  const m = getModel(id);
  if (!m) throw new Error(`no ${id}`);
  return m;
};
// Qwen-Image-Edit 2511: fal.ai takes every shape and a negative prompt; Replicate makes five shapes and takes none.
const qwen = model("qwen-image-edit-2511-cloud");
const slim = slimModel(qwen);
const asked = { params: { aspectRatio: "3:2" }, negativePrompt: "blur" };
const only = (...ps: ProviderId[]) => (p: ProviderId) => ps.includes(p);

/**
 * A video model with a fal.ai route that makes any 4n + 1 frames and Replicate's fast Wan 2.2, which makes 81–121: the
 * length cases (Wan 2.2 A14B had both routes until fal removed its Wan 2.2 line; it runs on Replicate alone now).
 */
const wanReplicate = model("wan-2-2-a14b-cloud");
const t2vReplicate = wanReplicate.routes.find((r) => r.op === "t2v" && r.provider === "replicate")!;
const t2vFal: ModelRoute = {
  op: "t2v",
  provider: "fal",
  endpoint: "fal/any-length-t2v",
  map: { numFrames: { key: "num_frames", fps: 16, min: 17, max: 161, step: 4 }, aspectRatio: { key: "aspect_ratio", accepts: ["16:9", "9:16", "1:1"] } },
};
const lengths: ModelDef = { ...wanReplicate, id: "two-length-routes", name: "Two routes", routes: [t2vFal, t2vReplicate] };

describe("before a run on a route that can't honour a setting", () => {
  it("names what Replicate's Qwen-Image-Edit 2511 can't do, in plain words, and offers fal.ai only when fal.ai runs", () => {
    for (const m of [qwen, slim]) {
      const n = routeNotice(m, "edit", "replicate", asked, only("replicate"));
      expect(n?.words).toBe("Replicate's Qwen-Image-Edit 2511 makes 1:1, 16:9, 9:16, 4:3 or 3:4 pictures only and ignores a negative prompt.");
      // Run anyway only: fal.ai isn't connected, so it isn't offered.
      expect(n?.instead).toBeUndefined();
      expect(routeNotice(m, "edit", "replicate", asked, only("replicate", "fal"))?.instead).toBe("fal");
    }
  });

  it("a model on Replicate alone has nothing else to offer: no notice and never Use fal.ai", () => {
    const wan = slimModel(wanReplicate);
    expect(wanReplicate.routes.every((r) => r.provider === "replicate")).toBe(true);
    for (const ready of [only("replicate"), () => true]) {
      expect(routeNotice(wan, "t2v", "replicate", { params: { aspectRatio: "1:1" }, negativePrompt: "blur" }, ready)?.instead).toBeUndefined();
    }
    expect(likelyProvider(wan, "t2v", { params: { aspectRatio: "16:9" } }, { ready: () => true })).toBe("replicate");
  });

  it("says one thing when only one is asked", () => {
    expect(routeNotice(slim, "edit", "replicate", { params: { aspectRatio: "3:2" } }, () => true)?.words).toBe("Replicate's Qwen-Image-Edit 2511 makes 1:1, 16:9, 9:16, 4:3 or 3:4 pictures only.");
    expect(routeNotice(slim, "edit", "replicate", { params: { aspectRatio: "16:9" }, negativePrompt: "blur" }, () => true)?.words).toBe(
      "Replicate's Qwen-Image-Edit 2511 ignores a negative prompt.",
    );
  });

  it("says nothing when the route makes everything as asked, or no route of the model would", () => {
    expect(routeNotice(slim, "edit", "replicate", { params: { aspectRatio: "16:9" } }, () => true)).toBeNull();
    expect(routeNotice(slim, "edit", "fal", asked, () => true)).toBeNull();
    // A blank negative prompt asks for nothing.
    expect(routeNotice(slim, "edit", "replicate", { params: {}, negativePrompt: "  " }, () => true)).toBeNull();
  });

  it("a longer clip than Replicate's frames make, which another route makes as asked", () => {
    const s = routeShortfalls(lengths, "t2v", "replicate", { params: { duration: 3 } });
    expect(s.map((x) => [x.setting, x.can])).toEqual([["duration", "makes this 5s long, not 3s"]]);
  });

  it("the run's note says what was made, in the past tense", () => {
    const s = routeShortfalls(qwen, "edit", "replicate", asked);
    expect(shortfallNote(qwen, "replicate", s)).toBe("Replicate's Qwen-Image-Edit 2511 made this at 4:3 in place of 3:2 and without the negative prompt.");
  });

  it("works for any model whose routes take different settings (Nano Banana Pro's seed on Replicate)", () => {
    const nano = slimModel(model("nano-banana-pro"));
    expect(routeNotice(nano, "t2i", "replicate", { params: { seed: 7 } }, () => true)).toMatchObject({ words: "Replicate's Nano Banana Pro takes no seed.", instead: "fal" });
  });

  it("Run anyway is remembered per model, mode, route and setting", () => {
    const n = routeNotice(slim, "edit", "replicate", { params: { aspectRatio: "3:2" } }, () => true)!;
    const said = anywayKeys(qwen.id, "edit", n);
    expect(anywaySaid(said, qwen.id, "edit", n)).toBe(true);
    // The same setting asked again: still said. A new setting the route can't take: asked again.
    expect(anywaySaid(said, qwen.id, "edit", routeNotice(slim, "edit", "replicate", { params: { aspectRatio: "3:2" } }, () => true)!)).toBe(true);
    expect(anywaySaid(said, qwen.id, "edit", routeNotice(slim, "edit", "replicate", { params: { aspectRatio: "16:9" }, negativePrompt: "blur" }, () => true)!)).toBe(false);
  });
});

describe("where the run goes, as the server picks", () => {
  it("the first ready route, the preferred aggregator first, and the one the request names", () => {
    expect(likelyProvider(slim, "edit", asked, { ready: only("replicate") })).toBe("replicate");
    expect(likelyProvider(slim, "edit", asked, { ready: only("replicate", "fal") })).toBe("fal");
    expect(likelyProvider(slim, "edit", asked, { ready: only("replicate", "fal"), preferred: "replicate" })).toBe("replicate");
    expect(likelyProvider(slim, "edit", { ...asked, prefer: "fal" }, { ready: only("replicate", "fal"), preferred: "replicate" })).toBe("fal");
    // Named but not ready: the next ready one.
    expect(likelyProvider(slim, "edit", { ...asked, prefer: "fal" }, { ready: only("replicate") })).toBe("replicate");
    expect(likelyProvider(slim, "edit", asked, { ready: () => false })).toBeUndefined();
  });

  it("a route that makes the length asked wins over the preferred one", () => {
    // 3 s: Replicate's fast Wan 2.2 makes 81–121 frames (about 5 s); the other route makes 3 s.
    expect(likelyProvider(lengths, "t2v", { params: { duration: 3 } }, { ready: () => true, preferred: "replicate" })).toBe("fal");
    expect(pickRoute(lengths.routes, { ok: () => true, seconds: 3, preferred: "replicate", prefer: "replicate" })?.provider).toBe("replicate");
  });
});
