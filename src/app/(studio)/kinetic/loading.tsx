import { ScenePickerShell } from "@/components/kinetic/scene-picker";

/** On the way in from a menu, Kinetic's opening screen itself stands in while the page loads. */
export default function Loading() {
  return <ScenePickerShell />;
}
