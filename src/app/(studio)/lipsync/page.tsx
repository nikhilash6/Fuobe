import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { exampleRow } from "@/lib/examples/catalog";
import { LIPSYNC_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Lipsync & avatars" };

export default function Page() {
  return <Studio config={LIPSYNC_STUDIO} examples={exampleRow("studio:lipsync")} />;
}
