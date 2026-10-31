import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { studioExamples } from "@/lib/studio-examples";
import { EDIT_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Edit image" };

export default function Page() {
  return <Studio config={EDIT_STUDIO} examples={studioExamples("edit")} />;
}
