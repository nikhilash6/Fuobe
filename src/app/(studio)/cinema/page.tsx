import type { Metadata } from "next";
import { CinemaProjects } from "@/components/cinema/projects-view";
import { exampleRow } from "@/lib/examples/catalog";
import { starterCards } from "@/lib/starters/catalog";

export const metadata: Metadata = { title: "Cinema Studio" };

export default function Page() {
  return <CinemaProjects examples={exampleRow("suite:cinema")} starters={starterCards("cinema")} />;
}
