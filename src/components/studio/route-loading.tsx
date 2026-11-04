import { HubBodySkeleton, StudioSkeleton } from "@/components/skeletons";
import { StudioRouteSkeleton } from "@/components/studio/hub-chrome";

/**
 * The route skeleton of a studio page with no skeleton of its own: each top-level folder under src/app/(studio) has a
 * loading.tsx, most of them this one re-exported. On the way into a hub it is the hub's real title bar and tabs over
 * the body's skeleton; elsewhere the generic one.
 *
 * There is deliberately no loading.tsx in src/app/(studio) itself. A loading.tsx wraps its folder's page in a Suspense
 * boundary, and React sends a boundary that big as the skeleton first and the page last, hidden, at the end of the
 * HTML. Home would then show this skeleton on every full load until the whole document has been read and drawn in one
 * frame, which takes many seconds on a busy computer. Without the boundary, Home's first screen is drawn as its HTML
 * arrives.
 */
export default function StudioRouteLoading() {
  return <StudioRouteSkeleton generic={<StudioSkeleton />} hubBody={<HubBodySkeleton />} />;
}
