"use client";

import { Film, Layers, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CoverArt, useCoverPlayback } from "@/components/template-cover";
import { MotionPlayer, useMotionInputs, usePlan, useScene } from "@/components/motion/player";
import { Viewer } from "@/components/studio/viewer";
import { useGenerations, useIsGuest } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { exampleRecipe, KINETIC_EXAMPLES, KINETIC_SCENES, entryBySlug, restingTime, type KineticEntry, type KineticExample } from "@/lib/motion/kinetic-catalog";
import { templateCover } from "@/lib/template-covers";
import { cn } from "@/lib/utils";

/**
 * Kinetic's opening screen: four examples, every scene, and what the person made here before. The examples are drawn
 * live by the engine, each finished with its own look, and rest on their telling frame; a scene tile shows its cover.
 * On a screen with a pointer nothing moves until hovered or focused; on a phone, only the example most in view plays.
 * With reduced motion every tile keeps its still. A tile opens the editor on its scene.
 */

/** Everything Kinetic saves except versions (those live in the Versions sheet). */
export const MADE_FEATURES = ["kinetic", "kinetic-frame", "kinetic-sheet", "kinetic-canvas", "marketing-kinetic"];

const firstSentence = (s: string) => (s.match(/^[^.!?]*[.!?]/)?.[0] ?? s).trim();

const chipClass = "absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur md:text-[12px]";
const playClass = "absolute right-2 bottom-2 grid size-6 place-items-center rounded-full bg-black/45 text-white backdrop-blur";

function SceneTile({ entry, onOpen, chip }: { entry: KineticEntry; onOpen: () => void; chip?: React.ReactNode }) {
  const cover = templateCover("marketing", entry.template);
  const { ref, playing, asked, handlers } = useCoverPlayback<HTMLButtonElement>(`kinetic/${entry.slug}`, cover, { auto: "touch" });
  return (
    <button ref={ref} type="button" {...handlers} onClick={onOpen} data-kinetic-tile={entry.slug} className="group/tile min-w-0 rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <span className="relative block aspect-[3/4] overflow-hidden rounded-2xl bg-muted transition-transform duration-300 ease-move group-hover/tile:scale-[1.015] motion-reduce:transition-none motion-reduce:group-hover/tile:scale-100">
        {cover && <CoverArt cover={cover} sizes="(max-width: 768px) 50vw, 20vw" playing={playing} asked={asked} />}
        {chip && <span className={chipClass}>{chip}</span>}
        <span className={playClass} aria-hidden>
          <Play className="size-3 fill-current" />
        </span>
      </span>
      <span className="mt-2 block truncate px-0.5 text-[13px] font-medium md:text-[14px]">{entry.name}</span>
      <span className="line-clamp-2 block px-0.5 text-[12px] leading-snug text-muted-foreground md:text-[13px]">{firstSentence(entry.blurb)}</span>
    </button>
  );
}

/** Whether a pointer can hover here (false on the server and first render: phones are the default). */
function useCanHover(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const f = () => setOn(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return on;
}

/** Which of the examples is most in view (phones play only that one). */
function useMostInView(count: number): [(i: number) => (el: HTMLElement | null) => void, number | null] {
  const els = useRef<(HTMLElement | null)[]>([]);
  const ratios = useRef<number[]>([]);
  const [best, setBest] = useState<number | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = els.current.indexOf(e.target as HTMLElement);
          if (i >= 0) ratios.current[i] = e.intersectionRatio;
        }
        let top: number | null = null;
        ratios.current.forEach((r, i) => {
          if (r >= 0.6 && (top === null || r > ratios.current[top])) top = i;
        });
        setBest(top);
      },
      { threshold: [0, 0.25, 0.6, 0.8, 1] },
    );
    for (const el of els.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, [count]);
  return [(i) => (el) => void (els.current[i] = el), best];
}

function ExampleTile({ example, onOpen, setRef, inView, canHover }: { example: KineticExample; onOpen: () => void; setRef: (el: HTMLElement | null) => void; inView: boolean; canHover: boolean }) {
  const entry = entryBySlug(example.slug)!;
  const cover = templateCover("marketing", entry.template);
  const recipe = useMemo(() => exampleRecipe(example), [example]);
  const inputs = useMotionInputs(recipe);
  const scene = useScene(recipe.scene);
  const plan = usePlan(scene, recipe, inputs);
  const [hover, setHover] = useState(false);
  const poster = plan ? restingTime(plan, recipe) : undefined;
  const ratio = plan ? `${plan.design.w} / ${plan.design.h}` : "4 / 5";
  return (
    <button
      ref={setRef}
      type="button"
      onClick={onOpen}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
      onFocus={(e) => e.currentTarget.matches(":focus-visible") && setHover(true)}
      onBlur={() => setHover(false)}
      data-kinetic-tile={example.slug}
      data-kinetic-example={example.slug}
      className="group/tile min-w-0 rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="relative grid aspect-[4/5] place-items-center overflow-hidden rounded-2xl bg-muted">
        {/* The scene's cover until the live drawing is ready, then the example itself. */}
        {!plan && cover && <CoverArt cover={cover} sizes="(max-width: 768px) 50vw, 25vw" />}
        {plan && (
          <span className="block h-full max-w-full" style={{ aspectRatio: ratio }}>
            <MotionPlayer plan={plan} sources={inputs.sources} size={recipe.size} duration={recipe.duration} fps={recipe.fps} label={`${example.label}: ${example.purpose}`} controls={false} active={canHover ? hover : inView} poster={poster} className="w-full" />
          </span>
        )}
        <span className={playClass} aria-hidden>
          <Play className="size-3 fill-current" />
        </span>
      </span>
      <span className="mt-2 block truncate px-0.5 text-[14px] font-medium md:text-[15px]">{example.label}</span>
      <span className="line-clamp-2 block px-0.5 text-[12px] leading-snug text-muted-foreground md:text-[13px]">{example.purpose}</span>
    </button>
  );
}

