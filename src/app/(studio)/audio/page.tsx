import type { Metadata } from "next";
import { ModeSwitchStudio } from "@/components/studio/mode-switch-studio";
import { studioExamples } from "@/lib/studio-examples";

export const metadata: Metadata = { title: "Audio" };

export default function Page() {
  return <ModeSwitchStudio kind="audio" examples={studioExamples("audio")} />;
}
