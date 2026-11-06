"use client";

import { UnavailableNote } from "@/components/ui/unavailable";
import { endFrameAloneProblem } from "@/lib/catalog/plan";
import type { ModelDef } from "@/lib/catalog/types";
import type { SlotValue } from "./media-slot";

/**
 * An end frame with no start frame, on a model that uses an end frame only after a start frame (endFrameAloneProblem): said
 * before the run in the shared unavailable note, with the one tap that keeps the picture in the clip ("Use it as the start
 * frame"). A model that takes an end frame alone (fal's H3 family) runs it as it is, so there is nothing to say.
 */
export function EndFrameNote({
  model,
  start,
  end,
  hasStartSlot,
  setSlot,
}: {
  model: ModelDef;
  start: SlotValue | null | undefined;
  end: SlotValue | null | undefined;
  /** The studio has a start frame slot to move the picture into. */
  hasStartSlot: boolean;
  setSlot: (key: "image" | "endImage", v: SlotValue | null) => void;
}) {
  if (!end?.ref || start?.ref) return null;
  const why = endFrameAloneProblem(model, { endImage: end.ref });
  if (!why) return null;
  const fix = hasStartSlot
    ? {
        label: "Use it as the start frame",
        run: () => {
          setSlot("image", end);
          setSlot("endImage", null);
        },
      }
    : undefined;
  return (
    <div className="px-1">
      <UnavailableNote reason={{ why, ...(fix && { fix }) }} onClose={() => undefined} />
    </div>
  );
}
