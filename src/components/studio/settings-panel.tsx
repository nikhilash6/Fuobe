"use client";

import { ChevronDown, Loader2, Shuffle, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLikelyVisitor, useTextHelper } from "@/lib/api";
import { OwnSetupChip } from "@/components/own-setup";
import { wantsH3TwoK } from "@/lib/catalog/regenerate";
import { FORMAT_INFO } from "@/lib/av/formats";
import { OPERATION_LABELS, type GenParams, type ModelDef, type Operation, type VideoFormat } from "@/lib/catalog/types";
import { colormapLabel, durationLabel, formatOf, hiddenChanges, MATTE_OUTPUT_LABELS, settingsSummary, videoToolNote, type SettingsShape } from "@/lib/composer";
import { ratioValue } from "@/lib/format";
import { matchSpokenLanguage, spokenLanguageName, spokenLanguageOptions } from "@/lib/speech-languages";
import { cn } from "@/lib/utils";
import { UNAVAILABLE_OPTION, UnavailableNote, useUnavailableNote } from "@/components/ui/unavailable";
import { opTakes, settingUnavailable, type OpTakes } from "@/lib/catalog/route-takes";
import type { Unavailable } from "@/lib/unavailable";
import { SliderControls } from "./audio-controls";
import { Chip } from "./chip";
import { radioKeys, radioTab } from "./radio-keys";
import { ResponsivePanel } from "./responsive-panel";
import { MultiShotControl } from "./shots-editor";

function RatioGlyph({ ratio }: { ratio: string }) {
  const r = ratioValue(ratio === "auto" ? "1:1" : ratio);
  const w = r >= 1 ? 18 : 18 * r;
  const h = r >= 1 ? 18 / r : 18;
  return <span className="inline-block rounded-[3px] border-[1.5px] border-current" style={{ width: w, height: h }} />;
}

function Section({ label, children, id }: { label: string; children: React.ReactNode; id?: string }) {
  return (
    <div className="space-y-1.5">
      <p id={id} className="text-[12px] font-medium text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format = (v) => String(v),
  unavailable,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
  /** Why a value can't be had with this model and operation (src/lib/unavailable.ts): it stays in view, muted, and says why. */
  unavailable?: (v: T) => Unavailable | undefined;
}) {
  const opts = options.map((o) => ({ value: o, unavailable: unavailable?.(o) }));
  const note = useUnavailableNote(opts);
  // Nothing selected (an unexpected value): the first option takes the Tab stop.
  const current = options.includes(value) ? value : options[0];
  // The value on show is one this run can't make (a model's default, a choice kept from another model): said at once.
  const held = unavailable?.(value);
  return (
    <div>
      <div role="radiogroup" aria-label={label} onKeyDown={radioKeys} className="flex flex-wrap gap-0.5 rounded-full bg-muted p-0.5">
        {opts.map((o) => {
          const off = note.isUnavailable(o);
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={value === o.value && !off}
              tabIndex={radioTab(current === o.value)}
              onClick={() => note.press(o, onChange)}
              {...note.optionProps(o)}
              className={cn(
                "h-7 min-w-11 flex-1 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground tabular-nums transition outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                value === o.value && !off && "bg-background text-foreground shadow-soft",
                off && UNAVAILABLE_OPTION,
              )}
            >
              {format(o.value)}
            </button>
          );
        })}
      </div>
      <UnavailableNote {...note.noteProps} reason={note.reason ?? held} />
    </div>
  );
}

