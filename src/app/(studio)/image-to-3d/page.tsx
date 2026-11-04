import type { Metadata } from "next";
import { Model3dStudio, type Model3dInfo } from "@/components/model3d/model3d-studio";
import { ALL_MODELS_3D, RIG_MODEL } from "@/lib/av/model3d";
import { HI3D_MODEL } from "@/lib/av/hi3d";
import { getModel } from "@/lib/catalog";
import { exampleRow } from "@/lib/examples/catalog";

export const metadata: Metadata = { title: "Image to 3D" };

/** The page passes the 3D models' names, so the client doesn't load the catalog. */
export default function Page() {
  const info: Record<string, Model3dInfo> = Object.fromEntries([...ALL_MODELS_3D.map((m) => m.id), RIG_MODEL, HI3D_MODEL].map((id) => [id, { name: getModel(id)?.name ?? id }]));
  return <Model3dStudio info={info} examples={exampleRow("tool:image-to-3d")} />;
}
