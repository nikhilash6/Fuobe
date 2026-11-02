import type { Metadata } from "next";
import { KatanaStudio } from "@/components/katana/katana-studio";
import { exampleRow } from "@/lib/examples/catalog";

export const metadata: Metadata = { title: "Katana" };

export default function Page() {
  return <KatanaStudio examples={exampleRow("tool:katana")} />;
}
