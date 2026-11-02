import type { Metadata } from "next";
import { StudioChrome } from "@/components/nav/studio-chrome";
import { NotFoundState } from "@/components/empty-state";
import { navCovers } from "@/lib/nav-covers";

export const metadata: Metadata = { title: "Not found" };

/** Unknown URLs anywhere in the app: the branded state inside the usual app frame. */
export default function NotFound() {
  return (
    <StudioChrome covers={navCovers()}>
      <NotFoundState />
    </StudioChrome>
  );
}