/** The aspect ratio grid: a shape this run can't make stays in view, muted, and pressing it says why with the closest one. */
function AspectChoices({ options, value, onChange, unavailable }: { options: string[]; value: string; onChange: (v: string) => void; unavailable: (v: string) => Unavailable | undefined }) {
  const opts = options.map((o) => ({ value: o, unavailable: unavailable(o) }));
  const note = useUnavailableNote(opts);
  const held = unavailable(value);
  return (
    <div>
      <div role="radiogroup" aria-label="Aspect ratio" onKeyDown={radioKeys} className="grid grid-cols-4 gap-1 sm:grid-cols-5">
        {opts.map((o) => {
          const off = note.isUnavailable(o);
          const sel = value === o.value && !off;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={sel}
              tabIndex={radioTab(value === o.value)}
              onClick={() => note.press(o, onChange)}
              {...note.optionProps(o)}
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-1.5 rounded-lg text-[11px] font-medium text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
                sel && "bg-brand-faint text-brand-text hover:bg-brand-faint-hover",
                off && UNAVAILABLE_OPTION,
                off && "hover:bg-transparent",
              )}
            >
              <span className="grid h-5 place-items-center">
                <RatioGlyph ratio={o.value} />
              </span>
              {o.value === "auto" ? "Auto" : o.value}
            </button>
          );
        })}
      </div>
      <UnavailableNote {...note.noteProps} reason={note.reason ?? held} />
    </div>
  );
}

/**
 * The seed field keeps what you type (an empty field while you replace the number) and sends a
 * whole number only; leaving it empty goes back to the last seed.
 */
function SeedInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(String(value));
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d]/g, "").slice(0, 10);
        setText(t);
        if (t) onChange(Number(t));
      }}
      onBlur={() => !text && setText(String(value))}
      aria-label="Seed"
      className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm tabular-nums outline-none focus:border-primary"
    />
  );
}

/**
 * The language of the speech a transcriber hears: detected unless you pick one (sent as
 * params.sourceLanguage). A stored value the model doesn't list stays on show as it is, so the
 * picker says what the chip says and the request sends.
 */
function SpokenLanguage({ codes, value, onChange }: { codes: string[]; value?: string; onChange: (v: string | undefined) => void }) {
  const options = useMemo(() => spokenLanguageOptions(codes), [codes]);
  const listed = value ? matchSpokenLanguage(value, options.map((l) => l.code)) : undefined;
  const selected = !value ? "auto" : (listed ?? value);
  return (
    <Select value={selected} onValueChange={(v) => onChange(v === "auto" ? undefined : v)}>
      <SelectTrigger className="w-full" aria-label="Spoken language">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value="auto">Detect automatically</SelectItem>
        {value && !listed && <SelectItem value={value}>{spokenLanguageName(value)}</SelectItem>}
        {options.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  children,
  unavailable,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
  /** Why the switch can't change anything with this model here: it is off-limits and says so in place of its hint. */
  unavailable?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className={cn("block", unavailable ? "cursor-not-allowed" : "cursor-pointer")}>
          <span className={cn("block text-[13px] font-medium", unavailable && "text-muted-foreground")}>{label}</span>
          <span className="block text-[12px] leading-snug text-muted-foreground">{unavailable ?? hint}</span>
        </label>
        {children}
      </div>
      <Switch id={id} checked={checked} disabled={!!unavailable} onCheckedChange={onChange} />
    </div>
  );
}

/** What the model can't do of an option the studio offers (open depth maps: grayscale and inferno only). */
function OptionNote({ text }: { text: string | null }) {
  return text ? <p className="text-[12px] leading-snug text-muted-foreground">{text}</p> : null;
}

export interface SettingsPanelProps {
  model?: ModelDef;
  op?: Operation;
  shape: SettingsShape;
  params: GenParams;
  setP: (patch: Partial<GenParams>) => void;
  setExtra: (key: string, v: unknown) => void;
  negativePrompt: string;
  setNegativePrompt: (v: string) => void;
  kind: "image" | "video" | string;
  enhancing: boolean;
  onRewrite: () => void;
  opNote?: string;
  /** Classes for the chip (its place in the toolbar). */
  className?: string;
  /** Chips the toolbar has no room for on phones (voice, motion, style…): shown at the top of the sheet there. */
  extras?: React.ReactNode;
  /** Picking a format (SDR to HDR, Export): another model may write it (the composer moves the request there). */
  onFormat?: (f: VideoFormat) => void;
  /** The model that writes a format, when it isn't the one picked ("via LTX 2.3 HDR"). */
  formatVia?: (f: VideoFormat) => string | undefined;
}

/**
 * One summary chip ("16:9 · 720p · 5s · ×1") for every output setting, opening a popover (a
 * bottom sheet on phones) with segmented controls, the mode toggles and Advanced. On phones the
 * chip is just its icon (a dot when something differs from the defaults); the sheet's header
 * spells the summary out.
 */
export function SettingsChip(props: SettingsPanelProps) {
  const { model, shape, params, negativePrompt, className } = props;
  const [open, setOpen] = useState(false);
  const parts = settingsSummary(shape, params, model);
  const extra = hiddenChanges(params, negativePrompt, model);
  const text = parts.length ? parts.join(" · ") : "Settings";
  // Icon-only on phones: the dot then also says the summary differs from the model's defaults.
  const changed = extra > 0 || parts.join() !== settingsSummary(shape, { ...model?.defaults }, model).join();
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      title="Settings"
      description={parts.length ? text : undefined}
      className="w-[min(92vw,400px)] p-3.5"
      trigger={
        <Chip
          icon={SlidersHorizontal}
          aria-label={`Settings: ${parts.join(", ") || "defaults"}${extra ? `, ${extra} more changed` : ""}`}
          className={cn("relative tabular-nums max-sm:w-8 max-sm:justify-center max-sm:px-0", className)}
        >
          <span className="max-sm:hidden">{text}</span>
          {(extra > 0 || changed) && (
            <span aria-hidden className={cn("-mr-0.5 size-1.5 rounded-full bg-primary max-sm:absolute max-sm:top-1 max-sm:right-1 max-sm:mr-0", extra === 0 && "sm:hidden")} />
          )}
        </Chip>
      }
    >
      <SettingsBody {...props} />
    </ResponsivePanel>
  );
}

