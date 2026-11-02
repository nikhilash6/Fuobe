import { HubBodySkeleton } from "@/components/skeletons";
import { HubFrame } from "@/components/studio/hub-chrome";

/** The hub's title bar and mode tabs: shared by /upscale and /upscale/<mode>, so a tab switch keeps them on screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <HubFrame kind="upscale" skeleton={<HubBodySkeleton />}>
      {children}
    </HubFrame>
  );
}
