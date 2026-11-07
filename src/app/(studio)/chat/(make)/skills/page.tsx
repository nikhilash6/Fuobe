import type { Metadata } from "next";
import { SkillsView } from "@/components/assist/skills-view";

export const metadata: Metadata = { title: "Skills" };

export default function Page() {
  return <SkillsView />;
}
