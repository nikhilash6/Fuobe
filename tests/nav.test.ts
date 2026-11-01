import { describe, expect, it } from "vitest";
import { NAV } from "@/components/nav-items";
import { DEFAULT_NAV_CLOSED, fullScreenStudio, groupId, navActive, NEW_CREATION_HREF, NEW_CREATION_PARAM, parseClosed, scrollFades, sidebarCookie, SIDEBAR_STATE_SCRIPT, sidebarOpenFromCookie } from "@/lib/nav";

const q = (s = "") => new URLSearchParams(s);
const LIBRARY = ["/library", "/library?tab=favorites"];

describe("sidebar active state", () => {
  it("matches a path and the pages below it", () => {
    expect(navActive("/apps", "/apps", q())).toBe(true);
    expect(navActive("/apps", "/apps/app-face-swap", q())).toBe(true);
    expect(navActive("/apps", "/apps-old", q())).toBe(false);
    expect(navActive("/", "/", q())).toBe(true);
    expect(navActive("/", "/image", q())).toBe(false);
    expect(navActive("/image", "", q())).toBe(false);
  });

  it("lights up query links when their params match", () => {
    expect(navActive("/library?tab=favorites", "/library", q("tab=favorites"), LIBRARY)).toBe(true);
    expect(navActive("/library?tab=favorites", "/library", q(), LIBRARY)).toBe(false);
    expect(navActive("/library?tab=favorites", "/library", q("tab=trash"), LIBRARY)).toBe(false);
  });

  it("hands the active state from the plain link to the better-matching query link", () => {
    expect(navActive("/library", "/library", q(), LIBRARY)).toBe(true);
    expect(navActive("/library", "/library", q("tab=favorites"), LIBRARY)).toBe(false);
    // Other tabs have no link of their own, so "All creations" stays lit.
    expect(navActive("/library", "/library", q("tab=trash"), LIBRARY)).toBe(true);
  });

  it("hands it to a sibling link below the plain one: Settings and About & licences", () => {
    const engine = NAV.find((g) => g.label === "Engine")!.items.map((i) => i.href);
    expect(engine).toContain("/settings/about");
    const lit = (pathname: string) => engine.filter((h) => navActive(h, pathname, q(), engine));
    expect(lit("/settings/about")).toEqual(["/settings/about"]);
    expect(lit("/settings")).toEqual(["/settings"]);
    // Pages below Settings with no link of their own keep Settings lit.
    expect(lit("/settings/models")).toEqual(["/settings"]);
    expect(lit("/models")).toEqual(["/models"]);
  });
});

