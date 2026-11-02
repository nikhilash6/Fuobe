import type { Metadata } from "next";
import { ContentFactoryHome } from "@/components/content-factory/home";
import { getModel } from "@/lib/catalog";
import { pickerData } from "@/lib/catalog/faceless";
import { starterCards, starterFills } from "@/lib/starters/catalog";

export const metadata: Metadata = { title: "Content Factory" };

export default function Page() {
  return <ContentFactoryHome voices={pickerData(getModel).voices} starters={starterCards("content-factory")} fills={starterFills("content-factory")} />;
}
