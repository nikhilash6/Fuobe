import { PhoneBar } from "@/components/phone-bar";
import { cn } from "@/lib/utils";

/** Scrollable page body for non-studio pages (galleries, settings, library). */
export function PageShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-content min-w-0 flex-col">
      <PhoneBar />
      <div className={cn("mx-auto w-full min-w-0 flex-1 px-4 pt-4 pb-16 sm:px-8 md:pt-12", wide ? "max-w-[1400px]" : "max-w-[1200px]")}>{children}</div>
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="font-heading text-[34px] leading-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
