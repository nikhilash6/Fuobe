import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusInfo, ViewerInfo } from "@/lib/api";

/*
 * The nav's one state system (src/app/nav-states.css, src/components/nav/nav-row.tsx, input-modality.ts): one highlight
 * that the mouse and the keyboard share, a keyboard-only focus ring, a pressed state, and a current-page mark that is
 * never a fill (so it never reads as a second highlight).
 */

const state = vi.hoisted(() => ({
  path: "/",
  hydrated: false,
  viewer: undefined as ViewerInfo | undefined,
  status: undefined as StatusInfo | undefined,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api", async (load) => ({
  ...(await load<typeof import("@/lib/api")>()),
  useHydrated: () => state.hydrated,
  useViewer: () => ({ data: state.viewer }),
  useStatus: () => ({ data: state.status }),
  useEngineMode: () => "both",
}));

const { modalityForKey, modalityForPointer } = await import("@/components/nav/input-modality");
const { columnMove, CreateList } = await import("@/components/nav/create-menu");
const { LauncherColumns } = await import("@/components/nav/studios-launcher");
const { AccountSections } = await import("@/components/nav/account-menu");
const { NavUiProvider } = await import("@/components/nav/nav-ui");
const { navCovers } = await import("@/lib/nav-covers");

const covers = navCovers();
const Nav = NavUiProvider as (p: { covers: typeof covers; children?: ReactNode }) => ReactNode;
const render = (node: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Nav, { covers }, node)));
/** Every element tag with aria-current="page". */
const currentTags = (html: string) => [...html.matchAll(/<[a-z]+\s[^>]*aria-current="page"[^>]*>/g)].map((m) => m[0]);
const classOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1] ?? "";

const ROOT = path.resolve(__dirname, "..");
const css = readFileSync(path.join(ROOT, "src/app/nav-states.css"), "utf8");
/** The stylesheet's rules as [selector, body], comments out and media blocks flattened. */
function rules(text: string): [string, string][] {
  const flat = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, "$1");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2].trim()]);
}

/** A selector list's selectors (commas inside :is() and :not() stay). */
function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) {
      out.push(list.slice(at, i).trim());
      at = i + 1;
    }
  }
  return [...out, list.slice(at).trim()];
}

beforeEach(() => {
  state.path = "/";
  state.hydrated = false;
  state.viewer = undefined;
  state.status = undefined;
});

describe("which input leads", () => {
  it("hands the lead to the keyboard only for keys that move or press", () => {
    for (const k of ["Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Escape", "Enter", " "]) expect(modalityForKey(k), k).toBe("keyboard");
    for (const k of ["a", "Shift", "Meta", "Control", "Backspace"]) expect(modalityForKey(k), k).toBeNull();
    // A shortcut (Ctrl+Tab, Cmd+ArrowLeft) is not the keyboard walking the page.
    expect(modalityForKey("Tab", { ctrlKey: true })).toBeNull();
    expect(modalityForKey("ArrowLeft", { metaKey: true })).toBeNull();
  });

  it("hands it to the keyboard for a letter that moves a list's highlight, not for one typed into the page", () => {
    const inside = (sel: string) => ({ closest: (s: string) => (s.split(",").some((x) => x.trim() === sel) ? {} : null) });
    // A menu's typeahead and the search field move the highlight: the ring marks the row the keys picked.
    expect(modalityForKey("i", {}, inside('[role="menu"]') as unknown as EventTarget)).toBe("keyboard");
    expect(modalityForKey("c", {}, inside("[cmdk-input]") as unknown as EventTarget)).toBe("keyboard");
    // Typing in any other field, or with no target, leaves the lead where it is; so do keys that are not letters.
    expect(modalityForKey("a", {}, inside("textarea") as unknown as EventTarget)).toBeNull();
    expect(modalityForKey("a", {}, null)).toBeNull();
    expect(modalityForKey("Backspace", {}, inside("[cmdk-input]") as unknown as EventTarget)).toBeNull();
    expect(modalityForKey("k", { metaKey: true }, inside("[cmdk-input]") as unknown as EventTarget)).toBeNull();
  });

  it("hands it to the pointer on a press, or a mouse that really moved", () => {
    expect(modalityForPointer("pointerdown", false)).toBe("pointer");
    expect(modalityForPointer("pointermove", true)).toBe("pointer");
    // A layout change under a still mouse (a menu opening under it) is not the mouse moving.
    expect(modalityForPointer("pointermove", false)).toBeNull();
  });
});

describe("the Create menu's columns", () => {
  it("moves Left and Right to the same row of the other column, or its last", () => {
    expect(columnMove([5, 5], { col: 0, row: 2 }, "ArrowRight")).toEqual({ col: 1, row: 2 });
    expect(columnMove([5, 5], { col: 1, row: 4 }, "ArrowLeft")).toEqual({ col: 0, row: 4 });
    expect(columnMove([5, 3], { col: 0, row: 4 }, "ArrowRight")).toEqual({ col: 1, row: 2 });
  });

  it("stops at the edges and leaves other keys to the menu", () => {
    expect(columnMove([5, 5], { col: 0, row: 1 }, "ArrowLeft")).toBeNull();
    expect(columnMove([5, 5], { col: 1, row: 1 }, "ArrowRight")).toBeNull();
    expect(columnMove([5, 0], { col: 0, row: 1 }, "ArrowRight")).toBeNull();
    expect(columnMove([5, 5], { col: 0, row: 1 }, "ArrowDown")).toBeNull();
  });
});

