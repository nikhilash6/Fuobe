"use client";

import { ArrowRight, LayoutGrid, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CardPending, IntentLink } from "@/components/intent-link";
import { CoverThumb } from "@/components/nav/cover-thumb";
import { useViewerKind } from "@/components/nav/nav-ui";
import { area } from "@/lib/nav-areas";
import { NAV_ICONS } from "@/lib/nav-icons";
import { GOALS, goalBand, isNew, tapHref, type GoalId, type NavEntry, type ViewerKind } from "@/lib/nav-model";
import { cn } from "@/lib/utils";
import { onAttr, TAB_PILL, TabRow } from "@/components/ui/tab-row";
import { GOAL_STRIP } from "./goal-tab";

/**
 * Home's goal row: six goals under the hero, each a button that opens a band of that goal's studios, one-tap presets
 * and finishing tools right under the row (in the page's flow, so only what is below it moves). One band at a time;
 * closed on load, so the first paint never changes.
 */

/** The goal a roving key moves the focus to from `i` of `n` (wrapping at the ends), or null for any other key. */
export function rovingTarget(key: string, i: number, n: number): number | null {
  if (n <= 0) return null;
  switch (key) {
    case "ArrowRight":
      return (i + 1) % n;
    case "ArrowLeft":
      return (i - 1 + n) % n;
    case "Home":
      return 0;
    case "End":
      return n - 1;
    default:
      return null;
  }
}

/** What "Plan it with Assist" types into a new chat for a goal that offers it (the owner's: Assist is the owner's). */
export const GOAL_ASSIST_PROMPTS: Partial<Record<GoalId, string>> = {
  film: "Plan a 30-second short film: a 6-frame storyboard of a night heist in Paris, then a camera move and sound for every shot",
  social: "Plan five vertical reels for a fashion label: a hook in the first second, a model on a rooftop at golden hour, music on every cut",
  sell: "Plan a 3-shot ad for a matte black perfume bottle: a hero still, a macro detail, then animate both with a slow push in",
};

/** The Assist link for a goal, or undefined when it has none. */
export function goalAssistHref(id: GoalId): string | undefined {
  const prompt = GOAL_ASSIST_PROMPTS[id];
  return prompt ? `/assist?prompt=${encodeURIComponent(prompt)}` : undefined;
}

/**
 * Marks a sideways rail's ends (.fade-x in globals.css fades an end while there is more past it), as the galleries'
 * category strip does; kept here so the goal row doesn't pull the gallery's module into its own.
 */
function useFadeEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.toggleAttribute("data-fade-start", el.scrollLeft > 2);
      el.toggleAttribute("data-fade-end", el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return ref;
}

const LABEL = "text-[11px] font-semibold tracking-[0.08em] text-brand-text uppercase";
/** The band's links and buttons take the nav's states (nav-states.css): highlight, keyboard ring, pressed. */
const FOCUS = "nav-row";

function NewBadge() {
  return <span className="ml-1.5 inline-block rounded-full bg-highlight px-1.5 align-[2px] text-[10px] leading-4 font-semibold text-highlight-foreground">New</span>;
}

/** A studio (or tool) as a 4:3 cover card. */
function GoalCard({ e }: { e: NavEntry }) {
  return (
    <IntentLink
      href={e.href}
      className={cn(
        "group/card flex h-full flex-col overflow-hidden rounded-[14px] border bg-card nav-hover:border-border-strong",
        FOCUS,
      )}
    >
      <span className="block overflow-hidden">
        <CoverThumb
          id={e.cover}
          size="card"
          icon={e.icon}
          className="rounded-none ease-out motion-safe:transition-transform motion-safe:duration-[400ms] motion-safe:group-hover/card:scale-[1.03]"
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 px-3 pt-2.5 pb-3 lg:px-3.5 lg:pt-3 lg:pb-3.5">
        {/* Whole names, wrapping where five cards share a narrow band. */}
        <span className="text-[14.5px] leading-snug font-semibold md:max-lg:text-[13.5px]">
          {e.label}
          {isNew(e) && <NewBadge />}
        </span>
        <span className="text-[12px] leading-snug text-muted-foreground">{e.what}</span>
      </span>
      <CardPending />
    </IntentLink>
  );
}

