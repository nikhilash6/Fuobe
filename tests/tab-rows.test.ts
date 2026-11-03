import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AreaTabs } from "@/components/areas/area-islands";
import { onAttr, TAB_PILL, TabRow } from "@/components/ui/tab-row";
import { glideDuration } from "@/lib/glide-scroll";

/*
 * Every row of tabs or chips on the site has one look (src/components/ui/tab-row.tsx, src/app/tab-row.css): pills in a
 * TabRow, the selected one marked data-on, a fill that slides between them. These checks keep each row on it.
 */

const src = (f: string) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

/** Each row: the file that draws it and the row's own words (its aria-label), so a row can't leave the shared look. */
const ROWS: [file: string, label: string][] = [
  ["src/components/areas/area-islands.tsx", "<TabRow follow>"],
  ["src/components/nav/goal-row.tsx", 'aria-label="Start from a goal"'],
  ["src/components/library-view.tsx", 'aria-label="Library sections"'],
  ["src/components/studio/hub-chrome.tsx", "<TabRow ref={ref}"],
  ["src/components/marketing/shell.tsx", 'aria-label="Marketing tools"'],
  ["src/components/marketing/marketing-studio.tsx", 'aria-label="View"'],
  ["src/components/preset-gallery.tsx", 'aria-label="Categories"'],
  ["src/components/genjutsu/genjutsu-studio.tsx", 'aria-label="Genjutsu modes"'],
  ["src/components/shorts/shorts-studio.tsx", 'aria-label="Shorts Studio"'],
  ["src/components/mixed-media/mixed-studio.tsx", 'aria-label="Mixed Media"'],
  ["src/components/influencer/influencer-builder.tsx", 'aria-label="Categories"'],
  ["src/components/fashion/character-sheet.tsx", 'aria-label="How to build it"'],
  ["src/components/fashion/character-sheet.tsx", 'aria-label="Soul Cast"'],
  ["src/components/photodump/photodump-view.tsx", 'aria-label="Packs"'],
  ["src/components/moodboards/moodboards-view.tsx", 'aria-label="Moodboards"'],
  ["src/components/moodboards/moodboard-panel.tsx", 'aria-label="Moodboards"'],
  ["src/components/swap-studio/workbench.tsx", 'aria-label="Stages"'],
  ["src/components/studio/preset-chips.tsx", 'aria-label="Categories"'],
  ["src/components/dub/dub-studio.tsx", 'aria-label="Languages"'],
  ["src/components/cinema/soul-builders.tsx", 'aria-label="Cast details"'],
  ["src/components/cinema/director-panel.tsx", 'aria-label="Camera"'],
  ["src/components/cinema/director-panel.tsx", 'aria-label="Lighting"'],
  ["src/components/cinema/palette-editor.tsx", 'aria-label="Source"'],
  ["src/components/cinema/side-panel.tsx", 'aria-label="Panel"'],
  ["src/components/canvas/canvas-editor.tsx", 'aria-label="View"'],
  ["src/components/ads/ad-editor.tsx", 'aria-label="Format"'],
  ["src/components/studio/media-slot.tsx", 'aria-label="Kind"'],
  ["src/components/genjutsu/look-picker.tsx", 'aria-label="Where the look comes from"'],
  ["src/components/nav/studios-sheet.tsx", 'aria-label="Show the studios for one goal"'],
  ["src/components/nav/search-palette.tsx", 'aria-label="Show the studios for one goal"'],
];

