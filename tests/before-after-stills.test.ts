import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { BeforeAfter, BeforeAfterPicture } from "@/components/home/before-after";
import { getPreset } from "@/lib/catalog";
import { homeShowcase } from "@/lib/home-showcase";
import { PRESET_BEFORE_AFTER } from "@/lib/preset-before-after.generated";
import { PRESET_PEAKS } from "@/lib/preset-peaks.generated";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";

// homeShowcase() is kept with "use cache" and cacheLife, which only a Next render reads; the slider's "Try" link
// prefetches through the router, which only a Next render has.
vi.mock("next/cache", () => ({ cacheLife: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: () => {} }) }));

/*
 * Home's before/after slider (src/components/home/before-after.tsx) and its HD stills (scripts/gen-before-after.mjs,
 * src/lib/preset-before-after.generated.ts): every app whose cover is a reveal clip has a pair, so any of them can go
 * on Home and stay sharp on every screen, a phone's too, and the slider asks for its 960 or 1280 px copy only once
 * it comes near the screen. Each pair still shows what its app's card shows, so a cover made again needs its pair
 * made again.
 */

const root = process.cwd();
/** The apps whose cover is a before → after reveal clip (gen-before-after.mjs's REVEAL_MODEL). */
const REVEALS = Object.keys(PRESET_PREVIEWS).filter((id) => PRESET_PREVIEWS[id].model === "ideogram4+qwen-image-2.1-edit");
/** The most one still may weigh: a pair is about 205 KB at 1280 px, 125 KB at 960 and 55 KB at 512. */
const MAX_BYTES = { 1280: 260_000, 960: 160_000, 512: 64_000 };

/** A JPEG's size, from its frame header (baseline or progressive). */
function jpegSize(file: string) {
  const b = fs.readFileSync(file);
  for (let i = 2; i + 9 < b.length && b[i] === 0xff; i += 2 + b.readUInt16BE(i + 2)) {
    if (b[i + 1] >= 0xc0 && b[i + 1] <= 0xc2) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
  }
  return undefined;
}

