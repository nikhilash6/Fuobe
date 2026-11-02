"use client";

import { ExampleRow as Row } from "@/components/examples/example-cards";
import type { ExampleRowData } from "@/lib/examples/types";

/**
 * A tool's or a project list's examples (Layers, Genjutsu, Katana, Cinema, Ads Studio…), from the page's exampleRow()
 * (src/lib/examples/catalog.ts): until the tool has examples of its own, "More to try", covers that each open their own
 * page; an example of the tool's own opens a sheet with what went in and what came out.
 */
export function ExampleRow({ row, className }: { row: ExampleRowData; className?: string }) {
  return <Row row={row} className={className} />;
}
