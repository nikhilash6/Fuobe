import type { Metadata } from "next";
import { StoryboardView } from "@/components/storyboard-view";
import { getModel } from "@/lib/catalog";
import { STORYBOARD_LOOK_MODEL, STORYBOARD_MODELS, STORYBOARD_NEXT_SCENE, STORYBOARD_PARTNERS } from "@/lib/catalog/storyboard";

export const metadata: Metadata = { title: "Storyboard" };

/** Display names for the few models a storyboard uses, so the view needs no catalog in the browser. */
const MODEL_NAMES = Object.fromEntries(
  [...Object.values(STORYBOARD_MODELS), ...Object.values(STORYBOARD_PARTNERS)]
    .flatMap((m) => [m.first, m.firstWithRefs, m.next])
    .concat(STORYBOARD_LOOK_MODEL, ...Object.values(STORYBOARD_NEXT_SCENE))
    .map((id) => [id, getModel(id)?.name ?? id]),
);

export default function Page() {
  return <StoryboardView modelNames={MODEL_NAMES} />;
}
