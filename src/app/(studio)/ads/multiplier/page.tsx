import type { Metadata } from "next";
import { AdMultiplier } from "@/components/ads/multiplier";
import { marketingModelInfo } from "@/components/marketing/model-info";
import { exampleRow } from "@/lib/examples/catalog";

export const metadata: Metadata = { title: "Ad Multiplier" };

export default function Page() {
  return <AdMultiplier models={marketingModelInfo()} examples={exampleRow("suite:ads")} />;
}
