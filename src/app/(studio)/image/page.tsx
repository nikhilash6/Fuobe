import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { studioExamples } from "@/lib/studio-examples";
import { IMAGE_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Create image" };

export default function Page() {
  return <Studio config={IMAGE_STUDIO} examples={studioExamples("image")} />;
}
