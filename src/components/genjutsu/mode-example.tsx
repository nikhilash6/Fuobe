"use client";

import { Check, Copy, Pause, Play, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { copyText } from "@/lib/clipboard";
import { encodeSetup } from "@/lib/catalog/genjutsu";
import { exampleSettings, type GenjutsuExampleCard } from "@/lib/examples/genjutsu";
import { cn } from "@/lib/utils";
import { OnlyYou } from "./openjutsu-panels";

/**
 * A Genjutsu mode's example, under the mode's title: one muted before → after loop (the clip that went in, then what
 * came out), what went in, the settings it used, and "Use this example", which puts those settings into the form and
 * keeps the viewer's own clip and photos. Visitors, who can't run Genjutsu here, see the loop and how it was made.
 *
 * Loading: a still in a fixed 4:3 box first (nothing moves when the clip arrives). The clip downloads only once the
 * card is at least half in view, and not at all with Save-Data or reduced motion (then the finished result shows as a
 * still with a Play button). Leaving the mode drops the download. No analytics of any kind.
 */

/** Where the clip that went in sits in an inset loop (clip-show: 308×230 at 24 px from the corner of 1024×768). */
const INSET = { left: `${(24 / 1024) * 100}%`, top: `${((768 - 24 - 230) / 768) * 100}%` };

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const saveData = () => typeof navigator !== "undefined" && !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

/** Reduced motion can change while the page is open. */
function watchStill(change: () => void) {
  const q = window.matchMedia("(prefers-reduced-motion: reduce)");
  q.addEventListener("change", change);
  return () => q.removeEventListener("change", change);
}

/** A small label on the picture (not read out: the card's caption says what it is). */
function Pill({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span aria-hidden className={cn("pointer-events-none absolute rounded-full bg-black/55 px-2 py-0.5 text-[12px] font-semibold text-white", className)} style={style}>
      {children}
    </span>
  );
}

/** The loop: the still first, the clip once it is in view (or Play is pressed). */
function Loop({ card }: { card: GenjutsuExampleCard }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);
  // null: plays by itself when it can; true / false: the viewer pressed Play or Pause.
  const [chosen, setChosen] = useState<boolean | null>(null);
  // Reduced motion or Save-Data: the finished result as a still, and the clip only on Play (false while the page hydrates).
  const still = useSyncExternalStore(watchStill, () => reducedMotion() || saveData(), () => false);
  // What the video itself reports (a refused play() — Low Power Mode, autoplay off — stays "not playing").
  const [playing, setPlaying] = useState(false);
  // The clip didn't load: the still stays, with no button that can't do anything.
  const [failed, setFailed] = useState(false);
  const out = card.output;
  const rest = out.rest?.src;

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // Half of the card on screen (no margin: the ratio is of the screen itself).
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const wanted = !failed && (chosen ?? (!still && inView));
  // The clip is fetched once it is first wanted, and kept while the mode stays (a scroll back plays at once).
  const [loaded, setLoaded] = useState(false);
  if (wanted && !loaded) setLoaded(true);

  useEffect(() => {
    const v = video.current;
    if (!v || !loaded || failed) return;
    const hidden = () => document.visibilityState === "hidden";
    const sync = () => {
      if (wanted && (inView || chosen) && !hidden()) void v.play().catch(() => setPlaying(false));
      else v.pause();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [loaded, failed, wanted, inView, chosen]);

  // The mode changes (this card leaves): its download stops.
  useEffect(() => {
    const v = video.current;
    if (!v || !loaded) return;
    return () => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
  }, [loaded]);

  // Before the clip: the reduced-motion still is the finished result; otherwise the loop's first frame.
  const poster = still && rest ? rest : (out.poster ?? rest);
  return (
    <div ref={box} className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {poster && <img src={poster} alt="" decoding="async" fetchPriority="low" className="absolute inset-0 size-full object-cover" draggable={false} />}
      {loaded && !failed && (
        <video
          ref={video}
          src={out.src}
          poster={out.poster}
          muted
          loop
          playsInline
          preload="auto"
          aria-label={card.caption}
          className="absolute inset-0 size-full object-cover"
          data-example-video=""
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => {
            setPlaying(false);
            setFailed(true);
          }}
        />
      )}
      {/* The result is on the left of a wipe and fills an inset loop: "After" sits top left on both. */}
      <Pill className="top-2 left-2">After</Pill>
      {card.load.layout === "inset" ? (
        <Pill style={{ left: `calc(${INSET.left} + 6px)`, top: `calc(${INSET.top} + 6px)` }} className="bg-black/60 text-[11px]">
          Before
        </Pill>
      ) : (
        <Pill className="top-2 right-2">Before</Pill>
      )}
      {!failed && (
        <button
          type="button"
          onClick={() => setChosen(!playing)}
          aria-label={playing ? "Pause the example" : "Play the example"}
          className="absolute right-2 bottom-2 grid size-11 place-items-center rounded-full bg-black/55 text-white outline-none hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </button>
      )}
    </div>
  );
}

/** Copies the example's setup as a link (the owner pastes it into another Fuobe of theirs, or sends it on). */
async function copySetup(card: GenjutsuExampleCard) {
  const link = `${window.location.origin}/genjutsu?setup=${encodeSetup(card.load.recipe)}`;
  if (await copyText(link)) toast("Setup copied", { description: "Paste it in Genjutsu's Paste setup." });
  else toast.error("Couldn't copy — your browser blocked the clipboard");
}

export interface ModeExampleProps {
  card: GenjutsuExampleCard;
  /** The owner (or a studio of one's own): Use this example, the model's name, the seed, and Only you where it applies. */
  owner: boolean;
  /** Genjutsu runs here: Use this example and Copy its setup (a visitor gets the loop and how it was made only). */
  canUse: boolean;
  /** The form still holds this example's settings. */
  inUse: boolean;
  /** Some of its features are open only to the owner (the Only you mark). */
  onlyYou?: boolean;
  onUse: () => void;
  /** The mode's other examples: how many there are and which one shows (a number to pick each, when there are two or more). */
  pick?: { count: number; at: number; onPick: (i: number) => void };
  className?: string;
}

/** One button per example of the mode ("1", "2", "3"), the one in view pressed. */
function ExamplePicker({ pick }: { pick: NonNullable<ModeExampleProps["pick"]> }) {
  if (pick.count < 2) return null;
  return (
    <span role="group" aria-label="Examples" className="ml-auto flex items-center gap-1">
      {Array.from({ length: pick.count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Example ${i + 1} of ${pick.count}`}
          aria-pressed={i === pick.at}
          onClick={() => pick.onPick(i)}
          data-example-pick={i}
          className={cn(
            "relative inline-flex size-6 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums transition-colors before:absolute before:-inset-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            i === pick.at ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {i + 1}
        </button>
      ))}
    </span>
  );
}

/**
 * The example card, as wide as the page's column (640 px): the loop beside its title on a wide screen, above it on a
 * phone. What went in and the settings sit behind "How it was made" (on a phone the words too), so the upload box stays
 * close.
 */
export function ModeExample({ card, owner, canUse, inUse, onlyYou, onUse, pick, className }: ModeExampleProps) {
  const settings = exampleSettings(card.load.recipe, { owner });
  const titleId = `gj-example-${card.id.replace(/\W/g, "-")}`;
  const words = card.words && <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{card.words}</p>;
  return (
    <figure
      aria-labelledby={titleId}
      data-mode-example={card.id}
      className={cn(
        "mx-auto grid w-full max-w-[640px] grid-cols-1 overflow-hidden rounded-2xl border bg-background text-left shadow-soft md:grid-cols-[minmax(0,1fr)_248px]",
        inUse && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        className,
      )}
    >
      <Loop card={card} />
      <figcaption className="flex min-w-0 flex-col gap-3 p-4">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <span className="tracking-wider uppercase">Example</span>
            {onlyYou && <OnlyYou />}
            {pick && <ExamplePicker pick={pick} />}
          </p>
          <h3 id={titleId} className="mt-1 text-[16px] leading-snug font-semibold text-balance">
            {card.caption}
          </h3>
          {words && <div className="mt-1.5 hidden md:block">{words}</div>}
        </div>
        {canUse && (
          <div className="flex gap-2">
            <Button
              variant={inUse ? "outline" : "default"}
              className={cn("h-11 min-w-0 flex-1 rounded-full", inUse && "cursor-default text-foreground")}
              onClick={inUse ? undefined : onUse}
              aria-disabled={inUse || undefined}
              data-use-example=""
            >
              {inUse ? <Check className="size-4" /> : <Sparkles className="size-4" />}
              {inUse ? "In use" : "Use this example"}
            </Button>
            <Button variant="outline" className="size-11 shrink-0 rounded-full p-0" onClick={() => void copySetup(card)} aria-label="Copy its setup" title="Copy its setup">
              <Copy className="size-4" />
            </Button>
          </div>
        )}
        <details className="group -mt-1">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden>
              ›
            </span>
            How it was made
          </summary>
          <div className="space-y-3 pt-1 pb-1">
            {words && <div className="md:hidden">{words}</div>}
            <div>
              <p className="text-[12px] font-medium">What went in</p>
              <div className="mt-1.5 flex items-center gap-2">
                {card.inputs.map((i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i.slot}
                    src={i.media.thumb ?? i.media.src}
                    alt={i.label ?? ""}
                    loading="lazy"
                    decoding="async"
                    className={cn("h-12 shrink-0 rounded-md bg-muted object-cover", i.slot === "clip" ? "w-16" : "w-9")}
                  />
                ))}
                <span className="min-w-0 text-[13px] text-muted-foreground">{card.load.went}</span>
              </div>
            </div>
            <div>
              <p className="text-[12px] font-medium">Settings it used</p>
              <Settings items={settings} />
            </div>
          </div>
        </details>
      </figcaption>
    </figure>
  );
}

function Settings({ items }: { items: string[] }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Settings it used">
      {items.map((s) => (
        <li key={s} className="rounded-full border px-2 py-0.5 text-[12px] text-muted-foreground">
          {s}
        </li>
      ))}
    </ul>
  );
}

/** With a clip loaded: one line in the side panel, and the full card in a dialog. */
export function ModeExampleRow(props: ModeExampleProps) {
  const { card, inUse, onUse } = props;
  const [open, setOpen] = useState(false);
  const still = card.output.rest?.src ?? card.output.poster;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border p-2" data-mode-example-row={card.id}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {still && <img src={still} alt="" loading="lazy" decoding="async" className="h-12 w-16 shrink-0 rounded-md bg-muted object-cover" />}
      <p className="min-w-0 flex-1 text-[13px] leading-snug">
        <span className="text-muted-foreground">{inUse ? "Example in use: " : "Example: "}</span>
        {card.caption}
      </p>
      {!inUse && (
        <Button variant="outline" className="h-11 shrink-0 rounded-full px-4" onClick={() => setOpen(true)}>
          See it
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-[min(92vw,960px)]">
          <DialogHeader className="sr-only">
            <DialogTitle>{card.caption}</DialogTitle>
            <DialogDescription>An example of this mode, and the settings it used.</DialogDescription>
          </DialogHeader>
          <ModeExample
            {...props}
            className="rounded-none border-0 shadow-none"
            onUse={() => {
              setOpen(false);
              onUse();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
