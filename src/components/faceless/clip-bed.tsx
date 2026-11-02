"use client";

import { useEffect, useState } from "react";
import { MediaDrop } from "@/components/av/media-drop";
import type { SlotValue } from "@/components/studio/media-slot";
import { CLIP_BED_HINT, CLIP_BED_LABEL, CLIP_BED_MAX, CLIP_BED_MIN, type BedClip } from "@/lib/catalog/faceless";
import type { Engine } from "@/lib/catalog/types";
import { ToggleRow } from "./controls";

/**
 * "Use a clip's soundtrack as the bed" under Background music (open engine): a video whose music and effects, with the
 * talking taken out, play under the narration. In the cloud the switch is off with a line saying where it runs.
 */
export function ClipBed({ engine, value, onChange }: { engine: Engine; value?: BedClip; onChange: (v: BedClip | undefined) => void }) {
  const cloud = engine === "cloud";
  const [on, setOn] = useState(!!value);
  const [slot, setSlot] = useState<SlotValue | null>(() => (value ? { ref: value.url, preview: value.url, kind: "video", name: value.name } : null));
  const [seconds, setSeconds] = useState<number | null>(value?.seconds ?? null);
  const ready = slot && !slot.uploading && slot.ref ? slot : null;
  const fits = seconds !== null && seconds >= CLIP_BED_MIN && seconds <= CLIP_BED_MAX;
  const key = on && ready && fits ? `${ready.ref}|${seconds}` : "";
  useEffect(() => {
    // The settings follow the finished upload and its length (nothing while it uploads or when it doesn't fit).
    const next = key && ready ? { url: ready.ref, seconds: seconds!, ...(ready.name && { name: ready.name }) } : undefined;
    if ((next?.url ?? "") !== (value?.url ?? "") || next?.seconds !== value?.seconds) onChange(next);
    // Only when the clip or its length changes; `value` follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const problem = seconds === null ? null : seconds < CLIP_BED_MIN ? `Pick a clip of at least ${CLIP_BED_MIN} seconds.` : seconds > CLIP_BED_MAX ? "Pick a clip of up to 10 minutes." : null;
  return (
    <div className="space-y-2 sm:col-span-2">
      <ToggleRow label={CLIP_BED_LABEL} hint={CLIP_BED_HINT[engine]} checked={on && !cloud} disabled={cloud} onChange={setOn} />
      {on && !cloud && (
        <>
          <MediaDrop
            kind="video"
            compact
            value={slot}
            onChange={(v) => {
              setSlot(v);
              if (!v) setSeconds(null);
            }}
            onDuration={(s) => setSeconds(Math.round(s * 100) / 100)}
            title="Add a clip for its soundtrack"
            hint={`A video of ${CLIP_BED_MIN} seconds to 10 minutes`}
          />
          {problem && <p className="text-[12px] text-destructive">{problem}</p>}
        </>
      )}
    </div>
  );
}
