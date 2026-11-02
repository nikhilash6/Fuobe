import { MarketingToolSkeleton } from "@/components/marketing/skeletons";

// Its own fallback, so the Marketing gallery's skeleton (../loading.tsx) never stands in for this form.
export default function Loading() {
  return <MarketingToolSkeleton title="Click to Ad" active="click" />;
}
