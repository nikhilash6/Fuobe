import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoveList } from "@/components/cinema/move-list";
import { CoverTile } from "@/components/cover-tile";
import { CatalogProvider } from "@/components/studio/catalog";
import { ClearableChip } from "@/components/studio/chip";
import { MixChip, PresetChip, PresetGrid } from "@/components/studio/preset-chips";
import type { StudioConfig } from "@/components/studio/studio-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APPS, EFFECTS, MOTIONS } from "@/lib/catalog";
import { CAMERA_MOVES } from "@/lib/catalog/cinema";
import type { Preset } from "@/lib/catalog/types";
import { createPickerPlayback, PICKED_RESUME } from "@/lib/picker-playback";
import { moveCover, presetCover, thumbOf } from "@/lib/preset-covers";
import { PRESET_COVERS } from "@/lib/preset-covers.generated";
import { PRESET_PREVIEWS } from "@/lib/preset-previews.generated";
import { HOVER_INTENT } from "@/lib/preview-playback";
import type { StudioCatalog } from "@/lib/studio-catalog";

/*
 * The pickers show the same real covers as the galleries (the camera motion and Mix grids, Cinema Studio's moves),
 * rendered on the server as they first paint: small posters only, every clip waits for a hover, focus or pick.
 */

const grid = (list: Preset[], value?: string) => renderToStaticMarkup(createElement(PresetGrid, { list, value, noneLabel: "None", onPick: () => {} }));
/** The grid's tiles (not its category tabs), each as its markup. */
const tiles = (html: string) =>
  html
    .split("<button")
    .slice(1)
    .filter((b) => !b.includes('role="tab"'));
const covered = (list: Preset[]) => list.filter((p) => presetCover(p.id));
const count = (html: string, s: string) => html.split(s).length - 1;
const mixable = [...MOTIONS, ...EFFECTS].filter((p) => !p.inputs.some((i) => i.key === "endImage"));
const motion = (id: string) => MOTIONS.find((p) => p.id === id)!;

