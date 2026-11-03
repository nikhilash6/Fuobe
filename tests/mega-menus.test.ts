import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { APPS, EFFECTS, MODELS, MOTIONS } from "@/lib/catalog";
import { CANVAS_TEMPLATES } from "@/lib/catalog/canvas";
import { APP_GROUPS, appsMenu, canvasMenu, EFFECT_GROUPS, LINE_MAX, menuCategory, MOTION_GROUPS, motionsMenu, presetLine, sameIdea, SERVER_MENUS, shortLine, type PresetGroup } from "@/lib/mega-menus.server";
import { megaItems, megaMove, packMenu, ROW_CAPS, studiosMenu, TILE_COLS, TILE_ROWS, unpackMenu, type MegaModel } from "@/lib/mega-menus";
import { keyPlaces } from "@/components/nav/mega-panel";
import { CANVAS_INTRO } from "@/lib/canvas-template-cards";
import { MENU_LINES } from "@/lib/menu-lines";
import type { Preset } from "@/lib/catalog/types";
import { launcherColumns, subParent } from "@/lib/nav-model";
import { featuredAll } from "@/lib/preset-featured";
import { PRESET_COVERS } from "@/lib/preset-covers.generated";
import { templateCover } from "@/lib/template-covers";

const PUBLIC = path.resolve(__dirname, "../public");
const file = (url: string) => path.join(PUBLIC, url.split("?")[0]);

function mapsOnce(items: readonly Preset[], groups: readonly PresetGroup[]) {
  for (const cat of new Set(items.map(menuCategory))) {
    expect(groups.filter((g) => g.categories.includes(cat)).map((g) => g.id), `category ${cat}`).toHaveLength(1);
  }
  // No group names a category the catalog doesn't have.
  for (const g of groups) for (const cat of g.categories) expect(items.some((p) => menuCategory(p) === cat), `${g.id}: ${cat}`).toBe(true);
}

describe("the fetched menus' groups", () => {
  it("map every catalog category to exactly one column", () => {
    mapsOnce(APPS, APP_GROUPS);
    mapsOnce(MOTIONS, MOTION_GROUPS);
    mapsOnce(EFFECTS, EFFECT_GROUPS);
  });

  it("say the true counts", () => {
    expect(appsMenu().count).toBe(APPS.length);
    expect(appsMenu().countLine).toBe(`${APPS.length} apps, grouped by what they change`);
    const m = motionsMenu();
    expect(m.countLine).toBe(`${MOTIONS.length} camera motions and ${EFFECTS.length} effects, for any photo`);
    expect(m.families?.map((f) => [f.href, f.count])).toEqual([
      ["/motions", MOTIONS.length],
      ["/effects", EFFECTS.length],
    ]);
  });

  it("have six columns, motions left of effects", () => {
    expect(appsMenu().columns).toHaveLength(6);
    const m = motionsMenu();
    expect(m.columns).toHaveLength(6);
    expect(m.columns.map((c) => c.family)).toEqual(["motions", "motions", "motions", "effects", "effects", "effects"]);
  });
});

describe.each([
  ["apps", appsMenu, APPS],
  ["motions", motionsMenu, [...MOTIONS, ...EFFECTS]],
] as const)("the %s menu", (_id, build, items) => {
  const menu = build();
  // Each kind in its own premium order (a column holds one kind).
  const rank = new Map([APPS, MOTIONS, EFFECTS].flatMap((kind) => featuredAll(kind).map((p, i) => [p.id, i] as const)));

  it("leads each column with its strongest preset that has a cover of its own, then the rest premium first", () => {
    for (const c of menu.columns) {
      const ids = [c.lead!, ...c.rows].map((e) => e.id);
      const order = ids.map((id) => rank.get(id)!);
      expect(order, c.id).toEqual([...order].sort((a, b) => a - b));
      expect(Object.hasOwn(PRESET_COVERS, c.lead!.id), c.id).toBe(true);
      expect(c.rows.length, c.id).toBeLessThanOrEqual(ROW_CAPS.tall);
      // One of each idea ("Angles", "Fuobe Angles", "Any Angle": the strongest only).
      expect(new Set(ids.map((id) => sameIdea(items.find((p) => p.id === id)!.name))).size, c.id).toBe(ids.length);
    }
  });

  it("shows at most seven rows under a lead, as Studios", () => {
    expect(ROW_CAPS.tall).toBeLessThanOrEqual(7);
    for (const c of menu.columns) expect(c.rows.length, c.id).toBeLessThanOrEqual(7);
  });

  it("orders its columns by their strongest preset (within a family)", () => {
    const families = [...new Set(menu.columns.map((c) => c.family ?? ""))];
    for (const f of families) {
      const firsts = menu.columns.filter((c) => (c.family ?? "") === f).map((c) => rank.get(c.lead!.id)!);
      expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
    }
  });

  it("names each item once, with a cover at a versioned URL whose files exist, an href, and a plain line", () => {
    const all = megaItems(menu);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (const e of all) {
      expect(e.cover?.poster, e.id).toMatch(/\?v=[0-9a-f]{8}$/);
      for (const u of [e.cover!.poster, e.cover!.thumb, e.cover!.mini!]) expect(fs.existsSync(file(u)), u).toBe(true);
      expect(e.href, e.id).toMatch(e.id.startsWith("app-") ? /^\/apps\/app-/ : /^\/video\?preset=/);
      expect(e.line, e.id).toBeTruthy();
      // One row's line, whole: no "…", within LINE_MAX (about 26 characters, as Studios' lines).
      expect(e.line!.length, `${e.id}: ${e.line}`).toBeLessThanOrEqual(LINE_MAX);
      expect(e.line, e.id).not.toMatch(/…$/);
      expect(items.some((p) => p.category === e.line), `${e.id} line is a category`).toBe(false);
    }
  });
});

