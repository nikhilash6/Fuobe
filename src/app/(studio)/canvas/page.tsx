import type { Metadata } from "next";
import { CanvasList } from "@/components/canvas/canvas-list";
import { canvasIntro, templateCards } from "@/lib/canvas-template-cards";

export const metadata: Metadata = { title: "Canvas" };

export default function Page() {
  return <CanvasList templates={templateCards()} intro={canvasIntro()} />;
}
