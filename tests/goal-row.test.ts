import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { GOAL_ASSIST_PROMPTS, GoalBand, GoalRow, goalAssistHref, rovingTarget } from "@/components/nav/goal-row";
import { NavUiProvider } from "@/components/nav/nav-ui";
import { ASSIST_PROMPT_MAX } from "@/lib/assist";
import { APPS, EFFECTS, MOTIONS, getPreset } from "@/lib/catalog";
import { presetHref } from "@/lib/home-showcase";
import { navCovers } from "@/lib/nav-covers";
import { GOALS, goalBand, tapHref, type ViewerKind } from "@/lib/nav-model";
import { presetCover } from "@/lib/preset-covers";

/*
 * Home's goal row (src/components/nav/goal-row.tsx): six goals, each opening a band of its studios, one-tap presets and
 * finishing tools, all from the nav model, with real covers. The page reads the presets' names on the server.
 */

const names: Record<string, string> = Object.fromEntries(GOALS.flatMap((g) => g.taps.map((t) => [t.preset, getPreset(t.preset)?.name ?? ""])));
const covers = navCovers();
// The provider as createElement types it with its children passed after the props.
const Nav = NavUiProvider as (p: { covers: typeof covers; children?: ReactNode }) => ReactNode;

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Nav, { covers }, node)),
  );
const band = (id: (typeof GOALS)[number]["id"], kind: ViewerKind | undefined) => render(createElement(GoalBand, { id, kind, names, onClose: () => {} }));
/** Every href in the markup, in order (React escapes & as &amp;). */
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
/** The markup's words, without its tags. */
const words = (html: string) => html.replace(/<[^>]+>/g, " ");
const count = (html: string, s: string) => html.split(s).length - 1;
const KINDS: (ViewerKind | undefined)[] = [undefined, "guest", "account", "owner"];
const TYPE_OF = { App: "app", "Camera motion": "motion", Effect: "effect" } as const;
const GALLERY = new Set([...APPS, ...MOTIONS, ...EFFECTS].map((p) => p.id));

