"use client";

import { ArrowDownAZ, Camera, Check, ChevronLeft, ChevronRight, Film, ListOrdered, Palette, Plus, Smile, Sun, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  APERTURES,
  CAMERA_BODIES,
  EMOTION_FAMILIES,
  ERAS,
  FOCAL_LENGTHS,
  GENRES,
  LENSES,
  LIGHTING_PRESETS,
  LIGHT_DIRECTIONS,
  MAX_LIGHTS,
  PALETTES,
  QUICK_LIGHT_DIRECTIONS,
  TEMPOS,
  emotionStep,
  optionName,
  paletteHex,
  paletteLabel,
  rigError,
  type CinemaMode,
  type DirectorOption,
  type DirectorSettings,
  type LightSource,
} from "@/lib/catalog/cinema";
import type { StudioElement } from "@/lib/catalog/elements";
import type { Engine } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { MoveChips, MoveList, prefetchMoves } from "./camera-moves";
import { PaletteEditor } from "./palette-editor";

type Patch = (p: Partial<DirectorSettings>) => void;

const chipCls = "inline-flex h-8 max-w-[260px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors";

function DirectorChip({ icon: Icon, label, active, warn, children, ...rest }: { icon: typeof Film; label: string; active?: boolean; warn?: boolean; children?: React.ReactNode } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        chipCls,
        active ? "bg-brand-faint text-brand-text hover:bg-brand-faint-hover" : "bg-secondary text-secondary-foreground hover:bg-accent",
        warn && "ring-1 ring-warning/60",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      {children}
    </button>
  );
}

function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-1 pb-2">
      <p className="text-[13px] font-medium">{title}</p>
      <p className="text-[12px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

