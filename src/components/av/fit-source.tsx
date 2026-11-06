"use client";

import { useMemo } from "react";
import type { SlotValue } from "@/components/studio/media-slot";
import { FitClipNote, useClipFit } from "./fit-clip";
import { FitUploadNote, useFitUpload } from "./fit-upload";

/**
 * A tool's own source (a sound or a video, once stored) longer than the tool takes: a part of it offered, with the shared
 * picker (src/components/av/trim-picker.tsx). A sound's part is an MP3, a clip's part is cut from a key frame. The tool
 * keeps its own check: Cancel, or the owner's switch off, leaves the file as it is and the tool says why.
 */

type Source = { ref: string; preview: string; kind?: string; name?: string; uploading?: boolean; held?: string; duration?: number };

const SOUND_CAP = 50 * 1024 * 1024;

export function SourceFit<S extends Source>({
  source,
  kind,
  tool,
  maxSeconds,
  minSeconds,
  setSource,
  className,
}: {
  source: S | null;
  kind: "audio" | "video";
  tool: string;
  /** The longest the tool takes; undefined: nothing to fit. */
  maxSeconds: number | undefined;
  minSeconds?: number;
  setSource: (s: S | null) => void;
  className?: string;
}) {
  const value = source as unknown as SlotValue | null;
  const set = (v: SlotValue | null) => setSource(v ? ({ ...(source ?? {}), ...v, kind, duration: undefined } as unknown as S) : null);
  const clipRule = useMemo(() => (kind === "video" && maxSeconds ? { for: tool, tool, maxSeconds, minSeconds } : null), [kind, tool, maxSeconds, minSeconds]);
  const soundRule = useMemo(
    () => (kind === "audio" && maxSeconds ? { for: tool, tool, formats: ["*"], maxSeconds, minSeconds, outMaxBytes: SOUND_CAP, fromVideo: false } : null),
    [kind, tool, maxSeconds, minSeconds],
  );
  const clip = useClipFit({
    rule: clipRule,
    value,
    seconds: source?.duration,
    setValue: set,
    upload: () => {},
  });
  const sound = useFitUpload({
    rule: soundRule,
    value,
    seconds: source?.duration,
    setValue: set,
    upload: () => {},
  });
  return kind === "video" ? <FitClipNote fit={clip} className={className} /> : <FitUploadNote fit={sound} className={className} />;
}
