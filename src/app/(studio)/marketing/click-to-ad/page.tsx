import type { Metadata } from "next";
import { ClickToAd } from "@/components/marketing/click-to-ad";
import { marketingModelInfo } from "@/components/marketing/model-info";
import { starterCards } from "@/lib/starters/catalog";

export const metadata: Metadata = { title: "Click to Ad" };

export default function Page() {
  return <ClickToAd models={marketingModelInfo()} starters={starterCards("click-to-ad")} />;
}
