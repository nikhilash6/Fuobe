import type { Metadata } from "next";
import { AdsHome } from "@/components/ads/ads-home";
import { exampleRow } from "@/lib/examples/catalog";
import { starterCards } from "@/lib/starters/catalog";

export const metadata: Metadata = { title: "Ads Studio" };

export default function Page() {
  return <AdsHome examples={exampleRow("suite:ads")} starters={starterCards("ads")} />;
}
