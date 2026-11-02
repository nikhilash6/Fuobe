import type { Metadata } from "next";
import { KatanaStudio } from "@/components/katana/katana-studio";
import { studioExamples } from "@/lib/studio-examples";

export const metadata: Metadata = { title: "Katana" };

export default function Page() {
  return <KatanaStudio examples={studioExamples("katana")} />;
}
