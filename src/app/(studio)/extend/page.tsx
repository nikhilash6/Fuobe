import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { studioExamples } from "@/lib/studio-examples";
import { EXTEND_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Extend video" };

export default function Page() {
  return <Studio config={EXTEND_STUDIO} examples={studioExamples("extend")} />;
}
