import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The result panel's action grid: a long label wraps inside its own button, and an action that runs on the visitor's
 * own setup shows its mark (an icon with its words as tooltip) in a narrow cell and the short words where there is room,
 * never the long label that pushed the button out of its column. The owner sees no mark.
 */

vi.mock("server-only", () => ({}));

const { OwnSetupChip, OwnSetupMark } = await import("@/components/own-setup");
const { ownSetupLabel, ownSetupOnly, ownSetupShort } = await import("@/lib/own-setup");

const source = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("the own-setup chip in the result panel", () => {
  it("short=always says only the short words, at every width", () => {
    const o = ownSetupOnly("video-tools:restore")!;
    const html = renderToStaticMarkup(createElement(OwnSetupChip, { setup: o, short: "always" }));
    expect(html).toContain(ownSetupShort(o));
    expect(html).not.toContain(`>${ownSetupLabel(o)}<`);
    expect(html).not.toContain("sm:hidden");
  });

  it("the mark keeps the full words for a tooltip and a screen reader", () => {
    const o = ownSetupOnly("regenerate:upscale")!;
    const html = renderToStaticMarkup(createElement(OwnSetupMark, { setup: o }));
    expect(html).toContain(`title="${ownSetupLabel(o)}"`);
    expect(html).toContain("sr-only");
  });
});

describe("the result panel's action buttons", () => {
  const viewer = source("src/components/studio/viewer.tsx");

  it("keep their label inside their own cell: up to two lines in the grid, rows of one height", () => {
    expect(viewer).toMatch(/<span data-label className="min-w-0 truncate" title=\{label\}>/);
    expect(viewer).toMatch(/const cls = cn\("min-w-0"/);
    expect(viewer).not.toMatch(/\{icon\} \{label\}/);
    const grid = /const ACTION_GRID =\s*"([^"]+)"/.exec(viewer)?.[1] ?? "";
    for (const c of ["@container/actions", "grid-cols-2", "[&>*]:h-auto", "[&>*]:min-h-7", "[&>*]:whitespace-normal", "[&_[data-label]]:line-clamp-2", "[&_[data-label]]:whitespace-normal"]) expect(grid).toContain(c);
  });

  it("show the short chip only where the grid has room, the mark elsewhere, and nothing to the owner", () => {
    expect(viewer.match(/className=\{(cn\()?ACTION_GRID/g)).toHaveLength(2);
    expect(viewer).toMatch(/a\.ownSetup && !owner &&/);
    expect(viewer).toMatch(/<OwnSetupMark setup=\{a\.ownSetup\} className="@min-\[34rem\]\/actions:hidden" \/>/);
    expect(viewer).toMatch(/<OwnSetupChip setup=\{a\.ownSetup\} short="always" className="min-w-0 shrink @max-\[34rem\]\/actions:hidden" \/>/);
  });
});
