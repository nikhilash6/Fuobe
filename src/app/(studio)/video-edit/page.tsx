import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { studioExamples } from "@/lib/studio-examples";
import { VIDEO_EDIT_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Edit video" };

export default function Page() {
  return <Studio config={VIDEO_EDIT_STUDIO} examples={studioExamples("video-edit")} />;
}
