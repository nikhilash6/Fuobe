import type { Metadata } from "next";
import { AdsHome } from "@/components/ads/ads-home";
import { studioExamples } from "@/lib/studio-examples";

export const metadata: Metadata = { title: "Ads Studio" };

export default function Page() {
  return <AdsHome examples={studioExamples("ads")} />;
}
