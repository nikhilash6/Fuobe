import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Command as CommandPrimitive } from "cmdk";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const { isPaletteToggle, PALETTE_INDEX_KEY, SearchPaletteProvider, slashOpens, typesText, useSearchPalette } = await import("@/components/nav/search-context");
const { PaletteBody, startValue } = await import("@/components/nav/search-palette");
const { BestRow, kindTag, StudioTile } = await import("@/components/nav/search-results");
const { paletteIndex } = await import("@/lib/palette-index");
const { entriesFor, entry, launcherEntries } = await import("@/lib/nav-model");
const { navSearchEntries, searchNav } = await import("@/lib/nav-search");
const { indexEntries } = await import("@/lib/command-search");

/** A stand-in element: what `closest` finds above it. */
const el = (inside: string[] = []) => ({ closest: (sel: string) => (inside.some((s) => sel.includes(s)) ? {} : null) }) as unknown as EventTarget;
const key = (k: string, over: Partial<KeyboardEvent> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, isComposing: false, target: el(), ...over }) as KeyboardEvent;
const noDialog = { querySelector: () => null };
const dialogOpen = { querySelector: () => ({}) as Element };

describe("the palette's shortcuts", () => {
  it("Ctrl+K and ⌘K toggle it from anywhere, a text field included", () => {
    expect(isPaletteToggle(key("k", { ctrlKey: true }))).toBe(true);
    expect(isPaletteToggle(key("K", { metaKey: true }))).toBe(true);
    expect(isPaletteToggle(key("k", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isPaletteToggle(key("k", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPaletteToggle(key("k"))).toBe(false);
  });

  it("/ opens it only when nothing else wants the key", () => {
    expect(slashOpens(key("/"), noDialog)).toBe(true);
    // Typing a slash in a field, an editor or a workspace with keys of its own types a slash.
    expect(slashOpens(key("/", { target: el(["input"]) }), noDialog)).toBe(false);
    expect(slashOpens(key("/", { target: el(["[contenteditable]"]) }), noDialog)).toBe(false);
    expect(slashOpens(key("/", { target: el(["[data-hotkeys-off]"]) }), noDialog)).toBe(false);
    expect(slashOpens(key("/", { ctrlKey: true }), noDialog)).toBe(false);
    expect(slashOpens(key("/", { metaKey: true }), noDialog)).toBe(false);
    expect(slashOpens(key("/", { defaultPrevented: true }), noDialog)).toBe(false);
    expect(slashOpens(key("/", { isComposing: true }), noDialog)).toBe(false);
    expect(slashOpens(key("?"), noDialog)).toBe(false);
    // Over a dialog or a menu that is open.
    expect(slashOpens(key("/"), dialogOpen)).toBe(false);
  });

  it("knows a field from the page", () => {
    expect(typesText(null)).toBe(false);
    expect(typesText(el())).toBe(false);
    expect(typesText(el(["textarea"]))).toBe(true);
    expect(typesText({} as EventTarget)).toBe(false);
  });
});

function withClient(node: ReactNode, seed?: (c: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  seed?.(client);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, node));
}

describe("the palette's provider", () => {
  it("renders the page alone until the palette is wanted (its code loads on its own)", () => {
    function Probe() {
      const s = useSearchPalette();
      return createElement("span", { "data-open": String(s.isOpen) }, "page");
    }
    const html = withClient(createElement(SearchPaletteProvider, null, createElement(Probe)));
    expect(html).toBe('<span data-open="false">page</span>');
  });

  it("does nothing outside the provider", () => {
    let api: ReturnType<typeof useSearchPalette> | undefined;
    function Probe() {
      api = useSearchPalette();
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(api?.isOpen).toBe(false);
    expect(() => api?.open()).not.toThrow();
  });
});

describe("the palette's rows", () => {
  const inList = (node: ReactNode) => renderToStaticMarkup(createElement(CommandPrimitive, { label: "Search" }, createElement(CommandPrimitive.List, null, node)));

  it("shows a best match with its cover, line and tag, as an option", () => {
    const html = inList(
      createElement(BestRow, {
        hit: { key: "app:app-giant-product", kind: "app", label: "Giant Product", hint: "Product", href: "/apps/app-giant-product", cover: "/previews/presets/thumbs/app-giant-product.jpg?v=1234abcd", score: 50 },
        onPick: () => {},
      }),
    );
    expect(html).toContain('role="option"');
    expect(html).toContain("Giant Product");
    expect(html).toContain('src="/previews/presets/thumbs/app-giant-product.jpg?v=1234abcd"');
    expect(html).toContain('alt=""');
    expect(html).toContain(">App<");
  });

  it("puts a tool under its studio, and tags studios", () => {
    const html = inList(createElement(BestRow, { hit: { key: "nav:audio-clean", kind: "tool", label: "Clean up voice", hint: "Audio", what: "Remove noise and echo", href: "/audio/clean", icon: "Eraser", score: 9 }, onPick: () => {} }));
    expect(html).toMatch(/Audio<\/span>.*Clean up voice/);
    expect(kindTag({ kind: "studio" })).toBe("Studio");
    expect(kindTag({ kind: "page", navKind: "create" })).toBe("Create");
    expect(kindTag({ kind: "setting" })).toBe("Settings");
  });

  it("shows a studio tile with its name (the short one on a phone), on up to two lines, without a badge", () => {
    const html = inList(createElement(StudioTile, { e: entry("character-swap")!, onPick: () => {} }));
    expect(html).toContain("Character swap");
    expect(html).toContain("Character Swap");
    expect(html).toContain("line-clamp-2");
    expect(html).not.toContain(">New<");
  });
});

describe("the palette's body", () => {
  const body = (initialQuery: string, initialGroup?: "sell") =>
    withClient(createElement(PaletteBody, { initialQuery, initialGroup, onPick: () => {}, onOpenRecent: () => {}, onClose: () => {} }), (c) =>
      c.setQueryData(PALETTE_INDEX_KEY, paletteIndex()),
    );

  /** The studio tiles' full names, in order (each tile also carries its short name for phones). */
  const tiles = (html: string) => [...html.matchAll(/<span class="max-md:hidden">([^<]+)<\/span>/g)].map((m) => m[1].replaceAll("&amp;", "&"));

  it("lists every studio before a search, with the goal chips", () => {
    const html = body("");
    expect(html).toContain('placeholder="What do you want to make?"');
    expect(tiles(html)).toEqual(launcherEntries(undefined).map((e) => e.label));
    expect(html).toContain('aria-label="Show the studios for one goal"');
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-pressed="true" aria-label="All studios"');
    // The Cancel button's name starts with the word it shows.
    expect(html).toContain('>Esc<span class="sr-only"> (close search)</span>');
    // The goal chips are buttons, outside the listbox.
    const list = html.slice(html.indexOf('role="listbox"'));
    expect(list).not.toContain("aria-pressed");
    expect(html).not.toContain("Best matches");
  });

  it("finds what a query means, best first, and keeps every studio below", () => {
    const html = body("ad for my perfume");
    const best = html.slice(html.indexOf("Best matches"), html.indexOf("Also try"));
    const order = ["Marketing Studio", "Ads Studio", "Giant Product"].map((l) => best.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.indexOf("Every studio")).toBeGreaterThan(html.indexOf("Also try"));
    expect(tiles(html)).toHaveLength(34);
  });

  it("starts filtered to a goal when opened for one", () => {
    const html = body("", "sell");
    expect(tiles(html)).toEqual(["Marketing Studio", "Ads Studio", "Fuobe Kinetic Motion", "Mixed Media", "Moodboards", "Photodump"]);
    expect(html).toContain("6 in Sell &amp; advertise");
  });

  it("starts on the best match, or on the first studio when nothing is typed", () => {
    const E = [...navSearchEntries(entriesFor("guest")), ...indexEntries(paletteIndex(), "both")];
    const studios = launcherEntries("guest");
    expect(startValue(true, searchNav("ad for my perfume", E), [], studios)).toBe("nav:marketing");
    expect(startValue(false, searchNav("", E), [{ id: "g1" }], studios)).toBe("tile:cinema");
    expect(startValue(true, searchNav("zqx", E), [{ id: "g1" }], studios)).toBe("recent:g1");
    expect(startValue(true, searchNav("zqx", E), [], studios)).toBe("tile:cinema");
    expect(startValue(false, searchNav("", E), [], [])).toBe("");
  });

  it("shows no owner setting before the viewer is known", () => {
    expect(body("comfyui server")).not.toContain("ComfyUI server");
  });
});
