"use client";

import { ArrowRight, ArrowUp, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { HeaderPill } from "@/components/gpu/readiness-chip";
import { badgeFor, openGpuSetup, useGpuBadges } from "@/hooks/use-gpu";
import type { Generation, MediaKind, ModelDef, Preset } from "@/lib/catalog/types";
import { GUEST_PROMPT_EVENT, useEngine, useGenerations, useIsGuest } from "@/lib/api";
import { claimStartToken, followEngineDefault, handoffKey, mergeHandoff, presetModel, promptShown, START_PARAM, withoutStart, withPreset } from "@/lib/composer";
import { positionsFrom } from "@/lib/catalog/keyframes";
import { reuseSignature, withSignatureWords } from "@/lib/catalog/palettes";
import { movedAppRequest } from "@/lib/catalog/plan";
import { currentModelId, migrateRequest } from "@/lib/catalog/replaced";
import { matchSpokenLanguage } from "@/lib/speech-languages";
import { SoulPresetCards } from "@/components/moodboards/soul-preset-cards";
import type { StudioCatalog } from "@/lib/studio-catalog";
import { cn } from "@/lib/utils";
import { ComposerBridgeCtx, useComposerBridge, type ComposerBridge } from "./attachments";
import { CatalogProvider, useCatalog } from "./catalog";
import { Composer } from "./composer";
import { EngineSwitch } from "./engine-switch";
import { Feed } from "./feed";
import type { SlotValue } from "./media-slot";
import { PresetUrlCtx, StartRequestCtx, StudioProvider, usePresetUrl, useStudio, useStudioActions, type Draft, type StudioConfig } from "./studio-context";

function kindOfUrl(url: string): MediaKind {
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return "video";
  if (/\.(mp3|wav|ogg|flac|m4a)(\?|$)/i.test(url)) return "audio";
  return "image";
}

const slot = (url: string | null | undefined): SlotValue | null =>
  url ? { ref: url, preview: url, kind: kindOfUrl(url), id: nanoid(6) } : null;

function initialDraft(
  config: StudioConfig,
  sp: URLSearchParams,
  engine: "cloud" | "open",
  lookup: { getModel: (id: string) => ModelDef | undefined; getPreset: (id: string) => Preset | undefined },
): Draft {
  const preset = sp.get("preset") ? lookup.getPreset(sp.get("preset")!) : config.preset;
  // A link or Assist hand-off that names a model Fuobe retired opens on the one that replaced it (replaced.ts).
  const requested = sp.get("model") && currentModelId(sp.get("model")!);
  // An app opened on one of its own models (?model=, from ⌘K) takes that model's route and params.
  const presetRoute = preset
    ? ([preset.cloud, preset.open].find((r) => !!requested && r?.modelId === requested) ?? (engine === "open" ? preset.open : preset.cloud) ?? preset.cloud ?? preset.open)
    : null;
  // A camera motion or effect starts on its Original (Fuobe DoP) when the studio has it.
  const presetOwn = presetModel(preset, engine);
  const modelId =
    (requested && lookup.getModel(requested)?.id) ||
    (preset?.type === "app" ? presetRoute?.modelId : undefined) ||
    (presetOwn && lookup.getModel(presetOwn)?.id) ||
    config.defaultModels[engine] ||
    config.defaultModels.cloud ||
    // Open-only tools (Match colors) keep their open model under the Cloud switch, like cloud-only ones do under Open.
    config.defaultModels.open;
  const model = lookup.getModel(modelId);
  const slots: Draft["slots"] = {};
  const imageSlot = config.slots.find((s) => s.accept === "image")?.key ?? preset?.inputs.find((s) => s.accept === "image")?.key;
  const refs: SlotValue[] = [];
  if (sp.get("image") && imageSlot) slots[imageSlot] = slot(sp.get("image"));
  if (sp.get("ref")) {
    if (config.multiRef) refs.push(slot(sp.get("ref"))!);
    else if (imageSlot) slots[imageSlot] = slot(sp.get("ref"));
  }
  if (sp.get("video")) slots.video = slot(sp.get("video"));
  if (sp.get("audio")) slots.audio = slot(sp.get("audio"));
  // An output format handed over in the link (Export → "ProRes in the cloud"), when the model writes it.
  const format = model?.options.formats?.find((f) => f === sp.get("format"));
  return {
    prompt: sp.get("prompt") ?? "",
    negativePrompt: "",
    modelId,
    params: { ...model?.defaults, ...(preset?.type === "app" ? presetRoute?.params : {}), ...(format && { format }) },
    slots,
    refs,
    presetId: sp.get("preset") ?? config.preset?.id,
    presetOptions: {},
  };
}

/** Rebuild a composer draft from a past generation ("Reuse"). */
function draftFromGeneration(g: Generation, config: StudioConfig, getModel: (id: string) => ModelDef | undefined, getPreset: (id: string) => Preset | undefined): Partial<Draft> {
  // A run styled by the Color signature / Moodboard chips comes back as it was before they routed it,
  // with the picks on the chips (studios without the chips get the styled prompt instead).
  const signed = config.signature ? reuseSignature(g.request) : null;
  const asked = signed ? { ...g.request, modelId: signed.modelId, params: signed.params } : config.signature ? g.request : withSignatureWords(g.request);
  // A run on a model Fuobe retired comes back on the one that replaced it (src/lib/catalog/replaced.ts): a Soul style
  // becomes its Fuobe look, the retired API's own settings are dropped. An app run on the model its app ran on before comes
  // back on the app's model now (movedAppRequest).
  const r = movedAppRequest(migrateRequest(asked).request, getModel, getPreset).request;
  const imgs = signed ? signed.images : (r.inputs?.images ?? []);
  const imageKeys = config.slots.filter((s) => s.accept === "image" && s.key !== "endImage" && s.key !== "mask").map((s) => s.key);
  const slots: Draft["slots"] = {};
  imageKeys.forEach((k, i) => (slots[k] = slot(imgs[i])));
  const refs = config.multiRef ? imgs.slice(imageKeys.length).map((u) => slot(u)!).filter(Boolean) : [];
  if (r.inputs?.endImage) slots.endImage = slot(r.inputs.endImage);
  if (r.inputs?.video) slots.video = slot(r.inputs.video);
  if (r.inputs?.audio) slots.audio = slot(r.inputs.audio);
  const params = { ...r.params };
  // A keyframes run comes back in Frames mode, each still at its place in the clip.
  const times = params.keyframeTimes;
  const frames =
    config.frames && times?.length && times.length === imgs.length && imgs.length > 1
      ? positionsFrom(times, params.duration ?? times[times.length - 1]).map((at, i) => ({ value: slot(imgs[i])!, at }))
      : undefined;
  delete params.keyframeTimes;
  // A spoken language stored as a name (Assist's "Spanish") or a locale comes back as the model's own code.
  const languages = getModel(r.modelId)?.options.sourceLanguages;
  if (languages?.length && params.sourceLanguage) params.sourceLanguage = matchSpokenLanguage(params.sourceLanguage, languages) ?? params.sourceLanguage;
  return {
    prompt: r.prompt ?? "",
    negativePrompt: r.negativePrompt ?? "",
    modelId: r.modelId,
    params,
    slots: frames ? {} : slots,
    refs: frames ? [] : refs,
    frames,
    presetId: r.presetId,
    presetOptions: r.presetOptions ?? {},
    presetStrength: r.presetStrength,
    mix: r.mix,
    signature: signed?.signature,
  };
}

/**
 * New results land at the top of the feed while the composer is docked at the bottom: when one
 * arrives off-screen (you scrolled down into your history), a pill above the composer jumps to it (U4).
 */
function useOffscreenResults(items: Generation[] | undefined) {
  const since = useRef(0);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  useEffect(() => {
    since.current = Date.now() - 2000;
  }, []);
  useEffect(() => {
    if (!items) return;
    if (!seen.current) {
      seen.current = new Set(items.map((g) => g.id));
      return;
    }
    const known = seen.current;
    const added = items.filter((g) => !known.has(g.id) && g.createdAt >= since.current);
    items.forEach((g) => known.add(g.id));
    if (!added.length) return;
    const raf = requestAnimationFrame(() => {
      const off = added.filter((g) => !inView(g.id)).map((g) => g.id);
      if (off.length) setFresh((f) => [...new Set([...off, ...f])]);
    });
    return () => cancelAnimationFrame(raf);
  }, [items]);
  // Clear the ones you scrolled to.
  const pending = fresh.length > 0;
  useEffect(() => {
    if (!pending) return;
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setFresh((f) => (f.some(inView) ? f.filter((id) => !inView(id)) : f)));
    };
    window.addEventListener("scroll", check, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", check, { capture: true });
    };
  }, [pending]);
  const present = fresh.filter((id) => items?.some((g) => g.id === id));
  const working = present.filter((id) => items?.some((g) => g.id === id && (g.status === "queued" || g.status === "running"))).length;
  const jump = () => {
    document.querySelector(`[data-gen-id="${present[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFresh([]);
  };
  return { count: present.length, working, jump };
}

function inView(id: string): boolean {
  const el = document.querySelector(`[data-gen-id="${id}"]`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.bottom > 56 && r.top < window.innerHeight - 160;
}

const EMPTY: Generation[] = [];

/** The preset card (U23) is its own chunk: only app pages and studios with a motion or effect picked load it. */
const PresetHeader = dynamic(() => import("@/components/preset-header").then((m) => m.PresetHeader));

/** While a preset (app, camera motion, effect) is active and the feed is empty: what it does and what to add, above the composer. */
function ActivePresetHeader() {
  const { config, draft, setDraft } = useStudio();
  const catalog = useCatalog();
  const presetUrl = usePresetUrl();
  const preset = draft.presetId ? catalog.getPreset(draft.presetId) : config.preset;
  if (!preset) return null;
  return (
    <PresetHeader
      preset={preset}
      className="mb-3"
      modelName={(id) => catalog.getModel(id)?.name}
      onClear={
        config.preset
          ? undefined
          : () => {
              presetUrl(undefined);
              setDraft({ presetId: undefined, mix: undefined, presetStrength: undefined });
            }
      }
    />
  );
}

/**
 * Example prompts under the hero. Its own component: it follows the picked model (a model that
 * takes no prompt, like FASHN try-on, gets none), so it re-renders with the draft, not the page.
 */
function PromptSuggestions({ suggestions }: { suggestions: string[] }) {
  const { config, draft, setDraft } = useStudio();
  const catalog = useCatalog();
  const preset = draft.presetId ? catalog.getPreset(draft.presetId) : config.preset;
  const model = catalog.getModel(draft.modelId);
  if (!promptShown(config.hidePrompt, preset?.userPrompt, model?.options.promptless)) return null;
  return (
    <div className="mx-auto mt-4 flex max-w-[760px] flex-wrap justify-center gap-2 px-3 pb-10">
      {suggestions.map((s) => (
        <button
          key={s}
          onClick={() => setDraft({ prompt: s })}
          className="h-8 max-w-full truncate rounded-full border bg-background px-3 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {s.length > 48 ? `${s.slice(0, 46)}…` : s}
        </button>
      ))}
    </div>
  );
}

/**
 * The picked open model's state on the viewer's GPU (the GPU pre-flight), left of the engine switch: a pill that opens
 * the guided fix. Its own component, so the draft it reads re-renders only this.
 */
function StudioGpuPill() {
  const { config, draft } = useStudio();
  const [engine] = useEngine();
  const badges = useGpuBadges().data;
  if (engine !== "open" || !badges?.connected) return null;
  const modelId = draft.modelId || config.defaultModels.open;
  const presetId = draft.presetId ?? config.preset?.id;
  const preset = presetId ? badges.presets[presetId] : undefined;
  const op = config.ops.find((o) => badges.models[`${modelId}#${o}`]);
  const badge = preset ?? (op ? badges.models[`${modelId}#${op}`] : badgeFor(badges, { modelId }));
  if (!badge) return null;
  const ref = preset && presetId ? `preset:${presetId}` : `model:${modelId}#${op ?? Object.keys(badges.models).find((k) => k.startsWith(`${modelId}#`))?.split("#")[1] ?? ""}`;
  return <HeaderPill badge={badge} gpu={badges.gpu} compact onOpen={() => openGpuSetup({ ref })} />;
}

/** Sticky page header (title + engine), with an optional row of mode tabs under it. */
function StudioHeader({ title, header, tabs }: { title: string; header?: React.ReactNode; tabs?: React.ReactNode }) {
  const [engine, setEngine] = useEngine();
  return (
    <div className="sticky top-0 z-20 bg-background/85 backdrop-blur">
      <header className="flex h-14 items-center gap-2 px-3 sm:px-6">
        <SidebarTrigger className="md:hidden" />
        <h1 className="min-w-0 truncate font-heading text-[22px] leading-[1.15]">{title}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {header}
          <StudioGpuPill />
          <EngineSwitch value={engine} onChange={setEngine} />
        </div>
      </header>
      {tabs}
    </div>
  );
}

function StudioBody({ header, tabs }: { header?: React.ReactNode; tabs?: React.ReactNode }) {
  // Config and actions only: the draft lives in the composer, so typing doesn't re-render the page or the feed.
  const { config, setDraft } = useStudioActions();
  const [engine, setEngine] = useEngine();
  const feed = useGenerations(config.feed);
  const bridge = useComposerBridge();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const items = feed.data ?? EMPTY;
  // While the feed loads (and in the prerendered shell) the page shows the hero and the composer, never a blank area.
  const hasItems = items.length > 0;
  const offscreen = useOffscreenResults(feed.data);
  const catalog = useCatalog();

  const reuse = useCallback(
    (g: Generation) => {
      setDraft(draftFromGeneration(g, config, catalog.getModel, catalog.getPreset));
      // A run on a model (or an operation) Fuobe retired, or an app's old model, comes back on what replaced it: say what changed.
      const retired = migrateRequest(g.request);
      const moved = retired.note ?? movedAppRequest(retired.request, catalog.getModel, catalog.getPreset).note;
      if (moved) toast(moved);
      if (g.engine !== engine) setEngine(g.engine);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("[data-composer] textarea")?.focus());
    },
    [catalog, config, engine, setDraft, setEngine],
  );

  return (
    <div
      className="relative flex min-h-svh min-w-0 flex-col"
      onDragEnter={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        if (bridge?.current) bridge.current(files);
        else toast("Drop it on the composer");
      }}
    >
      <StudioHeader title={config.title} header={header} tabs={tabs} />

      <div className={cn("mx-auto w-full max-w-[1240px] min-w-0 px-3 sm:px-6", hasItems && "flex-1 pb-8")}>
        {hasItems ? (
          <div className="pt-4">
            <Feed items={items} onReuse={reuse} />
          </div>
        ) : (
          <div className="flex flex-col items-center pt-6 text-center sm:pt-[16vh]">
            <h2 className="font-heading text-display text-balance">{config.hero}</h2>
            {config.subtitle && <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">{config.subtitle}</p>}
            {config.related && (
              <Link href={config.related.href} className="mt-3 inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {config.related.label}
                <ArrowRight className="size-3" />
              </Link>
            )}
          </div>
        )}
      </div>

      {/* One composer for both layouts (centred under the hero, docked under the feed), so it keeps focus and state when the first result arrives. */}
      <div
        className={cn(
          hasItems
            ? "sticky bottom-0 z-20 bg-gradient-to-t from-background via-background/95 to-transparent px-3 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"
            : "px-3 pt-6 sm:px-6 sm:pt-10",
        )}
      >
          {hasItems && offscreen.count > 0 && (
            <div className="pointer-events-none absolute inset-x-0 -top-2 flex justify-center">
              <button
                onClick={offscreen.jump}
                className="pointer-events-auto inline-flex h-8 animate-pop-in items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[13px] font-medium text-background shadow-strong transition hover:opacity-90"
              >
                {offscreen.working ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {offscreen.working ? `${offscreen.working} generating` : `${offscreen.count} new result${offscreen.count === 1 ? "" : "s"}`}
                <ArrowUp className="size-3.5" />
              </button>
            </div>
          )}
        {!hasItems && <ActivePresetHeader />}
        <div data-composer className={cn("mx-auto w-full", hasItems ? "max-w-[800px]" : "max-w-[760px]")}>
          <Composer docked={hasItems} />
        </div>
      </div>

      {!hasItems && config.suggestions && <PromptSuggestions suggestions={config.suggestions} />}
      {!hasItems && config.signature && <SoulPresetCards />}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-overlay p-8">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-background px-12 py-10 shadow-heavy">
            <Upload className="size-6 text-brand-text" />
            <p className="font-medium">Drop to attach</p>
            <p className="text-[13px] text-muted-foreground">Images, videos or audio · up to 200 MB</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface StudioPageProps {
  config: StudioConfig;
  /**
   * The models this studio needs, from the server (`studioCatalog(config)` in a server
   * component). Without it the page loads the catalog chunk itself.
   */
  catalog?: StudioCatalog;
  /** Extra header controls, left of the engine switch. */
  header?: React.ReactNode;
  /** A row under the header (mode tabs). */
  tabs?: React.ReactNode;
  initialRefs?: string[];
  /** Prompt to start with when the URL doesn't carry one (e.g. "@Maya "). */
  initialPrompt?: string;
}

type DraftProps = Omit<StudioPageProps, "catalog">;

/** Reports the URL's hand-off params, and its start token (`go`), if any. It reads the URL, so it sits under its own Suspense: the static shell renders without it. */
function UrlParams({ onChange }: { onChange: (key: string, start: string | null) => void }) {
  const sp = useSearchParams();
  const key = handoffKey(sp);
  const start = sp.get(START_PARAM) || null;
  // Layout effect: on a client navigation the prefilled draft is in place before the first paint.
  useLayoutEffect(() => onChange(key, start), [key, start, onChange]);
  return null;
}

/**
 * Applies the URL's hand-off params (`/video?image=…`) to the draft once they're known: right
 * after hydration on a direct visit (the static shell can't know them), or on the first render
 * of a client navigation. Fields the person already changed — a prompt typed before the page
 * hydrated — are kept. A later change of the params (Animate → Video while on Video) starts a
 * fresh draft instead.
 *
 * With `go=<token>` (Home's Start) it then asks the composer to run the draft once (onStart), after
 * the draft was built from the loaded models, and takes `go` out of the address so a reload or Back
 * doesn't run it again. Only the one-time token this tab's Home issued starts a run: a `go` in a
 * link from elsewhere just prefills the studio, so no website or message can spend the user's keys.
 */
function HandoffSync({
  startKey,
  start,
  build,
  adopt,
  follow,
  ownRef,
  ready,
  onNavigate,
  onStart,
}: {
  startKey: string;
  start: Draft;
  build: React.RefObject<(key: string) => Draft>;
  adopt: React.RefObject<(key: string) => void>;
  /** The base after the composer's own engine swap (followEngineDefault). */
  follow: React.RefObject<(base: Draft, current: Draft) => Draft>;
  /** Set here: takes an address the studio wrote itself (a picked or cleared preset) as applied, so it isn't a navigation. */
  ownRef: React.RefObject<(key: string) => void>;
  ready: boolean;
  onNavigate: (key: string) => void;
  onStart: () => void;
}) {
  const { setDraft } = useStudioActions();
  const [url, setUrl] = useState<{ key: string; start: string | null } | null>(null);
  const applied = useRef({ key: startKey, ready, base: start, seen: false });
  const started = useRef(false);
  useLayoutEffect(() => {
    ownRef.current = (key) => void (applied.current.key = key);
  }, [ownRef]);
  const onParams = useCallback((key: string, start: string | null) => setUrl((u) => (u?.key === key && u.start === start ? u : { key, start })), []);
  useLayoutEffect(() => {
    if (url === null) return;
    const a = applied.current;
    if (a.seen && url.key !== a.key) return onNavigate(url.key);
    a.seen = true;
    if (url.key !== a.key || ready !== a.ready) {
      const next = build.current(url.key);
      const base = a.base;
      setDraft((d) => mergeHandoff(follow.current(base, d), d, next));
      adopt.current(url.key);
      applied.current = { key: url.key, ready, base: next, seen: true };
    }
    if (url.start && ready && !started.current) {
      started.current = true;
      if (claimStartToken(url.start)) onStart();
      window.history.replaceState(null, "", withoutStart(window.location.href));
    }
  }, [url, ready, build, adopt, follow, setDraft, onNavigate, onStart]);
  return (
    <Suspense fallback={null}>
      <UrlParams onChange={onParams} />
    </Suspense>
  );
}

/**
 * One draft's page: the studio and its hand-off. The start request resets with the draft (a new epoch).
 *
 * A guest's Start from Home opens "Create a free account" here instead of sending a run that can only be refused. It
 * opens after HandoffSync took `go` out of the address (a microtask), so the card's way back is the studio with the
 * prompt filled in. While who is looking isn't known yet, the run is sent and its refusal opens the same card.
 */
function StudioSession({ header, tabs, sync }: { header?: React.ReactNode; tabs?: React.ReactNode; sync: Omit<React.ComponentProps<typeof HandoffSync>, "onStart"> }) {
  const [startRequest, setStartRequest] = useState(0);
  const guest = useIsGuest();
  const onStart = useCallback(() => {
    if (guest) queueMicrotask(() => window.dispatchEvent(new CustomEvent(GUEST_PROMPT_EVENT, { detail: { action: "run" } })));
    else setStartRequest((n) => n + 1);
  }, [guest]);
  return (
    <StartRequestCtx.Provider value={startRequest}>
      <StudioBody header={header} tabs={tabs} />
      <HandoffSync {...sync} onStart={onStart} />
    </StartRequestCtx.Provider>
  );
}

/**
 * The studio. It renders the same tree in the static shell and after hydration (the URL is read
 * by HandoffSync alone), so the composer the shell painted is the one you type into: nothing
 * typed or focused before hydration is lost.
 */
function StudioDraft({ config, header, tabs, initialRefs, initialPrompt }: DraftProps) {
  const [engine, setEngine] = useEngine();
  const catalog = useCatalog();
  const bridge = useMemo<ComposerBridge>(() => ({ current: null }), []);
  const build = (key: string) => {
    const d = initialDraft(config, new URLSearchParams(key), engine, catalog);
    if (initialRefs?.length) d.refs = [...initialRefs.map((u) => slot(u)!), ...d.refs];
    if (initialPrompt && !d.prompt) d.prompt = initialPrompt;
    return d;
  };
  // A model named in the URL (?model=, from ⌘K or a hand-off) brings its engine along, as Reuse
  // does: left on the other engine, the composer would swap it for that engine's default.
  const adopt = (key: string) => {
    const id = new URLSearchParams(key).get("model");
    const m = id ? catalog.getModel(id) : undefined;
    if (m && m.engine !== engine) setEngine(m.engine);
  };
  // The composer swaps an untouched default for the engine's own when the engine is read after hydration: a
  // hand-off still applies over that swap.
  const follow = (base: Draft, current: Draft) => followEngineDefault(base, current, config.defaultModels, engine, config.uncaptioned);
  const buildRef = useRef(build);
  const adoptRef = useRef(adopt);
  const followRef = useRef(follow);
  useLayoutEffect(() => {
    buildRef.current = build;
    adoptRef.current = adopt;
    followRef.current = follow;
  });
  // The draft the composer starts from: the defaults (the URL is unknown in the static shell), or
  // the hand-off params of a client navigation to new ones (a new epoch remounts the provider).
  const [start, setStart] = useState({ key: "", epoch: 0 });
  const initial = useMemo(() => build(start.key), [start, config]); // eslint-disable-line react-hooks/exhaustive-deps
  const onNavigate = useCallback((key: string) => {
    setStart((s) => ({ key, epoch: s.epoch + 1 }));
    adoptRef.current(key);
  }, []);
  // The picked camera motion or effect goes into the address (a reload or a shared link opens on it). HandoffSync
  // takes that address as applied first: it isn't a hand-off, so the draft isn't rebuilt.
  const ownRef = useRef<(key: string) => void>(() => {});
  const presetUrl = useCallback((id: string | undefined) => {
    const href = withPreset(window.location.href, id);
    if (href === window.location.href) return;
    ownRef.current(handoffKey(new URL(href).searchParams));
    window.history.replaceState(null, "", href);
  }, []);
  return (
    <ComposerBridgeCtx.Provider value={bridge}>
      <PresetUrlCtx.Provider value={presetUrl}>
        <StudioProvider key={start.epoch} config={config} initial={initial}>
          <StudioSession header={header} tabs={tabs} sync={{ startKey: start.key, start: initial, build: buildRef, adopt: adoptRef, follow: followRef, ownRef, ready: catalog.ready, onNavigate }} />
        </StudioProvider>
      </PresetUrlCtx.Provider>
    </ComposerBridgeCtx.Provider>
  );
}

/**
 * A studio page: header, hero, composer and feed. Everything but the URL is in the static shell:
 * the title, the hero and a composer you can start typing into before the page hydrates. The
 * hand-off params (`?image=`, `?prompt=`…) are applied once known (HandoffSync).
 */
export function StudioPage({ catalog, ...props }: StudioPageProps) {
  return (
    <CatalogProvider catalog={catalog} config={props.config}>
      <StudioDraft {...props} />
    </CatalogProvider>
  );
}
