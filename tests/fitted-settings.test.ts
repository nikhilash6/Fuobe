import { describe, expect, it } from "vitest";
import { getModel, getPreset, MODELS } from "@/lib/catalog";
import { fittedSettings, madeOfRun, shownSettings, tierWords } from "@/lib/catalog/fitted";
import { buildPayload } from "@/lib/catalog/payload";
import { planGeneration } from "@/lib/catalog/plan";
import type { EnumField, ModelDef } from "@/lib/catalog/types";
import { slimModel } from "@/lib/studio-catalog";

/**
 * What a run is made at, said the same way everywhere: a value its route doesn't take is fitted by the rules the payload
 * uses (a 2K run on MiniMax H3 Max Turbo is made at 1080P), and the change is said in plain words, before and after it.
 */
const model = (id: string): ModelDef => {
  const m = getModel(id);
  if (!m) throw new Error(`no ${id}`);
  return m;
};
const turbo = model("minimax-h3-max-turbo");

describe("quality", () => {
  it("a size above the most a model makes is made at its most, and says so before the run", () => {
    for (const asked of ["2K", "4K"]) {
      const made = fittedSettings(turbo, "t2v", { resolution: asked });
      expect(made.resolution).toBe("1080P");
      expect(made.changes).toEqual([
        expect.objectContaining({
          setting: "resolution",
          label: "Quality",
          asked,
          made: "1080p",
          reason: "the most this model makes",
          note: "MiniMax H3 Max Turbo makes up to 1080p, so this is made at 1080p",
          use: "1080P",
        }),
      ]);
      // After the run the views show only the made value: no line about what was asked.
      expect(shownSettings({ request: { params: { resolution: asked } }, made }).resolution).toBe("1080p");
    }
  });

  it("a size the model makes is no change, in any case", () => {
    for (const asked of ["1080p", "1080P", "768P", "480p"]) expect(fittedSettings(turbo, "t2v", { resolution: asked }).changes).toEqual([]);
  });

  it("matches what the payload sends and what the plan runs", () => {
    const sent = buildPayload(turbo.routes.find((r) => r.op === "t2v")!.map!, { prompt: "a", resolution: "4K" });
    expect(sent.resolution).toBe(fittedSettings(turbo, "t2v", { resolution: "4K" }).resolution);
    const plan = planGeneration({ feature: "video", modelId: turbo.id, op: "t2v", prompt: "a city at night", params: { resolution: "2K" } }, getModel, getPreset);
    expect(plan.params.resolution).toBe("1080P");
  });

  it("every hosted route's fitted size is the one its payload sends", () => {
    let checked = 0;
    for (const m of MODELS.filter((x) => x.engine === "cloud" && !x.id.startsWith("fuobe-")))
      for (const r of m.routes) {
        const f = r.map?.resolution;
        if (!f || typeof f === "string" || !f.accepts?.length || (f as EnumField).values || r.map?.size || r.map?.upscaleFactor) continue;
        for (const asked of ["4K", "2K", "1080p", "720p", "480p"]) {
          const sent = buildPayload(r.map!, { prompt: "a", resolution: asked })[f.key];
          const made = fittedSettings(m, r.op, { resolution: asked }, { provider: r.provider });
          const route = m.routes.filter((x) => x.op === r.op).find((x) => x.provider === r.provider);
          if (route !== r) continue;
          expect(made.resolution, `${m.id} ${r.op} ${asked}`).toBe(sent);
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(20);
  });

  it("reads the same in the browser (route.takes) as on the server (the field map)", () => {
    const slim = slimModel(turbo);
    expect(fittedSettings(slim, "t2v", { resolution: "2K", aspectRatio: "5:4" })).toEqual(fittedSettings(turbo, "t2v", { resolution: "2K", aspectRatio: "5:4" }));
  });
});

describe("shape", () => {
  it("a shape the model doesn't make is made at the closest", () => {
    const made = fittedSettings(turbo, "t2v", { aspectRatio: "5:4" });
    expect(made.aspectRatio).toBe("4:3");
    expect(made.changes[0]).toMatchObject({ setting: "aspectRatio", asked: "5:4", made: "4:3", reason: "the closest shape this model makes", use: "4:3" });
  });

  it("a start frame keeps its shape: a filled-in default says nothing, a picked shape says so", () => {
    const quiet = fittedSettings(turbo, "i2v", { aspectRatio: turbo.defaults?.aspectRatio ?? "16:9", resolution: "768P" });
    expect(quiet.aspectRatio).toBeUndefined();
    const picked = turbo.defaults?.aspectRatio === "9:16" ? "1:1" : "9:16";
    const said = fittedSettings(turbo, "i2v", { aspectRatio: picked });
    expect(said.aspectRatio).toBeUndefined();
    expect(said.changes[0]).toMatchObject({ setting: "aspectRatio", asked: picked, made: "The start frame's shape" });
  });
});

describe("length, seed, count, shots", () => {
  it("a length a route doesn't take is the one it makes", () => {
    const veo = model("veo-3-1");
    const short = fittedSettings(veo, "extend", { duration: 5 });
    expect(short.duration).toBe(7);
    expect(short.changes[0]).toMatchObject({ setting: "duration", asked: "5s", made: "7s" });
    const long = fittedSettings(veo, "extend", { duration: 10 });
    expect(long.changes[0]).toMatchObject({ made: "7s", reason: "the longest this model makes" });
  });

  it("a seed outside the route's range is sent inside it", () => {
    const made = fittedSettings(model("wan-3"), "t2v", { seed: 4294967295 });
    expect(made.seed).toBe(2147483647);
    expect(made.changes[0]).toMatchObject({ setting: "seed", asked: "4294967295", made: "2147483647" });
    expect(fittedSettings(model("wan-3"), "t2v", { seed: 42 }).changes).toEqual([]);
  });

  it("a route with no seed field makes a new picture each run", () => {
    const m = model("seedream-5-pro");
    const route = m.routes.find((r) => r.op === "t2i")!;
    const made = fittedSettings(m, "t2i", { seed: 42 }, { provider: route.provider });
    expect(made.seed).toBeUndefined();
    expect(made.changes.map((c) => c.setting)).toContain("seed");
  });

  it("more results than a run makes are the most it makes", () => {
    const made = fittedSettings(turbo, "t2v", { numOutputs: 12 });
    expect(made.numOutputs).toBe(8);
    expect(made.changes[0]).toMatchObject({ setting: "numOutputs", asked: "12", made: "8" });
  });

  it("a shot's words over the API's limit are cut there", () => {
    const shots = [
      { prompt: "a".repeat(600), duration: 3 },
      { prompt: "short", duration: 2 },
    ];
    const made = fittedSettings(model("kling-4"), "t2v", { shots });
    expect(made.changes).toEqual([expect.objectContaining({ setting: "shots", label: "Shot 1", asked: "600 characters", made: "512 characters" })]);
  });

  it("nothing changes on the open engine", () => {
    const open = MODELS.find((m) => m.engine === "open" && m.kind === "video")!;
    expect(fittedSettings(open, open.routes[0].op, { resolution: "4K", aspectRatio: "7:3", seed: 9e9 }).changes).toEqual([]);
  });
});

describe("a finished run", () => {
  it("carries the made settings only when something changed", () => {
    expect(madeOfRun(turbo, { op: "t2v", provider: "fal", request: { params: { resolution: "1080p" } } })).toBeUndefined();
    const made = madeOfRun(turbo, { op: "t2v", provider: "fal", request: { params: { resolution: "2K", aspectRatio: "16:9", duration: 5 } } });
    expect(made).toMatchObject({ resolution: "1080P", aspectRatio: "16:9", duration: 5 });
    expect(madeOfRun(undefined, { op: "t2v", request: {} })).toBeUndefined();
  });

  it("shows the made value, else what it asked", () => {
    const params = { resolution: "2K", aspectRatio: "16:9", duration: 5 };
    expect(shownSettings({ request: { params } })).toEqual({ aspectRatio: "16:9", resolution: "2K", duration: 5, seed: undefined });
    const made = madeOfRun(turbo, { op: "t2v", request: { params } });
    expect(shownSettings({ request: { params }, made })).toMatchObject({ resolution: "1080p", aspectRatio: "16:9", duration: 5 });
  });

  it("writes tiers the way the pickers do", () => {
    expect(tierWords("1080P")).toBe("1080p");
    expect(tierWords("2k")).toBe("2K");
    expect(tierWords("auto")).toBe("auto");
  });
});
