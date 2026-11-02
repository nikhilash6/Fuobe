import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HUB_MODES, hubOfPath, modeHref, modeOfPath, type HubKind } from "@/lib/hubs";

const src = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const HUBS = Object.keys(HUB_MODES) as HubKind[];

describe("hub paths", () => {
  it("reads the hub and the mode of a path", () => {
    expect(hubOfPath("/audio")).toBe("audio");
    expect(hubOfPath("/audio/music?x=1")).toBe("audio");
    expect(hubOfPath("/video-tools/trim")).toBe("video-tools");
    expect(hubOfPath("/audiobook")).toBeUndefined();
    expect(hubOfPath("/image")).toBeUndefined();
    expect(modeOfPath("audio", "/audio")).toBe("speech");
    expect(modeOfPath("audio", "/audio/music")).toBe("music");
    expect(modeOfPath("audio", "/audio/nope")).toBeUndefined();
    expect(modeOfPath("audio", "/audio/music/more")).toBeUndefined();
    expect(modeOfPath("upscale", "/audio/music")).toBeUndefined();
  });

  it("round-trips every mode's URL", () => {
    for (const kind of HUBS) for (const m of HUB_MODES[kind]) expect(modeOfPath(kind, modeHref(kind, m.id))).toBe(m.id);
  });
});

