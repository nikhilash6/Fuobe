import type { Metadata } from "next";
import { GenjutsuStudio } from "@/components/genjutsu/genjutsu-studio";
import { exampleRow, genjutsuExamples } from "@/lib/examples/catalog";
import { genjutsuLive } from "@/server/genjutsu-live";

export const metadata: Metadata = { title: "Genjutsu" };

export default function Page() {
  // Which Openjutsu modes are open to everyone (two committed files, read as the page is built; the owner sees them all).
  return <GenjutsuStudio examples={exampleRow("tool:genjutsu")} modeExamples={genjutsuExamples()} live={genjutsuLive()} />;
}
