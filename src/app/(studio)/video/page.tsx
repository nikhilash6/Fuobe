import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { exampleRow } from "@/lib/examples/catalog";
import { VIDEO_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Create video" };

export default function Page() {
  return <Studio config={VIDEO_STUDIO} examples={exampleRow("studio:video")} />;
}