/** Option cards in a grid: name and what it does; Auto first. */
function OptionGrid({ options, value, onChange, cols = 2 }: { options: DirectorOption[]; value: string | null | undefined; onChange: (slug: string | null) => void; cols?: 2 | 3 }) {
  return (
    <div className={cn("grid gap-1.5", cols === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")} role="radiogroup">
      {options.map((o) => {
        const sel = (value ?? null) === o.slug;
        return (
          <button
            key={o.name}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => onChange(o.slug)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
              sel ? "border-primary bg-brand-faint" : "hover:bg-accent",
            )}
          >
            <span className={cn("flex w-full items-center gap-1 text-[13px] font-medium", sel && "text-brand-text")}>
              {o.name}
              {sel && <Check className="ml-auto size-3.5" />}
            </span>
            <span className="text-[11.5px] leading-snug text-muted-foreground">{o.description}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Film setup control: a carousel with Previous/Next arrows over one list (Higgsfield's pattern). */
function Carousel({ kind, title, subtitle, options, value, onChange, disabled }: { kind: string; title: string; subtitle: string; options: DirectorOption[]; value: string | null | undefined; onChange: (slug: string | null) => void; disabled?: string }) {
  const i = Math.max(0, options.findIndex((o) => o.slug === (value ?? null)));
  const cur = options[i];
  const step = (d: number) => onChange(options[(i + d + options.length) % options.length].slug);
  return (
    <div className={cn("rounded-xl border p-2.5", disabled && "opacity-50")}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
          <p className="text-[11.5px] text-muted-foreground">{subtitle}</p>
        </div>
        <button type="button" disabled={!!disabled} onClick={() => step(-1)} className="grid size-7 place-items-center rounded-full hover:bg-accent" aria-label={`Previous ${kind}`}>
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-20 text-center font-heading text-[19px] leading-none">{cur.name}</span>
        <button type="button" disabled={!!disabled} onClick={() => step(1)} className="grid size-7 place-items-center rounded-full hover:bg-accent" aria-label={`Next ${kind}`}>
          <ChevronRight className="size-4" />
        </button>
      </div>
      <p className="mt-1.5 min-h-[2.4em] text-[12.5px] leading-snug">{disabled ?? cur.description}</p>
      <div className="mt-1.5 flex flex-wrap gap-1" role="radiogroup" aria-label={`Select ${kind}`}>
        {options.map((o) => (
          <button
            key={o.name}
            type="button"
            role="radio"
            aria-checked={o === cur}
            disabled={!!disabled}
            onClick={() => onChange(o.slug)}
            className={cn("h-6 rounded-full px-2 text-[12px] font-medium transition-colors", o === cur ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent")}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FilmSetupChip({ settings, onChange, mode }: { settings: DirectorSettings; onChange: Patch; mode: CinemaMode }) {
  const parts = [settings.genre && optionName(GENRES, settings.genre), settings.era && optionName(ERAS, settings.era), mode === "video" && settings.tempo && optionName(TEMPOS, settings.tempo)].filter(Boolean);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <DirectorChip icon={Film} label={parts.length ? parts.join(" · ") : "Film setup"} active={parts.length > 0} aria-label="Film setup" />
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,460px)] space-y-2 p-3" align="start" side="top" collisionPadding={12}>
        <PanelHeader title="Film setup" subtitle="Genre, era and tempo: the conventions every shot follows" />
        <Carousel kind="genre" title="Genre" subtitle="Story conventions the model should follow" options={GENRES} value={settings.genre} onChange={(genre) => onChange({ genre })} />
        <Carousel kind="era" title="Era" subtitle="The period the film belongs to" options={ERAS} value={settings.era} onChange={(era) => onChange({ era })} />
        <Carousel
          kind="tempo"
          title="Tempo"
          subtitle="Pacing of the montage"
          options={TEMPOS}
          value={settings.tempo}
          onChange={(tempo) => onChange({ tempo })}
          disabled={mode === "image" ? "Tempo shapes video cuts; stills ignore it." : undefined}
        />
      </PopoverContent>
    </Popover>
  );
}

const CAMERA_TABS = [
  { id: "camera", label: "Camera" },
  { id: "lens", label: "Lens" },
  { id: "focal", label: "Focal length" },
  { id: "aperture", label: "Aperture" },
  { id: "movement", label: "Movement" },
] as const;

export function CameraChip({
  settings,
  onChange,
  mode,
  engine,
  moves,
  onMovesChange,
  required,
  badges,
  civitai,
}: {
  settings: DirectorSettings;
  onChange: Patch;
  mode: CinemaMode;
  engine: Engine;
  moves: string[];
  onMovesChange: (m: string[]) => void;
  /** Badge how Fuobe Cinema drives each move (off when the picked model gets the moves in words), as the prompt bar's picker does. */
  badges?: boolean;
  civitai?: boolean;
  /** Cinematic stills: camera, lens and focal length must be set. */
  required?: boolean;
}) {
  const [tab, setTab] = useState<(typeof CAMERA_TABS)[number]["id"]>("camera");
  const still = !!required;
  const missing = still && (!settings.camera || !settings.lens || !settings.focal);
  const parts = [
    settings.camera && optionName(CAMERA_BODIES, settings.camera),
    settings.lens && optionName(LENSES, settings.lens),
    settings.focal && optionName(FOCAL_LENGTHS, settings.focal),
    settings.aperture && optionName(APERTURES, settings.aperture).replace(/ .*/, ""),
  ].filter(Boolean);
  const needs = (id: string) => still && ((id === "camera" && !settings.camera) || (id === "lens" && !settings.lens) || (id === "focal" && !settings.focal));
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <DirectorChip icon={Camera} label={parts.length ? parts.join(" · ") : "Camera"} active={parts.length > 0} warn={missing} aria-label="Camera settings" />
          </PopoverTrigger>
        </TooltipTrigger>
        {missing && <TooltipContent>Stills need a camera, lens and focal length</TooltipContent>}
      </Tooltip>
      <PopoverContent className="w-[min(94vw,540px)] p-3" align="start" side="top" collisionPadding={12}>
        <div className="scrollbar-none mb-3 flex gap-0.5 overflow-x-auto rounded-full bg-muted p-0.5" role="tablist">
          {CAMERA_TABS.filter((t) => t.id !== "movement" || mode === "video").map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              onPointerEnter={t.id === "movement" ? prefetchMoves : undefined}
              onFocus={t.id === "movement" ? prefetchMoves : undefined}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-medium transition-colors",
                tab === t.id ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {needs(t.id) && <span className="size-1.5 rounded-full bg-warning" aria-label="required" />}
              {t.id === "movement" && moves.length > 0 && <span className="font-mono text-[10px] text-brand-text">{moves.length}</span>}
            </button>
          ))}
        </div>
        <div className="max-h-[min(56vh,420px)] overflow-y-auto pr-0.5">
          {tab === "camera" && <OptionGrid options={CAMERA_BODIES} value={settings.camera} onChange={(camera) => onChange({ camera })} />}
          {tab === "lens" && <OptionGrid options={LENSES} value={settings.lens} onChange={(lens) => onChange({ lens })} />}
          {tab === "focal" && <OptionGrid options={FOCAL_LENGTHS} value={settings.focal} onChange={(focal) => onChange({ focal })} cols={3} />}
          {tab === "aperture" && <OptionGrid options={APERTURES} value={settings.aperture} onChange={(aperture) => onChange({ aperture })} />}
          {tab === "movement" && (
            <div className="-mx-1">
              <PanelHeader title="Direct a camera move" subtitle="Adds to the prompt box, or type # there. Several per shot; order matters." />
              <MoveChips moves={moves} onChange={onMovesChange} />
              <MoveList engine={engine} badges={badges} civitai={civitai} selected={moves} onPick={(slug) => onMovesChange([...moves, slug])} />
            </div>
          )}
        </div>
        {still && <p className="mt-2 text-[11.5px] text-muted-foreground">Cinematic stills need the camera, lens and focal length; the aperture is optional.</p>}
      </PopoverContent>
    </Popover>
  );
}

export function Swatches({ hex, className }: { hex: string[]; className?: string }) {
  return (
    <span className={cn("flex h-3 overflow-hidden rounded-full", className)} aria-hidden>
      {hex.map((h, i) => (
        <span key={i} className="h-full flex-1" style={{ background: h }} />
      ))}
    </span>
  );
}

export function PaletteChip({
  settings,
  onChange,
  engine,
  saved,
  onSave,
}: {
  settings: DirectorSettings;
  onChange: Patch;
  engine: Engine;
  saved: { name: string; hex: string[] }[];
  onSave: (p: { name: string; hex: string[] }[]) => void;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"default" | "name">("default");
  const [editor, setEditor] = useState(false);
  const hex = paletteHex(settings.palette);
  const list = useMemo(() => {
    const ps = PALETTES.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
    return sort === "name" ? [...ps].sort((a, b) => a.name.localeCompare(b.name)) : ps;
  }, [q, sort]);
  const mine = saved.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const isSel = (kind: "preset" | "custom", key: string) =>
    settings.palette?.kind === kind && (kind === "preset" ? settings.palette.kind === "preset" && settings.palette.slug === key : settings.palette.kind === "custom" && settings.palette.name === key);
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <DirectorChip icon={Palette} label={paletteLabel(settings.palette) ?? "Color palette"} active={!!hex} aria-label="Color palette">
            {hex && <Swatches hex={hex} className="h-2.5 w-10 shrink-0" />}
          </DirectorChip>
        </PopoverTrigger>
        <PopoverContent className="w-[min(94vw,560px)] p-3" align="start" side="top" collisionPadding={12}>
          <PanelHeader title="Set up color palette" subtitle="Palette the color grade should follow" />
          <div className="mb-2 flex items-center gap-1.5">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search palettes…" className="h-8" aria-label="Search palettes" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={() => setSort((s) => (s === "default" ? "name" : "default"))} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Change sort">
                  {sort === "default" ? <ArrowDownAZ className="size-4" /> : <ListOrdered className="size-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{sort === "default" ? "Sort: Name (A–Z)" : "Sort: Default"}</TooltipContent>
            </Tooltip>
            <button type="button" onClick={() => setEditor(true)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent">
              <Plus className="size-3.5" /> New palette
            </button>
          </div>
          <div className="max-h-[min(50vh,380px)] space-y-2 overflow-y-auto pr-0.5">
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => onChange({ palette: null })}
                className={cn("rounded-lg border px-2.5 py-2 text-left transition-colors", !settings.palette ? "border-primary bg-brand-faint" : "hover:bg-accent")}
              >
                <span className="text-[13px] font-medium">Auto</span>
                <span className="block text-[11.5px] text-muted-foreground">No palette: the prompt drives the grade</span>
              </button>
              {mine.map((p) => (
                <div key={`mine-${p.name}`} className={cn("group/pal relative rounded-lg border px-2.5 py-2 transition-colors", isSel("custom", p.name) ? "border-primary bg-brand-faint" : "hover:bg-accent")}>
                  <button type="button" className="block w-full text-left" onClick={() => onChange({ palette: { kind: "custom", name: p.name, hex: p.hex } })}>
                    <span className="flex items-center gap-1 text-[13px] font-medium">
                      {p.name} <span className="rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">yours</span>
                    </span>
                    <Swatches hex={p.hex} className="mt-1.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSave(saved.filter((x) => x !== p))}
                    className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md text-muted-foreground opacity-100 hover:bg-accent hover:text-destructive sm:opacity-0 sm:group-hover/pal:opacity-100"
                    aria-label={`Delete ${p.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              {list.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => onChange({ palette: { kind: "preset", slug: p.slug } })}
                  className={cn("rounded-lg border px-2.5 py-2 text-left transition-colors", isSel("preset", p.slug) ? "border-primary bg-brand-faint" : "hover:bg-accent")}
                >
                  <span className="flex items-center gap-1 text-[13px] font-medium">
                    <span className="truncate">{p.name}</span>
                    {isSel("preset", p.slug) && <Check className="ml-auto size-3.5 shrink-0 text-brand-text" />}
                  </span>
                  <Swatches hex={p.hex} className="mt-1.5" />
                </button>
              ))}
            </div>
            {!list.length && !mine.length && <p className="py-6 text-center text-[13px] text-muted-foreground">No palettes found</p>}
          </div>
          {engine === "open" && (
            <label className="mt-3 flex items-start justify-between gap-3 rounded-lg bg-muted px-3 py-2">
              <span>
                <span className="block text-[12.5px] font-medium">Lock the grade</span>
                <span className="block text-[11.5px] text-muted-foreground">Open source: recolour every take to the palette (palette transfer, runs on CPU)</span>
              </span>
              <Switch checked={settings.paletteLock !== false} onCheckedChange={(v) => onChange({ paletteLock: v })} aria-label="Lock the grade to the palette" />
            </label>
          )}
          {engine === "cloud" && (
            <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-[11.5px] text-muted-foreground">The palette&apos;s colours are written into the prompt. Locking the grade to them runs on your GPU (Open source).</p>
          )}
        </PopoverContent>
      </Popover>
      <PaletteEditor
        open={editor}
        onOpenChange={setEditor}
        onSave={(p) => {
          onSave([p, ...saved.filter((x) => x.name !== p.name)]);
          onChange({ palette: { kind: "custom", name: p.name, hex: p.hex } });
        }}
      />
    </>
  );
}

/** Where a light sits on a sphere: x/y from the direction words; "back" lights become a rim. */
function lightSpot(direction: string): { x: number; y: number; back: boolean } {
  const d = direction.split("-");
  return { x: 50 + (d.includes("left") ? -32 : d.includes("right") ? 32 : 0), y: 50 + (d.includes("top") ? -32 : d.includes("bottom") ? 32 : 0), back: d.includes("back") };
}

export function LightSphere({ lights, className }: { lights: LightSource[]; className?: string }) {
  const bg = lights
    .map((l) => {
      const s = lightSpot(l.direction);
      const size = 30 + l.diffuse * 0.4;
      const a = Math.round(25 + l.brightness * 0.75);
      return s.back
        ? `radial-gradient(circle at ${100 - s.x}% ${100 - s.y}%, transparent ${size + 10}%, color-mix(in oklab, ${l.color} ${a}%, transparent) ${size + 22}%, transparent ${size + 34}%)`
        : `radial-gradient(circle at ${s.x}% ${s.y}%, color-mix(in oklab, ${l.color} ${a}%, transparent), transparent ${size}%)`;
    })
    .join(", ");
  return <span className={cn("block aspect-square rounded-full bg-neutral-700", className)} style={{ backgroundImage: bg || undefined }} aria-hidden />;
}

const PRESET_LIGHT: Record<string, LightSource[]> = {
  silhouette: [{ direction: "back", color: "#fff4e0", brightness: 100, diffuse: 20 }],
  practicals: [{ direction: "front-bottom-left", color: "#ffb35c", brightness: 60, diffuse: 50 }, { direction: "right", color: "#ffd08a", brightness: 40, diffuse: 60 }],
  window: [{ direction: "left", color: "#e8f0ff", brightness: 85, diffuse: 45 }],
  "overhead-fall": [{ direction: "back-top", color: "#fff1dc", brightness: 75, diffuse: 80 }],
  "contre-jour": [{ direction: "back-top-right", color: "#ffd9a0", brightness: 100, diffuse: 70 }],
  "soft-cross": [{ direction: "front-left", color: "#fff6ea", brightness: 70, diffuse: 85 }, { direction: "right", color: "#dfe8ff", brightness: 45, diffuse: 85 }],
};

const HEX = /^#[0-9a-f]{6}$/i;

/** A hex field that only hands on complete colours: "#ff" while typing stays local, and blur puts the last good one back. */
function HexInput({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  // The colour changed elsewhere (the picker, a preset): show it.
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  return (
    <Input
      value={text}
      onChange={(e) => {
        const raw = e.target.value.trim().slice(0, 7);
        const v = raw.startsWith("#") ? raw : `#${raw.slice(0, 6)}`;
        setText(v);
        if (HEX.test(v)) {
          setShown(v.toLowerCase());
          onChange(v.toLowerCase());
        }
      }}
      onBlur={() => setText(value)}
      spellCheck={false}
      aria-invalid={!HEX.test(text) || undefined}
      className="h-7 w-24 font-mono text-[12px]"
      aria-label={label}
    />
  );
}

function LightEditor({ light, index, onChange, onRemove }: { light: LightSource; index: number; onChange: (l: LightSource) => void; onRemove?: () => void }) {
  return (
    <div className="space-y-2.5 rounded-xl border p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium">Light {index + 1}</span>
        {onRemove && (
          <button type="button" onClick={onRemove} className="ml-auto inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-destructive">
            <X className="size-3" /> Remove light
          </button>
        )}
      </div>
      <div className="flex items-start gap-3">
        <LightSphere lights={[light]} className="size-16 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {QUICK_LIGHT_DIRECTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onChange({ ...light, direction: d })}
                className={cn("h-6 rounded-full px-2 text-[11.5px] font-medium capitalize", light.direction === d ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent")}
              >
                {d}
              </button>
            ))}
          </div>
          <select
            value={light.direction}
            onChange={(e) => onChange({ ...light, direction: e.target.value })}
            className="h-7 w-full rounded-md border bg-background px-1.5 text-[12px] capitalize outline-none focus:border-primary"
            aria-label={`Light ${index + 1} direction`}
          >
            {LIGHT_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {d.replace(/-/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="color" value={light.color} onChange={(e) => onChange({ ...light, color: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5" aria-label={`Light ${index + 1} colour`} />
        <HexInput value={light.color} onChange={(color) => onChange({ ...light, color })} label={`Light ${index + 1} hex colour`} />

      </div>
      {(["brightness", "diffuse"] as const).map((k) => (
        <div key={k} className="space-y-1">
          <div className="flex justify-between text-[11.5px] text-muted-foreground">
            <span className="capitalize">{k}</span>
            <span className="font-mono">{light[k]}</span>
          </div>
          <Slider value={[light[k]]} min={0} max={100} step={1} onValueChange={([v]) => onChange({ ...light, [k]: Math.round(v) })} aria-label={`Light ${index + 1} ${k}`} />
        </div>
      ))}
    </div>
  );
}

export function LightingChip({ settings, onChange }: { settings: DirectorSettings; onChange: Patch }) {
  const lighting = settings.lighting;
  const [tab, setTab] = useState<"presets" | "custom">(lighting?.kind === "custom" ? "custom" : "presets");
  const lights = lighting?.kind === "custom" ? lighting.lights : [];
  const err = lighting?.kind === "custom" ? rigError(lighting.lights) : null;
  const label = !lighting ? "Lighting" : lighting.kind === "preset" ? optionName(LIGHTING_PRESETS, lighting.slug) : `Custom · ${lights.length} light${lights.length === 1 ? "" : "s"}`;
  const setLights = (ls: LightSource[]) => onChange({ lighting: ls.length ? { kind: "custom", lights: ls } : null });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <DirectorChip icon={Sun} label={label} active={!!lighting} aria-label="Lighting" />
      </PopoverTrigger>
      <PopoverContent className="w-[min(94vw,520px)] p-3" align="start" side="top" collisionPadding={12}>
        <PanelHeader title="Set up lighting" subtitle="Pick a scheme or place your own lights" />
        <div className="mb-3 inline-flex rounded-full bg-muted p-0.5" role="tablist">
          {(["presets", "custom"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("h-7 rounded-full px-3 text-[12px] font-medium", tab === t ? "bg-background shadow-soft" : "text-muted-foreground hover:text-foreground")}
            >
              {t === "presets" ? "Presets" : "Custom rig"}
            </button>
          ))}
        </div>
        <div className="max-h-[min(56vh,440px)] overflow-y-auto pr-0.5">
          {tab === "presets" ? (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" role="radiogroup">
              {[...LIGHTING_PRESETS].sort((a, b) => Number(!!a.slug) - Number(!!b.slug)).map((p) => {
                const sel = p.slug ? lighting?.kind === "preset" && lighting.slug === p.slug : !lighting;
                return (
                  <button
                    key={p.name}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    onClick={() => onChange({ lighting: p.slug ? { kind: "preset", slug: p.slug } : null })}
                    className={cn("flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors", sel ? "border-primary bg-brand-faint" : "hover:bg-accent")}
                  >
                    <LightSphere lights={p.slug ? (PRESET_LIGHT[p.slug] ?? []) : [{ direction: "front-top", color: "#ffffff", brightness: 50, diffuse: 90 }]} className="mt-0.5 size-9 shrink-0" />
                    <span className="min-w-0">
                      <span className={cn("block text-[13px] font-medium", sel && "text-brand-text")}>{p.name}</span>
                      <span className="block text-[11.5px] leading-snug text-muted-foreground">{p.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {lighting?.kind === "preset" && <p className="text-[12px] text-muted-foreground">A lighting preset and a custom rig are mutually exclusive — adding a light replaces “{optionName(LIGHTING_PRESETS, lighting.slug)}”.</p>}
              {lights.map((l, i) => (
                <LightEditor key={i} light={l} index={i} onChange={(nl) => setLights(lights.map((x, j) => (j === i ? nl : x)))} onRemove={() => setLights(lights.filter((_, j) => j !== i))} />
              ))}
              {lights.length < MAX_LIGHTS && (
                <button
                  type="button"
                  onClick={() => setLights([...lights, { direction: lights.length ? "right" : "front-top-left", color: lights.length ? "#9fb8ff" : "#ffd29a", brightness: lights.length ? 45 : 80, diffuse: 60 }])}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-3 text-[12.5px] font-medium text-muted-foreground hover:border-primary hover:bg-brand-faint hover:text-brand-text"
                >
                  <Plus className="size-3.5" /> Add light
                </button>
              )}
              {err && lights.length > 0 && <p className="text-[12px] text-destructive">{err}</p>}
              {lights.length > 0 && <LightSphere lights={lights} className="mx-auto size-24" />}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function EmotionChip({ settings, onChange, characters }: { settings: DirectorSettings; onChange: Patch; characters: StudioElement[] }) {
  const emotions = settings.emotions ?? {};
  const active = characters.filter((c) => emotions[c.handle.toLowerCase()]);
  const first = active[0] ? emotionStep(emotions[active[0].handle.toLowerCase()]) : undefined;
  const chipLabel = first ? `${first.name}${active.length > 1 ? ` +${active.length - 1}` : ""}` : "Emotions";
  const set = (handle: string, v: { family: string; step: number } | null) => {
    const next = { ...emotions };
    if (v) next[handle.toLowerCase()] = v;
    else delete next[handle.toLowerCase()];
    onChange({ emotions: next });
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <DirectorChip icon={Smile} label={chipLabel} active={active.length > 0} aria-label={first ? `Emotions: ${chipLabel}` : "Emotions"}>
          {first && <span className="size-2.5 shrink-0 rounded-full" style={{ background: first.color }} />}
        </DirectorChip>
      </PopoverTrigger>
      <PopoverContent className="w-[min(94vw,480px)] p-3" align="start" side="top" collisionPadding={12}>
        <PanelHeader title="Emotion Wheel" subtitle="Give each @character a feeling; its intensity sets the words added after their name" />
        {!characters.length ? (
          <p className="rounded-lg bg-muted px-3 py-4 text-center text-[12.5px] text-muted-foreground">Mention a character with @ in the prompt to give them an emotion.</p>
        ) : (
          <div className="max-h-[min(56vh,440px)] space-y-3 overflow-y-auto pr-0.5">
            {characters.map((c) => {
              const cur = emotions[c.handle.toLowerCase()];
              const step = emotionStep(cur);
              return (
                <div key={c.id} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center overflow-hidden rounded-full bg-muted" style={step ? { boxShadow: `0 0 0 2px ${step.color}` } : undefined}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {c.references[0] ? <img src={c.references[0]} alt="" className="size-full object-cover" /> : null}
                    </span>
                    <span className="text-[13px] font-medium">@{c.handle}</span>
                    {step && <span className="truncate text-[12px] text-muted-foreground">{step.prompt}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => set(c.handle, null)} className={cn("h-7 rounded-full px-2.5 text-[12px] font-medium", !cur ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent")}>
                      Neutral
                    </button>
                    {EMOTION_FAMILIES.map((f) => {
                      const sel = cur?.family === f.name;
                      return (
                        <button
                          key={f.name}
                          type="button"
                          onClick={() => set(c.handle, { family: f.name, step: cur?.family === f.name ? cur.step : 1 })}
                          className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium", sel ? "border-transparent text-white" : "hover:bg-accent")}
                          style={sel ? { background: f.colors[cur!.step] } : undefined}
                        >
                          {!sel && <span className="size-2 rounded-full" style={{ background: f.colors[1] }} />}
                          {f.name}
                        </button>
                      );
                    })}
                  </div>
                  {cur && step && (
                    <div className="flex gap-1 pl-0.5" role="radiogroup" aria-label={`${c.handle} intensity`}>
                      {step.family.steps.map((s, i) => (
                        <button
                          key={s.name}
                          type="button"
                          role="radio"
                          aria-checked={cur.step === i}
                          onClick={() => set(c.handle, { family: cur.family, step: i })}
                          className={cn("h-6 flex-1 rounded-md text-[11.5px] font-medium", cur.step === i ? "text-white" : "bg-secondary hover:bg-accent")}
                          style={cur.step === i ? { background: step.family.colors[i] } : undefined}
                        >
                          {s.name} · {s.intensity}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
