import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { studioExamples } from "@/lib/studio-examples";
import { MOTION_CONTROL_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Motion control" };

export default function Page() {
  return <Studio config={MOTION_CONTROL_STUDIO} examples={studioExamples("motion-control")} />;
}
