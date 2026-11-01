import type { Metadata } from "next";
import { ViralityStudio } from "@/components/virality/virality-studio";

export const metadata: Metadata = { title: "Hook check" };

export default function Page() {
  return <ViralityStudio />;
}
