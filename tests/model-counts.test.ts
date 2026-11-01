import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MODELS, modelCounts } from "@/lib/catalog";
import { countModels } from "@/lib/catalog/counts";
import { runsOn } from "@/lib/catalog/engines";
import type { ModelDef } from "@/lib/catalog/types";
import { paletteIndex } from "@/lib/palette-index";

/*
 * One model count for every page (src/lib/catalog/counts.ts): the models a visitor can pick, each once. Home, /models,
 * Project status and About & licences all read it, so their numbers match.
 */
const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("model counts", () => {
  it("counts each pickable model once: open (Originals included) plus cloud only", () => {
    const counts = modelCounts();
    const listed = MODELS.filter((m) => !m.hidden);
    expect(counts.all).toBe(listed.length);
    expect(counts.open + counts.cloud).toBe(counts.all);
    expect(counts.open).toBe(listed.filter((m) => runsOn(m, "open")).length);
    expect(counts.cloud).toBe(listed.filter((m) => !runsOn(m, "open")).length);
    // The ⌘K palette lists the same models.
    expect(paletteIndex().models).toHaveLength(counts.all);
  });

  it("leaves out the hidden steps presets and tools run, and counts an Original once", () => {
    const m = (id: string, engine: "open" | "cloud", extra: Partial<ModelDef> = {}) => ({ id, engine, ...extra });
    expect(
      countModels([
        m("a", "open"),
        m("b", "cloud"),
        m("original", "open", { engines: ["open", "cloud"] }),
        m("trim", "cloud", { hidden: true }),
        m("join", "open", { hidden: true }),
      ]),
    ).toEqual({ open: 2, cloud: 1, all: 3 });
    // The catalog has hidden steps on both engines, so the rule matters.
    expect(MODELS.some((x) => x.hidden && x.engine === "open")).toBe(true);
    expect(MODELS.some((x) => x.hidden && x.engine === "cloud")).toBe(true);
  });

  it("is the count Home, /models, Project status and About quote", () => {
    expect(read("src/lib/home-showcase.ts")).toMatch(/modelCounts\(\)/);
    expect(read("src/app/(studio)/status/page.tsx")).toMatch(/modelCounts\(\)/);
    expect(read("src/app/(studio)/settings/about/page.tsx")).toMatch(/modelCounts\(\)/);
    // /models lists the same models the counts count.
    expect(read("src/app/(studio)/models/page.tsx")).toMatch(/MODELS\.filter\(isListed\)/);
    // No page counts the catalog on its own.
    for (const file of ["src/app/(studio)/status/page.tsx", "src/app/(studio)/settings/about/page.tsx", "src/lib/home-showcase.ts"]) {
      expect(read(file), file).not.toMatch(/MODELS\.filter\([^)]*enginesOf/);
      expect(read(file), file).not.toMatch(/openModels: licences/);
    }
  });
});
