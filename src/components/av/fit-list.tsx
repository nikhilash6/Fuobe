"use client";

import { Scissors } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SlotValue } from "@/components/studio/media-slot";
import { FitClipNote, useClipFit } from "./fit-clip";
import { FitUploadNote, useFitUpload } from "./fit-upload";

/** An account's sound cap: a part made here stays under it. */
const SOUND_CAP = 50 * 1024 * 1024;

/** A stored clip or sound in a list (a reference, an element's clip). */
export type ListItem = { id?: string; ref: string; preview: string; kind?: string; name?: string; uploading?: boolean; held?: string };

/**
 * One stored clip or sound of a list (references, an element's clip) that is longer than the run takes: a part of it
 * offered with the shared picker (src/components/av/trim-picker.tsx), cut here and uploaded as a new file in its place
 * (`replace`). A clip's part is cut from a key frame (MP4 and MOV); a sound's part is an MP3. The owner's switches
 * apply: with "Offer a part" off, nothing is offered and the page's own line says why the run can't take it. After a
 * Cancel, a button offers the part again.
 */
export function ListFit({
  item,
  seconds,
  kind: askedKind,
  max: askedMax,
  min,
  tool,
  line: askedLine,
  label,
  replace,
  className,
}: {
  /** The one to offer a part of; null: nothing to fit. */
  item: ListItem | null;
  /** Its length, as the page read it. */
  seconds: number | undefined;
  kind: "audio" | "video";
  /** The longest part to keep, and the shortest. */
  max: number | undefined;
  min?: number;
  /** Who the part is for: "MiniMax H3". */
  tool: string;
  /** The picker's line (why a part is asked). */
  line?: string;
  /** Its name on the button after a Cancel: "Clip 2", "Maya's clip". */
  label: string;
  /** Put `to` where `from` is in the list. */
  replace: (from: ListItem, to: SlotValue) => void;
  className?: string;
}) {
  // The fitting step swaps the item for a stand-in while it cuts, then for the part: each swap finds the last one. While
  // it cuts, the stand-in stays this step's own, even when the page no longer asks for a part of it (an uploading file
  // isn't counted).
  const [cutting, setCutting] = useState<{ item: ListItem; max?: number; line?: string; kind: "audio" | "video" } | null>(null);
  const cur = useRef(item);
  useEffect(() => {
    if (item) cur.current = item;
  });
  const set = (v: SlotValue | null) => {
    const from = cur.current;
    if (!v || !from) return;
    replace(from, v);
    const next = { ...v, id: v.id ?? from.id };
    cur.current = next;
    setCutting(v.uploading ? { item: next, max: cutting?.max ?? askedMax, line: cutting?.line ?? askedLine, kind: cutting?.kind ?? askedKind } : null);
  };
  const shown = cutting?.item ?? item;
  const { max, line, kind } = cutting ?? { max: askedMax, line: askedLine, kind: askedKind };
  const value = shown as SlotValue | null;
  const has = !!shown;
  const clipRule = useMemo(() => (kind === "video" && has && max ? { for: tool, tool, maxSeconds: max, minSeconds: min, line } : null), [kind, has, tool, max, min, line]);
  const soundRule = useMemo(
    () => (kind === "audio" && has && max ? { for: tool, tool, formats: ["*"], maxSeconds: max, minSeconds: min, outMaxBytes: SOUND_CAP, fromVideo: false, line } : null),
    [kind, has, tool, max, min, line],
  );
  const clip = useClipFit({ rule: clipRule, value, seconds, setValue: set, upload: () => {} });
  const sound = useFitUpload({ rule: soundRule, value, seconds, setValue: set, upload: () => {} });
  const fit = kind === "video" ? clip : sound;
  return (
    <div className={className}>
      {kind === "video" ? <FitClipNote fit={clip} /> : <FitUploadNote fit={sound} />}
      {fit.declined && !fit.busy && (
        <button
          type="button"
          onClick={fit.again}
          className="mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-background px-3.5 text-[13px] font-medium text-foreground hover:bg-accent"
        >
          <Scissors className="size-3.5" /> Pick the part of {label}
        </button>
      )}
    </div>
  );
}

/**
 * A list's "add" tile for a guest whose files are kept in this browser (they can't be cut once kept): a clip or sound
 * longer than `max` gets its part offered before it is added (`add`), with the same picker. Cancel adds it as it is.
 */
export function useAddFit({ kind, max, min, tool, add }: { kind: "audio" | "video"; max: number | undefined; min?: number; tool: string; add: (f: File) => void }) {
  const [value, setValue] = useState<SlotValue | null>(null);
  const clipRule = useMemo(() => (kind === "video" && max ? { for: tool, tool, maxSeconds: max, minSeconds: min } : null), [kind, tool, max, min]);
  const soundRule = useMemo(
    () => (kind === "audio" && max ? { for: tool, tool, formats: ["*"], maxSeconds: max, minSeconds: min, outMaxBytes: SOUND_CAP, fromVideo: false } : null),
    [kind, tool, max, min],
  );
  const cb = useRef(add);
  useEffect(() => {
    cb.current = add;
  });
  const clip = useClipFit({ rule: clipRule, value: null, setValue: () => {}, upload: (f) => cb.current(f) });
  const sound = useFitUpload({
    rule: soundRule,
    value,
    setValue,
    upload: (f) => {
      setValue(null);
      cb.current(f);
    },
  });
  const take = (f: File) => {
    if (kind === "video" && clip.wants(f)) return clip.take(f);
    if (kind === "audio" && sound.wants(f)) return sound.take(f);
    cb.current(f);
  };
  return { take, note: kind === "video" ? <FitClipNote fit={clip} /> : <FitUploadNote fit={sound} /> };
}