describe("the camera motion picker", () => {
  const html = grid(MOTIONS);
  const all = tiles(html);
  const tile = (p: Preset) => all.find((t) => t.includes(`>${p.name.replaceAll("&", "&amp;").replaceAll("'", "&#x27;")}</span>`))!;

  it("shows every motion's cover where it has one, as a small lazy poster; the others and None keep their drawn tile", () => {
    expect(all).toHaveLength(MOTIONS.length + 1);
    for (const p of MOTIONS) {
      const t = tile(p);
      expect(t, p.id).toBeDefined();
      const cover = presetCover(p.id);
      if (cover) {
        expect(t, p.id).toContain(`src="${cover.thumb}"`);
        expect(t, p.id).toMatch(/<img[^>]*loading="lazy"[^>]*decoding="async"/);
        expect(t, p.id).not.toContain("linear-gradient");
      } else {
        expect(t, p.id).toContain("linear-gradient");
        expect(t, p.id).not.toContain("<img");
      }
    }
    const none = all[0];
    expect(none).toContain(">None</span>");
    expect(none).not.toContain("<img");
    expect(none).toContain('aria-pressed="true"');
    expect(count(html, "<img")).toBe(covered(MOTIONS).length);
    expect(covered(MOTIONS).length).toBeGreaterThan(MOTIONS.length * 0.9);
  });

  it("never borrows another move's cover: Dolly Zoom Out shows its own, not Dolly Zoom In's opposite move", () => {
    const t = tile(motion("motion-dolly-zoom-out"));
    expect(t).not.toContain("motion-dolly-zoom-in");
    expect(t).toMatch(/src="\/previews\/presets\/thumbs\/motion-dolly-zoom-out\.jpg\?v=[0-9a-f]{8}"/);
  });

  it("shows 3D Rotation with its own turntable cover, not the 3D Rotation app's it showed before it had one", () => {
    const t = tile(motion("motion-3d-rotation"));
    expect(t).toMatch(/src="\/previews\/presets\/thumbs\/motion-3d-rotation\.jpg\?v=[0-9a-f]{8}"/);
    expect(t).not.toContain("app-3d-rotation");
    expect(t).not.toContain("linear-gradient");
  });

  it("loads no clip until one is hovered, focused or picked", () => {
    expect(html).not.toContain("<video");
    expect(html).not.toContain(".mp4");
  });

  it("marks the picked motion on its picture, and only that one", () => {
    const picked = covered(MOTIONS).find((p) => presetCover(p.id)!.video)!;
    const html = grid(MOTIONS, picked.id);
    const marked = tiles(html).filter((t) => t.includes('aria-pressed="true"'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain(`src="${presetCover(picked.id)!.thumb}"`);
    expect(marked[0]).toContain('data-picked=""');
    expect(count(html, "data-picked")).toBe(1);
  });
});

describe("the Mix picker", () => {
  it("shows the cover of every motion and effect that has one, small posters only", () => {
    const html = grid(mixable);
    for (const p of covered(mixable)) expect(html, p.id).toContain(`src="${presetCover(p.id)!.thumb}"`);
    // A cover shown whole (cover-framing.ts) has one picture too: its blurred fill is a background drawn only in a
    // frame that isn't 4:3, and a picker tile is 4:3.
    expect(count(html, "<img")).toBe(covered(mixable).length);
    expect(count(html, "linear-gradient")).toBe(mixable.length - covered(mixable).length);
    expect(html).not.toContain("<video");
  });
});

/** A JPEG's width and height, from its first frame header. */
function jpegSize(buf: Buffer): { width: number; height: number } {
  for (let i = 2; i < buf.length; ) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("no frame header");
}

describe("the pickers' small posters", () => {
  const pub = path.join(process.cwd(), "public");
  /** A cover URL's file, without its version (?v=). */
  const file = (url: string) => path.join(pub, ...url.split("?")[0].split("/").filter(Boolean));

  it("are each poster at most 320 px wide, in thumbs/ next to it, a fraction of its size", () => {
    let total = 0;
    for (const id of Object.keys(PRESET_COVERS)) {
      const cover = presetCover(id)!;
      expect(cover.thumb, id).toBe(thumbOf(cover.poster));
      expect(cover.thumb, id).toBe(cover.poster.replace(/\/([^/]+)$/, "/thumbs/$1"));
      const thumb = fs.readFileSync(file(cover.thumb));
      const { width } = jpegSize(thumb);
      expect(width, id).toBeLessThanOrEqual(320);
      expect(width, id).toBeGreaterThanOrEqual(Math.min(320, jpegSize(fs.readFileSync(file(cover.poster))).width));
      expect(thumb.length, id).toBeLessThan(fs.statSync(file(cover.poster)).size);
      total += thumb.length;
    }
    // About 12 KB each where the posters are 40 to 70: a tab of 16 tiles is about 200 KB, not 1.3 MB.
    expect(total / Object.keys(PRESET_COVERS).length).toBeLessThan(16_000);
  });
});

describe("the cover tile", () => {
  const clip = { poster: "/previews/presets/motion-zoom-in.jpg", thumb: "/previews/presets/thumbs/motion-zoom-in.jpg", video: "/previews/presets/motion-zoom-in.mp4" };
  const tile = (props: Partial<React.ComponentProps<typeof CoverTile>>) =>
    renderToStaticMarkup(createElement(CoverTile, { cover: clip, playing: false, className: "aspect-video", ...props }));

  it("shows the small poster at rest, lazily, filling its box without shifting anything", () => {
    const html = tile({});
    expect(html).toMatch(/<span class="[^"]*relative[^"]*aspect-video[^"]*"/);
    expect(html).toMatch(/<img [^>]*src="\/previews\/presets\/thumbs\/motion-zoom-in\.jpg"/);
    expect(html).toMatch(/loading="lazy"/);
    expect(html).toMatch(/class="absolute inset-0 size-full object-cover"/);
    expect(html).not.toContain("<video");
    expect(html).not.toContain(clip.poster);
  });

  it("adds the clip only while it plays, over the same small poster, and never for a cover that is a still", () => {
    // The galleries' clip player (PresetPreview's Clip), which sets its source once mounted in the browser.
    const playing = tile({ playing: true });
    expect(count(playing, "<video")).toBe(1);
    expect(playing).toMatch(/<img [^>]*src="\/previews\/presets\/thumbs\/motion-zoom-in\.jpg"[^>]*>(<!-- -->)?<video /);
    expect(playing).not.toContain(clip.poster);
    expect(tile({ playing: true, cover: { poster: clip.poster, thumb: clip.thumb } })).not.toContain("<video");
  });

  it("draws the fallback when there is no cover", () => {
    const html = tile({ cover: undefined, fallback: createElement("i", { className: "drawn" }), playing: true });
    expect(html).toContain('<i class="drawn"></i>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<video");
  });

  it("marks a picked tile with a check, or with its place in an order, which a screen reader reads", () => {
    expect(tile({})).not.toContain("data-picked");
    expect(tile({ picked: true })).toMatch(/data-picked=""[^>]*aria-hidden="true"[^>]*>.*<svg/);
    expect(tile({ picked: 2 })).toMatch(/<span data-picked=""(?![^>]*aria-hidden)[^>]*>2</);
  });
});

describe("the camera motion and Mix chips", () => {
  const config = (preset: Preset) => ({ feature: "video", kind: "video", ops: [], slots: [], preset }) as unknown as StudioConfig;
  const render = (preset: Preset, chip: React.ReactElement) =>
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(CatalogProvider, { catalog: { models: [], lookup: [] } as unknown as StudioCatalog, config: config(preset) } as React.ComponentProps<typeof CatalogProvider>, chip),
      ),
    );
  /** The chip itself (the popover's trigger), not its clear button. */
  const trigger = (html: string) => html.split("<button")[1];
  /** Every camera motion has a cover now: one without, as a motion added before its cover would be. */
  const bare: Preset = { ...motion("motion-dolly-zoom-out"), id: "motion-without-a-cover" };
  const zoom = motion("motion-zoom-in");

  it("show the picked motion's small poster in place of its icon, and the icon when it has no cover", () => {
    const withCover = trigger(render(zoom, createElement(PresetChip, { type: "motion", value: zoom.id, onChange: () => {} })));
    expect(withCover).toContain(`src="${presetCover(zoom.id)!.thumb}"`);
    expect(withCover).not.toContain("<svg");
    expect(withCover).toContain(">Zoom In</button>");
    const without = trigger(render(bare, createElement(PresetChip, { type: "motion", value: bare.id, onChange: () => {} })));
    expect(without).not.toContain("<img");
    expect(without).toContain("<svg");
  });

  it("show the mixed preset's small poster in place of the Mix icon", () => {
    const mix = (second: Preset) =>
      trigger(render(second, createElement(MixChip, { primary: motion("motion-crash-zoom-in"), strength: 0.8, mix: { presetId: second.id, strength: 0.6 }, onChange: () => {} })));
    expect(mix(zoom)).toContain(`src="${presetCover(zoom.id)!.thumb}"`);
    expect(mix(zoom)).not.toContain("<svg");
    expect(mix(bare)).not.toContain("<img");
    expect(mix(bare)).toContain("lucide-shuffle");
  });

  it("keep the chip where it is when a pick makes it clearable, so an open Mix doesn't remount and restart the clip", () => {
    // React keeps a subtree only while the elements above it stay the same: the chip sits in the same wrapper,
    // first, with or without its clear button.
    const chip = (active: boolean) =>
      renderToStaticMarkup(createElement(ClearableChip, { active, onClear: () => {}, clearLabel: "Remove the mix" } as React.ComponentProps<typeof ClearableChip>, createElement("i")));
    expect(chip(false)).toMatch(/^<span class="contents"><i><\/i><\/span>$/);
    expect(chip(true)).toMatch(/^<span class="[^"]*inline-flex[^"]*"><i><\/i><button [^>]*aria-label="Remove the mix"/);
  });
});

describe("Cinema Studio's camera moves", () => {
  it("show the cover of the camera motion each move runs, but Drone Orbit's ground-level orbit isn't a drone shot", () => {
    for (const m of CAMERA_MOVES) {
      if (m.slug === "drone-orbit") expect(moveCover(m), m.slug).toBeUndefined();
      else expect(moveCover(m), m.slug).toEqual(presetCover(m.motionId));
    }
    // Pedestal Up rises like Jib Up, whose clip it shows.
    expect(moveCover(CAMERA_MOVES.find((m) => m.slug === "pedestal-up")!)?.poster).toMatch(/^\/previews\/presets\/motion-jib-up\.jpg\?v=[0-9a-f]{8}$/);
    expect(CAMERA_MOVES.filter((m) => moveCover(m)).length).toBeGreaterThan(30);
  });

  it("list them with their small poster, and the order number on it once picked, read out with the move", () => {
    const html = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(MoveList, { engine: "open", selected: ["dolly-in"], onPick: () => {} })));
    const rows = html.split('cmdk-item=""').slice(1);
    expect(rows).toHaveLength(CAMERA_MOVES.length);
    for (const m of CAMERA_MOVES) {
      const row = rows.find((r) => r.includes(`>${m.name}<`))!;
      const cover = moveCover(m);
      if (cover) expect(row, m.slug).toContain(`src="${cover.thumb}"`);
      else expect(row, m.slug).not.toContain("<img");
    }
    expect(html).not.toContain("<video");
    const dolly = rows.find((r) => r.includes(">Dolly In<"))!;
    // The number is in no aria-hidden element: the row's name starts with it, as before the covers.
    expect(dolly).toMatch(/<span data-picked=""(?![^>]*aria-hidden)[^>]*>1<\/span>/);
  });
});

