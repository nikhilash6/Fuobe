import type { Metadata } from "next";
import { ModeSwitchStudio } from "@/components/studio/mode-switch-studio";

export const metadata: Metadata = { title: "Video tools" };

export default function Page() {
  return <ModeSwitchStudio kind="video-tools" />;
}