/** Output formats as a list of choices, each with what it's for (the parity studio's SDR to HDR copy). */
function FormatChoices({ formats, value, onChange, via }: { formats: VideoFormat[]; value: VideoFormat; onChange: (f: VideoFormat) => void; via?: (f: VideoFormat) => string | undefined }) {
  return (
    <div role="radiogroup" aria-label="Format" onKeyDown={radioKeys} className="grid gap-1">
      {formats.map((f) => {
        const sel = value === f;
        const info = FORMAT_INFO[f];
        const other = via?.(f);
        return (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={sel}
            tabIndex={radioTab(sel)}
            onClick={() => onChange(f)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
              sel && "border-primary bg-brand-faint hover:bg-brand-faint-hover",
            )}
          >
            <span className={cn("text-[13px] font-medium", sel && "text-brand-text")}>
              {info?.label ?? f}
              {other && <span className="font-normal text-muted-foreground"> · {other}</span>}
            </span>
            <span className="text-[12px] leading-snug text-muted-foreground">{info?.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

function SettingsBody({ model, op, shape, params: p, setP, setExtra, negativePrompt, setNegativePrompt, kind, enhancing, onRewrite, opNote, extras, onFormat, formatVia }: SettingsPanelProps) {
  const opts = model?.options ?? {};
  const d = model?.defaults ?? {};
  const [advanced, setAdvanced] = useState(p.seed !== undefined || !!negativePrompt);
  const visitor = useLikelyVisitor();
  // "Rewrite my prompt now": the owner's AI helper, or for a visitor the studio's free helper.
  const helper = useTextHelper();
  // What this operation's routes send (route-takes.ts): a ratio, size or length they don't make stays in view, muted, and
  // says why with the closest one they do; a seed, negative prompt or sound switch they don't read says so.
  const takes: OpTakes = useMemo(() => opTakes(model, op), [model, op]);
  const why = (setting: "aspect" | "resolution" | "duration", v: string | number, apply: (x: string | number) => void, label = (x: string | number) => String(x)): Unavailable | undefined => {
    if (!model) return undefined;
    const u = settingUnavailable(model, op, setting, v, takes);
    if (!u) return undefined;
    const instead = u.instead;
    return { why: u.why, ...(instead !== undefined && { fix: { label: `Use ${label(instead)}`, run: () => apply(instead) } }) };
  };
  return (
    <div className="space-y-4">
      {extras && <div className="flex flex-wrap gap-1.5 sm:hidden">{extras}</div>}
      {shape.aspect && (
        <Section label="Aspect ratio">
          <AspectChoices
            options={shape.aspect}
            value={p.aspectRatio ?? d.aspectRatio ?? shape.aspect[0]}
            onChange={(o) => setP({ aspectRatio: o })}
            unavailable={(o) => why("aspect", o, (x) => setP({ aspectRatio: String(x) }), (x) => (x === "auto" ? "Auto" : String(x)))}
          />
        </Section>
      )}
      {shape.formats && (
        <Section label="Format">
          <FormatChoices formats={shape.formats} value={formatOf(p, model, shape.formats)!} onChange={(f) => (onFormat ? onFormat(f) : setP({ format: f }))} via={formatVia} />
        </Section>
      )}
      {shape.resolution && (
        <Section label={op?.startsWith("upscale") ? "Resolution" : "Quality"}>
          <Segmented
            label={op?.startsWith("upscale") ? "Resolution" : "Quality"}
            options={shape.resolution}
            value={p.resolution ?? d.resolution ?? shape.resolution[0]}
            onChange={(v) => setP({ resolution: v })}
            unavailable={(v) => why("resolution", v, (x) => setP({ resolution: String(x) }))}
          />
          {/* MiniMax H3 (open) at 2K finishes with Open-H3 Regenerate: a visitor runs it on its own GPU (own-setup.ts). */}
          {visitor && model && shape.resolution.find((r) => wantsH3TwoK(model.id, r)) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
              {shape.resolution.find((r) => wantsH3TwoK(model.id, r))}
              <OwnSetupChip setup="regenerate:h3-2k" />
            </p>
          )}
        </Section>
      )}
      {shape.fps && (
        <Section label="Frame rate">
          {/* 0 stands for the clip's own frame rate (nothing sent). */}
          <Segmented
            label="Frame rate"
            options={shape.fps.original ? [0, ...shape.fps.values] : shape.fps.values}
            value={p.targetFps ?? d.targetFps ?? (shape.fps.original ? 0 : shape.fps.values[0])}
            onChange={(v) => setP({ targetFps: v || undefined })}
            format={(v) => (v ? `${v}` : "Original")}
          />
        </Section>
      )}
      {shape.slowdown && (
        <Section label="Slow motion">
          <Segmented label="Slow motion" options={shape.slowdown} value={p.slowdown ?? 1} onChange={(v) => setP({ slowdown: v > 1 ? v : undefined })} format={(v) => (v > 1 ? `${v}×` : "Off")} />
        </Section>
      )}
      {shape.duration && (
        <Section label="Duration">
          <Segmented
            label="Duration"
            options={shape.duration}
            value={p.duration ?? d.duration ?? shape.duration[0]}
            onChange={(v) => setP({ duration: v })}
            format={durationLabel}
            unavailable={(v) => why("duration", v, (x) => setP({ duration: Number(x) }), (x) => durationLabel(Number(x)))}
          />
        </Section>
      )}
      {shape.count && (
        <Section label={kind === "video" ? "Videos" : "Images"}>
          <Segmented label={kind === "video" ? "Videos" : "Images"} options={[1, 2, 3, 4]} value={p.numOutputs ?? 1} onChange={(v) => setP({ numOutputs: v })} format={(v) => `×${v}`} />
        </Section>
      )}
      {shape.sourceLanguages && (
        <Section label="Spoken language">
          <SpokenLanguage codes={shape.sourceLanguages} value={p.sourceLanguage} onChange={(sourceLanguage) => setP({ sourceLanguage })} />
        </Section>
      )}
      {shape.matteOutput && model && (
        <Section label="Output">
          <Segmented label="Output" options={shape.matteOutput} value={p.matteOutput ?? shape.matteOutput[0]} onChange={(v) => setP({ matteOutput: v })} format={(v) => MATTE_OUTPUT_LABELS[v]} />
          <OptionNote text={videoToolNote(model, "matte")} />
        </Section>
      )}
      {shape.colormap && model && (
        <Section label="Color map">
          <Segmented label="Color map" options={shape.colormap} value={p.colormap ?? shape.colormap[0]} onChange={(v) => setP({ colormap: v })} format={colormapLabel} />
          <OptionNote text={videoToolNote(model, "colormap")} />
        </Section>
      )}
      {shape.multiShot && model && (
        <Section label="Multi-shot">
          <MultiShotControl model={model} params={p} onChange={setP} />
        </Section>
      )}
      {(shape.draft || shape.audio || shape.enhance || shape.sideBySide) && (
        <div className="divide-y rounded-xl border px-3">
          {shape.sideBySide && <Toggle label="Side by side" hint="Put the original video next to the depth map" checked={!!p.sideBySide} onChange={(v) => setP({ sideBySide: v })} />}
          {shape.draft && (
            <Toggle label="Draft" hint={p.draft ? "Cheap 480p take — finish the one you like in 1080p" : "Preview at 480p first, then render the keeper in 1080p"} checked={!!p.draft} onChange={(v) => setP({ draft: v })} />
          )}
          {shape.audio && (
            <Toggle
              label="Audio"
              hint={p.generateAudio === false ? "Silent video (cheaper)" : "Native sound, music and dialogue"}
              checked={p.generateAudio !== false}
              onChange={(v) => setP({ generateAudio: v })}
              unavailable={!takes.audio && model ? `${model.name} sets its own sound here: this switch can't change it` : undefined}
            />
          )}
          {shape.enhance && (
            <Toggle label="Enhance prompt" hint="Rewrites your prompt with more detail before it runs" checked={!!p.enhancePrompt} onChange={(v) => setP({ enhancePrompt: v })}>
              {helper && (
                <button
                  type="button"
                  onClick={onRewrite}
                  disabled={enhancing}
                  className="mt-1 inline-flex items-center gap-1 rounded text-[12px] font-medium text-brand-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
                >
                  {enhancing ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />} Rewrite my prompt now
                </button>
              )}
            </Toggle>
          )}
        </div>
      )}
      {shape.sliders && model && (
        <Section label="Model settings">
          <SliderControls model={model} values={p.extra ?? {}} onChange={setExtra} />
        </Section>
      )}
      <Collapsible open={advanced} onOpenChange={setAdvanced}>
        <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md text-[12px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
          <Sparkles className="size-3.5" /> Advanced
          <ChevronDown className={cn("ml-auto size-3.5 transition-transform", advanced && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[12px] text-muted-foreground">
              <span>Seed</span>
              <label className={cn("flex items-center gap-2", !takes.seed && "cursor-not-allowed opacity-60")}>
                Random
                <Switch checked={!takes.seed || p.seed === undefined} disabled={!takes.seed} onCheckedChange={(r) => setP({ seed: r ? undefined : Math.floor(Math.random() * 1e9) })} aria-label="Random seed" />
              </label>
            </div>
            {/* A model that takes no seed here (Nano Banana Pro, Seedance 2.5): every run is new, and it says so. */}
            {!takes.seed && model && <p className="text-[12px] leading-snug text-muted-foreground">{model.name} picks its own seed here, so each run comes out new.</p>}
            {takes.seed && p.seed !== undefined && (
              <div className="flex gap-1.5">
                <SeedInput value={p.seed} onChange={(seed) => setP({ seed })} />
                <Button variant="secondary" size="icon" className="size-8" onClick={() => setP({ seed: Math.floor(Math.random() * 1e9) })} aria-label="New random seed">
                  <Shuffle className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
          {opts.negativePrompt && (
            <div className="space-y-1.5">
              <span className="text-[12px] text-muted-foreground">Negative prompt</span>
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={3}
                disabled={!takes.negativePrompt}
                aria-label="Negative prompt"
                placeholder="blurry, low quality, extra fingers…"
                className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
              />
              {/* The route sends no negative prompt (Qwen Image Edit on fal, Kandinsky 6.0): said, never dropped without a word. */}
              {!takes.negativePrompt && model && (
                <p className="text-[12px] leading-snug text-muted-foreground">{model.name} doesn&apos;t read a negative prompt here: describe only what you want in the prompt.</p>
              )}
            </div>
          )}
          {model && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {model.name} via {model.engine === "open" ? "ComfyUI" : [...new Set(model.routes.map((r) => r.provider))].join(" / ")}
              {op ? ` · ${OPERATION_LABELS[op]}` : ""}
              {opNote ? ` · ${opNote}` : ""}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
