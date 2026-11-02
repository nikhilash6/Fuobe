import { StudioChrome } from "@/components/nav/studio-chrome";
import { ShareProvider } from "@/components/share/share-provider";
import { navCovers } from "@/lib/nav-covers";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <StudioChrome covers={navCovers()}>
      <ShareProvider>{children}</ShareProvider>
    </StudioChrome>
  );
}
