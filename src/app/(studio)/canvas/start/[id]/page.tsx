import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TemplatePage } from "@/components/canvas/template-page";
import { shownTo } from "@/lib/canvas-sections";
import { templateDetail, templateIds } from "@/lib/canvas-template-cards";
import { templateCover } from "@/lib/template-covers";

export function generateStaticParams() {
  return templateIds().map((id) => ({ id }));
}

export async function generateMetadata({ params }: PageProps<"/canvas/start/[id]">): Promise<Metadata> {
  const { id } = await params;
  const t = templateDetail(id);
  if (!t) return { title: "Not found" };
  // A board visitors don't see yet (no real cover): its page is the owner's, kept out of search.
  const hidden = !shownTo(t, { visitor: true, hasCover: (x) => !!templateCover("canvas", x) });
  return { title: `${t.name} · Canvas`, description: t.description, ...(hidden && { robots: { index: false, follow: false } }) };
}

async function Template({ params }: { params: PageProps<"/canvas/start/[id]">["params"] }) {
  const { id } = await params;
  const t = templateDetail(id);
  if (!t) notFound();
  return <TemplatePage t={t} />;
}

export default function Page({ params }: PageProps<"/canvas/start/[id]">) {
  return (
    <Suspense fallback={null}>
      <Template params={params} />
    </Suspense>
  );
}
