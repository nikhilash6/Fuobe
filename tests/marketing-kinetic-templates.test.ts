import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isCodeTemplate, TEMPLATES } from "@/lib/catalog/marketing";
import { RecipeSchema } from "@/lib/motion/recipe";
import { hasScene, loadScene } from "@/lib/motion/registry";
import { SHOWCASE_PRODUCT_THUMBS, SHOWCASE_PRODUCTS, SHOWCASES } from "@/lib/motion/showcase";
import { initialState, ownFiles, templateRecipe, templateScene, templateSizes, templateWords } from "@/lib/motion/template";
import { templateCover } from "@/lib/template-covers";
import type { Generation } from "@/lib/catalog/types";
import { filterToSearch, matchesFilter } from "@/lib/library";
import { measure } from "./helpers/motion";

// Marketing's templates drawn by Kinetic Motion: each names a registered scene, the words it takes and its quick
// choices, opens on a showcase that fits every size, saves as a recipe the record route takes, and has a real cover made
// by the engine (a clip with its version, resting on a moment where its words are set).

const CODE = TEMPLATES.filter(isCodeTemplate);

describe("the catalog's code-drawn templates", () => {
  it("are the switched templates and the ones drawn for Kinetic", () => {
    expect(CODE.map((t) => t.id).sort()).toEqual(
      ["ms-kinetic-headline", "m2-line-reveal", "ms-logo-sting", "ms-feature-cards", "ms-dashboard-zoom", "m2-retro-starburst", "m2-offer-badge", "ms-big-number", "ms-five-star-quote", "ms-end-card", "m2-midnight-drop", "m2-nocturne", "m2-season-finale", "m2-prism-stage", "mm-marquee", "mm-runway-titles", "ms-stat-stack", "ms-kind-words"].sort(),
    );
    // Scenes, not type, stay on the video models.
    for (const id of ["m2-sticker-pop", "m2-paper-parade", "m2-comic-panels", "m2-grid-shuffle", "ms-device-float"]) expect(isCodeTemplate(TEMPLATES.find((t) => t.id === id))).toBe(false);
  });

  it("each has a registered scene, fields, 2 to 4 groups of quick choices, a showcase and a cover", () => {
    for (const t of CODE) {
      expect(t.scene && hasScene(t.scene), t.id).toBe(true);
      expect(t.fields?.length, t.id).toBeGreaterThan(0);
      for (const f of t.fields!) expect(f.max > 0 && f.lines >= 1 && f.label.length > 0, `${t.id} ${f.key}`).toBe(true);
      expect(t.easy!.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.easy!.length, t.id).toBeLessThanOrEqual(4);
      for (const g of t.easy!) {
        // A group that picks the scene (the end card's five styles) has one choice per style; the others 2 or 3.
        if (g.scene) for (const c of g.choices) expect(hasScene(`${g.scene}/${c.id}`), `${t.id} ${c.id}`).toBe(true);
        else expect(g.choices.length >= 2 && g.choices.length <= 3, `${t.id} ${g.id}`).toBe(true);
      }
      expect(SHOWCASES[t.id], t.id).toBeDefined();
      const cover = templateCover("marketing", t.id);
      expect(cover?.video, t.id).toMatch(/^\/previews\/templates\/marketing\/[a-z0-9-]+\.mp4\?v=[0-9a-f]{8}$/);
      expect(cover?.poster, t.id).toMatch(/\.jpg\?v=[0-9a-f]{8}$/);
      expect(cover?.at, t.id).toBeGreaterThan(1);
    }
  });

  it("offer the four Kinetic sizes, their own first", () => {
    for (const t of CODE) {
      const sizes = templateSizes(t);
      expect([...sizes].sort(), t.id).toEqual(["16:9", "1:1", "4:5", "9:16"]);
      if (t.aspect) expect(sizes[0], t.id).toBe(t.aspect);
    }
  });
});

