import type { Metadata } from "next";
import { GenjutsuStudio } from "@/components/genjutsu/genjutsu-studio";
import { studioExamples } from "@/lib/studio-examples";

export const metadata: Metadata = { title: "Genjutsu" };

export default function Page() {
  return <GenjutsuStudio examples={studioExamples("genjutsu")} />;
}
