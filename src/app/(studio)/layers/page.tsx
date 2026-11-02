import type { Metadata } from "next";
import { LayersProjects } from "@/components/layers/projects-view";
import { studioExamples } from "@/lib/studio-examples";

export const metadata: Metadata = { title: "Layers" };

export default function Page() {
  return <LayersProjects examples={studioExamples("layers")} />;
}
