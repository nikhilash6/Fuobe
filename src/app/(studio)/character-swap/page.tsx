import type { Metadata } from "next";
import { SwapStudioHome } from "@/components/swap-studio/home";
import { exampleRow } from "@/lib/examples/catalog";

export const metadata: Metadata = { title: "Character Swap Studio" };

export default function Page() {
  return <SwapStudioHome examples={exampleRow("tool:character-swap")} />;
}
