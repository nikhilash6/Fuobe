import type { Metadata } from "next";
import { AdMultiplier } from "@/components/ads/multiplier";
import { marketingModelInfo } from "@/components/marketing/model-info";
import { studioExamples } from "@/lib/studio-examples";

export const metadata: Metadata = { title: "Ad Multiplier" };

export default function Page() {
  return <AdMultiplier models={marketingModelInfo()} examples={studioExamples("ads")} />;
}