describe("the states stylesheet", () => {
  const all = rules(css);
  const isCurrent = (sel: string) => /aria-current|data-current|data-active|data-narrow/.test(sel);

  it("is imported by the app's stylesheet, unlayered (it must win over a primitive's focus:bg-accent)", () => {
    const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    expect(globals).toContain('@import "./nav-states.css";');
    expect(css).not.toMatch(/@layer/);
  });

  it("gives the highlight one fill, the same for hover, keyboard focus and a menu's highlighted row", () => {
    const fill = all.filter(([, b]) => b.includes("var(--nav-hi)")).map(([s]) => s);
    const joined = fill.join("\n");
    expect(joined).toContain(":hover");
    expect(joined).toContain(":focus-visible");
    expect(joined).toContain("[data-highlighted]");
    expect(joined).toContain('[data-selected="true"]');
    // Hover never paints while the keyboard leads; the keyboard's focus never paints while the pointer leads.
    for (const s of fill.flatMap(selectors)) {
      if (s.includes(":hover")) expect(s).toContain('html:not([data-input="keyboard"])');
      if (s.includes(":focus-visible")) expect(s).toContain('html:not([data-input="pointer"])');
    }
    // Hover only where a pointer hovers: a finger never leaves a sticky highlight.
    expect(css).toMatch(/@media \(hover: hover\)\s*\{\s*html:not\(\[data-input="keyboard"\]\) \.nav-row[^{]*:hover/);
  });

  it("never marks the open page with a fill or the highlight", () => {
    const current = all.filter(([s]) => isCurrent(s));
    expect(current.length).toBeGreaterThan(0);
    for (const [s, b] of current) {
      expect(b, s).not.toContain("--nav-hi");
      expect(b, s).not.toContain("--nav-press");
      // Its only fill is the pip's own (a ::before 3 px wide or tall).
      if (/background-color/.test(b)) expect(s, s).toContain("::before");
    }
    const pip = current.filter(([s, b]) => s.includes("::before") && /width/.test(b)).map(([, b]) => b);
    expect(pip.some((b) => b.includes("width: 3px"))).toBe(true);
    expect(pip.some((b) => b.includes("height: 3px"))).toBe(true);
  });

  it("draws a 2 px keyboard ring inside the item, in the ring colour, only while the keyboard leads", () => {
    const ring = all.filter(([, b]) => b.includes("outline: 2px solid var(--ring)"));
    expect(ring.length).toBe(2);
    for (const [s] of ring) for (const one of selectors(s)) expect(one).toContain('html:not([data-input="pointer"])');
    expect(ring.some(([, b]) => b.includes("outline-offset: -2px"))).toBe(true);
  });

  it("has a pressed state that wins over hover, and no grey tap flash", () => {
    const pressed = all.find(([s]) => s.includes(":active"));
    expect(pressed?.[1]).toContain("var(--nav-press)");
    expect(css.indexOf(":active")).toBeGreaterThan(css.indexOf(":hover"));
    expect(css).toContain("-webkit-tap-highlight-color: transparent");
  });

  it("dims a disabled row and takes it out of hover and press", () => {
    const disabled = all.find(([s, b]) => s.includes('[aria-disabled="true"]') && b.includes("opacity"));
    expect(disabled?.[1]).toContain("opacity: 0.45");
    // cmdk writes data-disabled="false" on every item: only "" (Radix) and "true" count.
    expect(css).not.toMatch(/\[data-disabled\][^=]/);
  });

  it("defines its tokens for light and dark", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--nav-hi:[^}]*--nav-press:[^}]*--nav-mark:/);
    expect(css).toMatch(/\.dark\s*\{[^}]*--nav-hi:[^}]*--nav-press:/);
  });
});

describe("the nav's surfaces use it", () => {
  const NAV = path.join(ROOT, "src/components/nav");
  const sources = readdirSync(NAV)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => [f, readFileSync(path.join(NAV, f), "utf8")] as const);

  it("has no other hover, focus or current-page look left in the nav", () => {
    for (const [f, src] of sources) {
      expect(src, f).not.toMatch(/hover:bg-accent|focus:bg-accent|focus-visible:ring-2|focus-visible:ring-ring|data-\[current\]:bg-|aria-\[current=page\]:bg-|data-\[active\]:bg-|ring-offset-2 group-aria-\[current/);
    }
  });

  it("marks the open page in the Create sheet with the pip, and only that row", () => {
    state.path = "/edit";
    const html = render(createElement(CreateList, { variant: "sheet" }));
    const tags = currentTags(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('href="/edit"');
    const cls = classOf(tags[0]);
    expect(cls).toContain("nav-row");
    expect(cls).toContain("nav-mark-start");
    expect(cls).not.toMatch(/bg-brand-faint|bg-accent/);
  });

  it("marks the open page in the launcher with the pip, not a tinted card or row", () => {
    for (const current of ["cinema", "katana"]) {
      const html = render(createElement(LauncherColumns, { kind: undefined, current, now: 0 }));
      const tags = currentTags(html);
      expect(tags, current).toHaveLength(1);
      expect(classOf(tags[0])).toContain("nav-row");
      expect(classOf(tags[0])).not.toMatch(/bg-brand-faint|border-brand-text/);
    }
  });

  it("marks Settings in the You sheet when it is open", () => {
    state.hydrated = true;
    state.viewer = { signedIn: true, owner: false, publicSignup: true, account: { email: "ana@example.com" } };
    state.path = "/settings";
    const html = render(createElement(AccountSections, { variant: "sheet" }));
    const tags = currentTags(html);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('href="/settings"');
    expect(classOf(tags[0])).toContain("nav-mark-start");
  });
});
