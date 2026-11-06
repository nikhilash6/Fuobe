import { describe, expect, it } from "vitest";
import { getModel, PRESETS } from "@/lib/catalog";
import { askedChanges, fittedSettings, routeNotes } from "@/lib/catalog/fitted";
import { ENGINE_MODELS } from "@/lib/catalog/faceless";
import { MAKERS } from "@/lib/catalog/genjutsu";
import { MIXED_MODELS, nearestResolution } from "@/lib/catalog/mixed-media";
import { presetRoutes } from "@/lib/catalog/preset-recipe-routes";
import { RESTORE_UPSCALE } from "@/lib/catalog/restore";
import { SHORTS_RATIOS } from "@/lib/catalog/shorts";
import { reframes, resolutionFor } from "@/lib/catalog/shorts-models";
import { STORYBOARD_ASPECTS, STORYBOARD_MODELS, STORYBOARD_PARTNERS } from "@/lib/catalog/storyboard";
import { TURN_ROUTES } from "@/lib/catalog/turnaround";
import type { GenParams, ModelDef, Operation } from "@/lib/catalog/types";
import { INFLUENCER_CLOUD_MODELS, INFLUENCER_START, planInfluencer } from "@/lib/influencer";

/**
 * Every value a studio offers or fills in by itself for a hosted model is one that model's route makes as offered
 * (src/lib/catalog/fitted.ts), so a run never comes out at another size, shape or length without a word. A studio whose
 * list drifts from its routes fails here; the run would still say so in its notes.
 */
const model = (id: string): ModelDef => {
  const m = getModel(id);
  if (!m) throw new Error(`no ${id}`);
  return m;
};
const KEPT = ["resolution", "aspectRatio", "duration"] as const;

/** The changes to a size, shape or length a request makes on its model's route (the values picked on purpose). */
function changes(id: string, op: Operation, params: GenParams): string[] {
  const m = model(id);
  if (!m.routes.some((r) => r.op === op)) return [];
  return fittedSettings(m, op, params, { deliberate: true })
    .changes.filter((c) => (KEPT as readonly string[]).includes(c.setting) && !(c.setting === "aspectRatio" && params.aspectRatio === "auto"))
    .map((c) => `${id} ${op}: ${c.note}`);
}
const opsOf = (id: string) => [...new Set(model(id).routes.map((r) => r.op))];

