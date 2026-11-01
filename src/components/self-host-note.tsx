import Link from "next/link";
import { cn } from "@/lib/utils";

const studio = "font-medium text-foreground underline underline-offset-4";

/**
 * A tool or a save that guests and accounts can't use: says so up front, with the studios they can use, instead of a
 * form the server refuses.
 * Hidden in a browser the owner used last (`<html data-viewer="owner">`, src/components/app-sidebar.tsx), where a page
 * that shows it until the viewer is known (useLikelyVisitor) would otherwise draw it and take it away.
 */
export function SelfHostNote({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <p role="note" className={cn("text-[13px] text-pretty text-muted-foreground [html[data-viewer='owner']_&]:hidden", className)}>
      {children && <>{children} </>}
      Try{" "}
      <Link href="/image" className={studio}>
        Image
      </Link>
      ,{" "}
      <Link href="/video" className={studio}>
        Video
      </Link>{" "}
      or{" "}
      <Link href="/audio" className={studio}>
        Audio
      </Link>
      .
    </p>
  );
}
