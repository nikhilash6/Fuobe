import type { LucideIcon } from "lucide-react";
import { PageHeader, PageShell } from "@/components/page-shell";
import { cn } from "@/lib/utils";

const linkStyle = "[&_a]:text-brand-text [&_a]:underline-offset-2 [&_a:hover]:underline";

/**
 * Privacy and Terms: a title, a line under it, then short sections.
 * `cards` lays the sections out as a grid of soft cards (one column on phones, two from `sm`);
 * give each LegalSection an `icon` in that layout.
 */
export function LegalPage({
  title,
  lead,
  updated,
  cards,
  children,
}: {
  title: string;
  lead: string;
  updated: string;
  cards?: boolean;
  children: React.ReactNode;
}) {
  return (
    <PageShell>
      <PageHeader title={title} description={lead} />
      <div className={cn("text-[15px] leading-relaxed text-pretty", cards ? "grid max-w-4xl gap-4 sm:grid-cols-2" : "max-w-2xl space-y-8")}>{children}</div>
      <p className="mt-10 text-[12px] text-muted-foreground">Last updated {updated}</p>
    </PageShell>
  );
}

export function LegalSection({ title, icon: Icon, children }: { title: string; icon?: LucideIcon; children: React.ReactNode }) {
  if (Icon) {
    return (
      <section className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-faint text-brand-text" aria-hidden>
            <Icon className="size-[18px]" strokeWidth={1.75} />
          </span>
          <h2 className="text-[17px] font-medium leading-snug text-foreground">{title}</h2>
        </div>
        <div className={cn("mt-3 space-y-3 text-muted-foreground", linkStyle)}>{children}</div>
      </section>
    );
  }
  return (
    <section>
      <h2 className="font-heading text-[22px] leading-tight">{title}</h2>
      <div className={cn("mt-2 space-y-3 text-muted-foreground", linkStyle)}>{children}</div>
    </section>
  );
}