describe("tab and chip rows", () => {
  it.each(ROWS)("%s draws %s as a TabRow of tab pills", (file, label) => {
    const s = src(file);
    expect(s).toContain('from "@/components/ui/tab-row"');
    // The row's opening tag is a TabRow (the label is on it, maybe a few lines down; other elements may share it).
    let at = -1;
    for (let i = s.indexOf(label); i > -1; i = s.indexOf(label, i + 1)) {
      if (/^<TabRow\s/.test(s.slice(s.lastIndexOf("<", i), s.lastIndexOf("<", i) + 8))) {
        at = i;
        break;
      }
    }
    expect(at, `${file}: ${label} is on a TabRow`).toBeGreaterThan(-1);
    // Its items are pills with the shared mark, and none keeps an underline or a segmented track of its own.
    const close = s.indexOf("</TabRow>", at);
    const row = s.slice(at, close);
    expect(row).toContain("TAB_PILL");
    expect(row).toMatch(/onAttr\(/);
    expect(row).not.toMatch(/border-b-2|after:h-0\.5|bg-background text-foreground shadow-soft|rounded-t-/);
  });

  it("leaves no role=tablist outside the shared row", () => {
    const dir = path.join(__dirname, "..", "src/components");
    const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".tsx"));
    // A picker of pictures (Home's before and after) and the canvas's page tabs (rename, reorder) are not tab rows.
    const exempt = new Set(["home/before-after.tsx", "canvas/toolbar.tsx", "ui/tabs.tsx"].map((f) => path.normalize(f)));
    const left = files.filter((f) => !exempt.has(path.normalize(f)) && /<div[^>]*role="tablist"/.test(fs.readFileSync(path.join(dir, f), "utf8")));
    expect(left).toEqual([]);
  });

  it("the Radix tabs (ui/tabs) use the same pills and row", () => {
    const s = src("src/components/ui/tabs.tsx");
    expect(s).toContain("TAB_ROW");
    expect(s).toContain("TAB_PILL");
    expect(s).toContain("useTabIndicator");
  });

  it("a row renders its sliding fill, and the selected pill carries data-on", () => {
    const html = renderToStaticMarkup(
      createElement(TabRow, { role: "tablist", "aria-label": "Test" }, [
        createElement("button", { key: "a", role: "tab", "aria-selected": true, className: TAB_PILL, ...onAttr(true) }, "A"),
        createElement("button", { key: "b", role: "tab", "aria-selected": false, className: TAB_PILL, ...onAttr(false) }, "B"),
      ]),
    );
    expect(html).toContain('class="tab-row fade-x"');
    expect(html).toContain('<span aria-hidden="true" class="tab-ind"><span></span><span></span><span></span></span>');
    expect(html.match(/data-on=""/g)?.length).toBe(1);
  });

  it("the area tabs are links in a sticky band, no tab selected before the page is read", () => {
    const html = renderToStaticMarkup(
      createElement(AreaTabs, {
        label: "Create sections",
        tabs: [
          { href: "#make", label: "Make", icon: "sparkles", section: "make" },
          { href: "#edit", label: "Edit a picture", icon: "wand", section: "edit" },
        ],
      }),
    );
    expect(html).toMatch(/<nav[^>]*class="tab-band/);
    expect(html.match(/<a [^>]*class="tab-pill"/g)?.length).toBe(2);
    expect(html).not.toContain("data-on");
  });

  it("the shared style: fully rounded pills of one height, a fill that moves by transform only, motion off when reduced", () => {
    const css = src("src/app/tab-row.css");
    const pill = css.slice(css.indexOf(".tab-pill {"), css.indexOf("}", css.indexOf(".tab-pill {")));
    expect(pill).toContain("height: 36px");
    expect(pill).toContain("border-radius: 9999px");
    expect(pill).toContain("align-items: center");
    // 44 px to tap on touch.
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*?inset: -4px 0/);
    // The fill's parts move with transforms only, never left or width.
    const moving = css.slice(css.indexOf("[data-ind-moving] > .tab-ind > span {"));
    expect(moving.slice(0, moving.indexOf("}"))).toContain("transition: transform");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
    expect(css).not.toMatch(/transition:[^;]*\b(left|width)\b/);
  });

  it("a section glide takes 450 to 650 ms, longer for a longer way", () => {
    expect(glideDuration(0, 800)).toBe(450);
    expect(glideDuration(800, 800)).toBe(550);
    expect(glideDuration(-3200, 800)).toBe(650);
    expect(glideDuration(80_000, 800)).toBe(650);
    expect(glideDuration(400, 800)).toBeLessThan(glideDuration(1600, 800));
  });
});
