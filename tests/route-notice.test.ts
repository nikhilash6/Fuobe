import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { anywayKeys, anywaySaid, likelyProvider, pickRoute, routeNotice, routeShortfalls, shortfallNote } from "@/lib/catalog/route-notice";
import type { ModelDef, ProviderId } from "@/lib/catalog/types";
import { slimModel } from "@/lib/studio-catalog";

/**
 * The notice before a run whose route can't honour a setting another route of the model takes: Wan 2.2 text to video on
 * Replicate makes 16:9 or 9:16 only and reads no negative prompt, on fal.ai it makes 1:1 and reads one. Said from the
 * browser's catalog (no field maps) the same way the server fits the run, with "Use fal.ai" only where fal.ai runs.
 */
const model = (id: string): ModelDef => {
  const m = getModel(id);
  if (!m) throw new Error(`no ${id}`);
  return m;
};
const wan = model("wan-2-2-a14b-cloud");
const slim = slimModel(wan);
const asked = { params: { aspectRatio: "1:1" }, negativePrompt: "blur" };
const only = (...ps: ProviderId[]) => (p: ProviderId) => ps.includes(p);

describe("before a run on a route that can't honour a setting", () => {
  it("names what Replicate's Wan 2.2 can't do, in plain words, and offers fal.ai only when fal.ai runs", () => {
    for (const m of [wan, slim]) {
      const n = routeNotice(m, "t2v", "replicate", asked, only("replicate"));
      expect(n?.words).toBe("Replicate's Wan 2.2 A14B makes 16:9 or 9:16 clips only and ignores a negative prompt.");
      expect(n?.instead).toBeUndefined();
      expect(routeNotice(m, "t2v", "replicate", asked, only("replicate", "fal"))?.instead).toBe("fal");
    }
  });

  it("says one thing when only one is asked", () => {
    expect(routeNotice(slim, "t2v", "replicate", { params: { aspectRatio: "1:1" } }, () => true)?.words).toBe("Replicate's Wan 2.2 A14B makes 16:9 or 9:16 clips only.");
    expect(routeNotice(slim, "t2v", "replicate", { params: { aspectRatio: "9:16" }, negativePrompt: "blur" }, () => true)?.words).toBe(
      "Replicate's Wan 2.2 A14B ignores a negative prompt.",
    );
  });

  it("says nothing when the route makes everything as asked, or no route of the model would", () => {
    expect(routeNotice(slim, "t2v", "replicate", { params: { aspectRatio: "16:9" } }, () => true)).toBeNull();
    expect(routeNotice(slim, "t2v", "fal", asked, () => true)).toBeNull();
    // 1080p: no route of Wan 2.2 makes it (the picker says so), so it isn't Replicate's to say.
    expect(routeShortfalls(slim, "t2v", "replicate", { params: { resolution: "1080p" } })).toEqual([]);
    // A blank negative prompt asks for nothing.
    expect(routeNotice(slim, "t2v", "replicate", { params: {}, negativePrompt: "  " }, () => true)).toBeNull();
  });

  it("a longer clip than Replicate's frames make, which fal.ai makes as asked", () => {
    const s = routeShortfalls(slim, "t2v", "replicate", { params: { duration: 3 } });
    expect(s.map((x) => [x.setting, x.can])).toEqual([["duration", "makes this 5s long, not 3s"]]);
  });

  it("the run's note says what was made, in the past tense", () => {
    const s = routeShortfalls(wan, "t2v", "replicate", asked);
    expect(shortfallNote(wan, "replicate", s)).toBe("Replicate's Wan 2.2 A14B made this at 16:9 in place of 1:1 and without the negative prompt.");
  });

  it("works for any model whose routes take different settings (Nano Banana Pro's seed on Replicate)", () => {
    const nano = slimModel(model("nano-banana-pro"));
    expect(routeNotice(nano, "t2i", "replicate", { params: { seed: 7 } }, () => true)).toMatchObject({ words: "Replicate's Nano Banana Pro takes no seed.", instead: "fal" });
  });

  it("Run anyway is remembered per model, mode, route and setting", () => {
    const n = routeNotice(slim, "t2v", "replicate", asked, () => true)!;
    const said = anywayKeys(wan.id, "t2v", n);
    expect(anywaySaid(said, wan.id, "t2v", n)).toBe(true);
    // The same shape asked again: still said. A new setting the route can't take: asked again.
    expect(anywaySaid(said, wan.id, "t2v", routeNotice(slim, "t2v", "replicate", { params: { aspectRatio: "1:1" } }, () => true)!)).toBe(true);
    expect(anywaySaid(said, wan.id, "t2v", routeNotice(slim, "t2v", "replicate", { params: { duration: 3 } }, () => true)!)).toBe(false);
  });
});

describe("where the run goes, as the server picks", () => {
  it("the first ready route, the preferred aggregator first, and the one the request names", () => {
    expect(likelyProvider(slim, "t2v", asked, { ready: only("replicate") })).toBe("replicate");
    expect(likelyProvider(slim, "t2v", asked, { ready: only("replicate", "fal") })).toBe("fal");
    expect(likelyProvider(slim, "t2v", asked, { ready: only("replicate", "fal"), preferred: "replicate" })).toBe("replicate");
    expect(likelyProvider(slim, "t2v", { ...asked, prefer: "fal" }, { ready: only("replicate", "fal"), preferred: "replicate" })).toBe("fal");
    // Named but not ready: the next ready one.
    expect(likelyProvider(slim, "t2v", { ...asked, prefer: "fal" }, { ready: only("replicate") })).toBe("replicate");
    expect(likelyProvider(slim, "t2v", asked, { ready: () => false })).toBeUndefined();
  });

  it("a route that makes the length asked wins over the preferred one", () => {
    // 3 s: Replicate's Wan 2.2 makes 81–121 frames (about 5 s), fal's makes 3 s.
    expect(likelyProvider(slim, "t2v", { params: { duration: 3 } }, { ready: () => true, preferred: "replicate" })).toBe("fal");
    expect(pickRoute(wan.routes.filter((r) => r.op === "t2v"), { ok: () => true, seconds: 3, preferred: "replicate", prefer: "replicate" })?.provider).toBe("replicate");
  });
});
