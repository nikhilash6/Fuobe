import { createElement, type FC } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The template and style tiles pick their real cover when the manifest (template-covers.generated.ts) lists one, and
 * keep their drawn art when it doesn't. The manifest is mocked here: one listed tile per group, in each of its forms
 * (a still's version, a still and clip's versions, URLs with frames or a rest on the clip's last frame).
 */
vi.mock("@/lib/template-covers.generated", () => ({
  TEMPLATE_COVERS: {
    "marketing/ps-sunlit-plinth": "1a2b3c4d",
    "marketing/m2-sticker-pop": ["2b3c4d5e", "3c4d5e6f"],
    "marketing/cta-luxury": ["0a1b2c3d", "1b2c3d4e"],
    "fashion/ultra-bold": { poster: "/previews/templates/fashion/ultra-bold.jpg?v=4d5e6f70", frames: ["/previews/templates/fashion/ultra-bold-2.jpg?v=5e6f7081", "/previews/templates/fashion/ultra-bold-3.jpg?v=6f708192"] },
    "photodump/zen": {
      poster: "/previews/templates/photodump/zen.jpg?v=708192a3",
      frames: ["/previews/templates/photodump/zen-2.jpg?v=8192a3b4", "/previews/templates/photodump/zen-3.jpg?v=92a3b4c5", "/previews/templates/photodump/zen-4.jpg?v=a3b4c5d6"],
    },
    "shorts/shorts-warm-glow": { poster: "/previews/templates/shorts/shorts-warm-glow.jpg?v=b4c5d6e7", video: "/previews/templates/shorts/shorts-warm-glow.mp4?v=c5d6e7f8", at: 3.542 },
    "mixed-media/mixed-sketch": { poster: "/previews/presets/effect-sketch.jpg?v=d6e7f809" },
    "canvas/product-angles": {
      poster: "/previews/templates/canvas/product-angles.jpg?v=e7f8091a",
      frames: ["/previews/templates/canvas/product-angles-2.jpg?v=f8091a2b", "/previews/templates/canvas/product-angles-3.jpg?v=091a2b3c"],
    },
    "canvas/effect-chain-fallen-angel": { poster: "/previews/presets/effect-fallen-angel.jpg?v=1a2b3c4e", video: "/previews/presets/effect-fallen-angel.mp4?v=2b3c4d5f" },
    "content-factory/what-if": ["3c4d5e60", "4d5e6f71"],
    "explainer/pixel-art": "5e6f7082",
    "soul/v2-general": "70819304",
    // Every human type has its cover; of the creatures only the cats.
    "influencer/tier-normal": "81920a15",
    "influencer/tier-freak": "920a1b26",
    "influencer/tier-total": "0a1b2c37",
    "influencer/tier-cats": "1b2c3d48",
    "examples/character-sheet": "2c3d4e59",
    "examples/storyboard-heist": {
      poster: "/previews/templates/examples/storyboard-heist.jpg?v=3d4e5f6a",
      frames: [2, 3, 4, 5, 6].map((k) => `/previews/templates/examples/storyboard-heist-${k}.jpg?v=4e5f6a7${k}`),
    },
    "examples/element-maya": "5f6a7b8c",
    "examples/element-rooftop-bar": "6a7b8c9d",
    "examples/element-aurora": "7b8c9dae",
    "examples/element-together": "8c9daebf",
  },
}));

const { TemplateCard: MarketingCard } = await import("@/components/marketing/template-gallery");
const { StyleTile } = await import("@/components/marketing/click-to-ad");
const { TemplatePreview: FashionPreview } = await import("@/components/fashion/template-preview");
const { PackCover } = await import("@/components/photodump/covers");
const { LookCard } = await import("@/components/shorts/preset-card");
const { TemplateCard: CanvasCard } = await import("@/components/canvas/template-card");
const { PresetTile } = await import("@/components/content-factory/parts");
const { StyleArt } = await import("@/components/faceless/style-art");
const { AD_STYLES, TEMPLATES } = await import("@/lib/catalog/marketing");
const { FASHION, PACKS } = await import("@/lib/catalog/packs");
const { coveredFirst, SHORTS_PRESETS, shortsPreview } = await import("@/lib/catalog/shorts");
const { MIXED_PRESETS, mixedPreview } = await import("@/lib/catalog/mixed-media");
const { CANVAS_TEMPLATES, outline } = await import("@/lib/catalog/canvas");
const { PRESETS } = await import("@/lib/catalog/content-factory");
const { templateCover } = await import("@/lib/template-covers");
const { CuratedCover } = await import("@/components/moodboards/cards");
const { CURATED_SETS, curatedLook } = await import("@/components/moodboards/logic");
const { TierPanel } = await import("@/components/influencer/option-panel");
const { INFLUENCER_START } = await import("@/lib/influencer");
const { BoardExample, ElementsExample, SheetExample, hasBoardExample } = await import("@/components/empty-examples");

/** A component's markup as the server renders it first (a memo component or a function). */
const html = (type: unknown, props: Record<string, unknown>) => renderToStaticMarkup(createElement(type as FC<Record<string, unknown>>, props));
/** Every cover URL in the markup carries its version. */
const unversioned = (markup: string) => [...markup.matchAll(/\/previews\/[^"\s,?]+(?:\?v=[0-9a-f]{8})?/g)].map((m) => m[0]).filter((u) => !/\?v=[0-9a-f]{8}$/.test(u));
const by = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id)!;
const noop = () => {};

describe("Marketing Studio's template cards", () => {
  const card = (id: string) => html(MarketingCard, { t: by(TEMPLATES, id), selected: false, onPick: noop });

  it("show the template's cover, its 320 px copy where the card is small, lazily", () => {
    const h = card("ps-sunlit-plinth");
    expect(h).toContain('src="/previews/templates/marketing/ps-sunlit-plinth.jpg?v=1a2b3c4d"');
    expect(h).toContain("/previews/templates/marketing/thumbs/ps-sunlit-plinth.jpg?v=1a2b3c4d 320w");
    expect(h).toMatch(/<img[^>]*loading="lazy"/);
    expect(h).not.toContain("<svg viewBox=\"0 0 240 320\"");
    expect(unversioned(h)).toEqual([]);
  });

  it("never load a clip before it plays", () => {
    const h = card("m2-sticker-pop");
    expect(h).toContain('src="/previews/templates/marketing/m2-sticker-pop.jpg?v=2b3c4d5e"');
    expect(h).not.toContain("<video");
    expect(h).not.toContain(".mp4");
  });

  it("keep the drawn preview for a template without a cover", () => {
    const h = card("ps-ice-bath");
    expect(h).toContain('<svg viewBox="0 0 240 320"');
    expect(h).not.toContain("<img");
  });
});

describe("Click to Ad's styles", () => {
  const tile = (id: string) => html(StyleTile, { style: by(AD_STYLES, id), selected: false, onPick: noop });

  it("show the style's cover (its still until the clip plays), else the drawn preview", () => {
    const h = tile("luxury");
    expect(h).toContain('src="/previews/templates/marketing/cta-luxury.jpg?v=0a1b2c3d"');
    expect(h).toContain("/previews/templates/marketing/thumbs/cta-luxury.jpg?v=0a1b2c3d 320w");
    expect(h).not.toContain("<video");
    expect(h).not.toContain("<svg viewBox=\"0 0 240 320\"");
    expect(unversioned(h)).toEqual([]);
    const drawn = tile("simple-ugc");
    expect(drawn).toContain('<svg viewBox="0 0 240 320"');
    expect(drawn).not.toContain("<img");
  });
});

describe("Fashion Factory's templates", () => {
  it("show the cover's slides in the carousel (the first one only, until picked), else the drawn framings", () => {
    const h = html(FashionPreview, { t: by(FASHION, "ultra-bold") });
    expect(h).toContain('src="/previews/templates/fashion/ultra-bold.jpg?v=4d5e6f70"');
    expect(h).not.toContain("ultra-bold-2.jpg");
    expect(h).toContain('aria-label="Ultra bold preview 1 of 3"');
    expect(h).toContain('aria-label="Next preview"');
    const drawn = html(FashionPreview, { t: by(FASHION, "red-room") });
    expect(drawn).toContain('<svg viewBox="0 0 60 70"');
    expect(drawn).not.toContain("<img");
  });
});

describe("Photodump packs", () => {
  it("fill the contact sheet with the cover's four frames (320 px copies), else the drawn tiles", () => {
    const zen = by(PACKS, "zen");
    const h = html(PackCover, { id: zen.id, name: zen.name, count: 10 });
    for (const f of ["zen.jpg?v=708192a3", "zen-2.jpg?v=8192a3b4", "zen-3.jpg?v=92a3b4c5", "zen-4.jpg?v=a3b4c5d6"]) expect(h).toContain(`/previews/templates/photodump/thumbs/${f} 320w`);
    expect(h).not.toContain("linear-gradient");
    expect(unversioned(h)).toEqual([]);
    const drawn = html(PackCover, { id: "sleepy-head", name: "Sleepy Head", count: 10 });
    expect(drawn).toContain("gradient(");
    expect(drawn).not.toContain("<img");
    // A user's pack shows its own photos, whatever its id.
    expect(html(PackCover, { id: "zen", name: "Mine", count: 3, refs: ["/media/a.jpg"] })).not.toContain("/previews/templates/");
  });
});

describe("Shorts and Mixed Media looks", () => {
  const look = (preview: ReturnType<typeof shortsPreview>, id: string) => html(LookCard, { id, name: id, description: "", preview, hue: 20, selected: false, onSelect: noop });

  it("show the look's cover without the drawn motif, resting on the reveal's last frame", () => {
    const p = shortsPreview(by(SHORTS_PRESETS, "shorts-warm-glow"));
    expect(p).toEqual({
      poster: "/previews/templates/shorts/shorts-warm-glow.jpg?v=b4c5d6e7",
      video: "/previews/templates/shorts/shorts-warm-glow.mp4?v=c5d6e7f8",
      rest: { src: "/previews/templates/shorts/shorts-warm-glow.jpg?v=b4c5d6e7", at: 3.542, from: 0 },
      scene: "product",
    });
    const h = look(p, "shorts-warm-glow");
    expect(h).toContain('src="/previews/templates/shorts/shorts-warm-glow.jpg?v=b4c5d6e7"');
    expect(h).not.toContain("<video");
    expect(h).not.toContain('class="pv"');
  });

  it("show a preset's cover where the look is that preset's restyle", () => {
    const h = look(mixedPreview(by(MIXED_PRESETS, "mixed-sketch")), "mixed-sketch");
    expect(h).toContain('src="/previews/presets/effect-sketch.jpg?v=d6e7f809"');
  });

  it("keep the drawn preview and motif without a cover", () => {
    const shorts = by(SHORTS_PRESETS, "shorts-bold-urban");
    const p = shortsPreview(shorts);
    expect(p).toEqual({ poster: expect.stringMatching(/^\/samples\/previews\//), scene: shorts.scene, fx: shorts.fx });
    expect(look(p, shorts.id)).toContain('class="pv"');
    const mixed = by(MIXED_PRESETS, "mixed-noir");
    expect(mixedPreview(mixed)).toEqual({ poster: expect.stringMatching(/^\/samples\/previews\//), scene: mixed.scene, fx: mixed.fx });
  });

  it("list the Shorts looks with a cover first, the rest in catalog order", () => {
    const ids = coveredFirst(SHORTS_PRESETS).map((p) => p.id);
    expect(ids[0]).toBe("shorts-warm-glow");
    expect(ids.slice(1)).toEqual(SHORTS_PRESETS.map((p) => p.id).filter((id) => id !== "shorts-warm-glow"));
  });
});

describe("Canvas templates", () => {
  const card = (id: string) => {
    const t = by(CANVAS_TEMPLATES, id);
    const engine = { outline: outline(t.build("cloud")), models: [] };
    return html(CanvasCard, { t: { id: t.id, name: t.name, description: t.description, icon: t.icon, hue: t.hue, section: t.group ?? "", rank: t.rank, flow: t.flow, byEngine: { cloud: engine, open: engine } }, engine: "cloud", busy: false });
  };

  it("show the cover's frames side by side with its steps in a corner, or its still and clip, else the board", () => {
    const angles = card("product-angles");
    for (const f of ["product-angles.jpg?v=e7f8091a", "product-angles-2.jpg?v=f8091a2b", "product-angles-3.jpg?v=091a2b3c"]) expect(angles).toContain(`src="/previews/templates/canvas/${f}"`);
    expect(angles).toContain("3 angles");
    expect(angles).not.toContain("<svg viewBox=");
    const chain = card("effect-chain-fallen-angel");
    expect(chain).toContain('src="/previews/presets/effect-fallen-angel.jpg?v=1a2b3c4e"');
    expect(chain).not.toContain("<video");
    const drawn = card("script-film");
    expect(drawn).not.toContain("<img");
    expect(drawn).toContain("linear-gradient(135deg");
  });
});

describe("Content Factory's trending styles and the Explainer styles", () => {
  it("show the trending style's cover, else its style's picture", () => {
    const tile = (id: string) => html(PresetTile, { p: by(PRESETS, id), on: false, tabStop: true, onPick: noop });
    expect(tile("what-if")).toContain('src="/previews/templates/content-factory/what-if.jpg?v=3c4d5e60"');
    expect(tile("what-if")).not.toContain("<video");
    expect(tile("dark-history")).toContain('<svg viewBox="0 0 160 100"');
  });

  it("show the style's cover wherever its picture shows, else the drawn motif", () => {
    const h = html(StyleArt, { styleId: "pixel-art", sizes: "96px" });
    expect(h).toContain('src="/previews/templates/explainer/pixel-art.jpg?v=5e6f7082"');
    expect(h).toContain('sizes="96px"');
    expect(html(StyleArt, { styleId: "low-poly" })).toContain('<svg viewBox="0 0 160 100"');
  });
});

describe("Fuobe Soul's looks", () => {
  it("show the look's cover in the curated sets and the look pickers, its 320 px copy where small, else the drawn cover", () => {
    const general = CURATED_SETS["soul-v2"].find((c) => c.id === "v2-general")!;
    expect(general.preview).toEqual({ src: "/previews/templates/soul/v2-general.jpg?v=70819304", thumb: "/previews/templates/soul/thumbs/v2-general.jpg?v=70819304" });
    expect(curatedLook("v2-general").preview).toEqual(general.preview);
    const h = html(CuratedCover, { m: general, sizes: "200px" });
    expect(h).toContain('src="/previews/templates/soul/v2-general.jpg?v=70819304"');
    expect(h).toContain("/previews/templates/soul/thumbs/v2-general.jpg?v=70819304 320w");
    expect(h).toMatch(/<img[^>]*loading="lazy"/);
    expect(unversioned(h)).toEqual([]);
    // A look without a cover keeps its drawn one.
    const other = CURATED_SETS["soul-v1"][0];
    expect(other.preview).toBeUndefined();
    expect(curatedLook(other.id).preview).toBeUndefined();
    expect(html(CuratedCover, { m: other })).not.toContain("<img");
  });
});

describe("AI Influencer's character types", () => {
  const panel = () => html(TierPanel, { state: INFLUENCER_START, onTier: noop, onSpecies: noop, onBodyColor: noop });

  it("show photo cards for a row whose every type has its cover, and keep the icon tiles for a row that doesn't", () => {
    const h = panel();
    for (const id of ["normal", "freak", "total"]) expect(h).toContain(`src="/previews/templates/influencer/tier-${id}.jpg?v=`);
    expect(h).toContain("/previews/templates/influencer/thumbs/tier-normal.jpg?v=81920a15 320w");
    // Only the cats have a cover among the creatures: their row stays as icons, with no picture at all.
    expect(h).not.toContain("tier-cats");
    expect(h.match(/<img/g)).toHaveLength(3);
    // Still a radio group: the picked type is checked.
    expect(h).toMatch(/role="radio" aria-checked="true"[^>]*>(?:(?!<\/button>).)*tier-normal/);
    expect(unversioned(h)).toEqual([]);
  });
});

describe("The empty pages' examples", () => {
  it("show Character Sheet's example sheet with its chip", () => {
    const h = html(SheetExample, {});
    expect(h).toContain('src="/previews/templates/examples/character-sheet.jpg?v=2c3d4e59"');
    expect(h).toContain(">Example<");
  });

  it("show Storyboard's six frames in order, numbered", () => {
    expect(hasBoardExample()).toBe(true);
    const h = html(BoardExample, {});
    const srcs = [...h.matchAll(/ src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs).toEqual(["/previews/templates/examples/storyboard-heist.jpg?v=3d4e5f6a", ...[2, 3, 4, 5, 6].map((k) => `/previews/templates/examples/storyboard-heist-${k}.jpg?v=4e5f6a7${k}`)]);
    expect(h).toContain(">6<");
    expect(unversioned(h)).toEqual([]);
  });

  it("show Elements' three saved elements and the picture of two of them together", () => {
    const h = html(ElementsExample, {});
    expect([...h.matchAll(/ src="([^"]+)"/g)].map((m) => m[1].split("?")[0])).toEqual(
      ["element-maya", "element-rooftop-bar", "element-aurora", "element-together"].map((id) => `/previews/templates/examples/${id}.jpg`),
    );
    expect(h).toContain("@Maya walking into @Rooftop_bar");
    expect(h.match(/>Example</g)).toHaveLength(1);
  });
});

describe("templateCover", () => {
  it("reads every form of entry, with versions on every URL, and nothing for a tile that isn't listed", () => {
    expect(templateCover("marketing", "m2-sticker-pop")).toEqual({
      poster: "/previews/templates/marketing/m2-sticker-pop.jpg?v=2b3c4d5e",
      thumb: "/previews/templates/marketing/thumbs/m2-sticker-pop.jpg?v=2b3c4d5e",
      video: "/previews/templates/marketing/m2-sticker-pop.mp4?v=3c4d5e6f",
      frames: [{ src: "/previews/templates/marketing/m2-sticker-pop.jpg?v=2b3c4d5e", thumb: "/previews/templates/marketing/thumbs/m2-sticker-pop.jpg?v=2b3c4d5e" }],
    });
    expect(templateCover("fashion", "ultra-bold")?.frames.map((f) => f.thumb)).toEqual([
      "/previews/templates/fashion/thumbs/ultra-bold.jpg?v=4d5e6f70",
      "/previews/templates/fashion/thumbs/ultra-bold-2.jpg?v=5e6f7081",
      "/previews/templates/fashion/thumbs/ultra-bold-3.jpg?v=6f708192",
    ]);
    // Group by group: the same id in another group is another tile.
    expect(templateCover("canvas", "ps-sunlit-plinth")).toBeUndefined();
    expect(templateCover("marketing", undefined)).toBeUndefined();
    expect(templateCover("marketing", "toString")).toBeUndefined();
    // The same object each time, so a memo card doesn't render again for it.
    expect(templateCover("marketing", "ps-sunlit-plinth")).toBe(templateCover("marketing", "ps-sunlit-plinth"));
  });
});
