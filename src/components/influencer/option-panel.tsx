"use client";

import {
  Bird,
  Bug,
  Cat,
  Check,
  Dog,
  Drama,
  Droplet,
  Earth,
  Eye,
  Glasses,
  Hourglass,
  Leaf,
  Lock,
  LockOpen,
  Palette,
  PersonStanding,
  Rat,
  Ruler,
  RulerDimensionLine,
  ScanFace,
  Scissors,
  Shirt,
  Smile,
  SmilePlus,
  Sparkles,
  UserRound,
  VenusAndMars,
  type LucideIcon,
} from "lucide-react";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import { CoverImg } from "@/components/template-cover";
import { templateCover } from "@/lib/template-covers";
import {
  conflictFor,
  CREATURE_TYPES,
  HUMAN_TIERS,
  type InfluencerCategory,
  type InfluencerState,
  type InfluencerTier,
} from "@/lib/influencer";
import { cn } from "@/lib/utils";

export const TIER_ICON: Record<InfluencerTier, LucideIcon> = {
  normal: UserRound,
  freak: Smile,
  total: Drama,
  insects: Bug,
  frogs: Leaf,
  cats: Cat,
  dogs: Dog,
  capybaras: Rat,
  birds: Bird,
};

export const CATEGORY_ICON: Record<string, LucideIcon> = {
  tier: UserRound,
  gender: VenusAndMars,
  ethnicity_origin_base: Earth,
  age: Hourglass,
  skin_tone: Palette,
  height: Ruler,
  body_type: PersonStanding,
  proportions: RulerDimensionLine,
  freak_head: ScanFace,
  freak_neck: UserRound,
  eye_shape: Eye,
  eye_color: Eye,
  freak_face: SmilePlus,
  facial_hair: Scissors,
  hair: Scissors,
  hair_colour: Droplet,
  distinctive: Sparkles,
  aesthetic: Shirt,
  accessory: Glasses,
};

/** A stable hue per option id, for its tile (Fuobe draws its own tiles; nothing comes from the parity studio's CDN). */
function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const SLOT_LABEL: Record<string, string> = {
  marks: "Marks",
  cheeks: "Cheeks",
  eyes: "Eyes",
  lips: "Mouth",
  brows: "Brows",
  nose: "Nose",
  ears: "Ears",
  teeth: "Teeth",
  chin: "Chin",
  forehead: "Forehead",
};

/** How many a category takes, in words. */
export function pickRule(c: InfluencerCategory): string {
  if (c.id === "freak_face") return "One per area, up to 4";
  if (c.id === "accessory") return "Up to 3, or None";
  return c.max === 1 ? "Pick one" : `Up to ${c.max}`;
}

/** A character type's real cover ("influencer/tier-<id>"), or undefined. */
const tierCover = (id: InfluencerTier) => templateCover("influencer", `tier-${id}`);
/** A row of character types shows photo cards only when every type in it has its cover; otherwise its icon tiles. */
const allCovered = (ids: InfluencerTier[]) => ids.every((id) => tierCover(id));
const HUMAN_PHOTOS = allCovered(HUMAN_TIERS.map((t) => t.id));
const CREATURE_PHOTOS = allCovered(CREATURE_TYPES.map((c) => c.id));
/** A photo card's width: a third of the panel. */
const PHOTO_SIZES = "(min-width: 1024px) 200px, 33vw";

/** The categories whose options a portrait shows best: Hairstyle, Style and Accessories. */
const PHOTO_CATEGORIES = new Set(["hair", "aesthetic", "accessory"]);
/** An option's real cover ("influencer/<category>-<option id>"), or undefined. */
export const optionCover = (category: string, id: string) => (PHOTO_CATEGORIES.has(category) ? templateCover("influencer", `${category}-${id}`) : undefined);
/** A category shows photo cards only when every option it shows has its cover; otherwise its icon tiles. */
export const optionPhotos = (c: InfluencerCategory) => c.options.length > 0 && c.options.every((o) => optionCover(c.id, o.id));

