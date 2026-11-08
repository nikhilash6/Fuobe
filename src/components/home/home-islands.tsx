"use client";

import { ArrowDown, ArrowRight, Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CardPending, IntentLink } from "@/components/intent-link";
import { useFadeEdges } from "@/components/use-fade-edges";
import { useRailStills } from "@/components/use-rail-stills";
import { PresetPreview, usePreviewPlayback } from "@/components/preset-preview";
import { CONNECT_GPU_EVENT, signInHref, useHydrated, useIsOwner, useStatus } from "@/lib/api";
import { placeOf } from "@/lib/place-name";
import { copyWithToast } from "@/lib/clipboard";
import type { PresetCardData } from "@/lib/preset-cards";
import type { AutoPlay } from "@/lib/preview-playback";
import { cn } from "@/lib/utils";

const FADE_ROW = "fade-x scrollbar-none max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4";

/** A row that scrolls sideways on a phone, its edges fading where there's more to see. */
export function FadeRow({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useFadeEdges<HTMLDivElement>();
  return (
    <div ref={ref} className={cn(FADE_ROW, className)}>
      {children}
    </div>
  );
}

/**
 * A row of cards: a grid from sm up, a rail that snaps on a phone, with the next card peeking at the edge. Every card's
 * still loads as the row nears the screen, so a card sliding in from the side is never blank (useRailStills).
 */
export function HomeRail({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useFadeEdges<HTMLDivElement>();
  useRailStills(ref);
  return (
    <div ref={ref} className={cn(FADE_ROW, "flex snap-x snap-mandatory scroll-px-4 sm:grid sm:[mask-image:none]", className)}>
      {children}
    </div>
  );
}

/** Home's first screen shows it too (home-bento.tsx); it lives on its own so the bar's menus share it. */
export { PausePreviews } from "@/components/pause-previews";

/** The self-host card's Copy button: the commands go to the clipboard, and the icon turns to a check for a moment. */
export function CopyCommand({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      onClick={async () => {
        if (!(await copyWithToast(text, "Commands copied"))) return;
        setDone(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex h-6 items-center gap-1.5 rounded-full bg-white/10 px-2.5 text-[12px] text-white/80 transition-colors hover:bg-white/15 hover:text-white"
    >
      {done ? <Check className="motion-confirm size-3" /> : <Copy className="size-3" />}
      <span key={done ? "done" : "copy"} className="motion-swap">
        {done ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

/**
 * A studio's card. `auto` "always" (Home's row): its clip plays by itself while it's in view, like the preset cards
 * above it, within the screen's few players. "touch" (an area page's grid): it plays by itself only where nothing can
 * hover; with a mouse it waits for one. A hover on a card resting on its peak starts where the change starts
 * (PresetPreview's `asked`). `zoom`: a still that slowly closes in on hover instead.
 */
export function StudioCard({
  href,
  label,
  line,
  card,
  zoom,
  place,
  sizes,
  auto = "touch",
}: {
  href: string;
  label: string;
  line: string;
  card: PresetCardData;
  zoom?: boolean;
  place?: number;
  sizes?: string;
  auto?: AutoPlay;
}) {
  const { ref, playing, asked, handlers } = usePreviewPlayback<HTMLAnchorElement>(card.id, card.preview, { auto });
  return (
    <IntentLink ref={ref} href={href} {...handlers} className="group/studio flex min-w-0 flex-col gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <StudioPicture zoom={zoom}>
        <PresetPreview preview={card.preview} hue={card.hue} playing={playing} asked={asked} place={place} sizes={sizes} />
      </StudioPicture>
      <StudioName label={label} line={line} />
    </IntentLink>
  );
}

export function StudioPicture({ zoom, className, children }: { zoom?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("relative isolate aspect-[4/3] overflow-hidden rounded-lg bg-muted", className)}>
      <div
        className={cn(
          "absolute inset-0 ease-out motion-safe:transition-transform",
          zoom ? "motion-safe:duration-[1200ms] motion-safe:group-hover/studio:scale-[1.06]" : "motion-safe:duration-[400ms] motion-safe:group-hover/studio:scale-[1.03]",
        )}
      >
        {children}
      </div>
      <CardPending />
    </div>
  );
}

/** A studio card's name, the arrow following its last word wherever the name wraps, and its line. */
export function StudioName({ label, line }: { label: string; line: string }) {
  const cut = label.lastIndexOf(" ") + 1;
  return (
    <div className="min-w-0 px-0.5">
      <p className="text-[14px] font-medium">
        {label.slice(0, cut)}
        <span className="whitespace-nowrap">
          {label.slice(cut)}
          <ArrowRight
            aria-hidden
            className="ml-1.5 inline-block size-3.5 align-[-2px] text-muted-foreground transition-transform duration-150 group-hover/studio:translate-x-0.5 group-hover/studio:text-foreground"
          />
        </span>
      </p>
      <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{line}</p>
    </div>
  );
}

/** Over Assist's heading, for everyone but the studio's owner: here, Assist is the owner's (AssistSection). */
export function AssistTag() {
  if (useIsOwner()) return null;
  return <p className="mb-2 inline-flex h-6 items-center rounded-full bg-brand-faint px-2.5 text-[12px] font-medium text-brand-text">On your own Fuobe</p>;
}

const ASSIST_ACTION =
  "group mt-5 inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground transition hover:opacity-90";

/** The owner opens Assist; anyone else is shown how to run Fuobe themselves (the self-host card, StartSection). */
export function AssistAction() {
  const arrow = <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />;
  return useIsOwner() ? (
    <IntentLink href="/chat/make" className={ASSIST_ACTION}>
      Open Assist {arrow}
    </IntentLink>
  ) : (
    <a href="#home-start" className={ASSIST_ACTION}>
      Run your own Fuobe {arrow}
    </a>
  );
}

/**
 * What to ask Assist, and the skills it starts from: for the owner, each opens Assist with it typed in (nothing is
 * sent); for anyone else, examples of what it does. Both keep the same size, so nothing moves when the viewer is known.
 */
export function AssistExamples({ prompts, skills }: { prompts: string[]; skills: { name: string; title: string }[] }) {
  const owner = useIsOwner();
  const row = "flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-2.5 text-[13px]";
  const chip = "inline-flex h-8 items-center rounded-full border px-3 text-[13px]";
  return (
    <div className="min-w-0">
      <h3 className="mb-2 font-sans text-[12px] text-muted-foreground">{owner ? "Try asking" : "Ask it things like"}</h3>
      <ul className="space-y-1.5">
        {prompts.map((s) => (
          <li key={s}>
            {owner ? (
              <IntentLink href={`/chat/make?prompt=${encodeURIComponent(s)}`} className={cn(row, "group transition-colors hover:bg-muted")}>
                <span className="min-w-0">{s}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-[3px] group-hover:text-foreground" />
              </IntentLink>
            ) : (
              <p className={row}>
                <span className="min-w-0">“{s}”</span>
              </p>
            )}
          </li>
        ))}
      </ul>
      <h3 className="mt-5 mb-2 font-sans text-[12px] text-muted-foreground">{owner ? "Or start with a skill" : "Skills it starts from"}</h3>
      <FadeRow>
        <ul className="flex gap-1.5 max-sm:w-max sm:flex-wrap">
          {skills.map((s) => (
            <li key={s.name}>
              {owner ? (
                <IntentLink href={`/chat/make?skill=${s.name}`} className={cn(chip, "transition-colors hover:bg-accent")}>
                  {s.title}
                </IntentLink>
              ) : (
                <span className={cn(chip, "border-transparent bg-muted/60")}>{s.title}</span>
              )}
            </li>
          ))}
        </ul>
      </FadeRow>
    </div>
  );
}

/**
 * The three steps to start, for who's looking: a guest signs up, an account connects its GPU, the owner of their own
 * install connects ComfyUI or adds a key. Until the status comes, a guest's (as the composer's line); every step
 * keeps its height, so nothing moves when it changes.
 */
export function StartSteps() {
  const hydrated = useHydrated();
  const data = useStatus().data;
  const status = hydrated ? data : undefined;
  const viewer = status?.viewer;
  const owner = !!status && !viewer;
  // Hosted runs: runs need nothing set up, so the third step is to make something (a GPU of one's own is optional).
  const place = viewer?.hosted ? placeOf(viewer.placeName) : null;
  const link = "inline-flex items-center gap-1 text-[13px] font-medium text-brand-text hover:underline underline-offset-2";
  const done = (text: string) => (
    <span className="inline-flex items-center gap-1 text-[13px] font-medium text-foreground">
      <Check className="size-3.5 text-brand-text" /> {text}
    </span>
  );
  const steps: { title: string; text: string; action: React.ReactNode }[] = [
    {
      title: "Look around.",
      text: "Open every studio, preset and model, no account needed.",
      action: (
        <IntentLink href="/effects" className={link}>
          Browse effects <ArrowRight className="size-3.5" />
        </IntentLink>
      ),
    },
    {
      title: "Sign up free.",
      text: place ? `Runs on ${place.text}, or on your own GPU.` : "A free account runs every open model on your own GPU.",
      action:
        viewer?.kind === "account" ? (
          done("You’re signed in")
        ) : owner ? (
          <IntentLink href="/settings#get-started" className={link}>
            Connect ComfyUI or add a key <ArrowRight className="size-3.5" />
          </IntentLink>
        ) : (
          <a href={signInHref("signup")} className={link}>
            Sign up free <ArrowRight className="size-3.5" />
          </a>
        ),
    },
    place
      ? {
          title: "Make something.",
          text: "Pick a studio and press Generate. Your own GPU or key is optional.",
          action: (
            <IntentLink href="/video" className={link}>
              Open the Video studio <ArrowRight className="size-3.5" />
            </IntentLink>
          ),
        }
      : {
          title: "Connect your ComfyUI.",
          text: "Use the ComfyUI on your computer, or one you reach by link. Fuobe shows you everything it can run.",
          action: viewer?.gpu.connected ? (
            done("Your GPU is connected")
          ) : viewer?.kind === "account" ? (
            <button type="button" onClick={() => window.dispatchEvent(new Event(CONNECT_GPU_EVENT))} className={link}>
              Connect your GPU <ArrowRight className="size-3.5" />
            </button>
          ) : (
            <IntentLink href="/connect" className={link}>
              Connect your GPU <ArrowRight className="size-3.5" />
            </IntentLink>
          ),
        },
  ];
  return (
    <ol className="space-y-5">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-faint text-[12px] font-semibold text-brand-text tabular-nums">{i + 1}</span>
          <div className="min-h-[68px] min-w-0">
            <p className="text-[15px] font-medium">{s.title}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{s.text}</p>
            <div className="mt-1.5 flex h-5 items-center">{s.action}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Where the cue leads: the composer under the first screen (home-view.tsx). */
export const START_CREATING_ID = "start-creating";

/**
 * The first screen's way down to the composer. From md it is a button in the middle of the screen's foot row. While
 * that row is under the fold (a phone, a short laptop screen) a copy of it floats over the bottom of the screen, above
 * the phone's tabs, until the page is scrolled. A tap scrolls to the composer; with a mouse or trackpad the prompt box
 * also takes the cursor (a phone keeps its keyboard closed).
 */
export function ScrollCue({ footId }: { footId: string }) {
  const [float, setFloat] = useState(false);
  useEffect(() => {
    const foot = document.getElementById(footId);
    if (!foot) return;
    let below = false;
    let scrolled = window.scrollY > 120;
    let ready = false;
    const update = () => setFloat(ready && below && !scrolled);
    // Floats until the whole foot row is on the screen: a sliver of it at the bottom edge is easy to miss.
    const io = new IntersectionObserver(
      ([e]) => {
        below = e.intersectionRatio < 0.98 && e.boundingClientRect.top > 0;
        update();
      },
      { threshold: [0, 0.98] },
    );
    io.observe(foot);
    const onScroll = () => {
      if (window.scrollY <= 120) return;
      scrolled = true;
      update();
      window.removeEventListener("scroll", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // After the headline has risen into place, so the two don't move at once.
    const t = window.setTimeout(() => {
      ready = true;
      update();
    }, 1200);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(t);
    };
  }, [footId]);

  const go = () => {
    const box = document.getElementById(START_CREATING_ID);
    if (!box) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
    if (window.matchMedia("(pointer: fine)").matches) box.querySelector("textarea")?.focus({ preventScroll: true });
    setFloat(false);
  };

  const label = (
    <>
      Start creating
      <ArrowDown aria-hidden className="hb-cue-arrow size-3.5" />
    </>
  );
  return (
    <>
      <button type="button" onClick={go} className="hb-cue max-md:hidden">
        {label}
      </button>
      {/* The floating copy repeats the button above for pointers only: keyboards and screen readers reach that one. */}
      <button type="button" onClick={go} aria-hidden tabIndex={-1} data-shown={float || undefined} className="hb-cue hb-cue-float">
        {label}
      </button>
    </>
  );
}