/** A file under public/ by its URL. */
const local = (url: string) => path.join(root, "public", ...url.split("?")[0].split("/").filter(Boolean));
/** A 128x96 grey copy, cropped about its centre by `zoom` first. */
async function grey(file: string, zoom = 1) {
  const { width: w = 0, height: h = 0 } = await sharp(file).metadata();
  const [zw, zh] = [Math.round(w / zoom), Math.round(h / zoom)];
  return sharp(file)
    .extract({ left: Math.round((w - zw) / 2), top: Math.round((h - zh) / 2), width: zw, height: zh })
    .resize(128, 96, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
}
/** The mean difference (of 255) of two grey copies. */
const gap = (a: Buffer, b: Buffer) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
/** As gen-before-after.mjs's MATCH: a still made from the same masters is within 3, another picture 25 and more. */
const MATCH = 6;

describe("Home's before/after stills", () => {
  it("gives every app whose cover is a reveal clip an HD before and after, with its version", () => {
    expect(REVEALS.length).toBeGreaterThan(20);
    for (const id of REVEALS) expect(PRESET_BEFORE_AFTER[id], `${id}: node scripts/gen-before-after.mjs --masters <dir> ${id}`).toMatch(/^[0-9a-f]{8}$/);
    // Any other pair is an app whose cover is a clip too.
    for (const [id, v] of Object.entries(PRESET_BEFORE_AFTER)) {
      expect(v, id).toMatch(/^[0-9a-f]{8}$/);
      expect(getPreset(id)?.type, id).toBe("app");
      expect(PRESET_PREVIEWS[id]?.video, `${id}'s cover is a clip`).toBeDefined();
    }
  });

  it("makes each still 4:3, 1280, 960 and 512 px wide, light enough for a phone and the repo", () => {
    for (const id of Object.keys(PRESET_BEFORE_AFTER)) {
      for (const w of [1280, 960, 512] as const) {
        for (const side of ["before", "after"]) {
          const file = path.join(root, "public", "previews", "presets", "ba", String(w), `${id}-${side}.jpg`);
          expect(jpegSize(file), file).toEqual({ width: w, height: (w * 3) / 4 });
          expect(fs.statSync(file).size, file).toBeLessThan(MAX_BYTES[w]);
        }
      }
    }
  });

  it("shows what each app's card shows now: the before its poster, the after its peak frame", async () => {
    for (const [id, v] of Object.entries(PRESET_BEFORE_AFTER)) {
      const again = `${id}'s cover changed: node scripts/gen-before-after.mjs --masters <dir> ${id}`;
      const still = (side: string) => path.join(root, "public", "previews", "presets", "ba", "512", `${id}-${side}.jpg`);
      expect(gap(await grey(still("before")), await grey(local(PRESET_PREVIEWS[id].poster))), `${again} (before)`).toBeLessThanOrEqual(MATCH);
      // The peak is cut later in the clip's slow push-in, so the after is matched at the zoom that fits it best.
      if (!PRESET_PEAKS[id]) continue;
      const frame = await grey(path.join(root, "public", "previews", "presets", "peak", `${id}.jpg`));
      let best = Infinity;
      for (let z = 1; z <= 1.081; z += 0.008) best = Math.min(best, gap(await grey(still("after"), z), frame));
      expect(best, `${again} (after, pair ${v})`).toBeLessThanOrEqual(MATCH);
    }
  }, 30_000);

  it("starts each picture on its 512 px still and adds the 960 and 1280 px copies for the screen to pick, never at first paint", async () => {
    const { beforeAfter } = await homeShowcase();
    const [{ id, zoom, before, after }] = beforeAfter;
    expect(before.hd?.[1280]).toContain(`/ba/1280/${id}-before.jpg?v=`);
    expect(before.hd?.[960]).toContain(`/ba/960/${id}-before.jpg?v=`);
    // The page as served: the open tab's two pictures, each its 512 px still, lazily; no larger copy and no preload,
    // so nothing large competes with the page's first paint.
    const html = renderToStaticMarkup(createElement(BeforeAfter, { pairs: beforeAfter }));
    expect(html.match(/<picture>/g)).toHaveLength(2);
    for (const s of [before, after]) expect(html).toMatch(new RegExp(`<img src="${s.src.replace(/[?.]/g, "\\$&")}"[^>]* loading="lazy"`));
    expect(html).not.toContain("<source");
    expect(html).not.toContain("1280");
    expect(html).not.toContain("/ba/960/");
    expect(html).not.toContain("preload");

    // Near the screen (hd): all three widths, sized as wide as the picture shows, enlarged by its zoom; on a phone
    // narrower than the 512 px picture plus its gutters, the screen's width less those, so a 2x phone takes the 960
    // and a 3x phone the 1280.
    const sizes = `(min-width: 1280px) ${Math.ceil(460 * zoom)}px, (min-width: 544px) ${Math.ceil(512 * zoom)}px, calc((100vw - 2rem) * ${zoom})`;
    for (const s of [before, after]) {
      const near = renderToStaticMarkup(createElement(BeforeAfterPicture, { still: s, zoom, hd: true }));
      expect(near).toContain(`<source srcSet="${s.src} 512w, ${s.hd![960]} 960w, ${s.hd![1280]} 1280w" sizes="${sizes}"/>`);
      expect(near).toMatch(new RegExp(`<img src="${s.src.replace(/[?.]/g, "\\$&")}"[^>]* loading="lazy"`));
    }
    // A picture without HD stills keeps its small still alone.
    const bare = renderToStaticMarkup(createElement(BeforeAfterPicture, { still: { src: "/previews/presets/a.jpg?v=00000000" }, zoom: 1, hd: true }));
    expect(bare).not.toContain("<source");
    expect(bare).toContain('<img src="/previews/presets/a.jpg?v=00000000"');
  });
});
