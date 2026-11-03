import type { Metadata } from "next";
import { ElementsView } from "@/components/elements-view";
import { starterCards } from "@/lib/starters/catalog";

export const metadata: Metadata = { title: "Elements" };

export default function Page() {
  return <ElementsView starters={starterCards("elements")} />;
}
