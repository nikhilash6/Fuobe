import type { Metadata } from "next";
import { FacelessHome } from "@/components/faceless/faceless-home";
import { starterCards } from "@/lib/starters/catalog";

export const metadata: Metadata = { title: "Faceless Studio" };

export default function Page() {
  return <FacelessHome starters={starterCards("faceless")} />;
}
