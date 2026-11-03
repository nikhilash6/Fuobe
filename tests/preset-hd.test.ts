import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PresetPreview } from "@/components/preset-preview";
import { PLAN, exampleById } from "@/lib/examples/catalog";
import { coverWidth, pickWidth } from "@/lib/media-pick";
import { PRESET_HD } from "@/lib/preset-hd.generated";
import { hasHdStill, presetClipCopies, presetHdFiles, presetStillSources } from "@/lib/preset-hd";
import { PRESET_PEAKS } from "@/lib/preset-peaks.generated";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";
import { STARTERS, starterCover } from "@/lib/starters/catalog";

/*
 * Larger copies of preset covers (scripts/gen-preset-hd.mjs, src/lib/preset-hd.ts): every listed copy is there at its
 * width, each still shows what the published one shows (so nothing jumps when a card swaps to it or its clip starts),
 * and a card offers them in its srcset, so a box takes one at least as wide as it shows.
 */

const root = process.cwd();
const local = (url: string) => path.join(root, "public", ...url.split("?")[0].split(" ")[0].split("/").filter(Boolean));
const grey = (file: string) => sharp(file).resize(128, 96, { fit: "fill" }).greyscale().raw().toBuffer();
const mean = (x: Buffer) => x.reduce((s, v) => s + v, 0) / x.length;
/** As gen-preset-hd.mjs: each from its own mean brightness, so an older still cut with another colour decode still matches. */
const gap = (a: Buffer, b: Buffer) => {
  const [ma, mb] = [mean(a), mean(b)];
  return a.reduce((sum, v, i) => sum + Math.abs(v - ma - (b[i] - mb)), 0) / a.length;
};
/** gen-preset-hd.mjs checks the decoded frame against MATCH (7); its AVIF and JPEG copies add a little of their own. */
const MATCH = 8;
/** The most a copy may weigh, by width: gen-preset-hd.mjs holds a clip to 1200 / 2000 kbit/s, about 0.9 / 1.5 MB for a 6 s loop. */
const MAX_CLIP = { 640: 950_000, 1024: 1_600_000 } as Record<number, number>;
const MAX_STILL = { 320: 30_000, 640: 120_000, 1024: 260_000 } as Record<number, number>;

const urls = (srcset: string) => srcset.split(", ").map((s) => ({ url: s.split(" ")[0], w: Number(s.split(" ")[1].slice(0, -1)) }));

describe("preset covers' larger copies", () => {
  const ids = Object.keys(PRESET_HD);

  it("lists covers that are published, at widths past the published copy's", () => {
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const e = PRESET_HD[id];
      const p = PRESET_PREVIEWS[id];
      expect(p, id).toBeTruthy();
      // A clip cover has its clip's copies; a still cover (`still`, its published width) only its still's.
      expect(!!p.video, id).toBe(!e.still);
      expect(e.w.every((w) => w > (e.still ?? 512)), id).toBe(true);
      if (e.rest) expect(e.rest, id).toMatch(new RegExp(`^/examples/${id}/\\d+/out-peak\\.jpg$`));
    }
  });

  it.each(ids)("%s: every copy is there, at its width and weight, showing the published frame", async (id) => {
    const e = PRESET_HD[id];
    const poster = PRESET_PREVIEWS[id].poster;
    const stills = [poster, ...(PRESET_PEAKS[id] && !e.still ? [`/previews/presets/peak/${id}.jpg?v=${PRESET_PEAKS[id].v}`] : []), ...(e.rest ? [e.rest] : [])];
    for (const still of stills) {
      const src = presetStillSources(still, "/thumb.jpg")!;
      expect(src, still).toBeDefined();
      const published = await grey(local(still));
      const ownW = (await sharp(local(still)).metadata()).width!;
      for (const { url, w } of [...urls(src.avif), ...urls(src.jpeg).filter((c) => c.w > ownW)]) {
        expect(url).toMatch(/\?v=[0-9a-f]{8}$/);
        const file = local(url);
        const meta = await sharp(file).metadata();
        expect(meta.width, url).toBe(w);
        expect(fs.statSync(file).size, url).toBeLessThan(MAX_STILL[w]);
        expect(gap(await grey(file), published), url).toBeLessThan(MATCH);
      }
      // The published file is listed at its own width.
      expect(src.jpeg, still).toContain(`${still} ${ownW}w`);
    }
    if (e.still) {
      expect(presetClipCopies(`/previews/presets/${id}.mp4`)).toHaveLength(1);
      return;
    }
    const clips = presetClipCopies(PRESET_PREVIEWS[id].video!);
    expect(clips.map((c) => c.w)).toEqual([512, ...e.w]);
    for (const c of clips.slice(1)) {
      expect(c.src).toMatch(new RegExp(`^/previews/presets/hd/${c.w}/${id}\\.mp4\\?v=${e.v}$`));
      expect(fs.statSync(local(c.src)).size, c.src).toBeLessThan(MAX_CLIP[c.w]);
    }
  });

  it("names the resting frame its examples' cards show", () => {
    for (const id of ids.filter((x) => PRESET_HD[x].rest)) {
      const rows = PLAN.filter((r) => r.rest?.src === PRESET_HD[id].rest);
      expect(rows.length, id).toBeGreaterThan(0);
      for (const r of rows) {
        const rest = exampleById(r.id)?.output.rest;
        expect(rest, r.id).toBeDefined();
        expect(hasHdStill(rest!.src), r.id).toBe(true);
      }
    }
  });

  it("leaves no file in public/previews/presets/hd that no entry names", () => {
    const named = new Set(ids.flatMap((id) => presetHdFiles(id, !!PRESET_PEAKS[id])));
    const dir = path.join(root, "public", "previews", "presets", "hd");
    const files = fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => /.(jpg|avif|mp4)$/.test(f));
    expect(files.map((f) => `/previews/presets/hd/${f.replaceAll("\\", "/")}`).filter((u) => !named.has(u))).toEqual([]);
    for (const u of named) expect(fs.existsSync(local(u)), u).toBe(true);
  });

  it("a cover without copies keeps its own files", () => {
    expect(presetStillSources("/previews/presets/no-such-cover.jpg?v=1", "/t.jpg")).toBeUndefined();
    expect(presetStillSources("/examples/no-such-cover/1/out-peak.jpg?v=1")).toBeUndefined();
    expect(presetClipCopies("/previews/presets/no-such-cover.mp4?v=1")).toEqual([{ src: "/previews/presets/no-such-cover.mp4?v=1", w: 512 }]);
  });

  it("a clip box takes the narrowest copy at least as wide as it shows", () => {
    const id = ids.find((x) => !PRESET_HD[x].still && PRESET_HD[x].w.length === 2)!;
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
      expect(html, s.id).toMatch(/<picture><source type="image\/avif" srcSet="[^"]*\/hd\/1024\/(peak\/)?[^"]+\.avif\?v=[0-9a-f]{8} 1024w"/);
      expect(html, s.id).toMatch(/<img[^>]*srcSet="[^"]*\/hd\/1024\/(peak\/)?[^"]+\.jpg\?v=[0-9a-f]{8} 1024w"/);
    }
    expect(STARTERS.some((s) => s.id === "mk.perfume-moss" && s.coverFrom && PRESET_HD[s.coverFrom])).toBe(true);
    expect(STARTERS.some((s) => s.id === "mk.bag-packshot" && s.coverFrom && PRESET_HD[s.coverFrom])).toBe(true);
  });
});
