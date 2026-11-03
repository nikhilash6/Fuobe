import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PresetPreview } from "@/components/preset-preview";
import { coverWidth, pickWidth } from "@/lib/media-pick";
import { PRESET_HD } from "@/lib/preset-hd.generated";
import { presetClipCopies, presetHdFiles, presetStillSources } from "@/lib/preset-hd";
import { PRESET_PEAKS } from "@/lib/preset-peaks.generated";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";
import { STARTERS, starterCover } from "@/lib/starters/catalog";

/*
 * Larger copies of preset covers (scripts/gen-preset-hd.mjs, src/lib/preset-hd.ts): every listed copy is there at its
 * width, each still shows what the published 512 px one shows (so nothing jumps when a card swaps to it or its clip
 * starts), and a card offers them in its srcset, so a box takes one at least as wide as it shows.
 */

const root = process.cwd();
const local = (url: string) => path.join(root, "public", ...url.split("?")[0].split(" ")[0].split("/").filter(Boolean));
const grey = (file: string) => sharp(file).resize(128, 96, { fit: "fill" }).greyscale().raw().toBuffer();
const gap = (a: Buffer, b: Buffer) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
/** As gen-preset-hd.mjs's MATCH. */
const MATCH = 6;
/** The most a copy may weigh, by width: a 1024 px clip of a 3 s loop is about 350 to 450 KB. */
const MAX_CLIP = { 640: 260_000, 1024: 560_000 } as Record<number, number>;
const MAX_STILL = { 320: 24_000, 640: 70_000, 1024: 150_000 } as Record<number, number>;

const urls = (srcset: string) => srcset.split(", ").map((s) => ({ url: s.split(" ")[0], w: Number(s.split(" ")[1].slice(0, -1)) }));

describe("preset covers' larger copies", () => {
  const ids = Object.keys(PRESET_HD);

  it("lists covers that are published, at widths past 512 px", () => {
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(PRESET_PREVIEWS[id]?.video, id).toBeTruthy();
      expect(PRESET_HD[id].w.every((w) => w > 512), id).toBe(true);
    }
  });

  it.each(ids)("%s: every copy is there, at its width and weight, showing the published frame", async (id) => {
    const poster = PRESET_PREVIEWS[id].poster;
    const stills = [poster, ...(PRESET_PEAKS[id] ? [`/previews/presets/peak/${id}.jpg?v=${PRESET_PEAKS[id].v}`] : [])];
    for (const still of stills) {
      const src = presetStillSources(still, "/thumb.jpg")!;
      expect(src, still).toBeDefined();
      const published = await grey(local(still));
      for (const { url, w } of [...urls(src.avif), ...urls(src.jpeg).filter((c) => c.w > 512)]) {
        expect(url).toMatch(/\?v=[0-9a-f]{8}$/);
        const file = local(url);
        const meta = await sharp(file).metadata();
        expect(meta.width, url).toBe(w);
        expect(meta.height, url).toBe((w * 3) / 4);
        expect(fs.statSync(file).size, url).toBeLessThan(MAX_STILL[w]);
        expect(gap(await grey(file), published), url).toBeLessThan(MATCH);
      }
    }
    const clips = presetClipCopies(PRESET_PREVIEWS[id].video!);
    expect(clips.map((c) => c.w)).toEqual([512, ...PRESET_HD[id].w]);
    for (const c of clips.slice(1)) {
      expect(c.src).toMatch(new RegExp(`^/previews/presets/hd/${c.w}/${id}\\.mp4\\?v=${PRESET_HD[id].v}$`));
      expect(fs.statSync(local(c.src)).size, c.src).toBeLessThan(MAX_CLIP[c.w]);
    }
  });

  it("leaves no file in public/previews/presets/hd that no entry names", () => {
    const named = new Set(ids.flatMap((id) => presetHdFiles(id, !!PRESET_PEAKS[id])));
    const dir = path.join(root, "public", "previews", "presets", "hd");
    const files = fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => /.(jpg|avif|mp4)$/.test(f));
    expect(files.map((f) => `/previews/presets/hd/${f.replaceAll("\\", "/")}`).filter((u) => !named.has(u))).toEqual([]);
  });

  it("a cover without copies keeps its own files", () => {
    expect(presetStillSources("/previews/presets/no-such-cover.jpg?v=1", "/t.jpg")).toBeUndefined();
    expect(presetClipCopies("/previews/presets/no-such-cover.mp4?v=1")).toEqual([{ src: "/previews/presets/no-such-cover.mp4?v=1", w: 512 }]);
  });

  it("a clip box takes the narrowest copy at least as wide as it shows", () => {
    const [id] = ids;
    const clips = presetClipCopies(PRESET_PREVIEWS[id].video!);
    // A 440 x 248 starter card on a 2x screen, a 358 px phone card at 3x, a 136 px picker tile at 2x.
    expect(pickWidth(clips, coverWidth(440, 248, 4 / 3, 2)).w).toBe(1024);
    expect(pickWidth(clips, coverWidth(358, 201, 4 / 3, 3)).w).toBe(1024);
    expect(pickWidth(clips, coverWidth(300, 225, 4 / 3, 2)).w).toBe(640);
    expect(pickWidth(clips, coverWidth(136, 102, 4 / 3, 2)).w).toBe(512);
  });

  it("the Marketing starters' cards offer their cover at 1024 px, AVIF first", () => {
    for (const s of STARTERS.filter((x) => x.coverFrom && PRESET_HD[x.coverFrom])) {
      const cover = starterCover(s)!;
      const html = renderToStaticMarkup(createElement(PresetPreview, { preview: { poster: cover.poster, scene: "product" }, hue: 0, playing: false, sizes: "440px" }));
      expect(html, s.id).toMatch(/<picture><source type="image\/avif" srcSet="[^"]*\/hd\/1024\/peak\/[^"]+\.avif\?v=[0-9a-f]{8} 1024w"/);
      expect(html, s.id).toMatch(/<img[^>]*srcSet="[^"]*\/hd\/1024\/peak\/[^"]+\.jpg\?v=[0-9a-f]{8} 1024w"/);
    }
    expect(STARTERS.some((s) => s.id === "mk.perfume-moss" && s.coverFrom && PRESET_HD[s.coverFrom])).toBe(true);
    expect(STARTERS.some((s) => s.id === "mk.bag-packshot" && s.coverFrom && PRESET_HD[s.coverFrom])).toBe(true);
  });
});
