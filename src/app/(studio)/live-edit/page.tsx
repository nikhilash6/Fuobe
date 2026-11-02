import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveEditApp, LiveSkeleton } from "@/components/live/live-edit-app";

export const metadata: Metadata = { title: "Live edit", description: "Change a picture as you type, on your own GPU." };

export default function Page() {
  return (
    <Suspense fallback={<LiveSkeleton />}>
      <LiveEditApp />
    </Suspense>
  );
}
