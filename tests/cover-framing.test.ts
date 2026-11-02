import fs from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoverTile } from "@/components/cover-tile";
import { CoverThumb } from "@/components/nav/cover-thumb";
import { NavUiProvider } from "@/components/nav/nav-ui";
import { LookCard } from "@/components/shorts/preset-card";
import { PresetGrid } from "@/components/studio/preset-chips";
import { CoverArt } from "@/components/template-cover";
import { EFFECTS, MOTIONS } from "@/lib/catalog";
import { MIXED_PRESETS, mixedPreview } from "@/lib/catalog/mixed-media";
import { COVER_FRAMING, coverFraming } from "@/lib/cover-framing";
import { navCovers } from "@/lib/nav-covers";
import { presetCover, thumbOf } from "@/lib/preset-covers";
import { PRESET_COVERS } from "@/lib/preset-covers.generated";
import { templateCover } from "@/lib/template-covers";

/*
 * How a 4:3 preset cover sits in a tile of another shape (src/lib/cover-framing.ts): every entry names a real cover,
 * and every surface that shows a cover in another shape reads it (the Mixed Media looks, the Canvas templates, the
 * pickers, the navigation's squares), on the still and on the clip.
 */

const root = process.cwd();
const fileOf = (url: string) => path.join(root, "public", url.split("?")[0]);

/** A baseline JPEG's size, from its first start-of-frame marker. */
function jpegSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error(`${file}: no frame header`);
}

const style = (focus: string) => `object-position:${focus}`;

describe("the cover framing map", () => {
  const entries = Object.entries(COVER_FRAMING);

  it("names real preset covers only, each with a focus point or the whole fit", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, f] of entries) {
      expect(Object.hasOwn(PRESET_COVERS, id), `${id} has a cover`).toBe(true);
      const cover = presetCover(id)!;
      expect(fs.statSync(fileOf(cover.poster), { throwIfNoEntry: false })?.size, id).toBeGreaterThan(0);
      expect(f.focus !== undefined || f.fit === "whole", `${id} sets something`).toBe(true);
      if (f.focus) {
        const m = /^(\d{1,3})% (\d{1,3})%$/.exec(f.focus);
        expect(m, `${id} focus is "x% y%"`).not.toBeNull();
        for (const n of [m![1], m![2]]) expect(Number(n)).toBeLessThanOrEqual(100);
      }
    }
  });

  it("fits whole only 4:3 covers (the whole fit draws a 4:3 box)", () => {
    for (const [id, f] of entries) {
      if (f.fit !== "whole") continue;
      const { w, h } = jpegSize(fileOf(presetCover(id)!.poster));
      expect(w * 3, `${id} is ${w}x${h}`).toBe(h * 4);
    }
  });

  it("finds a cover's framing from any of its URLs: poster, peak frame, small copies, clip", () => {
    const f = COVER_FRAMING["effect-comic"];
    for (const url of [
      "/previews/presets/effect-comic.jpg?v=12345678",
      "/previews/presets/thumbs/effect-comic.jpg?v=12345678",
      "/previews/presets/peak/effect-comic.jpg?v=12345678",
      "/previews/presets/peak/thumbs/effect-comic.jpg?v=12345678",
      "/previews/presets/effect-comic.mp4?v=12345678",
      "/previews/presets/effect-comic.jpg",
    ])
      expect(coverFraming(url), url).toBe(f);
    // A cover of its own (a tile's own shape) and a cover without an entry keep the plain centred fill.
    expect(coverFraming("/previews/templates/mixed-media/effect-comic.jpg?v=12345678")).toBeUndefined();
    expect(coverFraming("/previews/presets/effect-comic-2.jpg?v=12345678")).toBeUndefined();
    expect(coverFraming(undefined)).toBeUndefined();
  });
});

