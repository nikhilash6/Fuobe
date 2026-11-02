import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Studio } from "@/components/studio/studio";
import { CleanVoiceTool } from "@/components/audio-tools/clean-voice-tool";
import { RelightGate } from "@/components/relight/relight-gate";
import { APPS, getModel, getPreset } from "@/lib/catalog";
import { withRecipe } from "@/lib/catalog/preset-recipes";
import { appStudio } from "@/lib/studios";
import { relightToolLive } from "@/server/relight";

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
  // An app that is a tool of its own (Clean up voice): the same tool as its Audio mode, under the app's name.
  if (preset.tool === "clean-voice") return <CleanVoiceTool app={{ name: preset.name, description: preset.description }} />;
  // The app opens on the model its preview was made with, its own route one pick away.
  const studio = <Studio config={withRecipe(appStudio(preset), (m) => !!getModel(m))} />;
  // Relight: tap the photo to place lights, a live preview, then Generate lighting and an instant Intensity blend. The
  // composer stays for visitors until the tool's workflow has passed its check on a GPU.
  if (preset.tool === "relight")
    return (
      <RelightGate live={relightToolLive()} app={{ name: preset.name, description: preset.description }}>
        {studio}
      </RelightGate>
    );
  return studio;
}

export default function Page({ params }: PageProps<"/apps/[id]">) {
  return (
    <Suspense fallback={null}>
      <AppStudio params={params} />
    </Suspense>
  );
}
