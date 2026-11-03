import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { APPS, EFFECTS, getPreset, MOTIONS } from "@/lib/catalog";
import { SOUL_LOOK_CARDS } from "@/lib/catalog/soul-looks.generated";
import { previewFor, toPresetCard } from "@/lib/preset-card-data";
import { isCover, onPeak, presetCard } from "@/lib/preset-cards";
import { coverPreview, presetCover, thumbOf } from "@/lib/preset-covers";
import { HOME_BENTO_MEDIA } from "@/lib/home-bento.generated";
import { PRESET_BEFORE_AFTER } from "@/lib/preset-before-after.generated";
import { PRESET_COVERS } from "@/lib/preset-covers.generated";
import { PRESET_HD } from "@/lib/preset-hd.generated";
import { presetHdFiles } from "@/lib/preset-hd";
import { PRESET_PEAKS } from "@/lib/preset-peaks.generated";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";
import { mp4Seconds } from "./helpers/mp4-length";

/*
 * The real covers manifest (src/lib/preset-previews.generated.ts, written by pnpm eval:covers) against the files
 * in public/previews, unmocked: an entry committed without its files, or files without their entry, fails here
 * rather than as broken images on the cards. tests/preset-cards.test.ts covers the logic with a mocked manifest.
 */

const root = process.cwd();
const entries = Object.entries(PRESET_PREVIEWS);
/** A cover URL as the site gives it: its file's path, then its content version. */
const VERSIONED = /^(\/previews\/[^?]+)\?v=([0-9a-f]{8})$/;
/** A cover URL's file in public/ (without its version). */
const fileOf = (url: string) => path.join(root, "public", url.split("?")[0]);
/** What the generators version a URL by: the first 8 hex digits of the sha256 of its files, one after another. */
const versionOf = (...files: string[]) => {
  const hash = createHash("sha256");
  for (const f of files) hash.update(fs.readFileSync(f));
  return hash.digest("hex").slice(0, 8);
};
/** An app's HD before/after stills for Home, in the order gen-before-after.mjs versions them. */
const beforeAfterFiles = (id: string) => [1280, 960, 512].flatMap((w) => ["before", "after"].map((side) => `/previews/presets/ba/${w}/${id}-${side}.jpg`));

