import type { Metadata } from "next";
import { SwapStudioHome } from "@/components/swap-studio/home";
import { studioExamples } from "@/lib/studio-examples";

export const metadata: Metadata = { title: "Character Swap Studio" };

export default function Page() {
  return <SwapStudioHome examples={studioExamples("character-swap")} />;
}
