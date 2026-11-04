import type { Metadata } from "next";
import { ExplainerStudio } from "@/components/explainer/explainer-studio";
import { getModel } from "@/lib/catalog";
import { pickerData } from "@/lib/catalog/faceless";
import { starterCards, starterFills } from "@/lib/starters/catalog";

export const metadata: Metadata = { title: "Explainer" };

export default function Page() {
  return <ExplainerStudio picker={pickerData(getModel)} starters={starterCards("explainer")} fills={starterFills("explainer")} />;
}