describe("each studio's own values are made as offered", () => {
  it("Genjutsu: every maker's qualities", () => {
    const off = MAKERS.filter((mk) => getModel(mk.id)).flatMap((mk) => (mk.qualities ?? []).flatMap((q) => opsOf(mk.id).flatMap((op) => changes(mk.id, op, { resolution: q }))));
    expect(off).toEqual([]);
  });

  it("Mixed media: Fast's sizes for 1K, 2K and 4K", () => {
    const off = MIXED_MODELS.cloud.flatMap((id) =>
      (["1K", "2K", "4K"] as const).flatMap((want) => {
        const r = nearestResolution(model(id).options.resolutions, want);
        return r ? changes(id, "v2v", { resolution: r }) : [];
      }),
    );
    expect(off).toEqual([]);
  });

  it("Shorts: 9:16 and 16:9 at 720p on every restyle model", () => {
    const ids = [...new Set([...MIXED_MODELS.cloud])];
    const off = ids.flatMap((id) => SHORTS_RATIOS.flatMap((r) => changes(id, "v2v", { ...(reframes(id) && { aspectRatio: r.value }), ...(resolutionFor(id) && { resolution: resolutionFor(id) }) })));
    expect(off).toEqual([]);
  });

  it("Storyboards: every shape on the cloud's frame models and the partner", () => {
    const sets = [STORYBOARD_MODELS.cloud, ...Object.values(STORYBOARD_PARTNERS)];
    const off = sets.flatMap((s) => [...new Set([s.first, s.firstWithRefs, s.next])].flatMap((id) => STORYBOARD_ASPECTS.flatMap((a) => opsOf(id).flatMap((op) => changes(id, op, { aspectRatio: a })))));
    // 21:9 on the cloud's own frame models is said by boardShapeProblem (made 16:9, cropped by a look).
    expect(off.filter((l) => !/21:9/.test(l))).toEqual([]);
  });

  it("Turnaround: each cloud route's lengths and size", () => {
    const off = Object.values(TURN_ROUTES)
      .filter((r) => r.engine === "cloud")
      .flatMap((r) => r.durations.flatMap((d) => opsOf(r.modelId).flatMap((op) => changes(r.modelId, op, { duration: d, resolution: r.resolution }))));
    expect(off).toEqual([]);
  });

  it("AI Influencer: the sheet and the dressing step on each cloud model", () => {
    const off = INFLUENCER_CLOUD_MODELS.flatMap((modelId) =>
      [undefined, "face.png"].flatMap((photo) =>
        planInfluencer({ engine: "cloud", state: INFLUENCER_START, start: photo ? "face" : "scratch", photo, modelId }, {}).steps.flatMap((s) => changes(s.request.modelId, s.request.op!, s.request.params ?? {})),
      ),
    );
    expect(off).toEqual([]);
  });

  it("apps and motions: every cloud recipe's own settings", () => {
    const off = PRESETS.flatMap((p) =>
      presetRoutes(p, "cloud", (id) => !!getModel(id))
        .filter((r) => r.params && getModel(r.modelId)?.engine === "cloud")
        .flatMap((r) => changes(r.modelId, r.op, r.params!)),
    );
    expect(off).toEqual([]);
  });

  it("Faceless: the channel avatar (1:1) on the cloud's picture model", () => {
    const id = ENGINE_MODELS.cloud.still;
    expect(opsOf(id).flatMap((op) => changes(id, op, { aspectRatio: "1:1" }))).toEqual([]);
  });

  it("Restore's finish: Topaz Video to 2160p", () => {
    expect(changes(RESTORE_UPSCALE.cloud.modelId, "upscale-video", RESTORE_UPSCALE.cloud.params)).toEqual([]);
  });
});

describe("a studio's estimate says what a route makes differently", () => {
  it("names the change once, and not what the studio says already", () => {
    const req = { modelId: "minimax-h3-max-turbo", op: "t2v" as const, params: { resolution: "2K" } };
    const notes = routeNotes([req, req], getModel);
    expect(notes).toEqual(["MiniMax H3 Max Turbo makes up to 1080p, so this is made at 1080p"]);
    expect(routeNotes([req], getModel, notes)).toEqual([]);
  });

  it("compares a picker's own value with what is made, with the value to use", () => {
    const turbo = model("minimax-h3-max-turbo");
    // The studio sent the closest its options list (4:3 for 5:4); the route makes it as sent.
    expect(askedChanges(turbo, "t2v", { aspectRatio: "4:3" }, { aspectRatio: "5:4" })).toEqual([
      expect.objectContaining({ setting: "aspectRatio", asked: "5:4", made: "4:3", use: "4:3", note: "MiniMax H3 Max Turbo makes 4:3, the closest to 5:4" }),
    ]);
    // The route fits it again: its own words.
    expect(askedChanges(turbo, "t2v", { resolution: "2K" }, { resolution: "2K" })[0]).toMatchObject({ made: "1080p", use: "1080P" });
    // A start frame's shape: picked on purpose, so even the default is said, with nothing to use instead.
    const kept = askedChanges(turbo, "i2v", { aspectRatio: turbo.defaults?.aspectRatio ?? "16:9" }, { aspectRatio: turbo.defaults?.aspectRatio ?? "16:9" });
    expect(kept[0]).toMatchObject({ setting: "aspectRatio", made: "The start frame's shape" });
    expect(kept[0].use).toBeUndefined();
    expect(askedChanges(turbo, "t2v", { aspectRatio: "16:9" }, { aspectRatio: "16:9" })).toEqual([]);
  });
});
