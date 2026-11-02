import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { studioExamples } from "@/lib/studio-examples";
import { REFRAME_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Reframe" };

export default function Page() {
  return <Studio config={REFRAME_STUDIO} examples={studioExamples("reframe")} />;
}
