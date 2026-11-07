import type { Metadata } from "next";
import { ScheduledView } from "@/components/assist/scheduled-view";

export const metadata: Metadata = { title: "Scheduled" };

export default function Page() {
  return <ScheduledView />;
}
