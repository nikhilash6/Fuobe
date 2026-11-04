import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";
import { exampleRow } from "@/lib/examples/catalog";
import { EDIT_STUDIO } from "@/lib/studios";

export const metadata: Metadata = { title: "Edit image" };

export default function Page() {
  return <Studio config={EDIT_STUDIO} examples={exampleRow("studio:edit")} />;
}
