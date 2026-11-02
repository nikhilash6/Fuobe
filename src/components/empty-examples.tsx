"use client";

import { CoverImg, ExampleChip } from "@/components/template-cover";
import { templateCover, type CoverFrame } from "@/lib/template-covers";

/*
 * The example pictures of three empty pages, once they are published ("examples/<id>" in template-covers.ts): each
 * shows what the tool makes, with an "Example" chip, and renders nothing until its pictures exist.
 */

/** Character Sheet's empty result panel: one sheet, four views of the same person (16:9). */
export function SheetExample() {
  const cover = templateCover("examples", "character-sheet");
  if (!cover) return null;
  return (
    <div className="relative aspect-video w-full max-w-xl overflow-hidden rounded-xl bg-muted">
      <CoverImg frame={cover.frames[0]} sizes="(min-width: 640px) 576px, 92vw" className="absolute inset-0" />
      <ExampleChip />
    </div>
  );
}

/** Storyboard's empty page: a six-frame board (16:9 frames), numbered. */
export function BoardExample() {
  const cover = templateCover("examples", "storyboard-heist");
  if (!cover) return null;
  return (
    <div className="relative grid w-full max-w-3xl grid-cols-2 gap-2 sm:grid-cols-3">
      {cover.frames.map((f, i) => (
        <span key={f.src} className="relative aspect-video overflow-hidden rounded-lg bg-muted">
          <CoverImg frame={f} sizes="(min-width: 640px) 250px, 46vw" className="absolute inset-0" />
          <span aria-hidden className="absolute bottom-1 left-1.5 text-[11px] font-medium text-white drop-shadow-sm">
            {i + 1}
          </span>
        </span>
      ))}
      <ExampleChip />
    </div>
  );
}

const ELEMENT_TILES = [
  { id: "element-maya", label: "@Maya", hint: "Character" },
  { id: "element-rooftop-bar", label: "@Rooftop_bar", hint: "Location" },
  { id: "element-aurora", label: "@Aurora", hint: "Prop" },
  { id: "element-together", label: "@Maya walking into @Rooftop_bar", hint: "In a prompt" },
] as const;

/**
 * Elements' empty list: the example its line names, shown only with all four pictures: a character, a place and a
 * product saved as elements, and the picture "@Maya walking into @Rooftop_bar" made from two of them (4:5).
 */
export function ElementsExample() {
  const tiles = ELEMENT_TILES.map((t) => ({ ...t, frame: templateCover("examples", t.id)?.frames[0] }));
  if (!tiles.every((t): t is (typeof tiles)[number] & { frame: CoverFrame } => !!t.frame)) return null;
  return (
    <div className="mx-auto mt-6 grid max-w-2xl grid-cols-2 gap-3 text-left sm:grid-cols-4">
      {tiles.map((t) => (
        <figure key={t.id} className="min-w-0">
          <span className="relative block aspect-[4/5] overflow-hidden rounded-xl bg-muted">
            <CoverImg frame={t.frame} sizes="(min-width: 640px) 160px, 44vw" className="absolute inset-0" />
            {t.id === "element-together" && <ExampleChip />}
          </span>
          <figcaption className="mt-1.5 min-w-0 px-0.5">
            <span className="block truncate text-[12.5px] font-medium">{t.label}</span>
            <span className="block truncate text-[11.5px] text-muted-foreground">{t.hint}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Whether Storyboard's example board is published (its empty page then shows it in place of the icon). */
export const hasBoardExample = () => !!templateCover("examples", "storyboard-heist");