/**
 * One goal's band: its title and line, its studios as cover cards, its one-tap presets and its finishing tools.
 * `names` are the presets' names (from the catalog, read on the server); `kind` decides what the viewer sees.
 */
export function GoalBand({ id, kind, names, onClose }: { id: GoalId; kind: ViewerKind | undefined; names: Readonly<Record<string, string>>; onClose: () => void }) {
  const { goal, cards, finish } = goalBand(id, kind);
  const assist = kind === "owner" && goal.assist ? goalAssistHref(goal.id) : undefined;
  const cardRail = useFadeEdges<HTMLUListElement>();
  const tapRail = useFadeEdges<HTMLUListElement>();
  return (
    <section
      id="goal-band"
      aria-labelledby="goal-band-title"
      className={cn(
        "flex flex-col gap-5 border-b bg-popover px-4 pt-5 pb-6 text-popover-foreground max-sm:-mx-4",
        // 16 px in, its 1 px border included: the band's words sit on the goal tabs' icon column above.
        "sm:rounded-b-[18px] sm:border-x sm:px-[15px] sm:pt-6 sm:pb-7 sm:shadow-soft",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <div className="col-start-1 row-start-1 flex min-w-0 flex-col gap-1.5">
          <h2 id="goal-band-title" className="font-heading text-[28px] leading-none sm:text-[34px]">
            {goal.title}
          </h2>
          <p className="text-[13px] text-pretty text-muted-foreground">{goal.line}</p>
        </div>
        {assist && (
          <IntentLink
            href={assist}
            className={cn(
              "col-span-2 row-start-2 inline-flex h-11 items-center gap-2 justify-self-start rounded-full border bg-card pr-4 pl-3.5 text-[13.5px] font-medium sm:h-10 pointer-coarse:h-11",
              "sm:col-span-1 sm:col-start-2 sm:row-start-1",
              FOCUS,
            )}
          >
            <Sparkles aria-hidden className="size-[15px] text-brand-text" />
            Plan it with Assist
          </IntentLink>
        )}
        <button
          type="button"
          aria-label={`Close ${goal.title}`}
          onClick={onClose}
          className={cn(
            "col-start-2 row-start-1 grid size-11 place-items-center rounded-xl border bg-card sm:col-start-3 sm:size-10 pointer-coarse:size-11",
            FOCUS,
          )}
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        <h3 className={LABEL}>{goal.cardsLabel}</h3>
        {/* A phone's cards are one rail that scrolls sideways inside the band; wider, one row of five. */}
        <ul
          ref={cardRail}
          role="list"
          className={cn(
            "fade-x scrollbar-none -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 sm:-mx-6 sm:scroll-px-6 sm:px-6",
            "md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0 md:[mask-image:none] lg:gap-4",
          )}
        >
          {cards.map((e) => (
            <li key={e.id} className="w-40 shrink-0 snap-start md:w-auto">
              <GoalCard e={e} />
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-2.5">
          <h3 className={LABEL}>{goal.tapLabel}</h3>
          <ul
            ref={tapRail}
            role="list"
            className="fade-x scrollbar-none -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:[mask-image:none]"
          >
            {goal.taps.map((t) => (
              <li key={t.preset} className="w-[220px] shrink-0 snap-start sm:w-auto">
                <IntentLink
                  href={tapHref(t.preset)}
                  className={cn(
                    "flex h-[60px] min-w-0 items-center gap-2.5 rounded-xl border bg-card py-2 pr-3 pl-2",
                    FOCUS,
                  )}
                >
                  <CoverThumb id={t.preset} size="chip" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13.5px] leading-snug font-semibold">{names[t.preset] ?? t.preset}</span>
                    <span className="truncate text-[11.5px] leading-snug text-muted-foreground">{t.kind}</span>
                  </span>
                  <CardPending />
                </IntentLink>
              </li>
            ))}
          </ul>
        </div>
        {finish.length > 0 && (
          <div className="flex min-w-0 flex-col gap-2.5">
            <h3 className={LABEL}>{goal.finishLabel}</h3>
            <ul role="list" className="flex flex-col gap-2">
              {finish.map((e) => (
                <li key={e.id}>
                  <IntentLink
                    href={e.href}
                    className={cn(
                      "group/finish flex h-11 min-w-0 items-center gap-3 rounded-xl border bg-card px-3.5",
                      FOCUS,
                    )}
                  >
                    <span className="shrink-0 text-[13.5px] font-semibold">{e.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{e.what}</span>
                    <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover/finish:translate-x-0.5" />
                  </IntentLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The row and the open goal's band. Arrow keys (and Home / End) move between the goals, Enter or Space opens one and
 * opens or closes its band, Esc anywhere in the band closes it and puts the focus back on its goal.
 */
export function GoalRow({ names }: { names: Readonly<Record<string, string>> }) {
  const kind = useViewerKind();
  const [open, setOpen] = useState<GoalId | null>(null);
  // The goal that holds the row's one tab stop (the last one focused or opened).
  const [stop, setStop] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  /** Scrolls the row (only the row, never the page) so a goal that sits past its edge comes fully into view. */
  const reveal = (b: HTMLElement) => {
    const s = scroller.current;
    if (!s || s.scrollWidth <= s.clientWidth) return;
    const left = b.offsetLeft - 16;
    const right = b.offsetLeft + b.offsetWidth + 16 - s.clientWidth;
    const to = left < s.scrollLeft ? left : right > s.scrollLeft ? right : null;
    if (to === null) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    s.scrollTo({ left: Math.max(0, to), behavior: still ? "auto" : "smooth" });
  };

  const close = () => {
    const i = GOALS.findIndex((g) => g.id === open);
    setOpen(null);
    if (i >= 0) buttons.current[i]?.focus();
  };

  const onRowKey = (e: React.KeyboardEvent) => {
    const i = buttons.current.findIndex((b) => b === e.target);
    if (i < 0) return;
    const next = rovingTarget(e.key, i, GOALS.length);
    if (next === null) return;
    e.preventDefault();
    setStop(next);
    buttons.current[next]?.focus();
  };

  return (
    <div
      data-goal-row
      className="mt-6 sm:mt-8"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open || e.defaultPrevented) return;
        e.preventDefault();
        close();
      }}
    >
      <div className={GOAL_STRIP}>
        {/* A phone scrolls the goals sideways inside the row, never the page. */}
        <TabRow ref={scroller} role="toolbar" aria-label="Start from a goal" onKeyDown={onRowKey} className="flex-1 max-sm:mx-0 max-sm:px-4">
          {GOALS.map((g, i) => {
            const on = open === g.id;
            const Icon = NAV_ICONS[g.icon as keyof typeof NAV_ICONS] ?? LayoutGrid;
            return (
              <button
                key={g.id}
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                type="button"
                tabIndex={i === stop ? 0 : -1}
                aria-expanded={on}
                aria-controls="goal-band"
                data-goal={g.id}
                data-open={on || undefined}
                onFocus={() => setStop(i)}
                onClick={(e) => {
                  setStop(i);
                  setOpen(on ? null : g.id);
                  if (!on) reveal(e.currentTarget);
                }}
                className={TAB_PILL}
                {...onAttr(on)}
              >
                <Icon aria-hidden />
                {g.label}
              </button>
            );
          })}
        </TabRow>
        {/* Every studio and tool on one page, with covers (the bar's Studios menu is the quick way). */}
        <IntentLink
          href={area("studios").href}
          className={cn(
            "flex shrink-0 items-center justify-center gap-2 self-center rounded-full text-[13.5px] font-medium text-brand-text",
            // Its words from xl; narrower, its icon (with the words for screen readers) leaves the goals the room.
            "ml-1 size-11 max-sm:mr-3 xl:ml-2 xl:h-9 xl:w-auto xl:px-3.5",
            FOCUS,
          )}
        >
          <LayoutGrid aria-hidden className="size-[15px]" />
          <span className="max-xl:sr-only">All studios and tools</span>
        </IntentLink>
      </div>
      {open && <GoalBand key={open} id={open} kind={kind} names={names} onClose={close} />}
    </div>
  );
}
