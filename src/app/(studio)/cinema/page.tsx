import type { Metadata } from "next";
import { CinemaProjects } from "@/components/cinema/projects-view";
import { studioExamples } from "@/lib/studio-examples";

export const metadata: Metadata = { title: "Cinema Studio" };

export default function Page() {
  return <CinemaProjects examples={studioExamples("cinema")} />;
}
