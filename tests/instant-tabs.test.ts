import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
    expect(chrome).toMatch(/whenIdle\(/);
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
    expect(src("src/components/app-sidebar.tsx")).toMatch(/<IntentLink href=\{item\.href\} eager=\{item\.eager\} settled /);
    const link = src("src/components/intent-link.tsx");
    expect(link).toMatch(/const now = eager \|\| \(settled && idle\);/);
    // Also the rows scrolled out of view: prefetched on idle, not when a scroll brings them in front of the tap.
    expect(link).toMatch(/if \(settled && idle && href\) router\.prefetch\(href\);/);
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
