"use client";

import { Check, Copy, Pause, Play, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { copyText } from "@/lib/clipboard";
import { encodeSetup, getMaker } from "@/lib/catalog/genjutsu";
import type { GenjutsuExampleCard } from "@/lib/examples/genjutsu";
import { cn } from "@/lib/utils";
import { OnlyYou } from "./openjutsu-panels";

/**
 * A Genjutsu mode's example, under the mode's title: one muted before → after loop (the clip that went in, then what
 * came out), what went in, the settings it used, and "Use this example", which puts those settings into the form and
 * keeps the viewer's own clip and photos. Visitors, who can't run Genjutsu here, copy its setup instead.
 *
 * Loading: a still in a fixed 4:3 box first (nothing moves when the clip arrives). The clip downloads only once the
 * card is at least half in view, and not at all with Save-Data or reduced motion (then the finished result shows as a
 * still with a Play button). Leaving the mode drops the download. No analytics of any kind.
 */

/** Where the clip that went in sits in an inset loop (clip-show: 308×230 at 24 px from the corner of 1024×768). */
const INSET = { left: `${(24 / 1024) * 100}%`, top: `${((768 - 24 - 230) / 768) * 100}%` };
/** The wipe's line reaches the middle at 1.7 s: before that the frame is mostly the clip that went in. */
const WIPE_MIDDLE = 1.7;

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
  // null: plays by itself when it can; true / false: the viewer pressed Pause or Play.
  const [chosen, setChosen] = useState<boolean | null>(null);
  // Reduced motion or Save-Data: the finished result as a still, and the clip only on Play (false while the page hydrates).
  const still = useSyncExternalStore(watchStill, () => reducedMotion() || saveData(), () => false);
  const [late, setLate] = useState(false);
  const out = card.output;
  const rest = out.rest?.src;

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: "200px 0px", threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const wanted = chosen ?? (!still && inView);
  // The clip is fetched once it is first wanted, and kept while the mode stays (a scroll back plays at once).
  const [loaded, setLoaded] = useState(false);
  if (wanted && !loaded) setLoaded(true);

  useEffect(() => {
    const v = video.current;
    if (!v || !loaded) return;
    const hidden = () => document.visibilityState === "hidden";
    const sync = () => {
      if (wanted && inView && !hidden()) void v.play().catch(() => {});
      else v.pause();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [loaded, wanted, inView]);

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

  // The wipe's single label follows the line: "Before" until the result has most of the frame.
  useEffect(() => {
    const v = video.current;
    if (!v || !loaded || card.load.layout !== "wipe") return;
    const tick = () => setLate(v.currentTime >= WIPE_MIDDLE);
    v.addEventListener("timeupdate", tick);
    return () => v.removeEventListener("timeupdate", tick);
  }, [loaded, card.load.layout]);

  const playing = loaded && wanted;
  // Before the clip: the reduced-motion still is the finished result; otherwise the loop's first frame.
  const poster = still && rest ? rest : (out.poster ?? rest);
  const showsResult = still && !loaded ? true : late;
  return (
    <div ref={box} className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {poster && <img src={poster} alt="" decoding="async" fetchPriority="low" className="absolute inset-0 size-full object-cover" draggable={false} />}
      {loaded && (
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
        />
      )}
      {card.load.layout === "inset" ? (
        <>
          <Pill className="top-2 right-2">After</Pill>
          <Pill style={{ left: `calc(${INSET.left} + 6px)`, top: `calc(${INSET.top} + 6px)` }} className="bg-black/60 text-[11px]">
            Before
          </Pill>
        </>
      ) : (
        <Pill className="top-2 left-2">{showsResult ? "After" : "Before"}</Pill>
      )}
      <button
        type="button"
        onClick={() => setChosen(!playing)}
        aria-label={playing ? "Pause the example" : "Play the example"}
        className="absolute right-2 bottom-2 grid size-11 place-items-center rounded-full bg-black/55 text-white outline-none hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white"
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </button>
    </div>
  );
}

/** Copies the example's setup as a link (a visitor pastes it into Genjutsu on their own Fuobe). */
async function copySetup(card: GenjutsuExampleCard) {
  const link = `${window.location.origin}/genjutsu?setup=${encodeSetup(card.load.recipe)}`;
  if (await copyText(link)) toast("Setup copied", { description: "Paste it in Genjutsu on your own Fuobe." });
  else toast.error("Couldn't copy — your browser blocked the clipboard");
}

export interface ModeExampleProps {
  card: GenjutsuExampleCard;
  /** The owner (or a studio of one's own): Use this example, the model's name, and Only you where it applies. */
  owner: boolean;
  /** Genjutsu runs here: Use this example (else Copy its setup only). */
  canUse: boolean;
  /** The form still holds this example's settings. */
  inUse: boolean;
  /** Some of its features are open only to the owner (the Only you mark). */
  onlyYou?: boolean;
  onUse: () => void;
  className?: string;
}

/** The example card: the loop on the left (on top on a phone), what it is and what it used beside it. */
export function ModeExample({ card, owner, canUse, inUse, onlyYou, onUse, className }: ModeExampleProps) {
  const r = card.load.recipe;
  const model = owner ? getMaker(r.model, r.engine)?.label : undefined;
  const settings = [...(model ? [model] : []), ...(card.chips ?? [])];
  const titleId = `gj-example-${card.id.replace(/\W/g, "-")}`;
  return (
    <figure
      aria-labelledby={titleId}
      data-mode-example={card.id}
      className={cn(
        "mx-auto grid w-full max-w-[960px] grid-cols-1 overflow-hidden rounded-2xl border bg-background text-left shadow-soft md:grid-cols-[minmax(0,1fr)_352px]",
        inUse && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        className,
      )}
    >
      <Loop card={card} />
      <figcaption className="flex min-w-0 flex-col gap-3 p-4 md:p-5">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <span className="tracking-wider uppercase">Example</span>
            {onlyYou && <OnlyYou />}
          </p>
          <h3 id={titleId} className="mt-1 text-[16px] leading-snug font-semibold text-balance">
            {card.caption}
          </h3>
          {card.words && <p className="mt-1.5 text-[13px] leading-relaxed text-pretty text-muted-foreground">{card.words}</p>}
        </div>
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
        {/* The settings: open beside the loop on a wide screen, behind a tap on a phone. */}
        <div className="hidden md:block">
          <p className="text-[12px] font-medium">Settings it used</p>
          <Settings items={settings} />
        </div>
        <details className="group md:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
              ›
            </span>
            Settings it used
          </summary>
          <Settings items={settings} />
        </details>
        {/* One 44 px row for every viewer: the card keeps its height when the owner's page switches at hydration. */}
        <div className="mt-auto flex gap-2 pt-1">
          {canUse ? (
            <>
              <Button className="h-11 min-w-0 flex-1 rounded-full" onClick={onUse} disabled={inUse} data-use-example="">
                {inUse ? <Check className="size-4" /> : <Sparkles className="size-4" />}
                {inUse ? "In use" : "Use this example"}
              </Button>
              <Button variant="outline" className="size-11 shrink-0 rounded-full p-0" onClick={() => void copySetup(card)} aria-label="Copy its setup" title="Copy its setup">
                <Copy className="size-4" />
              </Button>
            </>
          ) : (
            <Button variant="outline" className="h-11 w-full rounded-full" onClick={() => void copySetup(card)}>
              <Copy className="size-4" /> Copy its setup
            </Button>
          )}
        </div>
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