describe("remembered sidebar state", () => {
  it("reads the shadcn cookie", () => {
    expect(sidebarOpenFromCookie("")).toBe(true);
    expect(sidebarOpenFromCookie("sidebar_state=true")).toBe(true);
    expect(sidebarOpenFromCookie("a=1; sidebar_state=false; b=2")).toBe(false);
    expect(sidebarOpenFromCookie("sidebar_state=false")).toBe(false);
    expect(sidebarOpenFromCookie("my_sidebar_state=false")).toBe(true);
  });

  it("parses the collapsed groups defensively", () => {
    expect(parseClosed('["studios","engine"]')).toEqual(["studios", "engine"]);
    expect(parseClosed('["studios", 3]')).toEqual(["studios"]);
    // The user opened every group: that choice is kept, not replaced by the defaults.
    expect(parseClosed("[]")).toEqual([]);
  });

  it("folds Engine, and shows Studios, until the user chooses (nothing stored, or nothing readable)", () => {
    expect(parseClosed(null)).toEqual(["engine"]);
    expect(parseClosed(undefined)).toEqual(["engine"]);
    expect(parseClosed("not json")).toEqual(["engine"]);
    expect(parseClosed('{"a":1}')).toEqual(["engine"]);
    // A fresh copy each time: a caller adding to it can't change the defaults.
    parseClosed(null).push("create");
    expect(parseClosed(null)).toEqual(["engine"]);
  });

  it("only folds groups that can fold, and keeps Create and Library in view", () => {
    const foldable = NAV.filter((g) => g.collapsible).map((g) => groupId(g.label));
    for (const id of DEFAULT_NAV_CLOSED) expect(foldable).toContain(id);
    expect(NAV.map((g) => g.label).slice(0, 2)).toEqual(["Create", "Library"]);
    // The part that can't fold stays short: Create and Library hold 15 rows; Studios below them can be folded away.
    const always = NAV.filter((g) => !g.collapsible).flatMap((g) => g.items);
    expect(always.length).toBeLessThanOrEqual(15);
    expect(DEFAULT_NAV_CLOSED).not.toContain("studios");
  });

  it("prefetches only the rows most visits go to next", () => {
    const eager = NAV.flatMap((g) => g.items.filter((i) => i.eager).map((i) => i.href));
    expect(eager).toEqual(["/", "/assist", "/image", "/video", "/library"]);
    // Every destination is unique (the palette and the sidebar key rows by href).
    const hrefs = NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("uses stable group ids", () => {
    expect(groupId("Studios")).toBe("studios");
    expect(groupId("Shorts & Marketing")).toBe("shorts-marketing");
  });

  it("ships a pre-paint script that is valid JavaScript", () => {
    expect(() => new Function(SIDEBAR_STATE_SCRIPT)).not.toThrow();
    expect(SIDEBAR_STATE_SCRIPT).toContain("sidebar_state=false");
    expect(SIDEBAR_STATE_SCRIPT).toContain("fuobe:nav-closed");
  });

  /** Runs the pre-paint script against a fake DOM with the given cookie, path and stored folds. */
  function runScript(cookie: string, pathname: string, stored: string | null) {
    const attrs = new Map<string, Record<string, string>>();
    const el = (key: string, toggle = true) => ({
      setAttribute: (k: string, v: string) => attrs.set(key, { ...attrs.get(key), [k]: v }),
      getAttribute: (k: string) => (k === "data-nav-group" ? key : null),
      querySelector: (s: string) => (s === "[data-nav-toggle]" && toggle ? el(`${key}/toggle`) : null),
    });
    const document = {
      cookie,
      querySelector: (s: string) => (s === '[data-slot="sidebar"]' ? el("sidebar") : null),
      // Create and Library can't fold (no toggle); Studios and Engine can.
      querySelectorAll: (s: string) => (s === "[data-nav-group]" ? [el("create", false), el("library", false), el("studios"), el("engine")] : []),
    };
    const localStorage = { getItem: () => stored };
    new Function("document", "localStorage", "location", SIDEBAR_STATE_SCRIPT)(document, localStorage, { pathname });
    return attrs;
  }

  it("applies the cookie and the remembered folds to the DOM", () => {
    const attrs = runScript("x=1; sidebar_state=false", "/image", '["studios","gone"]');
    expect(attrs.get("sidebar")).toEqual({ "data-state": "collapsed", "data-collapsible": "icon" });
    expect(attrs.get("studios")).toEqual({ "data-open": "false" });
    expect(attrs.get("studios/toggle")).toEqual({ "aria-expanded": "false" });
    // Engine was opened by the user: the server's default fold is undone before paint.
    expect(attrs.get("engine")).toEqual({ "data-open": "true" });
    expect(attrs.get("engine/toggle")).toEqual({ "aria-expanded": "true" });
    expect(attrs.has("create")).toBe(false);
  });

  it("leaves the server's default folds alone when nothing is remembered", () => {
    const attrs = runScript("", "/image", null);
    expect([...attrs.keys()]).toEqual([]);
  });

  it("folds the sidebar to its rail on a full-screen studio, whatever the cookie says", () => {
    expect(runScript("sidebar_state=true", "/cinema/abc", null).get("sidebar")).toEqual({ "data-state": "collapsed", "data-collapsible": "icon" });
    expect(runScript("sidebar_state=true", "/cinema", null).get("sidebar")).toBeUndefined();
  });
});

describe("full-screen studios", () => {
  it("are an open Cinema, Canvas or Layers project, and Assist", () => {
    for (const p of ["/cinema/abc", "/canvas/x1", "/layers/l-2/", "/assist", "/assist/memory", "/assist/projects/p1"]) expect(fullScreenStudio(p)).not.toBeNull();
    for (const p of ["/", "/cinema", "/canvas", "/layers", "/assistant", "/apps/app-packshot", "/cinema/a/b", "/library"]) expect(fullScreenStudio(p)).toBeNull();
  });

  it("count every Assist page as one studio, and each project as its own", () => {
    // Opening the sidebar on a chat keeps it open on Skills; a different project folds it again.
    expect(fullScreenStudio("/assist")).toBe("/assist");
    expect(fullScreenStudio("/assist/skills")).toBe(fullScreenStudio("/assist/projects/p1"));
    expect(fullScreenStudio("/layers/l-2/")).toBe(fullScreenStudio("/layers/l-2"));
    expect(fullScreenStudio("/cinema/a")).not.toBe(fullScreenStudio("/cinema/b"));
    expect(fullScreenStudio("/canvas/a")).not.toBe(fullScreenStudio("/cinema/a"));
  });
});

describe("the remembered choice's cookie", () => {
  it("is the one the shadcn provider reads, for a week, site-wide", () => {
    expect(sidebarCookie(false)).toBe("sidebar_state=false; path=/; max-age=604800");
    expect(sidebarOpenFromCookie(sidebarCookie(false).split(";")[0])).toBe(false);
    expect(sidebarOpenFromCookie(sidebarCookie(true).split(";")[0])).toBe(true);
  });
});

describe("New creation", () => {
  it("opens Home with its own flag, and Home stays lit while it's in the address", () => {
    const url = new URL(NEW_CREATION_HREF, "http://localhost");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.has(NEW_CREATION_PARAM)).toBe(true);
    expect(navActive("/", url.pathname, url.searchParams)).toBe(true);
  });
});

describe("the sidebar's fades", () => {
  it("are as deep as what's hidden past each edge, up to 24px above and 40px below", () => {
    expect(scrollFades({ scrollTop: 0, clientHeight: 637, scrollHeight: 637 })).toEqual({ above: 0, below: 0 });
    expect(scrollFades({ scrollTop: 0, clientHeight: 500, scrollHeight: 900 })).toEqual({ above: 0, below: 40 });
    expect(scrollFades({ scrollTop: 10, clientHeight: 500, scrollHeight: 900 })).toEqual({ above: 10, below: 40 });
    expect(scrollFades({ scrollTop: 400, clientHeight: 500, scrollHeight: 900 })).toEqual({ above: 24, below: 0 });
    // A row the edge cuts through fades as far as it's cut.
    expect(scrollFades({ scrollTop: 0, clientHeight: 620, scrollHeight: 640 })).toEqual({ above: 0, below: 20 });
  });

  it("never dim the last row for a few pixels of padding past the edge", () => {
    // fuobe.com at 1440×900: 3px of the last group's padding below the edge used to fade the last 40px.
    expect(scrollFades({ scrollTop: 0, clientHeight: 637, scrollHeight: 640 }).below).toBe(3);
    // Sub-pixel leftovers at either end are no fade at all.
    expect(scrollFades({ scrollTop: 0.4, clientHeight: 500, scrollHeight: 500.9 })).toEqual({ above: 0, below: 0 });
    expect(scrollFades({ scrollTop: 399.5, clientHeight: 500, scrollHeight: 900 }).below).toBe(0);
  });
});
