import type { Metadata } from "next";
import { MixedStudio } from "@/components/mixed-media/mixed-studio";
import { MIXED_FRAME_MODELS, MIXED_MODELS } from "@/lib/catalog/mixed-media";
import { modelInfos } from "@/lib/catalog/shorts-models";
import { studioExamples } from "@/lib/studio-examples";

export const metadata: Metadata = { title: "Mixed Media" };

/**
 * The models per engine as each runs there, slimmed on the server so the page ships no catalog: Fast's video-to-video
 * models (cloud), and the models that draw each frame (Fuobe Mixed Media first on both engines, then the cloud's partner
 * image editors). Smooth is Fuobe Mixed Media's own.
 */
const MODELS = { cloud: modelInfos(MIXED_MODELS.cloud, "cloud"), open: modelInfos(MIXED_MODELS.open, "open") };
const FRAME_MODELS = { cloud: modelInfos([...MIXED_FRAME_MODELS], "cloud"), open: modelInfos(MIXED_MODELS.open, "open") };

export default function Page() {
  return <MixedStudio models={MODELS} frameModels={FRAME_MODELS} how={studioExamples("mixed-media")} />;
}