describe("goal row keys", () => {
  it("moves between the goals with the arrows, Home and End, wrapping at the ends", () => {
    expect(rovingTarget("ArrowRight", 0, 6)).toBe(1);
    expect(rovingTarget("ArrowRight", 5, 6)).toBe(0);
    expect(rovingTarget("ArrowLeft", 0, 6)).toBe(5);
    expect(rovingTarget("ArrowLeft", 3, 6)).toBe(2);
    expect(rovingTarget("Home", 4, 6)).toBe(0);
    expect(rovingTarget("End", 1, 6)).toBe(5);
  });

  it("leaves every other key alone", () => {
    for (const key of ["Enter", " ", "Tab", "ArrowUp", "ArrowDown", "Escape", "a"]) expect(rovingTarget(key, 2, 6)).toBeNull();
    expect(rovingTarget("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("goal row data", () => {
  it("offers six goals in the row's order", () => {
    expect(GOALS.map((g) => g.id)).toEqual(["film", "social", "sell", "people", "edit", "sound"]);
  });

  it("links each one-tap preset where its gallery card links it, and names it as the catalog does", () => {
    for (const g of GOALS) {
      expect(g.taps.length, g.id).toBeGreaterThanOrEqual(2);
      expect(g.taps.length, g.id).toBeLessThanOrEqual(4);
      for (const t of g.taps) {
        const p = getPreset(t.preset);
        expect(p, t.preset).toBeDefined();
        // Its own gallery card (not an old id kept as an alias of another).
        expect(GALLERY.has(t.preset), t.preset).toBe(true);
        expect(p!.type, t.preset).toBe(TYPE_OF[t.kind]);
        expect(presetCover(t.preset), t.preset).toBeDefined();
        expect(names[t.preset]).toBe(p!.name);
        expect(tapHref(t.preset)).toBe(presetHref(t.preset));
      }
    }
    expect(tapHref("app-giant-product")).toBe("/apps/app-giant-product");
    expect(tapHref("motion-drone-reveal")).toBe("/video?preset=motion-drone-reveal");
  });

  it("types a goal's plan into Assist only for the goals that offer it", () => {
    for (const g of GOALS) {
      const href = goalAssistHref(g.id);
      if (!g.assist) continue;
      const prompt = GOAL_ASSIST_PROMPTS[g.id];
      expect(prompt, g.id).toBeTruthy();
      expect(prompt!.length).toBeLessThanOrEqual(ASSIST_PROMPT_MAX);
      expect(href).toBe(`/assist?prompt=${encodeURIComponent(prompt!)}`);
      expect(new URL(href!, "http://x").searchParams.get("prompt")).toBe(prompt);
    }
    for (const id of Object.keys(GOAL_ASSIST_PROMPTS)) expect(GOALS.find((g) => g.id === id)?.assist, id).toBe(true);
  });
});

describe("goal row markup", () => {
  it("renders closed: six goal buttons, one tab stop, no band and no pictures yet", () => {
    const html = render(createElement(GoalRow, { names }));
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Start from a goal"');
    expect(count(html, "data-goal=")).toBe(6);
    expect(count(html, 'aria-expanded="false"')).toBe(6);
    expect(html).not.toContain('aria-expanded="true"');
    expect(count(html, 'aria-controls="goal-band"')).toBe(6);
    expect(count(html, 'tabindex="0"')).toBe(1);
    expect(count(html, 'tabindex="-1"')).toBe(5);
    expect(html.indexOf('tabindex="0"')).toBeLessThan(html.indexOf('data-goal="social"'));
    for (const g of GOALS) expect(html).toContain(`data-goal="${g.id}"`);
    // Each label in the row's order (its bold copy, which keeps the width, is hidden from screen readers).
    const order = GOALS.map((g) => html.indexOf(`>${g.label.replace("&", "&amp;")}<`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("All studios and tools");
    expect(html).not.toContain('id="goal-band"');
    expect(html).not.toContain("<img");
  });

  for (const g of GOALS) {
    it(`opens the ${g.id} band with the model's studios, presets and tools`, () => {
      for (const kind of KINDS) {
        const html = band(g.id, kind);
        const want = goalBand(g.id, kind);
        expect(html).toContain('id="goal-band"');
        expect(html).toContain('aria-labelledby="goal-band-title"');
        expect(html).toContain(`id="goal-band-title"`);
        expect(html).toContain(g.title.replace("&", "&amp;"));
        expect(html).toContain(`aria-label="Close ${g.title.replace("&", "&amp;")}"`);
        const links = hrefs(html).filter((h) => !h.startsWith("/assist?prompt="));
        expect(links).toEqual([...want.cards.map((e) => e.href), ...g.taps.map((t) => tapHref(t.preset)), ...want.finish.map((e) => e.href)]);
        expect(want.cards.length, g.id).toBeGreaterThanOrEqual(4);
        expect(want.cards.length, g.id).toBeLessThanOrEqual(5);
        for (const t of g.taps) {
          expect(html).toContain(names[t.preset]);
          // Its real cover, at the versioned URL the server resolved.
          const c = covers[t.preset];
          expect(html.includes(c.thumb) || html.includes(c.poster), t.preset).toBe(true);
        }
        for (const e of want.cards.filter((e) => e.cover)) {
          const c = covers[e.cover!];
          expect(html.includes(c.poster) || html.includes(c.thumb), e.id).toBe(true);
        }
      }
    });
  }

  it("shows Plan it with Assist to the owner only, on the goals that have it", () => {
    for (const g of GOALS) {
      for (const kind of KINDS) {
        const html = band(g.id, kind);
        const shown = kind === "owner" && !!g.assist;
        expect(html.includes("Plan it with Assist"), `${g.id} ${kind}`).toBe(shown);
        expect(hrefs(html).some((h) => h.startsWith("/assist?prompt=")), `${g.id} ${kind}`).toBe(shown);
      }
    }
  });

  it("never shows a guest or an account a word about the studio's own setup", () => {
    for (const g of GOALS) {
      for (const kind of [undefined, "guest", "account"] as const) {
        const text = words(band(g.id, kind));
        for (const w of ["ComfyUI", "add key", "Add key", "offline", "online", "Paid APIs only", "Open source only", "Placeholder", "Plan it with Assist"]) {
          expect(text.includes(w), `${g.id} ${kind}: ${w}`).toBe(false);
        }
      }
    }
  });
});
