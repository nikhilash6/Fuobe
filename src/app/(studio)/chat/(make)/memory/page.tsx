import type { Metadata } from "next";
import { MemoryView } from "@/components/assist/memory-view";

export const metadata: Metadata = { title: "Memory" };

export default function Page() {
  return <MemoryView />;
}