describe("the preset covers manifest", () => {
  it("lists catalog presets (or Soul looks) only, in the order the generator writes them", () => {
    const ids = new Set([...APPS, ...MOTIONS, ...EFFECTS].map((p) => p.id).concat(SOUL_LOOK_CARDS.map((l) => l.id)));
    const keys = entries.map(([k]) => k);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    for (const k of keys) expect(ids.has(k), `${k} is a preset or Soul look`).toBe(true);
  });

  it("points every entry at a JPEG poster (and an MP4 clip) that exists and isn't empty, with its provenance", () => {
    for (const [id, e] of entries) {
      expect(e.poster, id).toMatch(/^\/previews\/[a-z0-9-]+\/[^/?]+\.jpg\?v=[0-9a-f]{8}$/);
      if (e.video !== undefined) expect(e.video, id).toMatch(/^\/previews\/[a-z0-9-]+\/[^/?]+\.mp4\?v=[0-9a-f]{8}$/);
      for (const url of [e.poster, e.video].filter((u): u is string => !!u)) {
        expect(fs.statSync(fileOf(url), { throwIfNoEntry: false })?.size, url).toBeGreaterThan(0);
      }
      expect(typeof e.run === "string" && e.run.length > 0, `${id} names its run`).toBe(true);
      expect(typeof e.engine === "string" && e.engine.length > 0, `${id} names its engine`).toBe(true);
    }
  });

  // The cards play a clip in a loop, from its start (or its peak) to its end, however long it is.
  it("keeps every clip short enough for a card's loop: its first 4 s, or its whole length up to 8 s", () => {
    const lengths = entries.flatMap(([id, e]) => (e.video ? [[id, mp4Seconds(fileOf(e.video))] as const] : []));
    for (const [id, s] of lengths) {
      expect(s, id).toBeGreaterThan(2.5);
      expect(s, id).toBeLessThanOrEqual(8);
    }
    // Most are cut at 4 s; a few keep their whole length (a meta.json {"length": "full"} in their masters folder).
    expect(lengths.filter(([, s]) => Math.abs(s - 4) < 0.01).length).toBeGreaterThan(lengths.length / 2);
  });

  // A file made again under its old name gets a new URL only when its version is made again too (pnpm eval:covers and
  // gen-preset-peaks do it, and their --versions on its own): a manifest left behind by its files fails here.
  it("versions every URL from its files as they are now: a poster with its small copy, a clip, a peak frame with its small copy", () => {
    for (const [id, e] of entries) {
      expect(e.poster.split("?")[1], id).toBe(`v=${versionOf(fileOf(e.poster), fileOf(thumbOf(e.poster)))}`);
      if (e.video) expect(e.video.split("?")[1], id).toBe(`v=${versionOf(fileOf(e.video))}`);
    }
    for (const [id, { v }] of Object.entries(PRESET_PEAKS)) {
      const still = `/previews/presets/peak/${id}.jpg`;
      expect(v, id).toBe(versionOf(fileOf(still), fileOf(thumbOf(still))));
    }
    // Home's HD before/after stills: one version for an app's six (gen-before-after.mjs, in its order).
    for (const [id, v] of Object.entries(PRESET_BEFORE_AFTER)) expect(v, id).toBe(versionOf(...beforeAfterFiles(id).map(fileOf)));
  });

  it("leaves no cover file in public/previews that no entry names (with its poster's small copy for the pickers, and its clip's peak frame and its small copy and its HD before/after for Home)", () => {
    const named = new Set(entries.flatMap(([, e]) => [e.poster, thumbOf(e.poster), e.video].filter((u): u is string => !!u).map((u) => u.split("?")[0])));
    for (const id of Object.keys(PRESET_PEAKS)) for (const f of [`/previews/presets/peak/${id}.jpg`, thumbOf(`/previews/presets/peak/${id}.jpg`)]) named.add(f);
    for (const id of Object.keys(PRESET_BEFORE_AFTER)) for (const f of beforeAfterFiles(id)) named.add(f);
    // The larger copies (scripts/gen-preset-hd.mjs, tests/preset-hd.test.ts).
    for (const id of Object.keys(PRESET_HD)) for (const f of presetHdFiles(id, !!PRESET_PEAKS[id])) named.add(f);
    // Home's first screen makes its own clips and stills (scripts/gen-home-bento.mjs, tests/home-bento.test.ts).
    for (const f of Object.keys(HOME_BENTO_MEDIA)) named.add(f);
    const dir = path.join(root, "public", "previews");
    const files = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => /\.(jpg|mp4)$/.test(f)) : [];
    // public/previews/templates is the template covers' (tests/template-covers.test.ts checks it).
    const orphans = files.map((f) => `/previews/${f.replaceAll("\\", "/")}`).filter((u) => !u.startsWith("/previews/templates/") && !named.has(u));
    expect(orphans).toEqual([]);
  });

  // Every one of the 255 effects is getting a hover clip (about 60 bytes of card data each, with its version), so the
  // budget is sized for all of them, not for today's count: about 100 KB then, of which the versions are 5.6 KB and
  // the descriptions' whole text (a phone opens it in place of a tooltip) 2.3 KB.
  it("shows each cover on its card, and keeps the effects gallery's card data under 105 KB with them", () => {
    for (const p of [...APPS, ...MOTIONS, ...EFFECTS]) {
      const c = toPresetCard(p);
      const e = PRESET_PREVIEWS[p.id];
      expect(isCover(c.preview), p.id).toBe(!!e);
      if (e) expect([c.preview.poster, c.preview.video], p.id).toEqual([e.poster, e.video]);
    }
    expect(JSON.stringify(EFFECTS.map(toPresetCard)).length).toBeLessThan(105_000);
  });

  it("versions every cover URL a gallery card, the preset header or a picker shows, and each small copy's", () => {
    const urls = (value: unknown) => [...JSON.stringify(value).matchAll(/"(\/previews\/[^"]*)"/g)].map((m) => m[1]);
    const presets = [...APPS, ...MOTIONS, ...EFFECTS];
    // The preset header rests on its clip's peak frame (onPeak); a gallery card is the same card without it.
    const cards = presets.map((p) => onPeak(toPresetCard(p)));
    const shown = [
      ...urls(cards),
      ...cards.flatMap((c) => (isCover(c.preview) ? [thumbOf(c.preview.poster), ...(c.preview.rest ? [thumbOf(c.preview.rest.src)] : [])] : [])),
      ...urls(presets.map((p) => presetCover(p.id))),
    ];
    expect(shown.length).toBeGreaterThan(entries.length * 3);
    for (const url of shown) expect(url).toMatch(VERSIONED);
  });

  it("gives the pickers every cover through the slim map, with the same files, and nothing else", () => {
    // Written with the manifest by pnpm eval:covers (scripts/eval/lib/covers.mjs): a manifest changed without it fails here.
    expect(Object.keys(PRESET_COVERS)).toEqual(entries.map(([k]) => k));
    for (const [id, e] of entries) expect(presetCover(id), id).toEqual({ poster: e.poster, thumb: thumbOf(e.poster), ...(e.video && { video: e.video }) });
    // Save 3D Rotation, which shows the 3D Rotation app's turntable shot (tests/picker-covers.test.ts).
    for (const p of [...APPS, ...MOTIONS, ...EFFECTS]) if (!PRESET_PREVIEWS[p.id] && p.id !== "motion-3d-rotation") expect(presetCover(p.id), p.id).toBeUndefined();
    for (const id of [undefined, "", "toString", "constructor", "__proto__"]) expect(presetCover(id), String(id)).toBeUndefined();
  });

  it("gives the preset header, from the slim map, the preview its gallery card shows", () => {
    for (const p of [...APPS, ...MOTIONS, ...EFFECTS]) expect(coverPreview(p), p.id).toEqual(previewFor(p));
  });

  it("rests the headers that showed a drawn tile on their own stills", () => {
    // The header as PresetHeader builds it (preset-header.tsx): the card from the slim map, on its peak frame. A
    // preset added without a cover yet still shows its drawn tile; these five have their stills now.
    const header = (id: string) => onPeak(presetCard(getPreset(id)!, coverPreview(getPreset(id)!))).preview;
    expect(header("app-talking-photo").poster).toBe(PRESET_PREVIEWS["app-talking-photo"].poster);
    for (const id of ["app-talking-photo", "app-fuobe-angles", "app-3d-rotation", "motion-buckle-up", "motion-dolly-zoom-out"]) {
      expect(isCover(header(id)), id).toBe(true);
      expect(header(id).poster.startsWith(`/previews/presets/${id}.jpg?v=`), id).toBe(true);
    }
  });

  it("is read only on the server", () => {
    // Client chunks keep whatever client code uses from a module. preset-cards.ts is in the galleries',
    // home's, shorts' and mixed media's chunks, so importing the manifest there (or preset-card-data.ts,
    // which does) would ship it to all of them. A new importer belongs here only if it's a server page or
    // server-only (Home's showcase). The preset header reads the slim map instead (coverPreview).
    const sources = fs
      .readdirSync(path.join(root, "src"), { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => ({ file: f.replaceAll("\\", "/"), text: fs.readFileSync(path.join(root, "src", f), "utf8") }));
    const importers = (spec: RegExp) =>
      sources
        .filter((s) => spec.test(s.text))
        .map((s) => s.file)
        .sort();
    expect(importers(/from "[^"]*preset-previews\.generated"/)).toEqual(["lib/catalog/preset-recipes.ts", "lib/preset-card-data.ts"]);
    // "Used for this preview" reads it too: on server pages and modules, in the preset header's chunk, and in a chunk the
    // composer loads on its own (import()); the composer and the planner read the light preset-recipe-routes.ts.
    expect(importers(/from "[^"]*catalog\/preset-recipes"/)).toEqual(["app/(studio)/apps/[id]/page.tsx", "components/preset-header.tsx", "server/gpu/tools.ts"]);
    expect(importers(/from "[^"]*preset-card-data"/)).toEqual([
      "app/(studio)/apps/page.tsx",
      "app/(studio)/effects/page.tsx",
      "app/(studio)/motions/page.tsx",
      "lib/home-showcase.ts",
    ]);
    expect(fs.readFileSync(path.join(root, "src", "lib", "home-showcase.ts"), "utf8")).toMatch(/^import "server-only";$/m);
    // The slim map (which presets have a cover, and a clip, with their versions: about 8 KB gzipped) is for the pickers
    // and the preset header, each in its own chunk: the camera motion and Mix pickers (next/dynamic in composer.tsx),
    // Cinema Studio's moves (next/dynamic in camera-moves.tsx, loaded when the "#" picker or the Director panel's
    // Movement tab shows them), and the preset header (next/dynamic in studio-page.tsx, checked below).
    expect(importers(/from "[^"]*preset-covers\.generated"/)).toEqual(["lib/preset-covers.ts"]);
    // (A type is no code: the cover tile takes a cover without importing the map.) Any Angle's page shows its own cover
    // above the upload: a tool of its own, whose chunk loads on that app's page only.
    // The navigation's covers and the search index's are resolved on the server: nav-covers.ts is server-only (the
    // studios layout passes them down as props) and palette-index.ts is read by the prerendered GET /api/search-index.
    expect(importers(/^import (?!type )[^;]*from "[^"]*preset-covers";/m)).toEqual([
      "components/any-angle/any-angle-tool.tsx",
      "components/cinema/move-list.tsx",
      "components/preset-header.tsx",
      "components/studio/preset-chips.tsx",
      "lib/canvas-template-cards.ts",
      "lib/nav-covers.ts",
      "lib/palette-index.ts",
    ]);
    expect(fs.readFileSync(path.join(root, "src", "lib", "nav-covers.ts"), "utf8")).toMatch(/^import "server-only";$/m);
    // Client code takes the covers' type only (the covers come as props).
    for (const f of importers(/^import (?!type )[^;]*from "[^"]*nav-covers";/m)) expect(sources.find((s) => s.file === f)!.text, f).not.toMatch(/^["']use client["'];?$/m);
    // The index is server code: the prerendered route, and Home's showcase (server-only) for model links.
    expect(importers(/from "[^"]*palette-index"/)).toEqual(["app/api/search-index/route.ts", "lib/home-showcase.ts"]);
    const composer = fs.readFileSync(path.join(root, "src", "components", "studio", "composer.tsx"), "utf8");
    expect(composer).toMatch(/dynamic\(\(\) => import\("\.\/preset-chips"\)/);
    expect(importers(/from "[^"]*\/move-list"/)).toEqual([]);
    const moves = fs.readFileSync(path.join(root, "src", "components", "cinema", "camera-moves.tsx"), "utf8");
    expect(moves).toMatch(/dynamic\(\(\) => import\("\.\/move-list"\)/);
    const header = fs.readFileSync(path.join(root, "src", "components", "studio", "studio-page.tsx"), "utf8");
    expect(header).toMatch(/dynamic\(\(\) => import\("@\/components\/preset-header"\)/);
  });

  it("serves a versioned cover for a year in the browser and a day in the CDN, and one without its version for a day", async () => {
    const rules = (await nextConfig.headers!()).filter((r) => r.source === "/previews/:path*");
    const version = { type: "query", key: "v", value: "[0-9a-f]{8}" };
    expect(rules).toEqual([
      { source: "/previews/:path*", has: [version], headers: [{ key: "Cache-Control", value: "public, max-age=31536000, s-maxage=86400, immutable" }] },
      { source: "/previews/:path*", missing: [version], headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ]);
    // Next matches a has or missing value whole (^…$), so the two rules never both apply, and every version takes the first.
    const whole = new RegExp(`^${version.value}$`);
    for (const [, e] of entries) expect(VERSIONED.exec(e.poster)?.[2]).toMatch(whole);
    for (const v of ["", "1234567", "123456789", "ABCDEF12", "abcdefg1"]) expect(v).not.toMatch(whole);
  });
});