describe("the Canvas menu", () => {
  const menu = canvasMenu();
  const boards = menu.columns.filter((c) => c.variant === "tiles").flatMap((c) => c.rows);

  it("lists the ready boards a visitor sees, each with its finished scene (a still or a peak frame), and counts them", () => {
    const visible = CANVAS_TEMPLATES.filter((t) => t.starter !== false && templateCover("canvas", t.id));
    const bare = CANVAS_TEMPLATES.filter((t) => t.starter !== false && !templateCover("canvas", t.id));
    // The tiles: every board with a cover but the one "What's a canvas?" shows, up to TILE_ROWS rows of TILE_COLS a section.
    const shown = visible.filter((t) => t.id !== CANVAS_INTRO);
    const sections = menu.columns.filter((c) => c.variant === "tiles");
    expect(boards.length).toBe(Math.min(shown.length, TILE_ROWS * TILE_COLS * sections.length));
    for (const b of boards) expect(shown.map((t) => t.id), b.id).toContain(b.id);
    for (const t of bare) expect(boards.map((b) => b.id)).not.toContain(t.id);
    expect(menu.count).toBe(visible.length);
    expect(menu.countLine).toBe(`${visible.length} ready boards that run as they are`);
    for (const b of boards) {
      expect(b.cover?.poster, b.id).toBe(templateCover("canvas", b.id)!.poster);
      expect(b.cover?.poster, b.id).toMatch(/^\/previews\/(presets\/peak|templates\/canvas)\/[^/]+\.jpg\?v=/);
    }
    for (const c of sections) expect(c.rows.length, c.id).toBeLessThanOrEqual(TILE_ROWS * TILE_COLS);
  });

  it("gives each board a whole line that fits its tile: its own menu line, or its description when that is short", () => {
    for (const b of boards) {
      const t = CANVAS_TEMPLATES.find((x) => x.id === b.id)!;
      expect(b.line!.length, `${b.id}: ${b.line}`).toBeLessThanOrEqual(LINE_MAX);
      expect([MENU_LINES[b.id], shortLine(t.description)], b.id).toContain(b.line);
      // No cut-off phrase ("You step", "You take the stage under"): a written line, or the whole first sentence.
      if (!MENU_LINES[b.id]) expect(t.description.split(/\.\s/)[0].replace(/\.$/, ""), b.id).toBe(b.line);
    }
  });

  it("starts with What's a canvas? on a board whose scene the tiles leave out, and ends with See all", () => {
    expect(menu.columns[0].lead?.label).toBe("What's a canvas?");
    expect(menu.columns[0].owner).toBe("canvas-start");
    expect(menu.columns[0].lead?.cover?.poster).toBe(templateCover("canvas", CANVAS_INTRO)!.poster);
    expect(boards.map((b) => b.id)).not.toContain(CANVAS_INTRO);
    expect(menu.columns.at(-1)?.more).toEqual({ href: "/canvas?tab=templates", label: "See all ready boards" });
  });

  it("holds no model name", () => {
    const text = JSON.stringify(menu);
    for (const name of ["Fuobe DoP", "Qwen", "free on your GPU", ...MODELS.map((m) => m.name).filter((n) => n.length > 5)]) expect(text, name).not.toContain(name);
  });
});

