"use client";

import { Loader2, Scissors } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Feed } from "@/components/studio/feed";
import type { SlotValue } from "@/components/studio/media-slot";
import { VideoTrimmer, type TrimRange } from "@/components/studio/video-trimmer";
import { useCreateGeneration, useEngine, useGenerations } from "@/lib/api";
import { formatCueTime, parseCueTime } from "@/lib/av/cue-edit";
import { probeBlob, probeUrl } from "@/lib/media-probe";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { MediaDrop } from "./media-drop";
import { useDraft } from "./use-draft";
import { Panel, ToolHero, ToolShell } from "./tool-shell";

export const TRIM_FEATURE = "trim";
const MIN_LENGTH = 0.5;

/**
 * Trim (Video tools → Trim): keep the part between two times, with its sound. fal's trim utility on
 * the cloud, ComfyUI's core Trim Video on the open engine (CPU). The shared VideoTrimmer picks the
 * part (filmstrip, handles, play the selection, typed times); a clip the browser can't decode is
 * trimmed by typed times, with its length read from the file when it says.
 */
export function TrimTool({ tabs }: { tabs?: React.ReactNode }) {
  const [engine, , engineMode] = useEngine();
  const create = useCreateGeneration();
  const results = useGenerations({ features: [TRIM_FEATURE], limit: 24 });
  const [video, setVideo] = useState<SlotValue | null>(null);
  const [range, setRange] = useState<TrimRange | null>(null);
  const [length, setLength] = useState(0);
  // Which clip is current: an upload that finishes is the same clip (its preview moves to the server URL).
  const [clip, setClip] = useState(0);
  /** The browser can't decode the clip: its length from the header (null: unknown, so the times are typed). */
  const [unreadable, setUnreadable] = useState<{ clip: number; length: number | null } | null>(null);
  const unread = unreadable?.clip === clip ? unreadable : null;
  // The file dropped for the current clip (none for a library pick), and which clip's header was read.
  const dropped = useRef<File | null>(null);
  const probed = useRef(-1);
  // The slot as last picked: an upload reports back to the `pick` of the render it started in, whose `video` is stale.
  const current = useRef<SlotValue | null>(null);
  const pick = (v: SlotValue | null) => {
    const prev = current.current;
    current.current = v;
    const finished = !!v && !!prev?.uploading && !v.uploading && v.name === prev.name;
    if (!finished) {
      setClip((c) => c + 1);
      setRange(null);
      setLength(0);
      if (!v?.uploading) dropped.current = null;
    }
    setVideo(v);
  };
  /**
   * The clip's length from its own header (MP4 / MOV), for clips this browser can't play: read once
   * per clip (the trimmer says so again when a finished upload moves its preview to the server),
   * from the dropped file itself, else from the server with Range requests (only the header and
   * moov box, never the whole clip).
   */
  const onUnreadable = () => {
    if (!video || probed.current === clip) return;
    const at = clip;
    probed.current = at;
    const file = dropped.current;
    void (file ? probeBlob(file) : probeUrl(video.ref || video.preview)).then((info) => setUnreadable({ clip: at, length: info?.duration ?? null }));
  };
  const trim = () => {
    if (!video) return void toast("Add the video first");
    if (video.uploading) return void toast("Still uploading — one moment");
    if (!range) return void toast("Pick the part to keep");
    if (range.endTime - range.startTime < MIN_LENGTH) return void toast(`Keep at least ${MIN_LENGTH} s`);
    create.mutate(
      {
        feature: TRIM_FEATURE,
        modelId: engine === "open" ? "oss-trim" : "trim-video",
        op: "trim",
        inputs: { video: video.ref },
        params: { startTime: Math.round(range.startTime * 100) / 100, endTime: Math.round(range.endTime * 100) / 100 },
        title: `Trim · ${formatCueTime(range.startTime)}–${formatCueTime(range.endTime)}`,
      },
      { onSuccess: () => toast.success("Trimming"), onError: (e) => toastError(e) },
    );
  };
  const typed = !!unread && unread.length == null;
  const total = unread?.length ?? length;
  return (
    <ToolShell title="Video tools" tabs={tabs}>
      {!video && <ToolHero title="Keep just the part you need" subtitle={`Pick where it starts and ends — the sound comes along. Free on your ComfyUI (CPU)${engineMode === "open" ? "." : ", fractions of a cent on the cloud."}`} />}
      <div className={cn("mx-auto max-w-[820px] space-y-3", video ? "pt-4" : "mt-8")}>
        <MediaDrop kind="video" value={video} onChange={pick} onFile={(f) => (dropped.current = f)} preview={false} title="Add a video to trim" hint="MP4, MOV or WebM up to 200 MB" compact />
        {video && (
          <Panel title="Keep">
            {typed ? (
              <ManualRange value={range} onChange={setRange} />
            ) : (
              <VideoTrimmer
                key={clip}
                src={video.preview}
                value={range}
                onChange={setRange}
                min={MIN_LENGTH}
                duration={unread?.length ?? undefined}
                label="Part to keep"
                onMeta={(m) => m.duration > 0 && setLength(m.duration)}
                onUnreadable={onUnreadable}
              />
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <p className="flex-1 text-[13px] text-muted-foreground">
                {range ? (
                  <>
                    Keeps <span className="font-mono text-foreground">{formatCueTime(Math.max(0, range.endTime - range.startTime))}</span>
                    {total > 0 && ` of ${formatCueTime(total)}`}
                  </>
                ) : typed ? (
                  "Type where it starts and ends"
                ) : (
                  "Reading the clip…"
                )}
              </p>
              <Button className="rounded-full" onClick={trim} disabled={create.isPending || !range}>
                {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Scissors className="size-4" />} Trim
              </Button>
            </div>
          </Panel>
        )}
      </div>
      {(results.data?.length ?? 0) > 0 && (
        <section className="mt-10" aria-labelledby="trimmed">
          <h3 id="trimmed" className="mb-3 font-heading text-[22px]">
            Trimmed clips
          </h3>
          <Feed items={results.data!} />
        </section>
      )}
    </ToolShell>
  );
}

/** When the browser can't decode the clip and its header has no length: type the times (the server still trims it). */
function ManualRange({ value, onChange }: { value: TrimRange | null; onChange: (v: TrimRange) => void }) {
  const r = value ?? { startTime: 0, endTime: 0 };
  const set = (edge: "start" | "end", raw: string) => {
    const t = parseCueTime(raw);
    if (t === null) return;
    onChange(edge === "start" ? { startTime: t, endTime: Math.max(r.endTime, t + MIN_LENGTH) } : { startTime: r.startTime, endTime: Math.max(t, r.startTime + MIN_LENGTH) });
  };
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted-foreground">This browser can&apos;t preview the clip, but it can still be trimmed — type the times (e.g. 0:03.5).</p>
      <div className="flex flex-wrap items-center gap-2">
        <TimeField label="Start" value={r.startTime} onCommit={(s) => set("start", s)} />
        <TimeField label="End" value={r.endTime} onCommit={(s) => set("end", s)} />
      </div>
    </div>
  );
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (raw: string) => void }) {
  const [text, setText] = useDraft(formatCueTime(value));
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      {label}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        inputMode="decimal"
        className="h-8 w-20 rounded-full border bg-background px-2.5 text-center font-mono text-[12px] text-foreground tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-brand-faint"
      />
    </label>
  );
}
