import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProjectView } from "@/components/assist/project-view";
import { recordExists } from "@/server/records";

export const metadata: Metadata = { title: "Project" };

async function Project({ params }: { params: PageProps<"/chat/projects/[id]">["params"] }) {
  const { id } = await params;
  if (!recordExists({ kind: "assist-project", ids: [id] })) notFound();
  return <ProjectView id={id} />;
}

export default function Page({ params }: PageProps<"/chat/projects/[id]">) {
  return (
    <Suspense fallback={null}>
      <Project params={params} />
    </Suspense>
  );
}
