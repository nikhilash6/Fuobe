import { MarketingToolSkeleton } from "@/components/marketing/skeletons";

// Ads Studio and a brand's workspace: the marketing suite's header and tabs stay on screen while the page loads.
export default function Loading() {
  return <MarketingToolSkeleton title="Ads Studio" active="ads" />;
}
