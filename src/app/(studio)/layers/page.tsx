import type { Metadata } from "next";
import { LayersProjects } from "@/components/layers/projects-view";
import { exampleRow } from "@/lib/examples/catalog";

export const metadata: Metadata = { title: "Layers" };

export default function Page() {
  return <LayersProjects examples={exampleRow("tool:layers")} />;
}
