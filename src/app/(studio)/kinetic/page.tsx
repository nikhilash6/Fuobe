import type { Metadata } from "next";
import { Suspense } from "react";
import { KineticStudio } from "@/components/kinetic/kinetic-studio";
import { ScenePickerShell } from "@/components/kinetic/scene-picker";

export const metadata: Metadata = { title: "Fuobe Kinetic Motion" };

/**
 * Fuobe Kinetic Motion: motion graphics in your brand, drawn live in the browser. The page itself is static: it sends
 * the opening screen (its title, the examples and every scene), and the studio reads its address (scene, style, from)
 * on the client, inside a Suspense boundary.
 */
export default function Page() {
  return (
    <Suspense fallback={<ScenePickerShell />}>
      <KineticStudio />
    </Suspense>
  );
}
