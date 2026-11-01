import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Studio } from "@/components/studio/studio";
import { APPS, getModel, getPreset } from "@/lib/catalog";
import { withRecipe } from "@/lib/catalog/preset-recipes";
import { appStudio } from "@/lib/studios";

export function generateStaticParams() {
  return APPS.map((a) => ({ id: a.id }));
}

export async function generateMetadata({ params }: PageProps<"/apps/[id]">): Promise<Metadata> {
  const { id } = await params;
  const preset = getPreset(id);
  return preset?.type === "app" ? { title: preset.name, description: `${preset.description}. A one-click Fuobe app on open-source models.` } : { title: "Not found" };
}

async function AppStudio({ params }: { params: PageProps<"/apps/[id]">["params"] }) {
  const { id } = await params;
  const preset = getPreset(id);
  if (!preset || preset.type !== "app") notFound();
  // The app opens on the model its preview was made with, its own route one pick away.
  return <Studio config={withRecipe(appStudio(preset), (m) => !!getModel(m))} />;
}

export default function Page({ params }: PageProps<"/apps/[id]">) {
  return (
    <Suspense fallback={null}>
      <AppStudio params={params} />
    </Suspense>
  );
}