function MadeInKinetic() {
  const guest = useIsGuest();
  const list = useGenerations({ features: MADE_FEATURES, statuses: ["succeeded"], limit: 12 });
  const items = useMemo(() => (guest ? [] : (list.data ?? []).filter((g) => g.status === "succeeded" && g.outputs[0]).slice(0, 12)), [list.data, guest]);
  const [open, setOpen] = useState<Generation | null>(null);
  if (!items.length) return null;
  return (
    <section aria-labelledby="kinetic-made" className="min-w-0" data-kinetic-made-strip>
      <h2 id="kinetic-made" className="mb-3 font-heading text-[20px] leading-tight">
        Made in Kinetic
      </h2>
      <div className="scrollbar-none -mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1">
        {items.map((g) => {
          const o = g.outputs[0];
          const poster = o.kind === "image" ? o.url : typeof o.meta?.poster === "string" ? o.meta.poster : undefined;
          // Its own shape when the size is known; otherwise the whole picture shows, never cropped.
          const sized = !!(o.width && o.height);
          return (
            <button key={g.id} type="button" onClick={() => setOpen(g)} aria-label={`Open ${(g.request.title ?? g.request.prompt ?? "saved result").slice(0, 80)}`} data-kinetic-made={g.id} className="relative h-36 shrink-0 overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ aspectRatio: sized ? `${o.width} / ${o.height}` : "4 / 5" }}>
              {poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={poster} alt="" className={cn("size-full", sized ? "object-cover" : "object-contain")} loading="lazy" />
              ) : (
                <video src={o.url} muted playsInline preload="metadata" className={cn("size-full", sized ? "object-cover" : "object-contain")} />
              )}
              {o.kind === "video" && (
                <span className={playClass} aria-hidden>
                  <Play className="size-3 fill-current" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {open && <Viewer generation={open} index={0} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** The opening screen as the static page sends it (its tiles start working once the page has loaded). */
export function ScenePickerShell() {
  return <ScenePicker onOpen={() => undefined} />;
}

export function ScenePicker({ onOpen }: { onOpen: (entry: KineticEntry, example?: KineticExample) => void }) {
  const canHover = useCanHover();
  const [refFor, best] = useMostInView(KINETIC_EXAMPLES.length);
  return (
    <div className="mx-auto w-full max-w-[1400px] min-w-0 space-y-10 px-4 pt-6 pb-16 sm:px-6 lg:px-8" data-kinetic-picker>
      <header className="max-w-2xl min-w-0">
        <h1 className="font-heading text-[32px] leading-[1.05] text-balance sm:text-[44px]">Fuobe Kinetic Motion</h1>
        <p className="mt-2 text-[15px] text-pretty text-muted-foreground sm:text-[17px]">Motion graphics in your brand, set in your exact words and drawn live in your browser.</p>
      </header>

      <section aria-labelledby="kinetic-examples" className="min-w-0">
        <h2 id="kinetic-examples" className="mb-3 font-heading text-[20px] leading-tight">
          Start from an example
        </h2>
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4 md:gap-4" data-kinetic-examples>
          {KINETIC_EXAMPLES.map((x, i) => (
            <ExampleTile key={x.slug} example={x} setRef={refFor(i)} inView={best === i} canHover={canHover} onOpen={() => onOpen(entryBySlug(x.slug)!, x)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="kinetic-all" className="min-w-0">
        <h2 id="kinetic-all" className="mb-3 font-heading text-[20px] leading-tight">
          All scenes
        </h2>
        <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3 xl:grid-cols-5" data-kinetic-scenes>
          {KINETIC_SCENES.map((e) => (
            <SceneTile
              key={e.slug}
              entry={e}
              onOpen={() => onOpen(e)}
              chip={
                e.slug === "end-card" ? (
                  <>
                    <Layers className="size-3" /> 5 styles
                  </>
                ) : e.clip ? (
                  <>
                    <Film className="size-3" /> Over your clip
                  </>
                ) : undefined
              }
            />
          ))}
        </div>
      </section>

      <MadeInKinetic />
    </div>
  );
}
