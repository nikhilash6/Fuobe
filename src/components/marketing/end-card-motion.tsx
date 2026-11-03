"use client";

import { Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { measureText } from "@/components/ads/render";
import { fontsReady } from "@/components/motion/fonts";
import { MotionPlayer, useMotionInputs, usePlan, useScene, type MotionInputs } from "@/components/motion/player";
import { canMakeMp4, renderClip, type RenderResult } from "@/components/motion/render";
import { phaseLine, useMotionSave } from "@/components/motion/save";
import { VariantPicker, type VariantChoice } from "@/components/motion/variant-picker";
import { END_CARD } from "@/lib/catalog/marketing";
import type { Engine } from "@/lib/catalog/types";
import { DEFAULT_EXPORT, type Recipe } from "@/lib/motion/recipe";
import { loadScene } from "@/lib/motion/registry";
import { END_CARD_VARIANT_NAMES, END_CARD_VARIANTS, type EndCardVariant } from "@/lib/motion/scenes/end-card/shared";
import type { SizeSpec } from "@/lib/motion/sizes";
import type { EndCardInput } from "./end-card";

/**
 * Click to Ad's end card in motion: five designed styles (and Still), each a live preview drawn by the same code that
 * renders the clip, so what plays here is what the ad ends on.
 */

export type EndCardChoice = EndCardVariant | "still";

export const END_CARD_CHOICES: VariantChoice[] = [
  ...END_CARD_VARIANTS.map((v) => ({ id: v, label: END_CARD_VARIANT_NAMES[v], scene: `end-card/${v}` })),
  { id: "still", label: "Still", scene: "end-card/draw-on", still: true },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** The card as a Kinetic Motion recipe (the words as typed, the kit's colours and fonts, its logo). */
export function endCardRecipe(card: EndCardInput, colors: readonly string[], scene: string, o: { fps: 24 | 25 | 30; size: SizeSpec; seconds?: number }): Recipe {
  return {
    v: 1,
    scene,
    seed: 1,
    size: o.size,
    fps: o.fps,
    duration: o.seconds ?? END_CARD.seconds,
    fields: { brand: card.content.brand, product: card.content.product, ...(card.content.cta && { cta: card.content.cta }), ...(card.content.website && { website: card.content.website }) },
    brand: { name: card.content.brand, colors: colors.filter((c) => HEX.test(c)).slice(0, 8), fonts: { heading: card.theme.heading, body: card.theme.body }, ...(card.logo && { logo: card.logo }) },
    export: DEFAULT_EXPORT,
  };
}

/** The frame rate the ad's join works at: 25 on the open engine (its join resamples to 25), 24 in the cloud. */
export const cardFps = (engine: Engine): 24 | 25 => (engine === "open" ? 25 : 24);

const OVERFLOW_WORDS: Record<string, string> = {
  product: "Shorten the product name to fit the end card",
  cta: "Shorten the call to action to fit the end card",
  brand: "Shorten the brand name to fit the end card",
  website: "Shorten the address to fit the end card",
};

export function useEndCardMotion(card: EndCardInput, colors: readonly string[], engine: Engine, choice: EndCardChoice) {
  const fps = cardFps(engine);
  const sceneId = choice === "still" ? "end-card/draw-on" : `end-card/${choice}`;
  const recipe = useMemo(() => endCardRecipe(card, colors, sceneId, { fps, size: END_CARD.size }), [card, colors, sceneId, fps]);
  const inputs = useMotionInputs(recipe);
  const scene = useScene(sceneId);
  const plan = usePlan(scene, recipe, inputs);
  const [mp4, setMp4] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void canMakeMp4(END_CARD.size.w, END_CARD.size.h, 24)
      .then((ok) => live && setMp4(ok))
      .catch(() => live && setMp4(false));
    return () => {
      live = false;
    };
  }, []);
  // The cloud's join takes MP4 only: without an H.264 encoder here the card stays a still.
  const stillOnly = engine === "cloud" && mp4 === false;
  const overflow = plan?.overflow.map((f) => OVERFLOW_WORDS[f]).filter(Boolean) ?? [];
  return { recipe, inputs, plan, overflow, stillOnly, animated: choice !== "still" && !stillOnly, recipeFor: (scene: string) => endCardRecipe(card, colors, scene, { fps, size: END_CARD.size }) };
}

/** Renders a recipe's clip here, in the brand's own fonts (a font that didn't load stops it). */
export async function renderRecipe(recipe: Recipe, inputs: MotionInputs, o: { formats: ("mp4" | "webm")[]; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<RenderResult> {
  await fontsReady([recipe.brand.fonts.heading, recipe.brand.fonts.body], { strict: true, text: [...Object.values(recipe.fields), recipe.brand.name].join(" ") });
  const scene = await loadScene(recipe.scene);
  return renderClip(scene, recipe, { sources: inputs.sources, logo: inputs.logo, images: inputs.images, outlines: inputs.outlines, measure: measureText, formats: o.formats, signal: o.signal, onProgress: (d, n) => o.onProgress?.(d, n) });
}

/** The words a saved end card is listed and searched by. */
const wordsOf = (card: EndCardInput) => [card.content.brand, card.content.product, card.content.cta, card.content.website].filter((w) => w?.trim()).join(" · ");

export function EndCardMotionPanel({
  card,
  colors,
  motion,
  choice,
  onChoice,
  cta,
  onCta,
  rendering,
}: {
  card: EndCardInput;
  colors: readonly string[];
  motion: ReturnType<typeof useEndCardMotion>;
  choice: EndCardChoice;
  onChoice: (c: EndCardChoice) => void;
  cta: string;
  onCta: (v: string) => void;
  /** "Rendering 42 of 63" while Generate renders the card. */
  rendering?: string | null;
}) {
  const saver = useMotionSave();
  const line = phaseLine(saver.phase);
  const words = [card.content.brand, card.content.product, card.content.cta].filter(Boolean).join(", ");
  // Only an animated style is kept as a clip; the still card is part of the ad itself.
  const variant = motion.animated && choice !== "still" ? choice : null;
  const save = () => {
    if (!variant) return;
    // A logo sting to keep: full 1080 × 1920 at 30 fps.
    const recipe = endCardRecipe(card, colors, `end-card/${variant}`, { fps: 30, size: "9:16" });
    void saver.save({ recipe, feature: "kinetic-end-card", title: `${card.content.brand || card.content.product || "Brand"} end card · ${END_CARD_VARIANT_NAMES[variant]}`, prompt: wordsOf(card), images: card.logo ? [card.logo] : [] }, (signal, progress) =>
      renderRecipe(recipe, motion.inputs, { formats: ["mp4", "webm"], signal, onProgress: progress }),
    );
  };
  return (
    <div className="min-w-0 space-y-3">
      <VariantPicker choices={END_CARD_CHOICES} value={motion.stillOnly ? "still" : choice} onChange={(id) => onChoice(id as EndCardChoice)} recipeFor={motion.recipeFor} inputs={motion.inputs} label="End card style" />
      {motion.stillOnly && <p className="text-[12px] text-muted-foreground">This browser makes the still end card.</p>}
      <div className="grid min-w-0 gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[200px] sm:max-w-none">
          {motion.animated ? (
            <MotionPlayer plan={motion.plan} sources={motion.inputs.sources} size={END_CARD.size} duration={motion.recipe.duration} fps={motion.recipe.fps} label={`End card preview: ${words}`} />
          ) : (
            <MotionPlayer plan={motion.plan} sources={motion.inputs.sources} size={END_CARD.size} duration={motion.recipe.duration} fps={motion.recipe.fps} label={`End card preview: ${words}`} controls={false} active={false} />
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <input value={cta} onChange={(e) => onCta(e.target.value.slice(0, 30))} className="h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Call to action on the end card" placeholder="Call to action, e.g. Shop now" />
          {motion.overflow.map((m) => (
            <p key={m} className="text-[12px] text-destructive">
              {m}
            </p>
          ))}
          {rendering && (
            <p role="status" className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {rendering}
            </p>
          )}
          {variant && (
            <Button variant="outline" className="h-11 w-full" onClick={save} disabled={!!line || motion.overflow.length > 0 || !motion.plan}>
              {line ? <Loader2 className="animate-spin" /> : <Save />} {line ?? `Save ${END_CARD_VARIANT_NAMES[variant]} to ${saver.label.endsWith("runs") ? "your runs" : "Library"}`}
            </Button>
          )}
          {line && (
            <Button variant="ghost" className="h-11 w-full" onClick={saver.cancel}>
              Stop
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
