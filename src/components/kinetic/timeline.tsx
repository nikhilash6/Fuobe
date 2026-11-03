"use client";

import { Diamond } from "lucide-react";
import { useMemo, useState } from "react";
import { dropTrackKey, groupsOf, isIdentityTiming, moveTrackKey, shotWindows } from "@/lib/motion/edit";
import { groupDefsFor } from "@/lib/motion/kinetic-groups";
import { setPro, type KineticDoc } from "@/lib/motion/kinetic-doc";
import type { TrackId } from "@/lib/motion/recipe";
import type { ScenePlan } from "@/lib/motion/scene";
import { cn } from "@/lib/utils";
import { usePlayhead, type TimeStore } from "./time-store";
import type { KineticEditor } from "./use-editor";

/**
 * The Timeline: the scene's motion groups as rows, each drawing its events at their real (retimed) times on a ruler,
 * then a lane per parameter track with its keys. Tapping a row opens its timing; tapping a key moves the playhead to it.
 * The ruler runs the clip's whole length, the last stretch marked as the hold on the rest frame.
 */

export const TRACK_NAMES: Record<TrackId, string> = {
  "camera.zoom": "Zoom",
  "camera.x": "Pan across",
  "camera.y": "Pan up and down",
  "camera.roll": "Roll",
  "finish.contrast": "Contrast",
  "finish.saturation": "Saturation",
  "finish.grain": "Grain",
  "clip.dim": "Clip dim",
};

const pct = (t: number, total: number) => `${Math.max(0, Math.min(100, (t / Math.max(1e-6, total)) * 100))}%`;

function Playhead({ time, total }: { time: TimeStore; total: number }) {
  const t = usePlayhead(time);
  return <span aria-hidden className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-primary" style={{ left: pct(t, total) }} />;
}

function Ruler({ total, rest }: { total: number; rest: number }) {
  const marks = Array.from({ length: Math.floor(total + 1e-6) + 1 }, (_, i) => i);
  return (
    <div className="relative h-6 text-[11px] text-muted-foreground tabular-nums md:text-[12px]" aria-hidden>
      {rest < total - 0.05 && (
        <span className="absolute inset-y-0 right-0 flex items-start justify-end rounded-sm bg-[repeating-linear-gradient(135deg,var(--muted)_0_4px,transparent_4px_8px)] pr-1" style={{ left: pct(rest, total) }}>
          <span className="bg-card px-1">Hold</span>
        </span>
      )}
      {marks.map((s) => (
        <span key={s} className={cn("absolute", s === 0 ? "" : s >= total - 1e-6 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: pct(s, total) }}>
          {s}s
        </span>
      ))}
    </div>
  );
}