describe("the menus' size", () => {
  it.each(Object.keys(SERVER_MENUS) as (keyof typeof SERVER_MENUS)[])("%s is at most 4 KB gzipped", (id) => {
    const menu = SERVER_MENUS[id]();
    const wire = JSON.stringify(packMenu(menu));
    expect(gzipSync(wire).length).toBeLessThanOrEqual(4096);
    // The browser gets back exactly the menu the server built.
    expect(unpackMenu(JSON.parse(wire))).toEqual(menu);
  });
});

describe("Studios as a menu", () => {
  it("is the launcher's columns, a studio that is a tab of another's suite under that one", () => {
    for (const kind of [undefined, "guest", "account", "owner"] as const) {
      const m: MegaModel = studiosMenu(kind);
      expect(m.columns.map((c) => [c.id, c.lead?.id, ...c.rows.map((r) => r.id)])).toEqual(
        launcherColumns(kind).map((c) => [c.group.id, c.lead.id, ...c.rest.map((e) => e.id)]),
      );
      // The desktop menu lists Ads Studio under Marketing Studio, not as a row (the phone's sheet keeps its tile).
      expect(megaItems(m).filter((e) => e.under).map((e) => [e.id, e.under])).toEqual([["ads", subParent("ads")]]);
      const marketing = m.columns.find((c) => c.id === "sell")!.lead!;
      expect(marketing.subs!.map((s) => [s.id, s.href])).toEqual([
        ["marketing-click-to-ad", "/marketing/click-to-ad"],
        ["ads", "/ads"],
        ["ads-multiplier", "/ads/multiplier"],
      ]);
      // A studio's features stay out of the phone's "All" (megaItems: leads and rows).
      expect(megaItems(m).some((e) => e.id.startsWith("genjutsu-"))).toBe(false);
      // Built once per kind of viewer.
      expect(studiosMenu(kind)).toBe(m);
    }
  });
});

describe("a preset's line", () => {
  it("is its menu line, else Home's caption or the description made short, never ending on a loose word", () => {
    expect(presetLine({ id: "motion-dolly-in", description: "x" })).toBe("A slow push in toward them");
    expect(presetLine({ id: "x", description: "A fast, punchy move. More here." })).toBe("A fast, punchy move");
    expect(shortLine("The camera slowly and steadily zooms in on the subject, building tension")).toBe("Slowly and steadily zooms");
    expect(shortLine("Tap a piece, pick a colour; the fabric stays")).toBe("Tap a piece, pick a colour");
  });
});

describe("the menus' groups by what an app takes", () => {
  it("put an app that takes no photo (a voice, a video) with the video apps", () => {
    const voice = { type: "app", category: "Utility", inputs: [{ accept: "audio" }] } as unknown as Preset;
    const photo = { type: "app", category: "Utility", inputs: [{ accept: "image" }] } as unknown as Preset;
    expect(menuCategory(voice)).toBe("Video");
    expect(menuCategory(photo)).toBe("Utility");
    const restyle = appsMenu().columns.find((c) => c.id === "restyle")!;
    expect([restyle.lead!, ...restyle.rows].map((e) => e.id)).not.toContain("app-clean-up-voice");
  });
});

describe("the keys' places", () => {
  it("stack two tiles sections on the same key columns, the lower one's rows after the upper one's", () => {
    const tiles = (n: number) => ({ id: `t${n}`, label: "", chip: "", variant: "tiles" as const, span: 4, rows: Array.from({ length: n }, (_, i) => ({ id: `b${n}-${i}`, href: "/", label: "" })) });
    const start = { id: "start", label: "", chip: "", span: 2, rows: [] };
    expect(keyPlaces([start, tiles(8), tiles(5)])).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 1, row: 2 },
    ]);
  });
});

describe("the arrow keys across columns", () => {
  it("skip hidden rows (the lengths count only the rows that show) and move between families", () => {
    // Six columns of 7 shown rows (lead + 6 at 720 px).
    const lengths = [7, 7, 7, 7, 7, 7];
    expect(megaMove(lengths, { col: 2, row: 6 }, "ArrowRight")).toEqual({ col: 3, row: 6 });
    expect(megaMove(lengths, { col: 0, row: 6 }, "ArrowDown")).toBeNull();
    // Canvas: a 2-track start column (one link), then four tile columns of two rows.
    expect(megaMove([1, 2, 2, 2, 2], { col: 0, row: 0 }, "ArrowRight")).toEqual({ col: 1, row: 0 });
    expect(megaMove([1, 2, 2, 2, 2], { col: 1, row: 1 }, "ArrowLeft")).toEqual({ col: 0, row: 0 });
    expect(megaMove([1, 2, 2, 2, 2], { col: 4, row: 0 }, "End")).toEqual({ col: 4, row: 1 });
  });
});
