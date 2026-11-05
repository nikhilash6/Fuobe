"use client";

import { Ban, Film, Loader2, Shuffle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import type { Preset } from "@/lib/catalog/types";
import { presetCover } from "@/lib/preset-covers";
import { featuredAll } from "@/lib/preset-featured";
import { cn } from "@/lib/utils";
import { onAttr, TAB_PILL, TabRow } from "@/components/ui/tab-row";
import { CoverScrollBox, CoverTile, usePickerPlayback } from "@/components/cover-tile";
import { PRESET_ICONS } from "@/components/preset-icons";
import { usePoolRules } from "@/hooks/use-pool-rules";
import { presetOwnSetup, type PoolRules } from "@/lib/pool-rules";
import { OwnSetupChip } from "@/components/own-setup";
import type { OwnSetup } from "@/lib/own-setup";
import { loadFullCatalog, useCatalog } from "./catalog";
import { Chip, ClearableChip } from "./chip";

/**
 * Camera-motion / effect picker and Mix. Loaded as its own chunk (with the preset icons and the slim
 * covers map), and the preset lists come from the full catalog chunk, fetched on first hover or open.
 * A preset shows its real cover, as in the galleries and in their shape (4:3, so it shows whole), else its drawn tile.
 * Both list them as the galleries do
 * (featuredAll), with the category tabs in catalog order.
 */

const tileClass = "group flex flex-col items-start gap-1 overflow-hidden rounded-lg p-1 text-left ring-primary transition hover:bg-accent";

function PresetTile({ preset: p, picked, onPick, setup }: { preset: Preset; picked: boolean; onPick: () => void; setup?: OwnSetup | null }) {
  const { playing, handlers } = usePickerPlayback(p.id, { picked });
  const PI = PRESET_ICONS[p.look.icon] ?? Film;
  return (
    <button type="button" aria-pressed={picked} onClick={onPick} {...handlers} className={cn(tileClass, picked && "ring-2")}>
      <CoverTile
        cover={presetCover(p.id)}
        playing={playing}
        picked={picked}
        className="aspect-[4/3] w-full rounded-md"
        fallback={
          <span className="absolute inset-0 grid place-items-center text-white" style={{ background: `linear-gradient(135deg, ${p.look.from}, ${p.look.to})` }}>
            <PI className="size-5 transition-transform duration-300 group-hover:scale-125" />
          </span>
        }
      />
      <span className="w-full truncate px-0.5 text-[12px] font-medium">{p.name}</span>
      {setup && <OwnSetupChip setup={setup} className="mx-0.5" />}
    </button>
  );
}

/**
 * The picker's grid. `rules` (hosted runs, a viewer with no GPU of its own): a preset only this studio's GPUs could run
 * and which they keep off stays, with what runs it (its own-setup label); Run then opens that setup.
 */
export function PresetGrid({
  list,
  value,
  onPick,
  noneLabel,
  rules,
  engine,
}: {
  list: Preset[] | null;
  value?: string;
  onPick: (id: string | undefined) => void;
  noneLabel: string;
  rules?: PoolRules;
  engine?: "open" | "cloud";
}) {
  const [cat, setCat] = useState<string>("All");
  const box = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => (list ? featuredAll(list) : null), [list]);
  if (!list || !ordered)
    return (
      <div className="grid h-40 place-items-center" role="status" aria-label="Loading presets">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  const cats = ["All", ...new Set(list.map((p) => p.category))];
  return (
    <>
      <TabRow className="mb-1 shrink-0" role="tablist" aria-label="Categories" follow>
        {cats.map((c) => (
          <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={TAB_PILL} {...onAttr(cat === c)}>
            {c}
          </button>
        ))}
      </TabRow>
      <CoverScrollBox value={box}>
        {/* The box scrolls and gives way in the picker (min-h-0); the grid inside keeps its rows whole. */}
        <div ref={box} className="max-h-[28rem] min-h-0 overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-3 gap-1.5">
            {cat === "All" && (
              <button type="button" aria-pressed={!value} onClick={() => onPick(undefined)} className={cn(tileClass, !value && "ring-2")}>
                <CoverTile
                  cover={undefined}
                  picked={!value}
                  className="aspect-[4/3] w-full rounded-md"
                  fallback={
                    <span className="absolute inset-0 grid place-items-center text-muted-foreground">
                      <Ban className="size-5" />
                    </span>
                  }
                />
                <span className="w-full truncate px-0.5 text-[12px] font-medium">{noneLabel}</span>
              </button>
            )}
            {ordered
              .filter((p) => cat === "All" || p.category === cat)
              .map((p) => (
                <PresetTile key={p.id} preset={p} picked={value === p.id} onPick={() => onPick(p.id)} setup={presetOwnSetup(rules, p, engine)} />
              ))}
          </div>
        </div>
      </CoverScrollBox>
    </>
  );
}

const prefetch = () => void loadFullCatalog();

/**
 * A picker opens on the side of its chip with more of the screen (below a chip in the upper half), and is as tall as
 * that room allows: its scroll box gives way (min-h-0), the categories and Mix's sliders keep their height, and the
 * covers get up to 28rem, three rows and part of a fourth. The side is picked as it opens, so a list still loading (a short box) doesn't keep
 * it on the side with less room.
 */
const POPOVER_HEIGHT = "max-h-[var(--radix-popover-content-available-height)]";

function usePickerSide() {
  const chip = useRef<HTMLButtonElement>(null);
  const [side, setSide] = useState<"top" | "bottom">("top");
  const measure = () => {
    const r = chip.current?.getBoundingClientRect();
    if (r) setSide(window.innerHeight - r.bottom > r.top ? "bottom" : "top");
  };
  return { chip, side, measure };
}

export function PresetChip({ type, value, onChange, engine }: { type: "motion" | "effect"; value?: string; onChange: (id?: string) => void; engine?: "open" | "cloud" }) {
  const [open, setOpen] = useState(false);
  const { chip, side, measure } = usePickerSide();
  const catalog = useCatalog();
  // For a viewer with no GPU of its own, what this studio's GPUs keep off shows with its own-setup label
  // (src/lib/pool-rules.ts), unless the preset has a cloud route and the composer isn't on the open engine.
  const rules = usePoolRules();
  const list = catalog.presets?.[type] ?? null;
  const selected = value ? catalog.getPreset(value) : undefined;
  // The picked preset's poster in place of its icon, as the Look chip shows its look.
  const cover = selected && presetCover(selected.id);
  const Icon = cover ? undefined : selected ? (PRESET_ICONS[selected.look.icon] ?? Film) : value && !catalog.complete ? Loader2 : Film;
  const noun = type === "motion" ? "camera motion" : "effect";
  return (
    <ClearableChip active={!!value} onClear={() => onChange(undefined)} clearLabel={`Clear ${selected?.name ?? noun}`}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) return;
          measure();
          prefetch();
        }}
      >
        <PopoverTrigger asChild>
          <Chip ref={chip} icon={Icon} active={!!value} onPointerEnter={prefetch} onFocus={prefetch} className={cn(value && !selected && "[&>svg]:animate-spin")}>
            {cover && <CoverTile cover={cover} className="size-4 rounded-full" />}
            {selected?.name ?? (value ? "Loading…" : type === "motion" ? "Camera motion" : "Effect")}
          </Chip>
        </PopoverTrigger>
        <PopoverContent className={cn(POPOVER_HEIGHT, "w-[min(92vw,460px)] p-2")} align="start" side={side} collisionPadding={12} aria-label={type === "motion" ? "Camera motions" : "Effects"}>
          <PresetGrid
            list={list}
            value={value}
            rules={rules}
            engine={engine}
            noneLabel="None"
            onPick={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </ClearableChip>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Higgsfield's Mix: a second motion or effect on top of the first, each with a strength. The first one's strength scales
 * its LoRAs, so its slider shows only on a model that runs them (`strengthOn` names the model that does, otherwise).
 */
export function MixChip({
  primary,
  strength,
  takesStrength = true,
  strengthOn,
  mix,
  onChange,
  engine,
}: {
  primary: Preset;
  strength: number;
  takesStrength?: boolean;
  strengthOn?: string;
  mix?: { presetId: string; strength: number };
  onChange: (patch: { presetStrength?: number; mix?: { presetId: string; strength: number } | undefined }) => void;
  /** The composer's engine: a preset with a cloud route stays on the cloud engine whatever this studio's GPUs run. */
  engine?: "open" | "cloud";
}) {
  const [open, setOpen] = useState(false);
  const { chip, side, measure } = usePickerSide();
  const catalog = useCatalog();
  const second = mix ? catalog.getPreset(mix.presetId) : undefined;
  const cover = second && presetCover(second.id);
  // Kept while the sliders move, so the picker isn't sorted again on every step.
  const presets = catalog.presets;
  const rules = usePoolRules();
  const mixable = useMemo(
    () => (presets ? [...presets.motion, ...presets.effect].filter((p) => p.id !== primary.id && !p.inputs.some((i) => i.key === "endImage")) : null),
    [presets, primary.id],
  );
  return (
    <ClearableChip active={!!mix} onClear={() => onChange({ mix: undefined })} clearLabel="Remove the mix">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) return;
          measure();
          prefetch();
        }}
      >
        <PopoverTrigger asChild>
          <Chip ref={chip} icon={cover ? undefined : Shuffle} active={!!mix} onPointerEnter={prefetch} onFocus={prefetch}>
            {cover && <CoverTile cover={cover} className="size-4 rounded-full" />}
            {second ? `+ ${second.name}` : "Mix"}
          </Chip>
        </PopoverTrigger>
        <PopoverContent className={cn(POPOVER_HEIGHT, "w-[min(92vw,460px)] space-y-3 p-3")} align="start" side={side} collisionPadding={12} aria-label="Mix">
          <div className="space-y-2.5">
            {takesStrength ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium">{primary.name}</span>
                  <span className="text-muted-foreground tabular-nums">{pct(strength)}</span>
                </div>
                <Slider min={0.1} max={1} step={0.05} value={[strength]} onValueChange={([v]) => onChange({ presetStrength: v })} aria-label={`${primary.name} strength`} />
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">{primary.name}</span> runs at full strength{strengthOn ? `; its strength can be set on ${strengthOn}` : ""}.
              </p>
            )}
            {second && mix && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium">{second.name}</span>
                  <span className="text-muted-foreground tabular-nums">{pct(mix.strength)}</span>
                </div>
                <Slider min={0.1} max={1} step={0.05} value={[mix.strength]} onValueChange={([v]) => onChange({ mix: { ...mix, strength: v } })} aria-label={`${second.name} strength`} />
              </div>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground">{second ? "Swap the second preset:" : "Pick a second motion or effect to combine with it:"}</p>
          <PresetGrid
            list={mixable}
            value={mix?.presetId}
            rules={rules}
            engine={engine}
            noneLabel="No mix"
            onPick={(id) => onChange({ mix: id ? { presetId: id, strength: mix?.strength ?? 0.6 } : undefined })}
          />
        </PopoverContent>
      </Popover>
    </ClearableChip>
  );
}

/** Both chips, as one lazily loaded unit for the composer toolbar. */
export default function PresetChips({
  picker,
  preset,
  presetId,
  strength,
  takesStrength,
  strengthOn,
  mix,
  onPreset,
  onMix,
  engine,
}: {
  picker?: "motion" | "effect";
  preset?: Preset;
  presetId?: string;
  strength: number;
  /** The run's model scales the move's LoRAs (its strength slider shows); `strengthOn`: the model that does, otherwise. */
  takesStrength?: boolean;
  strengthOn?: string;
  mix?: { presetId: string; strength: number };
  onPreset: (id?: string) => void;
  onMix: (patch: { presetStrength?: number; mix?: { presetId: string; strength: number } | undefined }) => void;
  /** The composer's engine (the pickers keep a preset with a cloud route off the open engine only). */
  engine?: "open" | "cloud";
}) {
  return (
    <>
      {picker && <PresetChip type={picker} value={presetId} onChange={onPreset} engine={engine} />}
      {preset && (preset.type === "motion" || preset.type === "effect") && <MixChip primary={preset} strength={strength} takesStrength={takesStrength} strengthOn={strengthOn} mix={mix} onChange={onMix} engine={engine} />}
    </>
  );
}
