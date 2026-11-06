import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, hashId, keepInView, READER_EVENTS } from "@/components/use-hash-anchor";

/*
 * A link to a Settings section (/settings#your-keys from the account menu's "Add a key"): the section exists only after
 * hydration, and Your GPU above it grows when its own data arrives. keepInView (src/components/use-hash-anchor.ts)
 * scrolls to the section once it exists and holds it at the top while the page above settles, until the reader takes
 * over or the hold runs out.
 */

class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  observed: unknown[] = [];
  off = false;
  constructor(private cb: () => void) {
    FakeResizeObserver.last = this;
  }
  observe(el: unknown) {
    this.observed.push(el);
  }
  disconnect() {
    this.off = true;
  }
  /** Something it watches changed size. */
  fire() {
    if (!this.off) this.cb();
  }
}

/**
 * body > main > [header, Your GPU, Your keys], with Your keys at `top` px from the window's top. The page is `height` px
 * tall in a 900 px window: scrolling the section to the top (80 px, its scroll margin) needs room below it.
 */
function settingsPage(top = 336, height = 4000) {
  const body = { name: "body" };
  const banner = { name: "banner", previousElementSibling: null };
  const main = { name: "main", parentElement: body, previousElementSibling: banner };
  const header = { name: "header", previousElementSibling: null };
  const gpu = { name: "gpu", previousElementSibling: header };
  const page = { name: "html", scrollHeight: height };
  const at = { top };
  const scrolls: ScrollIntoViewOptions[] = [];
  const keys = {
    name: "keys",
    parentElement: main,
    previousElementSibling: gpu,
    isConnected: true,
    getBoundingClientRect: () => ({ top: at.top }),
    // As far as the page lets it: to 80 px from the top, or to the page's end.
    scrollIntoView: (o: ScrollIntoViewOptions) => {
      scrolls.push(o);
      const docTop = win.scrollY + at.top;
      win.scrollY = Math.max(0, Math.min(docTop - 80, page.scrollHeight - win.innerHeight));
      at.top = docTop - win.scrollY;
    },
  };
  vi.stubGlobal("document", { body, documentElement: page });
  return { keys: keys as unknown as Element, raw: keys, at, scrolls, banner, header, gpu, page };
}

let win: EventTarget & { scrollY: number; innerHeight: number };
beforeEach(() => {
  vi.useFakeTimers();
  win = Object.assign(new EventTarget(), { scrollY: 0, innerHeight: 900 });
  vi.stubGlobal("window", win);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a section reached by its #id is held in view while the page settles", () => {
  it("scrolls to it at once, and again each time something above it grows", () => {
    const p = settingsPage();
    keepInView(p.keys);
    expect(p.scrolls).toEqual([{ block: "start" }]);
    const ro = FakeResizeObserver.last!;
    // Everything above it is watched: the sections before it, what is before the page around it, and the whole page.
    expect(ro.observed).toEqual([p.gpu, p.header, p.banner, p.page]);
    // Your GPU finds ComfyUI and grows by 565 px: the section is put back at the top.
    p.at.top += 565;
    ro.fire();
    expect(p.scrolls).toHaveLength(2);
    expect(p.at.top).toBe(80);
    // A change that doesn't move it: no scroll.
    ro.fire();
    expect(p.scrolls).toHaveLength(2);
  });

  it("when the page ends too soon, scrolls the section up as soon as what is below it loads", () => {
    // The menu's Add a key: Your keys starts at 960 px, and the page is only 1534 px tall so far.
    const p = settingsPage(960, 1534);
    keepInView(p.keys);
    expect(win.scrollY).toBe(634);
    expect(p.at.top).toBe(326);
    const ro = FakeResizeObserver.last!;
    // The cards below load and the page grows: the section goes up as far as the page lets it, then to the top.
    p.page.scrollHeight = 1766;
    ro.fire();
    expect(p.scrolls).toHaveLength(2);
    expect(p.at.top).toBe(94);
    p.page.scrollHeight = 2400;
    ro.fire();
    expect(p.scrolls).toHaveLength(3);
    expect(p.at.top).toBe(80);
    // At the top, the page growing again moves nothing.
    p.page.scrollHeight = 3000;
    ro.fire();
    expect(p.scrolls).toHaveLength(3);
  });

  it("lets go as soon as the reader scrolls, taps, clicks or types", () => {
    expect(READER_EVENTS).toEqual(["wheel", "touchstart", "pointerdown", "keydown"]);
    for (const t of READER_EVENTS) {
      const p = settingsPage();
      keepInView(p.keys);
      const ro = FakeResizeObserver.last!;
      win.dispatchEvent(new Event(t));
      expect(ro.off, t).toBe(true);
      p.at.top += 400;
      ro.fire();
      expect(p.scrolls, t).toHaveLength(1);
    }
  });

  it("lets go after the hold, when the section leaves the page, or when asked", () => {
    let p = settingsPage();
    keepInView(p.keys);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(FakeResizeObserver.last!.off).toBe(false);
    vi.advanceTimersByTime(1);
    expect(FakeResizeObserver.last!.off).toBe(true);

    p = settingsPage();
    keepInView(p.keys);
    p.raw.isConnected = false;
    p.at.top += 300;
    FakeResizeObserver.last!.fire();
    expect(FakeResizeObserver.last!.off).toBe(true);
    expect(p.scrolls).toHaveLength(1);

    p = settingsPage();
    const stop = keepInView(p.keys);
    stop();
    expect(FakeResizeObserver.last!.off).toBe(true);
    // Its listeners are gone: the reader's next tap finds nothing to end.
    stop();
  });

  it("reads the id from the address", () => {
    expect(hashId("#your-keys")).toBe("your-keys");
    expect(hashId("your-gpu")).toBe("your-gpu");
    expect(hashId("")).toBe("");
    expect(hashId("#%E0%A4%A")).toBe("");
  });
});

describe("the sections links point to", () => {
  const src = (f: string) => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8");

  it("hold themselves once they exist: Your GPU, Your keys and Account (an account's), and the owner's sections", () => {
    expect(src("components/keys/your-keys.tsx")).toMatch(/useHashAnchor\("your-keys", shown\);\s+if \(!shown\) return null;/);
    expect(src("components/gpu/account-gpu-section.tsx")).toMatch(/useHashAnchor\("your-gpu", shown\);\s+if \(!shown\) return null;/);
    expect(src("components/owner-settings.tsx")).toContain('useHashAnchor("account", true);');
    expect(src("components/settings-form.tsx")).toMatch(/document\.getElementById\(hashId\(window\.location\.hash\)\)[^]*keepInView\(el\)/);
  });

  it("the account menu's Add a key goes to Your keys", () => {
    expect(src("components/nav/connected-accounts.tsx")).toContain('<IntentLink href="/settings#your-keys">');
  });
});
