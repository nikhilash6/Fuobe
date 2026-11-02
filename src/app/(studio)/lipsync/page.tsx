import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { studioExamples } from "@/lib/studio-examples";
import { LIPSYNC_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Lipsync & avatars" };

export default function Page() {
  return <Studio config={LIPSYNC_STUDIO} examples={studioExamples("lipsync")} />;
}
