import { HubBodySkeleton, StudioSkeleton } from "@/components/skeletons";
import { StudioRouteSkeleton } from "@/components/studio/hub-chrome";

export default function Loading() {
  return <StudioRouteSkeleton generic={<StudioSkeleton />} hubBody={<HubBodySkeleton />} />;
}
