import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { exampleRow } from "@/lib/examples/catalog";
import { REFRAME_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Reframe" };

export default function Page() {
  return <Studio config={REFRAME_STUDIO} examples={exampleRow("studio:reframe")} />;
}