export function Timeline({ plan, doc, time, editor, onGroup }: { plan: ScenePlan; doc: KineticDoc; time: TimeStore; editor: Pick<KineticEditor, "apply">; onGroup: (id: string) => void }) {
  const r = doc.recipe;
  const total = Math.max(plan.rest, r.duration);
  const windows = useMemo(() => shotWindows(plan), [plan]);
  const groups = useMemo(() => groupsOf(groupDefsFor(r.scene), plan.timeline.events, windows), [plan, windows, r.scene]);
  const [sel, setSel] = useState<{ id: TrackId; i: number } | null>(null);
  const tracks = Object.entries(r.tracks ?? {}) as [TrackId, NonNullable<NonNullable<typeof r.tracks>[TrackId]>][];
  const label = "w-24 shrink-0 truncate pr-2 text-left text-[12px] font-medium sm:w-28";

  return (
    <section aria-labelledby="kinetic-timing" className="min-w-0 rounded-2xl border bg-card p-3" data-kinetic-timeline>
      <div className="mb-1 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
        <h3 id="kinetic-timing" className="text-[14px] font-medium">
          Timing
        </h3>
        <p className="text-[12px] text-muted-foreground">Tap a part to change its timing</p>
      </div>
      <div className="flex min-w-0">
        <span className={label} />
        <div className="min-w-0 flex-1">
          <Ruler total={total} rest={plan.rest} />
        </div>
      </div>
      <div className="relative min-w-0">
        {windows.map((w, wi) => (
          <div key={wi} className="min-w-0">
            {windows.length > 1 && <p className="mt-1 mb-0.5 text-[12px] font-medium text-muted-foreground">Shot {wi + 1}</p>}
            {groups
              .filter((g) => g.window === wi)
              .map((g) => {
                const retimed = !isIdentityTiming(r.groups?.[g.id]);
                return (
                  <button key={g.id} type="button" onClick={() => onGroup(g.id)} data-kinetic-group={g.id} aria-label={`${g.label} timing${retimed ? ", retimed" : ""}`} className="flex h-11 w-full min-w-0 items-center rounded-lg outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
                    <span className={label}>
                      {g.label}
                      {retimed && <span className="ml-1 inline-block size-1.5 rounded-full bg-primary align-middle" aria-hidden />}
                    </span>
                    <span className="relative h-6 min-w-0 flex-1 rounded bg-secondary/60">
                      {g.camera ? (
                        <span className={cn("absolute inset-y-2 rounded", retimed ? "bg-primary" : "bg-muted-foreground")} style={{ left: pct(w[0], total), width: pct(w[1] - w[0], total) }} />
                      ) : (
                        // One solid tone (overlapping beats never read as a second colour); a retimed part in the brand colour.
                        g.events.map((e) => <span key={e.id} className={cn("absolute inset-y-1 rounded-sm", retimed ? "bg-primary" : "bg-muted-foreground")} style={{ left: pct(Math.max(0, e.start), total), width: `max(2px, ${pct(e.dur, total)})` }} />)
                      )}
                    </span>
                  </button>
                );
              })}
          </div>
        ))}
        {tracks.length > 0 && <p className="mt-2 mb-0.5 text-[12px] font-medium text-muted-foreground">Keys</p>}
        {tracks.map(([id, tr]) => (
          <div key={id} className="flex h-11 min-w-0 items-center" data-kinetic-track={id}>
            <span className={label}>{TRACK_NAMES[id]}</span>
            <span className="relative h-11 min-w-0 flex-1">
              <span className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden />
              {tr.keys.map((k, i) => {
                const on = sel?.id === id && sel.i === i;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={`${TRACK_NAMES[id]} key at ${k.t.toFixed(2)} s`}
                    aria-pressed={on}
                    onClick={() => {
                      setSel({ id, i });
                      time.setPlaying(false);
                      time.seek(k.t);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                        e.preventDefault();
                        const t = k.t + (e.key === "ArrowRight" ? 1 : -1) / r.fps;
                        editor.apply((d) => setPro(d, (rec) => moveTrackKey(rec, id, i, t, rec.fps)));
                        time.seek(Math.max(0, t));
                      } else if (e.key === "Delete" || e.key === "Backspace") {
                        e.preventDefault();
                        editor.apply((d) => setPro(d, (rec) => dropTrackKey(rec, id, i)));
                        setSel(null);
                      }
                    }}
                    className="absolute top-0 grid size-11 -translate-x-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ left: pct(k.t, total) }}
                  >
                    <Diamond className={cn("size-3.5", on ? "fill-primary text-primary" : "fill-foreground text-foreground")} />
                  </button>
                );
              })}
            </span>
          </div>
        ))}
        <div className="pointer-events-none absolute inset-y-0 right-0 left-24 sm:left-28">
          <Playhead time={time} total={total} />
        </div>
      </div>
      {sel && r.tracks?.[sel.id]?.keys[sel.i] && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              editor.apply((d) => setPro(d, (rec) => dropTrackKey(rec, sel.id, sel.i)));
              setSel(null);
            }}
            className="h-11 rounded-full bg-secondary px-4 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            Delete key
          </button>
          <p className="min-w-0 text-[12px] text-muted-foreground">Arrow keys move it one frame.</p>
        </div>
      )}
    </section>
  );
}
