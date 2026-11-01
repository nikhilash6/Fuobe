"use client";

import Link from "next/link";
import { ArrowRight, CircleAlert, ImageIcon, Loader2, MessageCircle, Video, Wand2, Zap } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { GetStarted } from "@/components/get-started";
import { usePagePlace } from "@/components/gpu/use-page-place";
import { GitHubMark } from "@/components/github-mark";
import { PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { HadItemsScript, useHadItems } from "@/components/use-had-items";
import { IntentLink } from "@/components/intent-link";
import { useFadeEdges } from "@/components/preset-gallery";
import { MediaThumb } from "@/components/studio/result-media";
import { CONNECT_GPU_EVENT, signInHref, useEngine, useGenerations, useHydrated, useIsOwner, useStatus } from "@/lib/api";
import { EngineSwitch } from "@/components/studio/engine-switch";
import type { Generation } from "@/lib/catalog/types";
import { issueStartToken, START_PARAM } from "@/lib/composer";
import { FIRST_RUN_KEY, FIRST_RUN_SCRIPT, FUOBE_REPO, nothingConnected as noConnection, showFirstRun, startLine, type StartQuote } from "@/lib/connections";
import { placeholdersOn } from "@/lib/demo-mode";
import { userTitle } from "@/lib/library";
import { NEW_CREATION_PARAM } from "@/lib/nav";
import { cn } from "@/lib/utils";

// The viewer is only needed once a recent result is opened.
const Viewer = lazy(() => import("@/components/studio/viewer").then((m) => ({ default: m.Viewer })));

const MODES = [
  { id: "image", label: "Image", icon: ImageIcon, href: "/image", placeholder: "Describe an image…" },
  { id: "video", label: "Video", icon: Video, href: "/video", placeholder: "Describe a shot…" },
  { id: "edit", label: "Edit", icon: Wand2, href: "/edit", placeholder: "Describe a change (you'll add the image next)…" },
  { id: "live", label: "Live", icon: Zap, href: "/live-edit", placeholder: "Type a change, then open Live edit…" },
];

/** A Try chip under the composer: it picks the mode and fills in the prompt; Start still runs it. */
export interface TryChip {
  mode: "image" | "video" | "edit";
  label: string;
  prompt: string;
}

/** The latest results as a compact strip of square thumbnails; a tap opens the viewer. */
function RecentStrip({ items }: { items: Generation[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const viewable = items.filter((g) => g.status === "succeeded" && g.outputs[0]);
  const pos = viewable.findIndex((g) => g.id === open);
  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {items.map((g) => {
          const title = userTitle(g);
          const ok = g.status === "succeeded" && g.outputs[0];
          const failed = g.status === "failed" || g.status === "canceled";
          return (
            <li key={g.id} className="min-w-0">
              {ok ? (
                <button
                  type="button"
                  onClick={() => setOpen(g.id)}
                  title={title}
                  aria-label={`Open “${title}”`}
                  className="relative block aspect-square w-full cursor-zoom-in overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MediaThumb output={g.outputs[0]} g={g} />
                </button>
              ) : (
                <Link
                  href="/library"
                  title={title}
                  aria-label={`${failed ? "Failed" : "Rendering"}: “${title}” — open the Library`}
                  className="grid aspect-square w-full place-items-center rounded-xl border border-dashed bg-muted/40 text-muted-foreground"
                >
                  {failed ? <CircleAlert className="size-5" /> : <Loader2 className="size-5 animate-spin" />}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {pos >= 0 && (
        <Suspense fallback={null}>
          <Viewer
            generation={viewable[pos]}
            index={0}
            onClose={() => setOpen(null)}
            onPrev={pos > 0 ? () => setOpen(viewable[pos - 1].id) : undefined}
            onNext={pos < viewable.length - 1 ? () => setOpen(viewable[pos + 1].id) : undefined}
          />
        </Suspense>
      )}
    </>
  );
}

function Row({ title, href, children, className }: { title: string; href: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-[24px]">{title}</h2>
        <Link href={href} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          See all <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {children}
    </section>
  );
}

/**
 * Runs while the HTML is parsed, ahead of the guide: hides the shell's guide before the first paint
 * in a browser that already put it away. On the client it renders as inert text/plain (React warns
 * about executable scripts it renders itself), like the sidebar's state script.
 */
function FirstRunScript() {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: FIRST_RUN_SCRIPT }} />;
}

/**
 * "New creation" (the sidebar, ⌘K) opens Home with ?new=1: the composer starts empty and takes the
 * focus, and the flag leaves the address. It reads the URL, so it sits under Suspense.
 */
function NewCreation({ onNew }: { onNew: () => void }) {
  const router = useRouter();
  const fresh = useSearchParams().has(NEW_CREATION_PARAM);
  useEffect(() => {
    if (!fresh) return;
    onNew();
    router.replace("/", { scroll: false });
  }, [fresh, onNew, router]);
  return null;
}

/**
 * Home: what Fuobe is, the composer, a few prompts to try, then the wall of real covers (`wall`) right under them.
 * The sections below (`children`) are rendered on the server, so their words and pictures ship no script.
 */
export function HomeView({
  openModels,
  chips,
  assist,
  wall,
  children,
  prices,
  quotes,
}: {
  /** "120+": the open models and tools a visitor runs on their own GPU (modelCounts().open, rounded down). */
  openModels: string;
  chips: readonly TryChip[];
  /** The chip that opens Assist with a job typed in: the owner's, in place of the last Try chip. */
  assist: { label: string; href: string };
  wall: React.ReactNode;
  children: React.ReactNode;
  /** What a first paid image and clip cost, for the first-run guide. */
  prices?: string;
  /** What Start runs in each mode, and its price on the paid engine. */
  quotes?: Record<string, StartQuote>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(MODES[0]);
  const [prompt, setPrompt] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // Bumped by a Try chip: the composer's ring brightens once.
  const [flash, setFlash] = useState(0);
  const chipRow = useFadeEdges<HTMLDivElement>();
  const [engine, setEngine, engineMode] = useEngine();
  const recent = useGenerations({ limit: 6 });
  // How many (up to 6): a phone's grid holds 3 a row, so 1 to 3 results are one row of skeletons, 4 to 6 two.
  useHadItems("home-recent", recent.data?.length, 6);
  // The page hydrates inside the route's Suspense boundary, possibly after the sidebar already fetched
  // the status: render the server's (status-less) view until hydrated, as useEngineMode does.
  const hydrated = useHydrated();
  const statusData = useStatus().data;
  const status = hydrated ? statusData : undefined;
  const nothingConnected = !!status && noConnection(status);
  // A hosted studio: the owner's GPU is connected from here (the dialog), not by an address in Settings.
  const hostedPage = usePagePlace() === "hosted";
  // Until something is connected (or it's put away): three ways to start, under the composer. The
  // static shell (no status yet) shows it only in a browser where it showed last time
  // (FirstRunScript), so a visitor to a public studio, who never gets it, doesn't see it come and go.
  const firstRun = showFirstRun(status);
  const guide = !status || firstRun;
  // A guest or an account (public sign-up) runs open-source models on its own GPU, whatever the install's engines.
  const visitor = status?.viewer;
  // Only the studio's owner can use Assist: its chip takes the last Try chip's place once the owner is known.
  const owner = useIsOwner();
  // A Try chip's prompt fills two lines on a phone and scrolls past that, so the chips and the wall under the
  // composer stay where the thumb is; typing lets it grow again.
  const [chipFilled, setChipFilled] = useState(false);
  useEffect(() => {
    if (!status) return;
    try {
      localStorage.setItem(FIRST_RUN_KEY, firstRun ? "1" : "0");
    } catch {}
    document.documentElement.setAttribute("data-first-run", firstRun ? "1" : "0");
  }, [status, firstRun]);
  // The sections under the fold skip layout for the first paint only (.home-cv in globals.css). Once the page is
  // idle they're laid out one at a time, each when the page is idle again, so no one task holds the page up, and a
  // jump to one, or a picture of the whole page, finds every one of them drawn.
  useEffect(() => {
    const left = [...document.querySelectorAll<HTMLElement>(".home-cv:not([data-laid-out])")];
    const ric = typeof requestIdleCallback === "function";
    let id = 0;
    const next = () => {
      left.shift()?.setAttribute("data-laid-out", "");
      if (left.length) id = ric ? requestIdleCallback(next, { timeout: 4000 }) : window.setTimeout(next, 300);
    };
    id = ric ? requestIdleCallback(next, { timeout: 4000 }) : window.setTimeout(next, 1500);
    return () => (ric ? cancelIdleCallback(id) : clearTimeout(id));
  }, []);

  // With a prompt, the studio starts the run itself, or points at the photo it still needs. `go`
  // carries a one-time token from this tab, so only this button can start a run that way.
  const go = () => {
    const p = prompt.trim();
    // Live edit renders as you type there: the words go along, nothing starts by itself.
    if (mode.id === "live") return router.push(`/live-edit?from=home${p ? `&text=${encodeURIComponent(p)}` : ""}`);
    router.push(p ? `${mode.href}?prompt=${encodeURIComponent(p)}&${START_PARAM}=${issueStartToken()}` : mode.href);
  };
  // What Start will run, and what it costs, before it's pressed (or why it's a demo, and the engine that would run it).
  const runsFor = status && mode.id !== "live" ? startLine(status, quotes?.[mode.id as "image" | "video" | "edit"], engine, mode.id as "image" | "video" | "edit") : null;
  const openModel = mode.id === "live" ? undefined : quotes?.[mode.id as "image" | "video" | "edit"]?.open?.name;
  const focusComposer = () => requestAnimationFrame(() => box.current?.focus());
  const startOver = useCallback(() => {
    setPrompt("");
    requestAnimationFrame(() => box.current?.focus());
  }, []);
  // A Try chip: its mode and prompt go in, the caret goes to the end, and nothing runs until Start.
  const tryChip = (c: TryChip) => {
    setMode(MODES.find((m) => m.id === c.mode) ?? MODES[0]);
    setPrompt(c.prompt);
    setChipFilled(true);
    setFlash((n) => n + 1);
    box.current?.focus();
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.setSelectionRange(c.prompt.length, c.prompt.length);
      // A phone shows its last lines, where the caret is.
      el.scrollTop = el.scrollHeight;
    });
  };

  return (
    <PageShell>
      <Suspense fallback={null}>
        <NewCreation onNew={startOver} />
      </Suspense>
      <div className="flex flex-col items-center pt-[3vh] text-center">
        <a
          href={FUOBE_REPO}
          target="_blank"
          rel="noopener"
          className="group mb-3 inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-3 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <GitHubMark className="size-3.5" />
          MIT licence
          <span aria-hidden>·</span>
          <span className="font-medium text-brand-text">
            Code on GitHub{" "}
            <span aria-hidden className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">
              →
            </span>
          </span>
        </a>
        <h1 className="font-heading text-display text-balance sm:text-[44px]">
          <span className="inline-block">A complete AI studio.</span> <span className="inline-block">Open source.</span>
        </h1>
        <p className="mt-2 text-[15px] text-pretty text-muted-foreground">
          {/* Before the status: the words a public studio's visitors get (the owner's own install corrects them in a moment). */}
          {!status || visitor || engineMode === "open"
            ? `Pictures, video, sound and 3D on ${openModels} open models and tools, free on your own GPU through ComfyUI.`
            : engineMode === "cloud"
              ? "Frontier paid models through your own API keys."
              : "Frontier cloud models or fully open-source workflows — same studio, your choice."}
        </p>
        <div className="relative mt-6 w-full max-w-[720px] rounded-[20px] border bg-background p-2.5 text-left shadow-soft transition focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint sm:rounded-composer">
          {flash > 0 && <span key={flash} aria-hidden className="pointer-events-none absolute -inset-px animate-ring-flash rounded-[inherit] ring-4 ring-primary/30 motion-reduce:hidden" />}
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setChipFilled(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                go();
              }
            }}
            ref={box}
            rows={2}
            autoFocus
            aria-label="Describe what to create"
            placeholder={mode.placeholder}
            className={cn(
              // Two lines high from the first paint, so a two-line prompt doesn't move what's under it.
              "field-sizing-content max-h-48 min-h-[60px] w-full resize-none bg-transparent px-2.5 py-1.5 text-base outline-none placeholder:text-subtle-foreground",
              // The lines above fade out under the top edge, so the field reads as one that scrolls.
              chipFilled && "max-sm:max-h-[60px] max-sm:overflow-y-auto max-sm:[mask-image:linear-gradient(to_bottom,transparent,#000_14px)]",
            )}
          />
          <div className="flex items-center gap-1.5">
            <div role="radiogroup" aria-label="What to make" className="flex min-w-0 items-center gap-1">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode.id === m.id}
                  onClick={() => setMode(m)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                    mode.id === m.id ? "bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <m.icon className="size-3.5" /> {m.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden sm:block">
                <EngineSwitch value={engine} onChange={setEngine} size="sm" />
              </span>
              <button onClick={go} className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90" aria-label="Start">
                <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
        {/* Its line's height is kept from the first paint, so the chips and the wall under it don't move when it fills in. */}
        {visitor && openModel && !visitor.gpu.connected ? (
          <p className="mt-2 min-h-[18px] text-[12px] text-muted-foreground">
            {visitor.kind === "guest" ? (
              <>
                <a href={signInHref("signup")} className="text-brand-text underline underline-offset-2 hover:no-underline">
                  Sign up free
                </a>{" "}
                to run {openModel} on your own GPU
              </>
            ) : (
              <>
                <button type="button" onClick={() => window.dispatchEvent(new Event(CONNECT_GPU_EVENT))} className="text-brand-text underline underline-offset-2 hover:no-underline">
                  Connect your GPU
                </button>{" "}
                to run {openModel} · Free
              </>
            )}
          </p>
        ) : (
          <p className="mt-2 min-h-[18px] text-[12px] text-muted-foreground">
            {runsFor?.text}
            {runsFor?.other && (
              <>
                {" · "}
                <button type="button" onClick={() => setEngine(runsFor.other!)} className="text-brand-text underline underline-offset-2 hover:no-underline">
                  {runsFor.other === "open" ? "Run it free on your GPU" : "Use your paid key"}
                </button>
              </>
            )}
          </p>
        )}
        {/* A phone's chips are one row that scrolls sideways (none is cut); wider, they wrap, centred (a mouse can't scroll a row with no scrollbar). */}
        <div
          ref={chipRow}
          className="fade-x scrollbar-none mt-6 flex items-center gap-1.5 max-sm:-mx-4 max-sm:h-8 max-sm:w-[calc(100%+2rem)] max-sm:overflow-x-auto max-sm:px-4 sm:flex-wrap sm:justify-center sm:[mask-image:none]"
        >
          <span className="mr-0.5 hidden shrink-0 text-[12px] text-muted-foreground sm:block">Try</span>
          {(owner ? chips.slice(0, -1) : chips).map((c) => {
            const Icon = MODES.find((m) => m.id === c.mode)?.icon ?? ImageIcon;
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => tryChip(c)}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-background px-3 text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Icon className="size-3.5" />
                {c.label}
              </button>
            );
          })}
          {owner && (
            <IntentLink
              href={assist.href}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-brand-faint px-3 text-[13px] whitespace-nowrap text-brand-text transition-colors hover:bg-brand-faint-hover"
            >
              <MessageCircle className="size-3.5" />
              {assist.label}
            </IntentLink>
          )}
        </div>
        {guide ? (
          <>
            <FirstRunScript />
            <GetStarted
              className={cn("mt-6 max-w-[960px]", !status && "hidden [html[data-first-run='1']_&]:block")}
              status={status}
              prices={prices}
              onMode={(id) => {
                setMode(MODES.find((m) => m.id === id) ?? MODES[0]);
                focusComposer();
              }}
            />
          </>
        ) : nothingConnected && !status?.viewer && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            {/* Placeholders on (Settings, for a tour): say so; otherwise a run asks for a GPU or a key. */}
            {placeholdersOn(status?.demoMode) ? (
              <>
                <span className="font-medium text-foreground">Placeholder results are on</span>, so runs make stand-ins.{" "}
              </>
            ) : (
              "Nothing is connected yet. "
            )}
            {hostedPage && engineMode !== "cloud" ? (
              <button type="button" onClick={() => window.dispatchEvent(new Event(CONNECT_GPU_EVENT))} className="text-brand-text underline underline-offset-2">
                Connect your GPU
              </button>
            ) : (
              <Link href="/settings#get-started" className="text-brand-text underline underline-offset-2">
                {engineMode === "open" ? "Connect ComfyUI" : engineMode === "cloud" ? "Add a fal.ai or Replicate key" : "Add a fal.ai key or connect ComfyUI"}
              </Link>
            )}{" "}
            to make the real thing.
          </p>
        )}
      </div>

      {wall}

      {recent.data?.length ? (
        <Row title="Recent" href="/library" className="mt-12 sm:mt-16">
          <RecentStrip items={recent.data.slice(0, 6)} />
        </Row>
      ) : (
        // Loading, in a browser that saw results here last time: the row keeps its place from the first paint, so the rows below don't move down when it arrives.
        !recent.data && (
          <>
            <HadItemsScript name="home-recent" />
            <Row title="Recent" href="/library" className="mt-12 hidden sm:mt-16 [html[data-had-home-recent]_&]:block">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-busy="true" aria-label="Loading recent results">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton
                    key={i}
                    className={cn(
                      "aspect-square rounded-xl",
                      // A phone's second row only when the last visit had more than 3.
                      i >= 3 && "max-sm:hidden [html[data-had-home-recent='4']_&]:block [html[data-had-home-recent='5']_&]:block [html[data-had-home-recent='6']_&]:block",
                    )}
                  />
                ))}
              </div>
            </Row>
          </>
        )
      )}

      {children}
    </PageShell>
  );
}
