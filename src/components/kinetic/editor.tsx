"use client";

import { Loader2, Save, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { measureText } from "@/components/ads/render";
import { PicturePicker } from "@/components/marketing/kinetic-template";
import { useBrands } from "@/components/marketing/hooks";
import { BrandRow, kitBrand, useStoredBrand } from "@/components/motion/brand-row";
import { SizeChips } from "@/components/motion/easy-chips";
import { shortenLine, TemplateFields } from "@/components/motion/fields";
import { useReducedMotion, useScene } from "@/components/motion/player";
import { CoverArt } from "@/components/template-cover";
import { useIsGuest, useIsOwner } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { KINETIC_SCENES, normalizeKinetic, restingTime, templateOf, type KineticEntry } from "@/lib/motion/kinetic-catalog";
import { brandOf, clearTiming, docFiles, docFrom, docWords, easyValue, hasTiming, setBrand, setDuration, setEasy, setField, setProduct, setSize, type KineticDoc } from "@/lib/motion/kinetic-doc";
import { recipeKey, type Recipe } from "@/lib/motion/recipe";
import type { ScenePlan } from "@/lib/motion/scene";
import { exportSize, type SizePreset } from "@/lib/motion/sizes";
import { templateLengths, templateSizes, type TemplateBrand } from "@/lib/motion/template";
import { templateCover } from "@/lib/template-covers";
import { cn } from "@/lib/utils";
import { ClipControl } from "./clip-picker";
import { Choices, Segmented, SliderField } from "./controls";
import { readChoice, writeChoice } from "./draft";
import { EditorBar } from "./editor-bar";
import { ExportSheet, useMp4 } from "./export-sheet";
import { GroupSheet } from "./group-sheet";
import { jobLine, useKineticJobs, type JobKind } from "./jobs";
import { KineticPreview, Transport, useKineticInputs, useKineticPlan, usePreviewMode } from "./preview";
import { ProPanels } from "./pro-panels";
import { createTimeStore } from "./time-store";
import { Timeline } from "./timeline";
import type { KineticEditor } from "./use-editor";
import { recipeOfResult, VersionsSheet } from "./versions-sheet";

/**
 * The editor: the live preview with its transport, Easy (the template's own words and choices) or Pro (the real values
 * in four panels and a Timeline), and the Save bar. Phones stack it with the Save bar held at the foot; from 1024 px the
 * controls sit in a right-hand panel with their own scroll, and from 1280 px the scenes list sits on the left.
 */

type Mode = "easy" | "pro";

/** Whether the viewport is at least `px` wide (false on the server and first render). */
export function useMinWidth(px: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const f = () => setOn(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [px]);
  return on;
}

function OwnerBrand({ value, onChange }: { value: TemplateBrand; onChange: (b: TemplateBrand) => void }) {
  const kits = useBrands().data?.filter((k) => k.status !== "researching");
  const [kitId, setKitId] = useState<string | null>(null);
  return (
    <BrandRow
      value={value}
      onChange={onChange}
      kits={kits}
      kitId={kitId}
      onKit={(id) => {
        setKitId(id);
        const k = kits?.find((x) => x.id === id);
        if (k) onChange(kitBrand(k));
      }}
    />
  );
}

function SceneRail({ entry, onScene }: { entry: KineticEntry; onScene: (e: KineticEntry) => void }) {
  return (
    <nav aria-label="Scenes" className="min-h-0 overflow-y-auto border-r p-2">
      <ul className="space-y-1">
        {KINETIC_SCENES.map((e) => {
          const cover = templateCover("marketing", e.template);
          const on = e.slug === entry.slug;
          return (
            <li key={e.slug}>
              <button type="button" onClick={() => onScene(e)} aria-current={on ? "true" : undefined} className={cn("flex min-h-[68px] w-full min-w-0 items-center gap-3 rounded-xl p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-accent" : "hover:bg-accent/60")}>
                <span className="relative block size-14 shrink-0 overflow-hidden rounded-lg bg-muted">{cover && <CoverArt cover={cover} sizes="56px" />}</span>
                <span className={cn("min-w-0 truncate text-[13px]", on ? "font-semibold" : "font-medium")}>{e.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Editor({ editor, doc, entry, onBack, onScene, missing }: { editor: KineticEditor; doc: KineticDoc; entry: KineticEntry; onBack: () => void; onScene: (e: KineticEntry) => void; missing: ReadonlySet<string> }) {
  const r = doc.recipe;
  const t = templateOf(entry);
  const owner = useIsOwner();
  // A guest's Save always answers (with the sign-up card), even where this browser can't make the clip.
  const guest = useIsGuest();
  const [, setStored] = useStoredBrand();
  const inputs = useKineticInputs(r);
  const scene = useScene(r.scene);
  const plan = useKineticPlan(scene, r, inputs);
  const time = useMemo(() => createTimeStore(), []);
  const reduced = useReducedMotion();
  const [previewMode, setPreviewMode] = usePreviewMode();
  // The editor only ever renders in the browser (the studio waits for who is looking), so the choice reads at once.
  const [mode, setModeState] = useState<Mode>(() => readChoice("mode", ["easy", "pro"] as const, "easy"));
  const setMode = (m: Mode) => {
    setModeState(m);
    writeChoice("mode", m);
  };
  const jobs = useKineticJobs();
  const wide = useMinWidth(768);
  const desk = useMinWidth(1024);
  const side = wide ? "right" : "bottom";
  const [sheet, setSheet] = useState<"export" | "versions" | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [large, setLarge] = useState(false);
  const px = exportSize(r.size);
  const previewBox = useRef<HTMLDivElement>(null);
  const timelineBox = useRef<HTMLDivElement>(null);
  const [timelineH, setTimelineH] = useState(0);
  const mp4 = useMp4(px.w - (px.w % 2), px.h - (px.h % 2), r.fps);

  // The preview starts playing once the scene is ready (never with reduced motion: the rest frame waits for Play).
  const started = useRef(false);
  useEffect(() => {
    if (!plan || started.current) return;
    started.current = true;
    if (!reduced) time.setPlaying(true);
  }, [plan, reduced, time]);

  // A save pauses the preview: its clip and the export's would both decode at once.
  const working = !!jobs.job;
  useEffect(() => {
    if (working) time.setPlaying(false);
  }, [working, time]);

  // Phones: retiming keeps the preview in view above its half-height sheet.
  useEffect(() => {
    if (!group || desk) return;
    const el = previewBox.current;
    if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 64), behavior: reduced ? "auto" : "smooth" });
  }, [group, desk, reduced]);

  // The timing panel in the right-hand column closes with Escape, as the sheets do.
  useEffect(() => {
    if (!group || !desk || large) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setGroup(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [group, desk, large]);

  // Pro on desktop: the preview leaves room for the Timeline under it (never below 45% of the height).
  const timelineShown = desk && mode === "pro" && !!plan;
  useEffect(() => {
    const el = timelineBox.current;
    if (!timelineShown || !el) return setTimelineH(0);
    const ro = new ResizeObserver(() => setTimelineH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [timelineShown]);

  useEffect(() => {
    if (!large) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLarge(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [large]);

  const planWith = useCallback(
    (rec: Recipe): ScenePlan | null => {
      if (!scene || !inputs.ready) return null;
      try {
        return scene.plan({ recipe: rec, measure: measureText, logo: inputs.logo, images: inputs.images, outlines: inputs.outlines, ...(inputs.clip.info && { clips: { clip: inputs.clip.info } }) });
      } catch {
        return null;
      }
    },
    [scene, inputs],
  );

  const fields = t.fields ?? [];
  const overflow = plan?.overflow ?? [];
  const brandOver = overflow.includes("brand");
  const overflowLine = overflow.length ? fields.filter((f) => overflow.includes(f.key)).map(shortenLine).concat(brandOver ? ["Shorten the brand name to fit"] : []).join(" · ") : null;
  const mp4Line = r.export.format === "mp4" && mp4 === false ? "This browser can't make MP4 here. Pick WebM in Export options." : null;

  // Versions: what was opened, saved or restored last (Restore asks first when the open state differs from it).
  const key = recipeKey(r);
  const [versionKey, setVersionKey] = useState(key);
  const words = docWords(doc, entry);
  const meta = (kind: JobKind, at?: number) => {
    const title = kind === "clip" ? `${entry.name} · ${words.first}` : kind === "frame" ? `Frame · ${entry.name} · ${(at ?? 0).toFixed(1)} s` : kind === "sheet" ? `Contact sheet · ${entry.name} · ${words.first}` : `Version · ${entry.name} · ${words.first}`;
    return { title: title.slice(0, 200), prompt: words.prompt, images: docFiles(r) };
  };
  const save = (kind: JobKind) => {
    if (!plan) return Promise.resolve(null);
    const at = kind === "frame" ? Math.min(plan.rest, time.get()) : undefined;
    return jobs.run(kind, r, inputs, meta(kind, at), { at }).then((g) => {
      if (g && kind === "version") setVersionKey(key);
      return g;
    });
  };
  const restore = (g: Generation) => {
    const n = normalizeKinetic(recipeOfResult(g));
    if (!n) return;
    editor.restore(docFrom(n.recipe));
    setVersionKey(recipeKey(n.recipe));
    setSheet(null);
  };

  const setBrandValue = (b: TemplateBrand) => {
    editor.apply((d) => setBrand(d, b), { gesture: true });
    if (!owner) setStored(b);
  };
  const easyGroups = t.easy ?? [];
  const sizes = templateSizes(t);
  const lengths = templateLengths(t);
  const busy = jobLine(jobs.job);
  const blocked = overflowLine ? "Shorten the words to fit, then save." : null;

  const saveBar = (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={() => (jobs.job?.kind === "clip" ? jobs.cancel() : void save("clip"))}
        disabled={!plan || !!blocked || (!!mp4Line && !guest) || (!!jobs.job && jobs.job.kind !== "clip")}
        data-kinetic-save="main"
        className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-4 text-[15px] font-medium text-primary-foreground shadow-soft outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
      >
        {jobs.job?.kind === "clip" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        <span className="truncate">{jobs.job?.kind === "clip" ? busy : jobs.job ? "Saving another one…" : jobs.saveLabel}</span>
      </button>
      <button type="button" onClick={() => setSheet("export")} aria-label="Export options" className="grid size-12 shrink-0 place-items-center rounded-full bg-secondary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <Settings2 className="size-5" />
      </button>
    </div>
  );
  const saveNotes = (overflowLine || mp4Line) && (
    <p className="mt-1.5 text-[12px] text-muted-foreground" aria-live="polite">
      {overflowLine ?? mp4Line}
    </p>
  );

  const controls = (
    <div className="min-w-0 space-y-5">
      <Segmented
        label="Controls"
        hideLabel
        choices={[
          { id: "easy", label: "Easy" },
          { id: "pro", label: "Pro" },
        ]}
        value={mode}
        onChange={setMode}
      />
      <TemplateFields fields={fields} values={r.fields} onChange={(k, v) => editor.apply((d) => setField(d, entry, k, v), { gesture: true })} overflow={overflow} />
      {owner ? <OwnerBrand value={brandOf(doc)} onChange={setBrandValue} /> : <BrandRow value={brandOf(doc)} onChange={setBrandValue} />}
      {missing.has("logo") && <p className="-mt-3 text-[12px] text-destructive">Pick the logo again</p>}
      {brandOver && <p className="-mt-3 text-[12px] text-destructive">Shorten the brand name to fit</p>}
      {t.picture === "product" && (
        <div className="min-w-0">
          <PicturePicker value={r.media?.product} onChange={(url) => editor.apply((d) => setProduct(d, url))} owner={owner} />
          {missing.has("product") && <p className="mt-1 text-[12px] text-destructive">Pick the picture again</p>}
        </div>
      )}
      {entry.clip && <ClipControl doc={doc} editor={editor} time={time} clip={inputs.clip} side={side} pro={mode === "pro"} />}
      {missing.has("clip") && !r.layers?.video && <p className="-mt-3 text-[12px] text-destructive">Pick the clip again</p>}
      {mode === "easy" && easyGroups.map((g) => <Choices key={g.id} label={g.label} choices={g.choices} value={easyValue(doc, entry, g.id)} onChange={(c) => editor.apply((d) => setEasy(d, entry, g.id, c))} />)}
      {mode === "easy" && hasTiming(r) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center rounded-full bg-secondary px-3 text-[12px] font-medium">Has timing edits</span>
          <button type="button" onClick={() => editor.apply(clearTiming)} className="h-11 rounded-full px-3 text-[13px] font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            Clear timing edits
          </button>
        </div>
      )}
      <SizeChips sizes={sizes} value={(typeof r.size === "string" ? r.size : "custom") as SizePreset} onChange={(s) => editor.apply((d) => setSize(d, s))} />
      {lengths.max > lengths.min && <SliderField label="Length" unit="s" display={(v) => `${v} s`} value={r.duration} min={lengths.min} max={lengths.max} step={lengths.max - lengths.min <= 2 ? 0.5 : 1} onChange={(v) => editor.apply((d) => setDuration(d, v), { gesture: true })} onEnd={editor.end} />}
      {mode === "pro" && <ProPanels doc={doc} entry={entry} editor={editor} time={time} />}
      {mode === "pro" && plan && !desk && <Timeline plan={plan} doc={doc} time={time} editor={editor} onGroup={setGroup} />}
    </div>
  );

  const ratio = plan ? plan.design.w / plan.design.h : 9 / 16;
  const preview = (
    <KineticPreview
      plan={plan}
      recipe={r}
      inputs={inputs}
      time={time}
      mode={previewMode}
      label={`${entry.name} preview: ${words.prompt}`}
      hold={plan ? restingTime(plan, r) : undefined}
      className="mx-auto w-full"
      style={
        desk
          ? { maxWidth: `min(100%, calc(max(var(--content-h) * 0.45, var(--content-h) - 9.5rem - ${timelineShown && !large ? timelineH + 16 : 0}px) * ${ratio}))` }
          : { maxWidth: `min(100%, calc(${group ? 34 : 56}svh * ${ratio}))` }
      }
    />
  );
  const transport = plan ? <Transport time={time} duration={r.duration} fps={r.fps} rest={plan.rest} mode={previewMode} onMode={setPreviewMode} /> : <div className="h-11" />;

  return (
    <div className="flex min-w-0 flex-col lg:h-[var(--content-h)]" data-kinetic-editor={entry.slug} data-recipe-key={key}>
      <EditorBar
        entry={entry}
        onBack={onBack}
        onScene={onScene}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onUndo={editor.undo}
        onRedo={editor.redo}
        large={large}
        onLarge={setLarge}
        onVersions={() => setSheet("versions")}
        onExport={() => setSheet("export")}
      />
      <div className={cn("min-w-0 lg:grid lg:min-h-0 lg:flex-1", large ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[264px_minmax(0,1fr)_380px]")}>
        {!large && (
          <div className="hidden min-h-0 xl:flex xl:flex-col">
            <SceneRail entry={entry} onScene={onScene} />
          </div>
        )}
        <div className="min-w-0 px-4 pt-3 lg:min-h-0 lg:overflow-y-auto lg:px-6 lg:pt-5">
          <div className="mx-auto w-full max-w-[1100px] min-w-0" ref={previewBox}>
            {preview}
            <div className="mx-auto mt-1.5 w-full min-w-0" style={desk ? { maxWidth: "min(100%, 720px)" } : undefined}>
              {transport}
            </div>
            {desk && mode === "pro" && plan && (
              <div className="mt-4 min-w-0 pb-6" ref={timelineBox}>
                <Timeline plan={plan} doc={doc} time={time} editor={editor} onGroup={setGroup} />
              </div>
            )}
          </div>
        </div>
        {!large && desk && (
          <aside aria-label="Controls" className="hidden min-h-0 border-l lg:flex lg:flex-col">
            {group ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <GroupSheet inline open groupId={group} onClose={() => setGroup(null)} doc={doc} editor={editor} side="right" planWith={planWith} />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">{controls}</div>
            )}
            <div className="border-t bg-background p-3">
              {saveBar}
              {saveNotes}
            </div>
          </aside>
        )}
      </div>
      {/* Phones: the controls under the preview, the Save bar held at the foot above the app's own bar. */}
      {!desk && (
        <>
          <div className="min-w-0 px-4 pt-4 pb-28 lg:hidden">{controls}</div>
          <div className="sticky bottom-chrome z-20 min-w-0 border-t bg-background/95 px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden" data-kinetic-savebar>
            {saveBar}
            {saveNotes}
          </div>
        </>
      )}

      <ExportSheet open={sheet === "export"} onClose={() => setSheet(null)} side={side} doc={doc} entry={entry} editor={editor} jobs={jobs} blocked={blocked} mp4={mp4} onSave={(k) => void save(k)} />
      <VersionsSheet open={sheet === "versions"} onClose={() => setSheet(null)} side={side} jobs={jobs} onSaveVersion={() => save("version")} onRestore={restore} dirty={key !== versionKey} />
      <GroupSheet open={!!group && (!desk || large)} onClose={() => setGroup(null)} groupId={group} doc={doc} editor={editor} side={side} planWith={planWith} />
    </div>
  );
}
