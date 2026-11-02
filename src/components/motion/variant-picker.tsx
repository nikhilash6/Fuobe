"use client";

import { useState } from "react";
import type { Recipe } from "@/lib/motion/recipe";
import { cn } from "@/lib/utils";
import { MotionPlayer, usePlan, useScene, type MotionInputs } from "./player";

/**
 * A grid of looks to choose from, each a small live preview of its own: the chip under the pointer or the focus plays,
 * the others show the moment that sets their look apart (one moves at a time). "Still" keeps the card as a picture.
 * Three to a row on a phone, all in one row from a small tablet up: every choice is in view, nothing scrolls.
 */

export interface VariantChoice {
  id: string;
  label: string;
  /** The scene that plays on the chip (Still shows a scene's rest frame). */
  scene: string;
  still?: boolean;
}

function Chip({ choice, recipe, inputs, selected, active, onPick, onActive }: { choice: VariantChoice; recipe: Recipe; inputs: MotionInputs; selected: boolean; active: boolean; onPick: () => void; onActive: (on: boolean) => void }) {
  const scene = useScene(choice.scene);
  const plan = usePlan(scene, recipe, inputs);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      onMouseEnter={() => onActive(true)}
      onMouseLeave={() => onActive(false)}
      onFocus={() => onActive(true)}
      onBlur={() => onActive(false)}
      className={cn("flex min-h-11 min-w-0 flex-col items-center gap-1 rounded-xl p-1 text-center outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", selected && "bg-brand-faint ring-2 ring-primary")}
    >
      <MotionPlayer
        plan={plan}
        sources={inputs.sources}
        size={recipe.size}
        duration={recipe.duration}
        fps={recipe.fps}
        label={`${choice.label} end card`}
        controls={false}
        active={active && !choice.still}
        poster={choice.still ? undefined : plan?.signature}
        className="w-full max-w-[76px]"
      />
      <span className="block w-full truncate text-[11px] font-medium leading-4">{choice.label}</span>
    </button>
  );
}

export function VariantPicker({ choices, value, onChange, recipeFor, inputs, label }: { choices: VariantChoice[]; value: string; onChange: (id: string) => void; recipeFor: (scene: string) => Recipe; inputs: MotionInputs; label: string }) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <div role="group" aria-label={label} className="grid min-w-0 grid-cols-3 gap-1.5 py-1 sm:grid-cols-6">
      {choices.map((c) => (
        <Chip key={c.id} choice={c} recipe={recipeFor(c.scene)} inputs={inputs} selected={value === c.id} active={active === c.id} onPick={() => onChange(c.id)} onActive={(on) => setActive((a) => (on ? c.id : a === c.id ? null : a))} />
      ))}
    </div>
  );
}