describe("a template's recipe", () => {
  it("opens on its showcase, which fits every size and the record route's recipe schema", async () => {
    for (const t of CODE) {
      const s = initialState(t);
      for (const size of templateSizes(t)) {
        const r = templateRecipe(t, { ...s, size });
        expect(() => RecipeSchema.parse(r), `${t.id} ${size}`).not.toThrow();
        expect(r.controls?.template).toBe(t.id);
        const scene = await loadScene(r.scene);
        const plan = scene.plan({ recipe: r, measure, logo: null, images: r.media?.product ? { product: { w: 800, h: 1000 } } : undefined, outlines: {} });
        expect(plan.overflow, `${t.id} ${size}`).toEqual([]);
      }
    }
  });

  it("keeps the typed words exactly, the end card's style as its scene, and its brand's name as the end card's", () => {
    const end = CODE.find((t) => t.id === "ms-end-card")!;
    const s = initialState(end);
    expect(templateScene(end, { ...s.controls, style: "glint" })).toBe("end-card/glint");
    const r = templateRecipe(end, { ...s, controls: { ...s.controls, style: "iris", mark: "logo" }, brand: { ...s.brand, name: "Maison Ardent", logo: "/api/files/2026/11/logo.png" }, fields: { ...s.fields, product: "  Le Sérum Nuit  " } });
    expect(r.scene).toBe("end-card/iris");
    expect(r.fields.brand).toBe("Maison Ardent");
    expect(r.fields.product).toBe("  Le Sérum Nuit  ");
    expect(r.brand.logo).toBe("/api/files/2026/11/logo.png");
    expect(r.controls).toEqual({ template: "ms-end-card", mark: "logo" });
    // "Name" sets the brand name in type even with a logo.
    expect(templateRecipe(end, { ...s, controls: { style: "iris", mark: "name" }, brand: { ...s.brand, logo: "/api/files/2026/11/logo.png" } }).brand.logo).toBeUndefined();
  });

  it("ships every sample product (and its picker tile) as a cut-out whose version is its contents", () => {
    for (const [id, url] of [...Object.entries(SHOWCASE_PRODUCTS), ...Object.entries(SHOWCASE_PRODUCT_THUMBS).map(([k, u]) => [`${k} tile`, u] as const)]) {
      const [file, v] = url.split("?v=");
      const buf = fs.readFileSync(path.join(process.cwd(), "public", file));
      expect(createHash("sha256").update(buf).digest("hex").slice(0, 8), id).toBe(v);
      // A WebP with an alpha channel (VP8X with the alpha flag), so the picture traces as a cut-out.
      expect(buf.subarray(8, 16).toString("latin1"), id).toBe("WEBPVP8X");
      expect(buf[20] & 0x10, id).toBe(0x10);
    }
  });

  it("holds the length to the template's range and names its own files only", () => {
    const head = CODE.find((t) => t.id === "ms-kinetic-headline")!;
    const s = initialState(head);
    expect(templateRecipe(head, { ...s, duration: 99 }).duration).toBe(8);
    expect(templateRecipe(head, { ...s, duration: 1 }).duration).toBe(5);
    const line = CODE.find((t) => t.id === "m2-line-reveal")!;
    const l = initialState(line);
    expect(l.product).toMatch(/^\/previews\/kinetic\/products\/ardent-parfum\.webp\?v=/);
    expect(ownFiles(templateRecipe(line, l))).toEqual([]);
    expect(ownFiles(templateRecipe(line, { ...l, product: "/api/files/2026/11/bottle.png", brand: { ...l.brand, logo: "/api/files/2026/11/mark.png" } }))).toEqual(["/api/files/2026/11/mark.png", "/api/files/2026/11/bottle.png"]);
  });

  it("is listed by the template's name and its first words, without the highlight's stars", () => {
    const head = CODE.find((t) => t.id === "ms-kinetic-headline")!;
    const w = templateWords(head, initialState(head));
    expect(w.title).toBe("Kinetic Headline · SHIP IT TONIGHT.");
    expect(w.prompt).toBe("Lumen Labs · SHIP IT TONIGHT. · Start free · lumenlabs.io · Release 4.0");
    // A star that marks nothing is part of the words.
    const s = initialState(head);
    expect(templateWords(head, { ...s, fields: { ...s.fields, headline: "Rated 5* by *guests*" } }).title).toBe("Kinetic Headline · Rated 5* by guests");
    const offer = CODE.find((t) => t.id === "m2-offer-badge")!;
    const o = initialState(offer);
    expect(templateWords(offer, { ...o, fields: { ...o.fields, offer: "*2 for 1*" } }).title).toBe("Offer Badge · *2 for 1*");
  });
});

describe("Made with this template", () => {
  it("asks the server for the template's own clips, and a live update matches them the same way", () => {
    expect(filterToSearch({ features: ["marketing-kinetic"], template: "ms-big-number", limit: 12 }).get("template")).toBe("ms-big-number");
    const g = (template?: string) => ({ ...({} as Generation), feature: "marketing-kinetic", kind: "video", modelId: "local-motion", status: "succeeded", createdAt: 1, request: { prompt: "", params: { extra: { motion: { controls: { template } } } } } }) as unknown as Generation;
    expect(matchesFilter(g("ms-big-number"), { features: ["marketing-kinetic"], template: "ms-big-number" })).toBe(true);
    expect(matchesFilter(g("ms-end-card"), { features: ["marketing-kinetic"], template: "ms-big-number" })).toBe(false);
    expect(matchesFilter(g(), { features: ["marketing-kinetic"], template: "ms-big-number" })).toBe(false);
  });
});
