import { PageHeader, PageShell } from "@/components/page-shell";

/** Privacy and Terms: a title, a line under it, then short sections. */
export function LegalPage({ title, lead, updated, children }: { title: string; lead: string; updated: string; children: React.ReactNode }) {
  return (
    <PageShell>
      <PageHeader title={title} description={lead} />
      <div className="max-w-2xl space-y-8 text-[15px] leading-relaxed text-pretty">{children}</div>
      <p className="mt-10 text-[12px] text-muted-foreground">Last updated {updated}</p>
    </PageShell>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-heading text-[22px] leading-tight">{title}</h2>
      <div className="mt-2 space-y-3 text-muted-foreground [&_a]:text-brand-text [&_a]:underline-offset-2 [&_a:hover]:underline">{children}</div>
    </section>
  );
}
