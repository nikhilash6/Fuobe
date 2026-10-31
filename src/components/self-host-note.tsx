import { cn } from "@/lib/utils";
import { FUOBE_REPO } from "@/lib/connections";

/**
 * Where a studio saves to its owner's library (projects, canvases, brands, elements…), which guests and free accounts
 * can't do yet: says so up front, with the way to use it now (Fuobe is open source), instead of a form the server refuses.
 * Hidden in a browser the owner used last (`<html data-viewer="owner">`, src/components/app-sidebar.tsx), where a page
 * that shows it until the viewer is known (useLikelyVisitor) would otherwise draw it and take it away.
 */
export function SelfHostNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="note" className={cn("text-[13px] text-pretty text-muted-foreground [html[data-viewer='owner']_&]:hidden", className)}>
      {children}{" "}
      <a href={FUOBE_REPO} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-4">
        Run Fuobe yourself
      </a>{" "}
      (it&apos;s open source) to use it now.
    </p>
  );
}
