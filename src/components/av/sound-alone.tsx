"use client";

import { AudioLines, Loader2 } from "lucide-react";
import { useState } from "react";
import { FIT_READ_MAX_SECONDS, mp3Kbps } from "@/lib/av/fit-upload";
import { postFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { readSeconds, toMp3 } from "./fit-audio";
import { useUploadSwitches } from "./use-upload-switches";

/** An account's sound cap: the MP3 stays under it. */
const SOUND_CAP = 50 * 1024 * 1024;

/**
 * A stored file's sound as an MP3, made in this browser and uploaded as a new file: for a tool that can't take the file as
 * it is (a video too big to have its sound taken in the cloud, a sound whose length can't be read). Hidden while the owner's
 * "Convert to MP3" switch is off: the tool's own words then stand.
 */
export function SoundAloneButton({
  src,
  name,
  label = "Send the sound alone (MP3)",
  onDone,
  className,
}: {
  src: string;
  name?: string;
  label?: string;
  onDone: (file: { url: string; name: string }) => void;
  className?: string;
}) {
  const sw = useUploadSwitches();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!sw.soundConvert) return null;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error("We couldn't open the file. Add it again");
      const blob = await res.blob();
      const seconds = await readSeconds(blob, blob.type.startsWith("video/"));
      if (seconds && seconds > FIT_READ_MAX_SECONDS) throw new Error("Its sound is too long to convert here (15 minutes at most). Save the sound as an MP3 and add it");
      const mp3 = await toMp3(blob, { kbps: (seconds && mp3Kbps(seconds, SOUND_CAP)) || 192, name });
      const asset = await postFile(mp3);
      onDone({ url: asset.url, name: mp3.name });
    } catch (e) {
      setError((e as Error).message || "We couldn't convert the sound here. Save it as an MP3 and add it");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn("space-y-1.5", className)}>
      <button
        type="button"
        onClick={() => void go()}
        disabled={busy}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full border bg-background px-3.5 text-[13px] font-medium text-foreground hover:bg-accent disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <AudioLines className="size-3.5" />}
        {busy ? "Converting to MP3…" : label}
      </button>
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}