/** The Character type panel: three human tiers, six creature types, then the species and body colour. */
export function TierPanel({ state, onTier, onSpecies, onBodyColor }: { state: InfluencerState; onTier: (t: InfluencerTier) => void; onSpecies: (s?: string) => void; onBodyColor: (c?: string) => void }) {
  const creature = CREATURE_TYPES.find((c) => c.id === state.tier);
  /** A type as a 4:5 photo card: its cover, its name and hint on a scrim. */
  const photo = (id: InfluencerTier, label: string, hint: string) => {
    const cover = tierCover(id)!;
    const on = state.tier === id;
    return (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={on}
        tabIndex={radioTab(on)}
        onClick={() => onTier(id)}
        className={cn(
          "group relative block aspect-[4/5] min-w-0 overflow-hidden rounded-xl bg-muted text-left ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring",
          on && "ring-2 ring-primary",
        )}
      >
        <CoverImg frame={cover.frames[0]} sizes={PHOTO_SIZES} className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.03]" />
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/65 to-transparent" />
        <span className="absolute inset-x-2 bottom-2 min-w-0 text-white drop-shadow-sm">
          <span className="block truncate text-[13px] font-medium">{label}</span>
          <span className="block truncate text-[11.5px] leading-snug text-white/80">{hint}</span>
        </span>
        {on && (
          <span aria-hidden className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3" />
          </span>
        )}
      </button>
    );
  };
  const tile = (id: InfluencerTier, label: string, hint: string) => {
    const Icon = TIER_ICON[id];
    const on = state.tier === id;
    return (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={on}
        tabIndex={radioTab(on)}
        onClick={() => onTier(id)}
        className={cn(
          "flex min-w-0 items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          on && "border-primary bg-brand-faint hover:bg-brand-faint-hover",
        )}
      >
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground", on && "bg-primary text-primary-foreground")}>
          <Icon className="size-4.5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{label}</span>
          <span className="block text-[12px] leading-snug text-muted-foreground">{hint}</span>
        </span>
      </button>
    );
  };
  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Character type" onKeyDown={radioKeys} className="space-y-4">
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-muted-foreground">Human</p>
          {HUMAN_PHOTOS ? (
            <div className="grid grid-cols-3 gap-2">{HUMAN_TIERS.map((t) => photo(t.id, t.label, t.hint))}</div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{HUMAN_TIERS.map((t) => tile(t.id, t.label, t.hint))}</div>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-[12px] font-medium text-muted-foreground">Creature</p>
          {CREATURE_PHOTOS ? (
            <div className="grid grid-cols-3 gap-2">{CREATURE_TYPES.map((c) => photo(c.id, c.label, `${c.species.length} species`))}</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{CREATURE_TYPES.map((c) => tile(c.id, c.label, `${c.species.length} species`))}</div>
          )}
        </div>
      </div>
      {creature && (
        <>
          <div className="space-y-2">
            <p id="ib-species" className="text-[13px] font-medium">
              Species
            </p>
            <div role="radiogroup" aria-labelledby="ib-species" onKeyDown={radioKeys} className="flex flex-wrap gap-1.5">
              {[{ id: "", label: "Any" }, ...creature.species].map((s) => {
                const on = (state.species ?? "") === s.id;
                return (
                  <button
                    key={s.id || "any"}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={radioTab(on)}
                    onClick={() => onSpecies(s.id || undefined)}
                    className={cn("h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-primary bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent")}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[13px] font-medium">Body colour</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={!state.bodyColor}
                onClick={() => onBodyColor(undefined)}
                className={cn("h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", !state.bodyColor ? "border-primary bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent")}
              >
                Natural
              </button>
              <label className={cn("flex h-8 cursor-pointer items-center gap-2 rounded-full border pr-3 pl-1 text-[12.5px] font-medium focus-within:ring-2 focus-within:ring-ring", state.bodyColor ? "border-primary bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent")}>
                <input type="color" value={state.bodyColor ?? "#c08457"} onChange={(e) => onBodyColor(e.target.value)} className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0" aria-label="Body colour" />
                {state.bodyColor ? state.bodyColor.toUpperCase() : "Pick a colour"}
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** One category's options as tiles (swatches for colours); a tile that would conflict says why when picked. */
export function OptionTiles({ category, state, onPick }: { category: InfluencerCategory; state: InfluencerState; onPick: (id: string) => void }) {
  const picked = state.picks[category.id] ?? [];
  const Icon = CATEGORY_ICON[category.id] ?? Sparkles;
  const colour = category.kind === "color";
  if (optionPhotos(category)) {
    return (
      <div role="group" aria-label={category.label} className="grid grid-cols-3 gap-2">
        {category.options.map((o) => {
          const on = picked.includes(o.id);
          const conflict = on ? null : conflictFor(state, category.id, o.id);
          const cover = optionCover(category.id, o.id)!;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              aria-disabled={conflict ? true : undefined}
              title={conflict ?? undefined}
              onClick={() => onPick(o.id)}
              className={cn(
                "group relative block aspect-[4/5] min-w-0 overflow-hidden rounded-xl bg-muted text-left ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on && "ring-2 ring-primary",
                conflict && "opacity-50",
              )}
            >
              <CoverImg frame={cover.frames[0]} sizes={PHOTO_SIZES} className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.03]" />
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/65 to-transparent" />
              <span className="absolute inset-x-2 bottom-2 min-w-0 text-white drop-shadow-sm">
                <span className="block truncate text-[13px] font-medium">{o.label}</span>
              </span>
              {on && (
                <span aria-hidden className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </span>
              )}
              {conflict && <span className="sr-only">. {conflict}</span>}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div role="group" aria-label={category.label} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {category.options.map((o) => {
        const on = picked.includes(o.id);
        const conflict = on ? null : conflictFor(state, category.id, o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            aria-disabled={conflict ? true : undefined}
            title={conflict ?? undefined}
            onClick={() => onPick(o.id)}
            className={cn(
              "relative flex min-w-0 items-center gap-2.5 rounded-xl border p-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              on && "border-primary bg-brand-faint hover:bg-brand-faint-hover",
              conflict && "opacity-50",
            )}
          >
            {colour ? (
              <span className="size-9 shrink-0 rounded-full border border-black/10 shadow-inner dark:border-white/15" style={{ background: o.swatch }} aria-hidden />
            ) : (
              <span
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-[oklch(0.94_0.045_var(--h))] text-[oklch(0.45_0.12_var(--h))] dark:bg-[oklch(0.32_0.06_var(--h))] dark:text-[oklch(0.86_0.08_var(--h))]"
                style={{ "--h": hue(o.id) } as React.CSSProperties}
                aria-hidden
              >
                <Icon className="size-4" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] leading-tight font-medium break-words">{o.label}</span>
              {o.slot && <span className="block text-[11.5px] text-muted-foreground">{SLOT_LABEL[o.slot] ?? o.slot}</span>}
            </span>
            {on && (
              <span className="grid size-4.5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden>
                <Check className="size-3" />
              </span>
            )}
            {conflict && <span className="sr-only">. {conflict}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** "Keep on Shuffle": a locked category keeps its picks when you Shuffle. */
export function LockButton({ locked, label, onToggle }: { locked: boolean; label: string; onToggle: () => void }) {
  const Icon = locked ? Lock : LockOpen;
  return (
    <button
      type="button"
      aria-pressed={locked}
      onClick={onToggle}
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", locked ? "border-primary bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent")}
    >
      <Icon className="size-3.5" aria-hidden />
      {locked ? "Kept on Shuffle" : "Keep on Shuffle"}
      <span className="sr-only">({label})</span>
    </button>
  );
}