describe("the Mixed Media looks (4:5)", () => {
  const card = (id: string) => {
    const p = MIXED_PRESETS.find((m) => m.id === id)!;
    expect(p, id).toBeDefined();
    return renderToStaticMarkup(createElement(LookCard, { id: p.id, name: p.name, description: p.description, preview: mixedPreview(p), hue: p.hue, selected: false, onSelect: () => {} }));
  };

  it("keeps an off-centre subject in view", () => {
    for (const [id, focus] of [
      ["mixed-comic", "5% 50%"],
      ["mixed-akrill", "80% 50%"],
      ["mixed-paper", "40% 50%"],
    ]) {
      expect(templateCover("mixed-media", id), id).toBeDefined();
      expect(card(id), id).toContain(style(focus));
    }
  });

  it("shows a cover that spans the frame whole, in a 4:3 box over a blurred copy of itself", () => {
    for (const id of ["mixed-tracking", "mixed-windows", "mixed-multiverse"]) {
      const html = card(id);
      const poster = templateCover("mixed-media", id)!.poster;
      expect(html, id).toContain("cover-whole-backdrop");
      expect(html, id).toContain("aspect-[4/3]");
      // The blurred copy is a background the stylesheet draws only in a frame that isn't 4:3: one picture in the markup.
      expect(html, id).toContain(`--cover-bg:url(${thumbOf(poster)})`);
      expect(html.split("<img").length - 1, id).toBe(1);
    }
  });

  it("leaves a centred cover as it was", () => {
    const html = card("mixed-sketch");
    expect(html).not.toContain("object-position");
    expect(html).not.toContain("cover-whole");
  });
});

describe("the Canvas templates (16:9)", () => {
  const art = (id: string) => renderToStaticMarkup(createElement(CoverArt, { cover: templateCover("canvas", id)!, sizes: "100vw" }));

  it("keeps the top of a tall subject, and shows a full-height picture whole", () => {
    expect(art("effect-chain-agamemnon")).toContain(style("50% 0%"));
    expect(art("effect-chain-dolphin-ride")).toContain(style("50% 30%"));
    expect(art("effect-chain-pearl-earring")).toContain(style("50% 0%"));
    expect(art("effect-chain-skatedog")).toContain("aspect-[4/3]");
    expect(art("effect-chain-superstar")).not.toContain("object-position");
  });
});

describe("the pickers", () => {
  it("show covers in their own 4:3 shape, so nothing is cut", () => {
    const html = renderToStaticMarkup(createElement(PresetGrid, { list: [...MOTIONS.slice(0, 6), ...EFFECTS.slice(0, 6)], noneLabel: "None", onPick: () => {} }));
    expect(html).toContain("aspect-[4/3] w-full");
    expect(html).not.toContain("aspect-video");
  });

  it("frame a picker tile's small copy as the card does", () => {
    const html = renderToStaticMarkup(createElement(CoverTile, { cover: presetCover("effect-comic"), className: "aspect-[4/5]" }));
    expect(html).toContain(style("5% 50%"));
  });
});

describe("the navigation's squares", () => {
  const covers = navCovers();
  const Nav = NavUiProvider as (p: { covers: typeof covers; children?: ReactNode }) => ReactNode;
  const thumb = (id: string) => renderToStaticMarkup(createElement(Nav, { covers }, createElement(CoverThumb, { id, size: "tile" })));

  it("pass each cover's framing down from the server", () => {
    for (const id of ["app-steal-the-look", "app-outfit-swap", "app-character-swap", "app-ai-influencer"]) {
      expect(covers[id]?.framing, id).toBe(COVER_FRAMING[id]);
    }
  });

  it("keep a framed cover's subject in the square, and the top part of the others", () => {
    expect(thumb("app-steal-the-look")).toContain(style("80% 25%"));
    expect(thumb("app-ai-influencer")).toContain(style("13% 25%"));
    const plain = Object.keys(covers).find((id) => !covers[id].framing)!;
    expect(thumb(plain)).toContain(style("50% 25%"));
  });
});
