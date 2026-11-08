import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Studio } from "@/components/studio/studio";
import { CleanVoiceTool } from "@/components/audio-tools/clean-voice-tool";
import { AnyAngleGate } from "@/components/any-angle/any-angle-tool";
import { RelightGate } from "@/components/relight/relight-gate";
import { RecolorTool } from "@/components/recolor/recolor-tool";
import { BodyDoubleTool } from "@/components/body-double/body-double-tool";
import { WatermarkTool } from "@/components/watermark/watermark-tool";
import { APPS, getModel, getPreset } from "@/lib/catalog";
import { withRecipe } from "@/lib/catalog/preset-recipes";
import { presetCover } from "@/lib/preset-covers";
import { appStudio } from "@/lib/studios";
import { exampleRow } from "@/lib/examples/catalog";
import { anyAngleToolLive } from "@/server/any-angle-live";
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
  // Any Angle: build a 3D view of the photo once, then pick camera angles from it. Open to everyone once its workflows
  // have passed their check on a GPU; the owner gets it before then.
  if (preset.tool === "any-angle") return <AnyAngleGate live={anyAngleToolLive()} app={{ name: preset.name }} />;
  if (preset.tool === "recolor") return <RecolorTool app={{ name: preset.name, description: preset.description }} />;
  // Body Double: Live (in the browser, no GPU) is open to everyone; a photo or a clip runs on a GPU.
  if (preset.tool === "body-double") return <BodyDoubleTool app={{ name: preset.name, description: preset.description }} />;
  // The Watermark Remover: scan, keep what you like, remove the rest (src/components/watermark).
  if (preset.tool === "watermark") return <WatermarkTool app={{ name: preset.name, description: preset.description }} cover={presetCover(preset.id)} />;
  // The app opens on the model its preview was made with, its own route one pick away.
  // Its examples sit in the app's card above the composer: one tap loads the photo and settings each was made with.
  const studio = <Studio config={withRecipe(appStudio(preset), (m) => !!getModel(m))} examples={exampleRow(`app:${preset.id}`)} />;
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
