import { MarketingToolSkeleton } from "@/components/marketing/skeletons";

// Its own fallback, so the Ads Studio skeleton (../loading.tsx) never stands in for this page.
export default function Loading() {
  return <MarketingToolSkeleton title="Ad Multiplier" active="multiplier" />;
}
