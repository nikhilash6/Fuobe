"use client";

import { useState } from "react";
import { applyPreset, dropTrackKey, keyIndexAt, paceOf, presetOf, PRESETS, putTrackKey, setValue, trackValue, type PresetCategory } from "@/lib/motion/edit";
import { templateOf, type KineticEntry } from "@/lib/motion/kinetic-catalog";
import { easyValue, setEasy, setPro, type KineticDoc } from "@/lib/motion/kinetic-doc";
import { CAMERA_MOVES, type CameraMoveId, type CurveSetId, type Recipe, type TrackId } from "@/lib/motion/recipe";
import { quantize } from "@/lib/motion/time";
import { Choices, Panel, Segmented, SliderField, type SliderFieldProps } from "./controls";
import { PresetRow } from "./preset-row";
import { usePlayhead, type TimeStore } from "./time-store";
import type { KineticEditor } from "./use-editor";

/**
 * Pro's four panels (Motion, Graphics, Appearance, Camera): the real values behind Easy's chips, the same for every
 * scene (the scene wrappers apply them), each category with its presets. The numbers a track can animate carry a key
 * button: the first key makes the track, and then the slider sets the key at the playhead.
 */

export const FEELS: { id: CurveSetId; label: string }[] = [
  { id: "smooth", label: "Smooth" },
  { id: "snappy", label: "Snappy" },
  { id: "springy", label: "Springy" },
  { id: "steady", label: "Steady" },
];

const MOVE_NAMES: Record<CameraMoveId, string> = { scene: "Scene's own", locked: "Locked off", push: "Push", drift: "Drift", rise: "Rise" };

const presetName = (c: PresetCategory, r: Recipe) => {
  const id = presetOf(c, r);
  return PRESETS[c].find((p) => p.id === id)?.name ?? "Custom";
};

