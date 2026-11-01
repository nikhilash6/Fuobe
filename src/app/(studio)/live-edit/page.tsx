import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveEditApp, LiveSkeleton } from "@/components/live/live-edit-app";

export const metadata: Metadata = { title: "Live edit", description: "Change a picture as you type, on your own GPU with Qwen-Image 2.1." };

export default function Page() {
  return (
    <Suspense fallback={<LiveSkeleton />}>
      <LiveEditApp />
    </Suspense>
  );
}
