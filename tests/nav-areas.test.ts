import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/*
 * The area pages (/create, /studios, /apps, /motions-and-effects): what each one lists, against the navigation model, for
 * each kind of viewer; their premium-first order; which bar item and phone tab each page marks; and the routes their
 * menus load ahead.
 */

vi.mock("next/cache", () => ({ cacheLife: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { AREAS, areaCount, areaOfPath, areaPageOf, areaSections, cardsToShow, PILL_ONLY, rankCards } = await import("@/lib/nav-areas");
const { appsAreaShowcase, areaCover, areaShowcase, fxItem, fxSections, fxShowcase, MOTIONS_AREA_LINE_MAX, MOTIONS_AREA_WALL, motionsAreaShowcase, premiumFirst } = await import("@/lib/area-showcase");
const { FX_HOME, FX_SECTIONS, fxNavIds, inFx } = await import("@/lib/fx-tools");
const { CREATE_COLUMNS, activeEntry, entry, launcherEntries, LAUNCHER_GROUPS, NAV_ENTRIES, studioCount, visibleTo } = await import("@/lib/nav-model");
const createMenu = await import("@/components/nav/create-menu");
const { barActive, prefetchHrefs } = await import("@/components/nav/top-bar");
const { activePhoneTab } = await import("@/components/nav/phone-nav");
const { HOME_STUDIOS } = await import("@/lib/home-showcase");
const { HOME_CAPTION_MAX } = await import("@/lib/home-showcase");
const { FEATURED_BANDS, featuredBand } = await import("@/lib/preset-featured");
const { PRESET_COVERS } = await import("@/lib/preset-covers.generated");
const { APPS, EFFECTS, MOTIONS } = await import("@/lib/catalog");
const { categoryFrom, skippedInAll } = await import("@/lib/gallery-category");

const KINDS = [undefined, "guest", "account", "owner"] as const;
/** Words no visitor reads about the site itself. */
const STATUS = /\b(beta|unverified|not checked|coming soon|demo|placeholder|experimental|wip)\b/i;
const ids = (id: "create" | "studios", kind?: (typeof KINDS)[number]) => areaSections(id, kind).flatMap((s) => [...s.cards, ...s.chips, ...(s.subs ?? []).flatMap((x) => x.ids)]);

describe("what each area lists", () => {
  it("names only entries of the navigation model, each once per page, and only what the viewer may see", () => {
    for (const id of ["create", "studios"] as const)
      for (const kind of KINDS) {
        const all = ids(id, kind);
        for (const i of all) {
          const e = entry(i);
          expect(e, `${id}: ${i}`).toBeDefined();
          expect(visibleTo(e!, kind), `${id} for ${kind}: ${i}`).toBe(true);
        }
        expect(new Set(all).size, `${id} for ${kind}`).toBe(all.length);
      }
  });

  it("shows a guest and an account nothing that is the owner's", () => {
    for (const id of ["create", "studios"] as const)
      for (const kind of [undefined, "guest", "account"] as const)
        for (const i of ids(id, kind)) expect(entry(i)!.visibility ?? [], `${id}: ${i}`).not.toEqual(["owner"]);
    // Restore & colourise is everyone's: it runs on a visitor's own GPU or key, and says so (its home is Fuobe FX).
    const fx = (kind: (typeof KINDS)[number]) => fxSections(kind).flatMap((s) => [...s.cards, ...s.pills]);
    expect(fx("owner")).toContain("video-tools-restore");
    expect(fx("guest")).toContain("video-tools-restore");
    for (const kind of [undefined, "guest", "account"] as const)
      for (const i of fx(kind)) if (entry(i)) expect(entry(i)!.visibility ?? [], `fx: ${i}`).not.toEqual(["owner"]);
  });

  it("gives every card a cover from the catalog, or a picture drawn for it, and a line that fits two lines", async () => {
    for (const id of ["create", "studios"] as const) {
      const { sections } = await areaShowcase(id);
      for (const s of sections)
        for (const c of s.cards) {
          if (c.card) expect(PRESET_COVERS, `${id}: ${c.id}`).toHaveProperty(c.card.id);
          else expect(["live-edit", "canvas"], `${id}: ${c.id} has no cover`).toContain(c.id);
          expect(c.line, `${id}: ${c.id}`).toMatch(/[.!?]$/);
          if (!HOME_STUDIOS.some((h) => h.href === c.href)) expect(c.line.length, `${id}: ${c.id}`).toBeLessThanOrEqual(64);
        }
    }
    // The model's lines too, wherever an area draws its entry as a card.
    for (const e of NAV_ENTRIES) if (e.line) expect(e.line.length, e.id).toBeLessThanOrEqual(64);
  });

  it("says the same thing about a studio as Home does", async () => {
    const { sections } = await areaShowcase("studios");
    const cinema = sections.flatMap((s) => s.cards).find((c) => c.id === "cinema")!;
    expect(cinema.line).toMatch(/^Direct a film shot by shot/);
  });

  it("puts no status words in front of a visitor", async () => {
    for (const a of AREAS) expect(`${a.title} ${a.line}`).not.toMatch(STATUS);
    for (const id of ["create", "studios"] as const) {
      const { sections } = await areaShowcase(id);
      for (const s of sections) {
        expect(`${s.title} ${s.line}`).not.toMatch(STATUS);
        for (const c of s.cards) expect(`${c.label} ${c.line}`, c.id).not.toMatch(STATUS);
        for (const p of s.pills) expect(p.label, p.id).not.toMatch(STATUS);
      }
    }
  });
});

describe("/studios", () => {
  it("has a section per launcher group, every studio in its own group's section once, and Apps as a pill", () => {
    for (const kind of KINDS) {
      const sections = areaSections("studios", kind);
      expect(sections.map((s) => s.id)).toEqual(LAUNCHER_GROUPS.map((g) => g.id));
      const listed = sections.flatMap((s) => [...s.cards, ...s.chips]);
      const studios = launcherEntries(kind).filter((e) => e.kind === "studio");
      for (const s of studios) {
        expect(listed.filter((c) => c === s.id), s.id).toHaveLength(1);
        const own = sections.find((x) => x.id === s.group)!;
        expect([...own.cards, ...own.chips], s.id).toContain(s.id);
      }
      expect(sections.flatMap((s) => s.cards)).not.toContain("apps");
      expect(sections.find((s) => s.id === "finish")!.chips).toContain("apps");
    }
  });

  it("gives each page one home: a card on /create is a pill here, and no card is on both pages", () => {
    const create = new Set(areaSections("create", "guest").flatMap((s) => s.cards));
    const studios = areaSections("studios", "guest");
    for (const id of studios.flatMap((s) => s.cards)) expect(create.has(id), id).toBe(false);
    for (const id of ["upscale", "lipsync", "audio-translate", "image-to-3d"]) {
      expect(create.has(id), id).toBe(true);
      expect(studios.flatMap((s) => s.chips), id).toContain(id);
    }
    for (const id of ["katana", "video-edit", "cinema", "audio"]) expect(create.has(id), id).toBe(false);
    for (const id of ["katana", "video-edit"]) expect(studios.flatMap((s) => s.cards), id).toContain(id);
  });

  it("counts its studios as the bar does", () => {
    for (const kind of KINDS) expect(areaCount("studios", kind)).toBe(studioCount());
  });

  it("lists what each studio holds inside in a row of its own, never a pill that repeats a card or a pill", () => {
    const sections = areaSections("studios", "guest");
    const subsOf = (section: string, parent: string) => sections.find((s) => s.id === section)!.subs!.find((x) => x.parent === parent)?.ids ?? [];
    // Ads Studio is a studio with a card or pill of its own here: Marketing Studio's row has the other two.
    expect(subsOf("sell", "marketing")).toEqual(["marketing-click-to-ad", "ads-multiplier"]);
    // Genjutsu and Video tools live in Fuobe FX: no row of theirs here.
    expect(subsOf("people", "genjutsu")).toEqual([]);
    expect(subsOf("film", "video-tools")).toEqual([]);
    expect(subsOf("people", "character-sheet")).toEqual(["character-sheet-reference", "character-sheet-cast", "character-sheet-describe"]);
    expect(subsOf("sound", "audio")).not.toContain("audio-music"); // a card of its own
    for (const s of sections) {
      // A tool is a pill of the section only when it is in the bar's menu itself (the Sound column's modes).
      expect(s.chips.filter((c) => entry(c)!.kind === "tool" && !entry(c)!.group), s.id).toEqual([]);
      const hrefs = new Set([...s.cards, ...s.chips].map((c) => entry(c)!.href));
      for (const c of s.chips) expect(s.cards.map((x) => entry(x)!.href), `${s.id}: ${c}`).not.toContain(entry(c)!.href);
      for (const x of s.subs ?? []) for (const c of x.ids) expect(hrefs.has(entry(c)!.href), `${s.id}: ${c}`).toBe(false);
    }
    // Cinema Studio's Blockout is linked for everyone.
    const owner = areaSections("studios", "owner");
    expect(owner.find((s) => s.id === "film")!.subs!.find((x) => x.parent === "cinema")!.ids).toEqual(["cinema-blockout"]);
    expect(subsOf("film", "cinema")).toEqual(["cinema-blockout"]);
  });
});

describe("/create", () => {
  it("shows every entry of the Create menu but Assist (an item of the bar), as a card or a pill, and the menu reads the model's own columns", () => {
    const all = ids("create", "guest");
    for (const c of CREATE_COLUMNS) for (const id of c.ids) if (id !== "assist") expect(all, id).toContain(id);
    expect(all).not.toContain("assist");
    expect(all).not.toContain("new");
    expect(createMenu.CREATE_COLUMNS).toBe(CREATE_COLUMNS);
  });

  it("has Make, Edit a picture, Edit a clip and Sound, with Any Angle as an app of its own", () => {
    const sections = areaSections("create", "guest");
    expect(sections.map((s) => s.title)).toEqual(["Make", "Edit a picture", "Edit a clip", "Sound"]);
    expect(sections[0].cards).toContain("any-angle");
    expect(sections[3].cards).toEqual([]);
    expect(sections[3].chips[0]).toBe("audio");
    expect(entry("any-angle")).toMatchObject({ href: "/apps/app-any-angle", kind: "tool", parent: "apps" });
  });
});

describe("full rows", () => {
  it("shows 4 or 8 cards a section, or none, the rest as its first pills", async () => {
    expect([0, 1, 3, 4, 5, 7, 8, 12].map(cardsToShow)).toEqual([0, 0, 0, 4, 4, 4, 8, 8]);
    for (const id of ["create", "studios"] as const) {
      const { sections } = await areaShowcase(id);
      for (const s of sections) expect([0, 4, 8], `${id} › ${s.id}`).toContain(s.cards.length);
    }
  });

  it("never draws a flat or drawn cover as a card", () => {
    for (const id of ["create", "studios"] as const)
      for (const kind of KINDS) for (const s of areaSections(id, kind)) for (const p of PILL_ONLY) expect(s.cards, `${id} › ${s.id}`).not.toContain(p);
  });

  it("shows the owner the same cards and sections as everyone (only their pills differ)", () => {
    for (const id of ["create", "studios"] as const) {
      const guest = areaSections(id, undefined, premiumFirst);
      const owner = areaSections(id, "owner", premiumFirst);
      expect(owner.map((s) => s.id)).toEqual(guest.map((s) => s.id));
      owner.forEach((s, i) => expect(s.cards, `${id} › ${s.id}`).toEqual(guest[i].cards));
    }
  });

  it("uses Home's cover for a studio Home shows, unless another page already has that picture", () => {
    expect(areaCover("mixed-media")).toBe(HOME_STUDIOS.find((h) => h.href === "/mixed-media")!.id);
    expect(areaCover("audio")).toBe(entry("audio")!.cover);
  });
});

describe("premium first", () => {
  it("keeps each section's lead first and orders the rest by their cover's featured band", () => {
    const band = (c: string) => ({ "app-relight": 2, "app-packshot": 0, "app-change-background": 1 })[c] ?? 3;
    expect(rankCards(["edit", "inpaint", "layers"], band)).toEqual(["edit", "layers", "inpaint"]);
    expect(rankCards([], band)).toEqual([]);
  });

  it("never fills a section's first row with a cover from the last band", async () => {
    for (const id of ["create", "studios"] as const) {
      const { sections } = await areaShowcase(id);
      for (const s of sections)
        for (const c of s.cards.slice(0, 4)) if (c.card) expect(featuredBand(c.card.id), `${id} › ${s.id}: ${c.id}`).toBeLessThan(FEATURED_BANDS - 1);
    }
  });
});

describe("Motions & effects and Apps", () => {
  it("opens on a wall of real clips that fit a phone's tile, and rows that leave the wall out", async () => {
    const m = await motionsAreaShowcase();
    expect(m.wall).toHaveLength(8);
    for (const t of MOTIONS_AREA_WALL) expect(t.caption.length, t.id).toBeLessThanOrEqual(HOME_CAPTION_MAX.wall);
    for (const t of m.wall) expect(t.card.preview.video, t.id).toBeTruthy();
    for (const t of m.wall) expect(featuredBand(t.id), t.id).toBe(0);
    const wall = new Set<string>(m.wall.map((t) => t.id));
    for (const r of [...m.motions.row, ...m.effects.row]) expect(wall.has(r.card.id), r.card.id).toBe(false);
    for (const r of [...m.motions.row, ...m.effects.row]) {
      expect(r.caption.length, r.card.id).toBeLessThanOrEqual(MOTIONS_AREA_LINE_MAX);
      expect(r.caption, r.card.id).not.toMatch(/…|\.\.\.$/);
    }
    expect(m.motions.count).toBe(MOTIONS.length);
    expect(m.effects.count).toBe(EFFECTS.length);
    expect(new Set(m.motions.categories)).toEqual(new Set(MOTIONS.map((p) => p.category)));
  });

  it("starts /apps with Home's Apps section and keeps those apps out of the gallery's All view only", async () => {
    const a = await appsAreaShowcase();
    expect(a.shown.length).toBeGreaterThan(0);
    for (const id of a.shown) expect(APPS.some((p) => p.id === id), id).toBe(true);
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(skippedInAll(items, ["b"], false).map((i) => i.id)).toEqual(["a", "c"]);
    expect(skippedInAll(items, ["b"], true)).toHaveLength(3);
    expect(skippedInAll(items, undefined, false)).toHaveLength(3);
  });

  it("opens a gallery on the category a link asks for, and only one it has", () => {
    expect(categoryFrom("?category=Orbit", ["Orbit", "Lateral"])).toBe("Orbit");
    expect(categoryFrom("?category=Drone%20%26%20Vehicle", ["Drone & Vehicle"])).toBe("Drone & Vehicle");
    expect(categoryFrom("?category=Nope", ["Orbit"])).toBe("All");
    expect(categoryFrom("", ["Orbit"])).toBe("All");
  });
});

describe("which bar item and tab a page marks", () => {
  it("gives each page one area, and Canvas and Assist none (they have items of their own)", () => {
    const cases: [string, string | undefined][] = [
      ["/create", "create"],
      ["/image", "create"],
      ["/live-edit", "create"],
      ["/canvas", undefined],
      ["/canvas/p1", undefined],
      ["/assist", undefined],
      ["/assist/skills", undefined],
      ["/studios", "studios"],
      ["/extend", "fx"],
      ["/genjutsu", "fx"],
      ["/video-tools/depth", "fx"],
      ["/fx", "fx"],
      ["/katana", "studios"],
      ["/audio/music", "studios"],
      ["/apps", "apps"],
      ["/apps/app-any-angle", "apps"],
      ["/motions", "motions"],
      ["/effects", "motions"],
      ["/motions-and-effects", "motions"],
      ["/", undefined],
      ["/library", undefined],
      ["/settings", undefined],
    ];
    for (const [path, want] of cases) expect(areaOfPath(path), path).toBe(want);
  });

  it("marks the name (aria-current) on the area's own page only", () => {
    expect(areaPageOf("/create")).toBe("create");
    expect(areaPageOf("/studios/")).toBe("studios");
    expect(areaPageOf("/apps")).toBe("apps");
    expect(areaPageOf("/motions-and-effects")).toBe("motions");
    for (const p of ["/image", "/apps/app-relight", "/motions", "/cinema", "/"]) expect(areaPageOf(p), p).toBeUndefined();
    expect(barActive("/create")).toMatchObject({ create: true, studios: false, page: "create" });
    expect(barActive("/image")).toMatchObject({ create: true, page: undefined });
    expect(barActive("/studios")).toMatchObject({ studios: true, create: false, page: "studios" });
    expect(barActive("/motions-and-effects")).toMatchObject({ motions: true, page: "motions" });
    expect(barActive("/canvas")).toMatchObject({ canvas: true, create: false });
    expect(barActive("/assist")).toMatchObject({ assist: true, create: false });
  });

  it("selects the Create and Studios tabs on their own pages, and none on the galleries' page", () => {
    const tab = (p: string) => activePhoneTab(p, null, activeEntry(p, new URLSearchParams()));
    expect(tab("/create")).toBe("create");
    expect(tab("/studios")).toBe("studios");
    expect(tab("/motions-and-effects")).toBeNull();
  });

  it("loads each menu's area page with its rows when the menu opens", () => {
    expect(prefetchHrefs(undefined, "create")).toContain("/create");
    expect(prefetchHrefs(undefined, "studios")).toContain("/studios");
    expect(prefetchHrefs(undefined, "more")).toContain("/motions-and-effects");
    expect(prefetchHrefs(undefined)).toEqual(expect.arrayContaining(["/create", "/studios", "/motions-and-effects"]));
  });

  it("lets search find the area pages", () => {
    for (const a of AREAS) expect(entry(a.entryId)?.href, a.id).toBe(a.href);
  });
});

describe("Fuobe FX (/fx)", () => {
  /** The route folder a link's path lives in (src/app/(studio)/<first segment>), so every link opens a real page. */
  const routeExists = (href: string) => existsSync(`src/app/(studio)/${href.split(/[?#]/)[0].split("/")[1]}`);

  it("is a main area with its own entry, page and search words", () => {
    const a = AREAS.find((x) => x.id === "fx")!;
    expect(a).toMatchObject({ href: "/fx", label: "Fuobe FX", title: "Fuobe FX" });
    expect(entry(a.entryId)).toMatchObject({ href: "/fx", kind: "area" });
    for (const w of ["vfx", "fx", "compositing", "roto", "matte", "clean plate", "exr"]) expect(entry("area-fx")!.keywords, w).toContain(w);
    expect(existsSync("src/app/(studio)/fx/page.tsx")).toBe(true);
  });

  it("names only real entries and apps, each opening a page that exists", () => {
    for (const s of FX_SECTIONS)
      for (const id of s.items) {
        const it = fxItem(id);
        expect(it, `${s.id}: ${id}`).toBeDefined();
        expect(it!.href.startsWith("/"), id).toBe(true);
        expect(routeExists(it!.href), `${id}: ${it!.href}`).toBe(true);
        if (id.startsWith("app-")) expect(APPS.some((p) => p.id === id), id).toBe(true);
      }
    for (const id of fxNavIds()) expect(entry(id), id).toBeDefined();
  });

  it("is the one home of the FX studios: a card here, and in no Studios column, /studios or /create section", () => {
    for (const kind of KINDS) {
      const cards = fxSections(kind).flatMap((s) => s.cards);
      for (const id of FX_HOME) {
        expect(cards, `${kind}: ${id}`).toContain(id);
        expect(entry(id)!.group, id).toBeUndefined();
        expect(launcherEntries(kind).map((e) => e.id), id).not.toContain(id);
        for (const area of ["create", "studios"] as const) expect(ids(area, kind), `${area}: ${id}`).not.toContain(id);
      }
    }
    // Their links, names and search words stay as they were.
    expect(entry("genjutsu")).toMatchObject({ href: "/genjutsu", label: "Genjutsu" });
    expect(entry("video-tools")).toMatchObject({ href: "/video-tools", label: "Video tools" });
    expect(entry("extend")).toMatchObject({ href: "/extend", label: "Extend video" });
  });

  it("links every mode and tab of its studios a viewer may open, so none is left without a menu", () => {
    for (const kind of KINDS) {
      const hrefs = new Set(fxSections(kind).flatMap((s) => [...s.cards, ...s.pills]).map((id) => fxItem(id)!.href));
      for (const e of NAV_ENTRIES.filter((x) => x.parent && FX_HOME.includes(x.parent) && visibleTo(x, kind))) expect(hrefs.has(e.href), `${kind}: ${e.id}`).toBe(true);
    }
  });

  it("draws as cards only the FX studios and their own modes; shared tools and apps are pills", () => {
    for (const kind of KINDS)
      for (const s of fxSections(kind))
        for (const id of s.cards) {
          const e = entry(id);
          expect(e && (inFx(e) || id === "upscale-fps"), `${s.id}: ${id}`).toBeTruthy();
        }
    const pills = fxSections("guest").flatMap((s) => s.pills);
    for (const id of ["upscale", "color-grade", "layers", "inpaint", "image-to-3d", "app-recast", "app-face-swap"]) expect(pills, id).toContain(id);
  });

  it("shows full rows, each cover once, no link twice in a section, lines that read whole, and no status words", async () => {
    const { count, sections } = await fxShowcase();
    expect(count).toBeGreaterThan(40);
    const covers = sections.flatMap((s) => s.cards.map((c) => c.card!.id));
    expect(new Set(covers).size).toBe(covers.length);
    for (const s of sections) {
      expect([0, 4, 8], s.id).toContain(s.cards.length);
      expect(`${s.title} ${s.line}`).not.toMatch(STATUS);
      const hrefs = [...s.cards, ...s.pills].map((x) => x.href);
      expect(new Set(hrefs).size, s.id).toBe(hrefs.length);
      for (const c of s.cards) {
        expect(PRESET_COVERS, c.id).toHaveProperty(c.card!.id);
        expect(c.line, c.id).toMatch(/[.!?]$/);
        expect(c.line.length, c.id).toBeLessThanOrEqual(64);
        expect(`${c.label} ${c.line}`, c.id).not.toMatch(STATUS);
      }
      for (const p of [...s.pills, ...s.ownerPills]) expect(p.label, p.id).not.toMatch(STATUS);
    }
    // No two links on the page read the same ("Relight" the mode and "Relight" the app).
    const names = sections.flatMap((s) => [...s.cards, ...s.pills].map((x) => x.label.toLowerCase()));
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    // The first section leads with its full two rows.
    expect(sections[0].cards).toHaveLength(8);
  });

  it("marks Fuobe FX in the bar for its page and its studios, and the Studios tab on a phone", () => {
    expect(areaPageOf("/fx")).toBe("fx");
    expect(barActive("/fx")).toMatchObject({ fx: true, page: "fx", studios: false });
    expect(barActive("/genjutsu")).toMatchObject({ fx: true, studios: false, page: undefined });
    expect(barActive("/cinema")).toMatchObject({ fx: false, studios: true });
    const tab = (p: string) => activePhoneTab(p, null, activeEntry(p, new URLSearchParams()));
    expect(tab("/fx")).toBe("studios");
    expect(tab("/reframe")).toBe("studios");
    expect(prefetchHrefs(undefined, "fx")).toEqual(expect.arrayContaining(["/fx", "/genjutsu", "/video-tools", "/extend"]));
  });
});
