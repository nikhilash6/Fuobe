import { HubBodySkeleton } from "@/components/skeletons";
import { HubFrame } from "@/components/studio/hub-chrome";

/** The hub's title bar and mode tabs: shared by /video-tools and /video-tools/<mode>, so a tab switch keeps them on screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <HubFrame kind="video-tools" skeleton={<HubBodySkeleton />}>
      {children}
    </HubFrame>
  );
}
