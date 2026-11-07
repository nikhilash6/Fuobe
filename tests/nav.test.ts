import { describe, expect, it } from "vitest";
import { NAV } from "@/components/nav-items";
import { CHROME_HAD_PILLS, CHROME_STATE_SCRIPT, fullScreenStudio, groupId, navActive, NEW_CREATION_HREF, NEW_CREATION_PARAM } from "@/lib/nav";

const q = (s = "") => new URLSearchParams(s);
const LIBRARY = ["/library", "/library?tab=favorites"];

describe("nav links' active state", () => {
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

  it("hands it to a sibling link below the plain one", () => {
    const links = ["/settings", "/settings/runs"];
    const lit = (pathname: string) => links.filter((h) => navActive(h, pathname, q(), links));
    expect(lit("/settings/runs")).toEqual(["/settings/runs"]);
    expect(lit("/settings")).toEqual(["/settings"]);
    // Pages below Settings with no link of their own keep Settings lit.
    expect(lit("/settings/models")).toEqual(["/settings"]);
  });

  it("ends with Settings, and links no removed page", () => {
    const hrefs = NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(NAV.at(-1)!.items.map((i) => i.href)).toEqual(["/settings"]);
    for (const gone of ["/status", "/models", "/workflows", "/settings/about"]) expect(hrefs).not.toContain(gone);
  });
});

describe("nav rows", () => {
  it("prefetches only the rows most visits go to next", () => {
    const eager = NAV.flatMap((g) => g.items.filter((i) => i.eager).map((i) => i.href));
    expect(eager).toEqual(["/", "/chat", "/image", "/video", "/library"]);
    // Every destination is unique (the palette and the sidebar key rows by href).
    const hrefs = NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("uses stable group ids", () => {
    expect(groupId("Studios")).toBe("studios");
    expect(groupId("Shorts & Marketing")).toBe("shorts-marketing");
  });
});

describe("full-screen studios", () => {
  it("are an open Cinema, Canvas or Layers project, and Assist", () => {
    for (const p of ["/cinema/abc", "/canvas/x1", "/layers/l-2/", "/assist", "/assist/memory", "/assist/projects/p1", "/live-edit"]) expect(fullScreenStudio(p)).not.toBeNull();
    for (const p of ["/", "/cinema", "/canvas", "/layers", "/assistant", "/apps/app-packshot", "/cinema/a/b", "/library"]) expect(fullScreenStudio(p)).toBeNull();
  });

  it("count every Assist page as one studio, and each project as its own", () => {
    // Every Assist page is one studio; each project is its own.
    expect(fullScreenStudio("/assist")).toBe("/assist");
    expect(fullScreenStudio("/assist/skills")).toBe(fullScreenStudio("/assist/projects/p1"));
    expect(fullScreenStudio("/layers/l-2/")).toBe(fullScreenStudio("/layers/l-2"));
    expect(fullScreenStudio("/cinema/a")).not.toBe(fullScreenStudio("/cinema/b"));
    expect(fullScreenStudio("/canvas/a")).not.toBe(fullScreenStudio("/cinema/a"));
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

describe("the app frame's state before the first paint", () => {
  /** Runs CHROME_STATE_SCRIPT as the browser would, against a fake <html> and storage. */
  function run(pathname: string, stored: Record<string, string> = {}, storage: "ok" | "throws" = "ok") {
    const attrs = new Map<string, string>();
    const document = { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } };
    const localStorage = {
      getItem: (k: string) => {
        if (storage === "throws") throw new Error("SecurityError");
        return stored[k] ?? null;
      },
    };
    new Function("document", "localStorage", "location", CHROME_STATE_SCRIPT)(document, localStorage, { pathname });
    return attrs;
  }

  it("is valid script", () => {
    expect(() => new Function(CHROME_STATE_SCRIPT)).not.toThrow();
  });

  it("marks full-screen studios (a project, Assist, Live edit), not their lists", () => {
    for (const p of ["/cinema/abc", "/canvas/x1", "/layers/l2", "/assist", "/assist/skills", "/live-edit"]) expect(run(p).has("data-fullscreen-studio"), p).toBe(true);
    for (const p of ["/", "/cinema", "/canvas", "/image", "/library"]) expect(run(p).has("data-fullscreen-studio"), p).toBe(false);
  });

  it("applies the viewer this browser knew, and the bar's remembered pills", () => {
    const attrs = run("/", { "fuobe:viewer": "account", "fuobe:had:balance": "1", "fuobe:had:computer": "0", "fuobe:had:placeholders": "junk" });
    expect(attrs.get("data-viewer")).toBe("account");
    expect(attrs.get("data-had-balance")).toBe("1");
    expect(attrs.has("data-had-computer")).toBe(false);
    expect(attrs.has("data-had-placeholders")).toBe(false);
    expect([...CHROME_HAD_PILLS]).toEqual(["balance", "computer", "placeholders"]);
    // Anything but a known kind is ignored.
    expect(run("/", { "fuobe:viewer": "admin" }).has("data-viewer")).toBe(false);
  });

  it("survives storage that throws, and still marks a full-screen studio", () => {
    expect(() => run("/assist", {}, "throws")).not.toThrow();
    const attrs = run("/assist", {}, "throws");
    expect(attrs.has("data-fullscreen-studio")).toBe(true);
    expect(attrs.has("data-viewer")).toBe(false);
  });
});
