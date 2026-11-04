import type { Metadata } from "next";
import { MarketingStudio } from "@/components/marketing/marketing-studio";
import { marketingModelInfo } from "@/components/marketing/model-info";
import { starterCards } from "@/lib/starters/catalog";

export const metadata: Metadata = { title: "Marketing Studio" };

export default function Page() {
  return <MarketingStudio models={marketingModelInfo()} starters={starterCards("marketing")} />;
}