const sec = (t: number) => `${t.toFixed(1)} s`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}`;

export interface ProProps {
  doc: KineticDoc;
  entry: KineticEntry;
  editor: Pick<KineticEditor, "apply" | "end">;
  time: TimeStore;
}

/** A slider bound to a track id: the track's value at the playhead when there is one, else the plain value. */
export function useTrackSlider({ doc, editor, time }: Pick<ProProps, "doc" | "editor" | "time">) {
  const t = usePlayhead(time);
  const r = doc.recipe;
  const at = quantize(Math.min(t, r.duration), r.fps);
  return (id: TrackId, base: number, setBase?: (r: Recipe, v: number) => Recipe): Pick<SliderFieldProps, "value" | "onChange" | "onEnd" | "keyButton"> => {
    const track = r.tracks?.[id];
    const value = track ? trackValue(track, at) : base;
    const keyed = keyIndexAt(track, at, r.fps);
    const put = (rec: Recipe, v: number) => putTrackKey(rec, id, at, v, rec.fps) ?? rec;
    return {
      value,
      onChange: (v) => editor.apply((d) => setPro(d, (rec) => (rec.tracks?.[id] || !setBase ? put(rec, v) : setBase(rec, v))), { gesture: true }),
      onEnd: editor.end,
      keyButton: {
        label: keyed >= 0 ? `Remove the key at ${sec(at)}` : `Add a key at ${sec(at)}`,
        on: keyed >= 0,
        onPress: () => editor.apply((d) => setPro(d, (rec) => (keyed >= 0 ? dropTrackKey(rec, id, keyed) : put(rec, value)))),
      },
    };
  };
}

export function ProPanels({ doc, entry, editor, time }: ProProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({ motion: true });
  const panel = (id: string) => ({ open: !!open[id], onOpen: (v: boolean) => setOpen((o) => ({ ...o, [id]: v })), id });
  const r = doc.recipe;
  const t = templateOf(entry);
  const track = useTrackSlider({ doc, editor, time });
  const pick = (c: PresetCategory) => (id: string) => editor.apply((d) => setPro(d, (rec) => applyPreset(c, id, rec)));
  const set = (path: string, v: string | number | boolean | undefined, gesture = false) => editor.apply((d) => setPro(d, (rec) => setValue(rec, path, v)), { gesture });
  const graphics = (t.easy ?? []).filter((g) => g.id !== "pace" && g.id !== "look");
  const easyPace = easyValue(doc, entry, "pace");
  const pace = r.motion?.pace ?? paceOf(r.controls);
  const look = easyValue(doc, entry, "look");
  const lookGroup = t.easy?.find((g) => g.id === "look");

  return (
    <div className="min-w-0 space-y-2.5" data-kinetic-pro>
      <Panel title="Motion" summary={presetName("motion", r)} {...panel("motion")}>
        <PresetRow category="motion" recipe={r} onPick={pick("motion")} label="Motion presets" />
        {entry.pro.pace && (
          <SliderField
            label="Pace"
            display={(v) => `x${v.toFixed(2)}`}
            value={pace}
            min={0.7}
            max={1.4}
            step={0.01}
            reverse
            ends={["Calmer", "Punchier"]}
            onChange={(v) => set("motion.pace", v, true)}
            onEnd={editor.end}
            note={r.motion?.pace === undefined ? `From Easy: ${t.easy?.find((g) => g.id === "pace")?.choices.find((c) => c.id === easyPace)?.label ?? "Calm"}` : undefined}
          />
        )}
        <Segmented label="Feel" choices={FEELS} value={r.motion?.curves ?? "smooth"} onChange={(v) => set("motion.curves", v)} />
      </Panel>

      {graphics.length > 0 && (
        <Panel title="Graphics" summary={graphics.map((g) => g.choices.find((c) => c.id === easyValue(doc, entry, g.id))?.label).filter(Boolean).join(" · ")} {...panel("graphics")}>
          {graphics.map((g) => (
            <Choices key={g.id} label={g.label} choices={g.choices} value={easyValue(doc, entry, g.id)} onChange={(c) => editor.apply((d) => setEasy(d, entry, g.id, c))} />
          ))}
        </Panel>
      )}

      <Panel title="Appearance" summary={presetName("appearance", r)} {...panel("appearance")}>
        <PresetRow category="appearance" recipe={r} onPick={pick("appearance")} label="Appearance presets" />
        {entry.pro.look && lookGroup && <Segmented label="Look" choices={lookGroup.choices} value={look} onChange={(c) => editor.apply((d) => setEasy(d, entry, "look", c))} />}
        <SliderField label="Contrast" display={(v) => signed(v * 100)} min={-0.5} max={0.5} step={0.01} scale={100} {...track("finish.contrast", r.finish?.contrast ?? 0, (rec, v) => setValue(rec, "finish.contrast", v))} />
        <SliderField label="Saturation" display={(v) => signed(v * 100)} min={-1} max={1} step={0.01} scale={100} {...track("finish.saturation", r.finish?.saturation ?? 0, (rec, v) => setValue(rec, "finish.saturation", v))} />
        <SliderField label="Grain" unit="%" display={(v) => `${(v * 100).toFixed(1)} %`} min={0} max={0.1} step={0.001} scale={100} {...track("finish.grain", r.finish?.grain ?? 0, (rec, v) => setValue(rec, "finish.grain", v))} />
        <SliderField label="Grain size" display={(v) => v.toFixed(1)} value={r.finish?.grainSize ?? 1.2} min={1} max={3} step={0.1} onChange={(v) => set("finish.grainSize", v, true)} onEnd={editor.end} />
        {entry.pro.light && (
          <Segmented
            label="Ground light"
            choices={[
              { id: "on", label: "On" },
              { id: "off", label: "Off" },
            ]}
            value={r.look?.light === false ? "off" : "on"}
            onChange={(v) => set("look.light", v === "off" ? false : undefined)}
          />
        )}
      </Panel>

      <Panel title="Camera" summary={MOVE_NAMES[r.camera?.move ?? "scene"]} {...panel("camera")}>
        <Choices label="Move" choices={CAMERA_MOVES.map((m) => ({ id: m, label: MOVE_NAMES[m] }))} value={r.camera?.move ?? "scene"} onChange={(m) => set("camera.move", m)} />
        <SliderField label="Strength" display={(v) => v.toFixed(2)} value={r.camera?.amount ?? 1} min={0} max={2} step={0.05} onChange={(v) => set("camera.amount", v, true)} onEnd={editor.end} disabled={!["push", "drift", "rise"].includes(r.camera?.move ?? "scene")} />
        <SliderField label="Breath" display={(v) => v.toFixed(2)} value={r.camera?.breath ?? 1} min={0} max={2} step={0.05} onChange={(v) => set("camera.breath", v, true)} onEnd={editor.end} disabled={r.camera?.move === "locked"} />
        <div className="space-y-3 border-t pt-3">
          <p className="text-[12px] text-muted-foreground">Add keys at the playhead to move the camera over time. The last frame keeps the framing of your last key.</p>
          <SliderField label="Zoom" unit="×" display={(v) => `x${v.toFixed(2)}`} min={0.8} max={1.25} step={0.01} {...track("camera.zoom", 1)} />
          <SliderField label="Pan across" display={(v) => signed(v * 100)} min={-0.1} max={0.1} step={0.005} scale={100} {...track("camera.x", 0)} />
          <SliderField label="Pan up and down" display={(v) => signed(v * 100)} min={-0.1} max={0.1} step={0.005} scale={100} {...track("camera.y", 0)} />
          <SliderField label="Roll" unit="°" display={(v) => `${v.toFixed(1)}°`} min={-10} max={10} step={0.1} {...track("camera.roll", 0)} />
        </div>
      </Panel>
    </div>
  );
}
