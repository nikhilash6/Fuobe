import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { APPS, EFFECTS, MODELS, MOTIONS, getPreset, modelCounts } from "@/lib/catalog";
import { getTemplate } from "@/lib/catalog/canvas";
import { FORBIDDEN_WORDS } from "@/lib/examples/catalog";
import { HUB_MODES } from "@/lib/hubs";
import { studioCount } from "@/lib/nav-model";
import { HOME_BENTO_MEDIA, HOME_BENTO_WAVE } from "@/lib/home-bento.generated";
import { contentVersion } from "../scripts/eval/lib/covers.mjs";
import { mp4Seconds } from "./helpers/mp4-length";

/*
 * Home's first screen (src/components/home/home-bento.tsx, src/lib/home-bento.ts): every tile's media is a published
 * file with its version, every link goes somewhere real, every number is the catalog's, the words a visitor reads are
 * plain, and none of its clips plays anywhere else on Home.
 */

vi.mock("next/cache", () => ({ cacheLife: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { BENTO_BOARD, BENTO_CLIPS, BENTO_HREFS, BENTO_BEFORE_AFTER, BENTO_IMAGE_EXAMPLE, livePhrases, openModelsOf } = await import("@/lib/home-bento");
const { HOME_BEFORE_AFTER, HOME_EFFECTS, HOME_MOTIONS, HOME_REVEALS, HOME_STUDIOS, homeShowcase, navLabel } = await import("@/lib/home-showcase");
const { HomeBento } = await import("@/components/home/home-bento");

const root = process.cwd();
const file = (url: string) => path.join(root, "public", url.split("?")[0]);
const exists = (url: string) => (fs.statSync(file(url), { throwIfNoEntry: false })?.size ?? 0) > 0;
const versioned = /^\/[^?]+\?v=[0-9a-f]{8}$/;

const home = await homeShowcase();
const bento = home.bento;
const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(HomeBento, { bento })));
/** Every media URL the first screen names. */
const urls = [...new Set([...JSON.stringify(bento).matchAll(/"(\/(?:previews|examples|samples)\/[^"]*)"/g)].map((m) => m[1]))];

describe("Home's first screen", () => {
  it("shows only published files, each with its content version", () => {
    expect(urls.length).toBeGreaterThan(15);
    for (const u of urls) {
      expect(u, u).toMatch(versioned);
      expect(exists(u), u).toBe(true);
    }
    // The stills made for it are the ones scripts/gen-home-bento.mjs listed, at those versions.
    for (const [f, v] of Object.entries(HOME_BENTO_MEDIA)) {
      expect(contentVersion([file(f)]), f).toBe(v);
      expect(urls).toContain(`${f}?v=${v}`);
    }
    // And the page's HTML asks for them as listed (no URL without its version).
    for (const m of html.matchAll(/(?:src|srcSet)="([^"]+)"/g)) for (const part of m[1].split(", ")) expect(part.split(" ")[0], part).toMatch(versioned);
  });

  it("plays the catwalk and the turning gown, at the length of their published clips", () => {
    expect(bento.video.clip).toMatch(/^\/previews\/presets\/motion-catwalk\.mp4\?v=/);
    expect(bento.threeD.clip).toMatch(/^\/previews\/presets\/app-3d-rotation\.mp4\?v=/);
    expect(mp4Seconds(file(bento.video.clip))).toBeCloseTo(4, 1);
    expect(mp4Seconds(file(bento.threeD.clip))).toBeCloseTo(3.04, 1);
  });

  it("opens a real page from every tile, named by the navigation or the catalog", () => {
    const route = (href: string) => {
      const seg = href.split(/[?#]/)[0].replace(/^\//, "");
      return fs.existsSync(path.join(root, "src", "app", "(studio)", seg, "page.tsx"));
    };
    for (const href of [BENTO_HREFS.video, BENTO_HREFS.image, BENTO_HREFS.audio, BENTO_HREFS.threeD, BENTO_HREFS.live, BENTO_HREFS.canvas]) expect(route(href), href).toBe(true);
    expect(fs.existsSync(path.join(root, "src", "app", "(studio)", "apps", "[id]", "page.tsx"))).toBe(true);
    expect(APPS.some((a) => a.id === BENTO_BEFORE_AFTER)).toBe(true);
    const plan = JSON.parse(fs.readFileSync(path.join(root, "src", "lib", "examples", "plan.json"), "utf8")) as { id: string; surface: string; output?: string }[];
    expect(plan.find((r) => r.id === BENTO_IMAGE_EXAMPLE.id)).toMatchObject({ surface: "studio:image", output: BENTO_IMAGE_EXAMPLE.out });
    expect(BENTO_HREFS.numbers).toBe("#home-studios");
    expect(fs.readFileSync(path.join(root, "src", "components", "home", "home-sections.tsx"), "utf8")).toContain('id="home-studios"');
    // The words each link ends on are the place's own name.
    const t = bento.tiles;
    expect(t.video.cta).toBe(`Open ${navLabel("/cinema")}`);
    expect(t.image.cta).toBe(`Open ${navLabel("/image")}`);
    expect(t.audio.cta).toBe(`Open ${navLabel("/audio")}`);
    expect(t.threeD.cta).toBe(`Open ${navLabel("/image-to-3d")}`);
    expect(t.live.cta).toBe(`Open ${navLabel("/live-edit")}`);
    expect(t.canvas.cta).toBe(`Open ${navLabel("/canvas")}`);
    expect(t.restore.cta).toBe(`Open ${getPreset(BENTO_BEFORE_AFTER)!.name}`);
  });

  it("makes every tile one link with a name, in the grid's reading order", () => {
    const links = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
    const tiles = links.filter((a) => a.includes("data-tile="));
    expect(tiles.map((a) => /data-tile="([^"]+)"/.exec(a)![1])).toEqual(["video", "image", "audio", "threeD", "restore", "numbers", "live", "canvas"]);
    for (const a of tiles) {
      const label = /aria-label="([^"]+)"/.exec(a)?.[1];
      expect(label, a).toBeTruthy();
      expect(label!.length).toBeGreaterThan(10);
    }
    const KINDS = { video: "Video", image: "Image", audio: "Audio", threeD: "3D", restore: "Before and after", live: "Live edit", canvas: "Canvas" };
    for (const [key, kind] of Object.entries(KINDS)) {
      const t = bento.tiles[key as keyof typeof KINDS];
      expect(t.label).toBe(`${kind}: ${t.title}. ${t.cta}`);
    }
    // The numbers tile opens the studios list in place, and says so.
    expect(bento.tiles.numbers.label).toBe(`${bento.numbers[0].value} studios, ${bento.numbers[1].value} apps, ${bento.numbers[2].value} effects and camera moves. Opens all studios`);
    expect(tiles.find((a) => a.includes('data-tile="numbers"'))).toContain('aria-haspopup="dialog"');
    // No link or button inside a tile: the whole tile is the one target.
    for (const chunk of html.split("data-tile=").slice(1)) expect(chunk.split("</a>")[0]).not.toMatch(/<(a|button)\b/);
    // The page's only h1: the headline.
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.replace(/<[^>]+>/g, "")).toContain("Make anything: From an idea to a finished film, in one place.");
  });

  it("quotes the catalog's numbers, never typed in", () => {
    const f = bento.facts;
    const open = (kind: string) => MODELS.filter((m) => !m.hidden && (m.engine === "open" || m.engines?.includes("open")) && m.kind === kind).length;
    // The same studio count as the navigation's Studios badge and the launcher it opens.
    expect(f.studios).toBe(studioCount());
    expect(f.apps).toBe(APPS.length);
    expect(f.effectsAndMotions).toBe(EFFECTS.length + MOTIONS.length);
    expect(f.motions).toBe(MOTIONS.length);
    expect(f.openModels).toBe(modelCounts().open);
    expect([f.imageModels, f.videoModels, f.models3d]).toEqual([open("image"), open("video"), open("model3d")]);
    expect(openModelsOf("image")).toBe(open("image"));
    expect(f.soundTools).toBe(HUB_MODES.audio.length);
    expect(bento.numbers.map((n) => n.value)).toEqual([f.studios, f.apps, f.effectsAndMotions]);
    // No number in the components' own words: every one comes from the facts.
    for (const src of ["home-bento.tsx", "bento-islands.tsx"]) {
      const text = fs.readFileSync(path.join(root, "src", "components", "home", src), "utf8");
      const words = [...text.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]).filter((w) => !/[(){}=?;|&]/.test(w));
      for (const w of words) expect(w.replace(/RTX 5090|3D/g, ""), `${src}: "${w}"`).not.toMatch(/\d/);
    }
    const lib = fs.readFileSync(path.join(root, "src", "lib", "home-bento.ts"), "utf8");
    for (const m of lib.matchAll(/tile\("[a-zA-Z]+", "([^"]*)", (?:`([^`]*)`|"([^"]*)"), "([^"]*)", (?:`([^`]*)`|"([^"]*)")\)/g))
      for (const w of m.slice(1).filter(Boolean)) expect(w.replace(/\$\{[^}]+\}/g, "").replace(/3D/g, ""), w).not.toMatch(/\d/);
  });

  it("reads plainly: no model or maker names, no status or prompt words", () => {
    const visible = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;|&quot;|&amp;/g, " ")
      .replace(/\s+/g, " ");
    const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    const texts = [visible.replace(/Rendered locally on ComfyUI, on one RTX 5090\.|Every preview on this page was rendered locally on ComfyUI, on one RTX 5090\./g, ""), ...labels];
    const WORDS = new Set(["Relight", "Runway", "Canvas", "Image", "Audio", "Video"]);
    const names = [...new Set(MODELS.flatMap((m) => [m.name, m.vendor]).filter((n): n is string => !!n && n.trim().length >= 3 && !WORDS.has(n)))];
    const status = /\b(unverified|not checked|todo|tbd|test|placeholder|demo|preview made with|gpu|comfy|lora|checkpoint)\b/i;
    for (const t of texts) {
      for (const bad of FORBIDDEN_WORDS) expect(t, String(bad)).not.toMatch(bad);
      expect(t).not.toMatch(status);
      for (const n of names) expect(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t), `names ${n}: ${t}`).toBe(false);
    }
  });

  it("plays each clip in one place on Home (the playback store keys by id)", () => {
    const ids = [
      ...Object.values(BENTO_CLIPS),
      ...[...HOME_EFFECTS, ...HOME_MOTIONS, ...HOME_REVEALS].map((r) => r.id),
      ...HOME_BEFORE_AFTER.map((p) => p.id),
      ...HOME_STUDIOS.flatMap((s) => (s.id ? [s.id] : [])),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(HOME_STUDIOS.find((s) => s.href === "/image-to-3d")?.id).toBe("app-3d-figure");
    expect(home).not.toHaveProperty("wall");
  });

  it("draws the Audio tile from the sample's own loudness", () => {
    expect(bento.wave.bars).toHaveLength(48);
    for (const b of bento.wave.bars) {
      expect(b).toBeGreaterThanOrEqual(0.12);
      expect(b).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...bento.wave.bars)).toBe(1);
    // Made from the sample as it is now: a new sample needs node scripts/gen-home-bento.mjs again.
    expect(contentVersion([file(HOME_BENTO_WAVE.src)])).toBe(HOME_BENTO_WAVE.source);
    const ffmpeg = spawnSync("ffmpeg", ["-v", "error", "-i", file(HOME_BENTO_WAVE.src), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 64 << 20 });
    if (ffmpeg.status === 0) {
      const samples = new Int16Array(ffmpeg.stdout.buffer, ffmpeg.stdout.byteOffset, Math.floor(ffmpeg.stdout.length / 2));
      expect(samples.length / 8000).toBeCloseTo(HOME_BENTO_WAVE.seconds, 1);
    }
  });

  it("types the Live edit session's own words before the pictures they made", () => {
    const demo = JSON.parse(fs.readFileSync(path.join(root, "public", "previews", "live-edit", "demo.json"), "utf8"));
    const phrases = livePhrases(demo);
    expect(bento.live.phrases).toEqual(phrases);
    expect(phrases).toEqual(["evening makeup, deep red lips", "hair down, side-swept waves", "big gold hoop earrings"]);
    const typed = demo.script.filter((s: { type: string }) => s.type === "type").map((s: { text: string }) => s.text).join("");
    for (const p of phrases) expect(typed).toContain(p);
    expect(bento.live.frames).toHaveLength(4);
    for (const [i, f] of bento.live.frames.entries()) {
      const fr = demo.frames[`s${i}`];
      expect(f.avif.map((a) => a.src)).toEqual([fr.small, fr.mid]);
      expect(f.fallback).toBe(fr.webp);
    }
  });

  it("draws the Canvas board as the template builds it: its photo, two steps, its film", () => {
    const graph = getTemplate(BENTO_BOARD)!.build("open");
    const { photo, steps, film } = bento.canvas;
    expect([photo, ...steps, film].map((n) => n.label).sort()).toEqual(graph.nodes.map((n) => n.data.label).sort());
    expect(graph.nodes.find((n) => n.id === photo.id)?.type).toBe("image-input");
    expect(graph.nodes.find((n) => n.id === film.id)?.type).toBe("output");
    expect(photo.thumb).toMatch(/^\/previews\/home\/board-photo\.webp\?v=/);
    expect(film.thumb).toMatch(/^\/previews\/home\/board-film\.webp\?v=/);
  });
});
