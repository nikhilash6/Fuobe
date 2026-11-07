import type { Metadata } from "next";
import { Suspense } from "react";
import { AssistView } from "@/components/assist-view";
import { starterCards, starterFills } from "@/lib/starters/catalog";

export const metadata: Metadata = { title: "Make" };

export default function Page() {
  return (
    <Suspense>
      {/* Only the starters with their real cover: the owner's view loads the rest (GET /api/starters). */}
      <AssistView starters={starterCards("assist")} fills={starterFills("assist")} />
    </Suspense>
  );
}