describe("which covers the pickers borrow", () => {
  it("none while every preset has its own (3D Rotation shows the 3D Rotation app's turntable shot only without one)", () => {
    const borrowed = [...APPS, ...MOTIONS, ...EFFECTS].filter((p) => !PRESET_PREVIEWS[p.id] && presetCover(p.id)).map((p) => p.id);
    expect(borrowed).toEqual([]);
  });
});

/** The browser as the picker's playback sees it, with a clock that only moves when told. */
function fakeEnv({ reduced = false, saveData = false, hover = true } = {}) {
  let now = 0;
  const timers = new Set<{ at: number; cb: () => void }>();
  const next = () => [...timers].sort((a, b) => a.at - b.at)[0];
  const advance = (ms: number) => {
    const end = now + ms;
    for (let due = next(); due && due.at <= end; due = next()) {
      timers.delete(due);
      now = due.at;
      due.cb();
    }
    now = end;
  };
  const env = {
    matches: (q: string) => (q.includes("reduced-motion") ? reduced : q.includes("hover") ? hover : false),
    delay: (cb: () => void, ms: number) => {
      const t = { at: now + ms, cb };
      timers.add(t);
      return () => void timers.delete(t);
    },
    saveData: () => saveData,
  };
  return { env, advance };
}

describe("which picker tile plays", () => {
  it("plays the picked tile when the picker opens, and the hovered one instead once the pointer rests on it", () => {
    const { env, advance } = fakeEnv();
    const p = createPickerPlayback(env);
    expect(p.plays("picked", true)).toBe(true);
    expect(p.plays("other")).toBe(false);
    p.play("other");
    advance(HOVER_INTENT - 1);
    expect([p.plays("picked", true), p.plays("other")]).toEqual([true, false]);
    advance(1);
    expect([p.plays("picked", true), p.plays("other")]).toEqual([false, true]);
  });

  it("doesn't restart the picked tile while the pointer moves from tile to tile, only once it has left them", () => {
    const { env, advance } = fakeEnv();
    const p = createPickerPlayback(env);
    p.play("a");
    advance(HOVER_INTENT);
    p.stop("a");
    expect(p.plays("picked", true)).toBe(false);
    advance(PICKED_RESUME / 2);
    p.play("b");
    advance(HOVER_INTENT);
    expect([p.plays("picked", true), p.plays("a"), p.plays("b")]).toEqual([false, false, true]);
    // Passing over a tile without resting on it doesn't play it, and doesn't hold the picked one off for good.
    p.stop("b");
    p.play("c");
    p.stop("c");
    advance(PICKED_RESUME - 1);
    expect([p.plays("picked", true), p.plays("c")]).toEqual([false, false]);
    advance(1);
    expect(p.plays("picked", true)).toBe(true);
  });

  it("keeps the picked tile's clip going while the pointer rests on it and after it leaves: no gap, no restart", () => {
    const { env, advance } = fakeEnv();
    const p = createPickerPlayback(env);
    p.play("picked");
    advance(HOVER_INTENT);
    expect(p.plays("picked", true)).toBe(true);
    // The pointer (or keyboard focus) leaves the picked tile: it plays on at once, so its clip isn't remounted.
    p.stop("picked", true);
    expect(p.plays("picked", true)).toBe(true);
    advance(PICKED_RESUME);
    expect(p.plays("picked", true)).toBe(true);
    // Another tile still takes over once the pointer rests on it, and gives the picked one back after.
    p.play("other");
    advance(HOVER_INTENT);
    expect([p.plays("picked", true), p.plays("other")]).toEqual([false, true]);
    p.stop("other");
    advance(PICKED_RESUME);
    expect(p.plays("picked", true)).toBe(true);
  });

  it("keeps a tile playing that was picked while it played, when the pointer goes on to the strength slider", () => {
    const { env, advance } = fakeEnv();
    const p = createPickerPlayback(env);
    p.play("a");
    advance(HOVER_INTENT);
    // Clicked: "a" is the picked tile now (Mix stays open after a pick), and the pointer leaves it.
    p.stop("a", true);
    expect(p.plays("a", true)).toBe(true);
  });

  it("plays one tile at a time, the last one asked for", () => {
    const { env, advance } = fakeEnv();
    const p = createPickerPlayback(env);
    p.play("a");
    advance(HOVER_INTENT);
    p.play("b");
    advance(HOVER_INTENT);
    expect([p.plays("a"), p.plays("b")]).toEqual([false, true]);
    p.stop("a");
    expect(p.plays("b")).toBe(true);
  });

  it("keeps the picked tile on its poster with Save-Data or on 2G (it plays unasked), but plays a hovered one", () => {
    const { env, advance } = fakeEnv({ saveData: true });
    const p = createPickerPlayback(env);
    expect(p.plays("picked", true)).toBe(false);
    p.play("other");
    advance(HOVER_INTENT);
    expect(p.plays("other")).toBe(true);
  });

  it("plays nothing when the user prefers reduced motion", () => {
    const { env, advance } = fakeEnv({ reduced: true });
    const p = createPickerPlayback(env);
    expect(p.plays("picked", true)).toBe(false);
    p.play("other");
    advance(HOVER_INTENT);
    expect(p.plays("other")).toBe(false);
  });

  it("tells a device that can hover from a phone (a list's highlighted row plays only where it can)", () => {
    expect(createPickerPlayback(fakeEnv().env).canHover()).toBe(true);
    expect(createPickerPlayback(fakeEnv({ hover: false }).env).canHover()).toBe(false);
  });
});
