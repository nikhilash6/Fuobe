"use client";

import { ExampleRow as Row } from "@/components/examples/example-cards";
import type { RowLayout } from "@/components/examples/example-row-frame";
import type { ExampleRowData } from "@/lib/examples/types";

/**
 * A tool's or a project list's examples (Layers, Genjutsu, Katana, Cinema, Ads Studio…), from the page's exampleRow()
 * (src/lib/examples/catalog.ts): until the tool has examples of its own, "More to try", covers that each open their own
 * page; an example of the tool's own opens a sheet with what went in and what came out. A page with a box of its own
 * above the row (an upload box) gives the row that box's width (`layout="column"` and `maxWidth`), so the heading and
 * the cards line up with the box.
 */
export function ExampleRow(props: { row: ExampleRowData; layout?: RowLayout; maxColumns?: 2 | 4; maxWidth?: number; className?: string }) {
  return <Row {...props} />;
}