describe("hub tabs never leave the screen during a switch", () => {
  it("each hub's layout draws the title bar and the tabs, shared by every mode", () => {
    for (const kind of HUBS) {
      const layout = src(`src/app/(studio)/${kind}/layout.tsx`);
      expect(layout).toContain(`<HubFrame kind="${kind}">`);
    }
  });

  it("no mode page draws its own tabs, and the per-mode boundary has a skeleton, never an empty fallback", () => {
    const hub = src("src/components/studio/mode-switch-studio.tsx");
    expect(hub).not.toMatch(/fallback=\{null\}/);
    expect(hub).toMatch(/fallback=\{<HubBodySkeleton \/>\}/);
    expect(hub).not.toMatch(/ModeTabs|tabs=\{/);
  });

  it("the tabs prefetch whole mode pages, also the ones scrolled out of a phone's row", () => {
    const chrome = src("src/components/studio/hub-chrome.tsx");
    // The tab's <Link> has a bare `prefetch` (prefetch={true}: the whole mode page, not only the route's shared shell).
    const link = chrome.slice(chrome.indexOf("<Link"), chrome.indexOf("</Link>"));
    expect(link).toMatch(/^ +prefetch\r?$/m);
    expect(chrome).toMatch(/useIdlePrefetch\(\s*modes\.map\(\(m\) => modeHref\(kind, m\.id\)\),\s*"page",\s*true,?\s*\)/);
    // The tapped tab is marked at once, before the route commits.
    expect(chrome).toMatch(/useTappedTab<string>\(pathname\)/);
    expect(chrome).toMatch(/onClick=\{\(e\) => isPlainClick\(e\) && tap\(m\.id\)\}/);
  });

  it("the hub's engine badge says self-hosted for the same modes as their tools", () => {
    const files: Record<string, string> = {
      "audio/translate": "src/components/dub/dub-studio.tsx",
      "audio/split": "src/components/audio-tools/split-tool.tsx",
      "audio/clean": "src/components/audio-tools/clean-voice-tool.tsx",
      "video-tools/remove-object": "src/components/remove-object/remove-object-tool.tsx",
      "video-tools/remove-dialogue": "src/components/audio-tools/remove-dialogue-tool.tsx",
      "video-tools/evolution": "src/components/evolution/evolution-tool.tsx",
      "video-tools/restore": "src/components/restore/restore-tool.tsx",
      "video-tools/captions": "src/components/captions/captions-studio.tsx",
      "video-tools/trim": "src/components/av/trim-tool.tsx",
    };
    for (const [key, file] of Object.entries(files)) {
      const [kind, id] = key.split("/") as [HubKind, string];
      const mode = HUB_MODES[kind].find((m) => m.id === id);
      const shell = src(file).match(/<ToolShell[^>]*>/)?.[0] ?? "";
      expect(!!mode?.selfHostedOnly, key).toBe(/\bselfHostedOnly\b/.test(shell));
    }
  });
});

describe("other tab bars switch without a round trip", () => {
  it("Library sections update the address with the History API, not a router navigation", () => {
    const lib = src("src/components/library-view.tsx");
    expect(lib).toMatch(/window\.history\.replaceState\(null, "", /);
    expect(lib).not.toMatch(/router\.replace\(/);
  });

  it("sidebar rows prefetch once the page is idle, not only on hover or touch", () => {
    const sidebar = src("src/components/app-sidebar.tsx");
    expect(sidebar).toMatch(/<IntentLink\s+href=\{item\.href\}\s+eager=\{item\.eager\}\s+settled\s/);
    // The clicked row is the open page's row from the next frame on, in every group; the address takes over once it moves.
    expect(sidebar).toMatch(/onClick=\{\(e\) => isPlainClick\(e\) && setTappedRow\(item\.href\)\}/);
    expect(sidebar).toMatch(/useLayoutEffect\(\(\) => setTappedRow\(null\), \[pathname, search\]\);/);
    expect(sidebar).toMatch(/const active = navActive\(item\.href, at, where, hrefs\);/);
    const link = src("src/components/intent-link.tsx");
    // Also the rows scrolled out of view, in the "nav" lane (after the page's own tabs), not the Link's viewport prefetch.
    expect(link).toMatch(/useIdlePrefetch\(settled && href \? \[href\] : null, "nav"\);/);
    expect(link).toMatch(/prefetch=\{eager \|\| intent \? null : false\}/);
  });

  it("a tapped tab is marked before the route commits, and dropped once the route moves or the page is hidden", () => {
    const hook = src("src/lib/use-tapped-tab.ts");
    expect(hook).toMatch(/if \(tapped && tapped\.at !== pathname\) setTapped\(null\);/);
    expect(hook).toMatch(/useLayoutEffect\(\(\) => \(\) => setTapped\(null\), \[\]\);/);
    const marketing = src("src/components/marketing/shell.tsx");
    expect(marketing).toMatch(/useTappedTab<SuiteTab>\(active\)/);
    expect(marketing).toMatch(/aria-current=\{t\.id === current \? "page" : undefined\}/);
  });

  it("the marketing suite's route skeletons draw its real header and tabs, the page's own tab current", () => {
    expect(src("src/components/marketing/skeletons.tsx")).toMatch(/<MarketingHeader title=\{title\} active=\{active\}/);
    expect(src("src/app/(studio)/marketing/loading.tsx")).toMatch(/<MarketingSkeleton \/>/);
    for (const [file, title, active] of [
      ["marketing/click-to-ad", "Click to Ad", "click"],
      ["ads", "Ads Studio", "ads"],
      ["ads/multiplier", "Ad Multiplier", "multiplier"],
    ])
      expect(src(`src/app/(studio)/${file}/loading.tsx`)).toContain(`<MarketingToolSkeleton title="${title}" active="${active}" />`);
  });

  it("Library sections show the tapped section before useSearchParams follows", () => {
    const lib = src("src/components/library-view.tsx");
    expect(lib).toMatch(/setSet\(\{ from: routed\.toString\(\), to: next \}\);/);
    expect(lib).toMatch(/if \(set && set\.from !== routed\.toString\(\)\) setSet\(null\);/);
  });

  it("gallery categories mark the chip in an urgent render and filter the grid in a deferred one", () => {
    const gallery = src("src/components/preset-gallery.tsx");
    expect(gallery).toMatch(/const listCat = useDeferredValue\(cat\);/);
    expect(gallery).toMatch(/aria-pressed=\{cat === c\}/);
    expect(gallery).not.toMatch(/p\.category === cat\)/);
  });

  it("the studio's route skeleton keeps a hub's bar and tabs on the way in", () => {
    expect(src("src/app/(studio)/loading.tsx")).toMatch(/<StudioRouteSkeleton /);
  });
});

describe("idle prefetches: the page's own tabs go before the sidebar's routes", () => {
  let clock = 0;
  let idle: (() => void)[] = [];
  let observed: ((list: { getEntries(): unknown[] }) => void) | null = null;
  let order: string[] = [];

  async function load() {
    vi.useFakeTimers();
    clock = 0;
    idle = [];
    observed = null;
    order = [];
    vi.stubGlobal("document", { readyState: "complete" });
    vi.stubGlobal("performance", { now: () => clock });
    vi.stubGlobal("window", {
      location: { href: "http://app.test/audio" },
      requestIdleCallback: (fn: () => void) => idle.push(fn),
      cancelIdleCallback: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (t: number) => clearTimeout(t),
    });
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        constructor(cb: (list: { getEntries(): unknown[] }) => void) {
          observed = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    return import("@/lib/idle-prefetch");
  }
  const tick = (ms: number) => {
    for (let i = 0; i < ms; i += 10) {
      clock += 10;
      vi.advanceTimersByTime(10);
    }
  };
  const answered = (path: string) => observed!({ getEntries: () => [{ name: `http://app.test${path}?_rsc=x`, responseEnd: clock }] });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("issues the page's tabs first, and the sidebar's rows once the server has answered every tab and gone quiet", async () => {
    const { queueIdlePrefetch } = await load();
    queueIdlePrefetch("nav", "/image", () => order.push("row image"));
    queueIdlePrefetch("page", "/audio/music", () => order.push("tab music"));
    queueIdlePrefetch("page", "/audio/sfx", () => order.push("tab sfx"));
    const cancel = queueIdlePrefetch("nav", "/gone", () => order.push("row gone"));
    cancel();
    expect(order).toEqual([]);
    expect(idle).toHaveLength(1);
    idle[0]();
    expect(order).toEqual(["tab music", "tab sfx"]);
    answered("/audio/music");
    tick(1000);
    expect(order).toEqual(["tab music", "tab sfx"]);
    answered("/audio/sfx");
    tick(400);
    expect(order).toHaveLength(2);
    tick(200);
    expect(order).toEqual(["tab music", "tab sfx", "row image"]);
    // A page that mounts later (a client navigation into a hub) gets its own idle moment.
    queueIdlePrefetch("page", "/audio/loop", () => order.push("tab loop"));
    expect(idle).toHaveLength(2);
    idle[1]();
    expect(order.at(-1)).toBe("tab loop");
  });

  it("lets the sidebar's rows go after 8 s at the latest", async () => {
    const { queueIdlePrefetch } = await load();
    queueIdlePrefetch("page", "/audio/music", () => order.push("tab music"));
    queueIdlePrefetch("nav", "/image", () => order.push("row image"));
    idle[0]();
    tick(7900);
    expect(order).toEqual(["tab music"]);
    tick(200);
    expect(order).toEqual(["tab music", "row image"]);
  });

  it("with no tabs on the page, prefetches the sidebar's rows at the first idle moment", async () => {
    const { queueIdlePrefetch } = await load();
    queueIdlePrefetch("nav", "/image", () => order.push("row image"));
    idle[0]();
    expect(order).toEqual(["row image"]);
  });

  it("relies on Next serving route trees and shells before any URL-specific part (the phase order of its prefetch queue)", () => {
    const scheduler = fs.readFileSync(path.join(__dirname, "..", "node_modules/next/dist/client/components/segment-cache/scheduler.js"), "utf8");
    const compare = scheduler.slice(scheduler.indexOf("function compareQueuePriority"), scheduler.indexOf("function heapPush"));
    expect(compare).toMatch(/const phaseDiff = b\.phase - a\.phase;/);
  });
});
