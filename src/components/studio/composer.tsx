"use client";

import { ArrowUp, AtSign, Cloud, Cpu, GalleryHorizontalEnd, LayoutDashboard, Loader2, Sparkles, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { openAddKey } from "@/components/keys/your-keys";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToday } from "@/hooks/use-today";
import { estimateCost, imageLimit, layoutCanvas, planGeneration, routesFor, type Plan } from "@/lib/catalog/plan";
import type { Engine, GenerationRequest, MediaKind, ModelDef, Operation, Preset, PresetRoute, VideoFormat } from "@/lib/catalog/types";
import { dualEngine } from "@/lib/catalog/engines";
import { locksByDefault } from "@/lib/catalog/palettes";
import { DEFAULT_LOOK, lookCard } from "@/lib/catalog/soul-cards";
import { formatsOf } from "@/lib/av/formats";
import { quoteBody, useHostedQuote, useSettled, type RunOn } from "@/lib/hosted";
import { CONNECT_GPU_EVENT, enhance, useClipFacts, useCreateGeneration, useElements, useEngine, useHydrated, useStatus } from "@/lib/api";
import { usePagePlace } from "@/components/gpu/use-page-place";
import { applyMentions, elementsNote, type StudioElement } from "@/lib/catalog/elements";
import { applySketch, stripMotionPaths } from "@/lib/catalog/sketch";
import {
  chainGapProblem,
  chainTiming,
  frameSupport,
  framesBlocker,
  framesDuration,
  framesDurations,
  framesNote,
  FRAMES_MODELS,
  frameTimes,
  keyframeChain,
  moveFrameAt,
  OPEN_MIN_GAP,
  type FrameSupport,
} from "@/lib/catalog/keyframes";
import { appModels, presetGpuKey, presetRoutes, recipeRoute } from "@/lib/catalog/preset-recipe-routes";
import {
  appRoute,
  blockerFor,
  blockerLine,
  clipBlocker,
  clipOutcome,
  costLabel,
  engineSwitchModel,
  enterFrames,
  enterLayout,
  filterModels,
  firstMissingSlot,
  followEngineParams,
  framesRequest,
  framesShape,
  framesSlots,
  framesUploading,
  layoutBoxModel,
  layoutNotes,
  layoutRequest,
  layoutShape,
  leaveFrames,
  leaveLayout,
  namedImageSlots,
  needsMask,
  onImageChange,
  PLACEHOLDER,
  presetModel,
  presetOriginal,
  presetFallback as presetFallbackRoute,
  presetParams,
  postStepCost,
  prestepCost,
  pushRecent,
  routeParams,
  untouchedParams,
  settingsShape,
  showsPrompt,
  startStep,
  viewerDefaults,
  writesCaptions,
} from "@/lib/composer";
import { formatCost } from "@/lib/format";
import { toastError } from "@/lib/refusals";
import { addKeyLabel, billedTo, CLOUD_KEY, needsKey, paidThrough, startingModel } from "@/lib/your-keys";
import { cn } from "@/lib/utils";
import { badgeFor, badgeText, dropGpuRetry, openGpuSetup, setGpuRetry, useGpuBadges } from "@/hooks/use-gpu";
import { AttachMenu } from "./attach-menu";
import { useAttach, useComposerBridge, useUploadReaper } from "./attachments";
import { DialogueEditor, LanguageChip, VoicePicker } from "./audio-controls";
import { FramesStrip, type FramesNotice } from "./frames-strip";
import { LayoutStrip } from "./layout-strip";
import { loadFullCatalog, useCatalog } from "./catalog";
import { Chip, chipBase, chipIdle } from "./chip";
import { MediaSlot, SlotPreview, type SlotValue } from "./media-slot";
import { ControlsChip } from "./model-controls";
import { ModelPicker } from "./model-picker";
import { ELEMENT_ICONS, PromptInput, type PromptInputHandle } from "./prompt-input";
import { radioKeys, radioTab } from "./radio-keys";
import { SettingsChip } from "./settings-panel";
import { ShotsEditor } from "./shots-editor";
import { SketchTools } from "./sketch-tools";
import { RECENT_MODELS, useStoredList } from "./stored-list";
import { usePresetUrl, useStartRequest, useStudio, type Draft } from "./studio-context";
import { useEdgeFade } from "./use-edge-fade";
import { CleanVoiceSlot, CleanVoiceSwitch, useVoiceCleaning } from "@/components/audio-tools/clean-voice-switch";
import { useSignature } from "../palettes/use-signature";
import { placeholdersOn } from "@/lib/demo-mode";

const EMPTY: StudioElement[] = [];

/** The motion / effect picker (and its preset icons) is its own chunk: only video studios load it. */
const PresetChips = dynamic(() => import("./preset-chips"), {
  loading: () => <span aria-hidden className="h-8 w-32 shrink-0 animate-pulse rounded-full bg-secondary" />,
});

/** Layout mode's editor (the canvas, the boxes and their rows): its own chunk, loaded when Layout is turned on. */
const LayoutEditor = dynamic(() => import("./layout-editor").then((m) => m.LayoutEditor));

/** The model Layout mode suggests where the picked one reads boxes as words: MOSS-Image on each engine. */
const BOX_MODELS: Record<Engine, string> = { open: "oss-moss-image", cloud: "moss-image" };

/** Fuobe Soul's Look picker (the look cards): its own chunk. */
const LookChip = dynamic(() => import("./look-chip"), {
  loading: () => <span aria-hidden className="h-8 w-28 shrink-0 animate-pulse rounded-full bg-secondary" />,
});

/** Color signature + Moodboard chips (studios with `signature`): their own chunk too. */
const SignatureChips = dynamic(() => import("../palettes/signature-chips"), {
  loading: () => <span aria-hidden className="h-8 w-40 shrink-0 animate-pulse rounded-full bg-secondary" />,
});

/** Two speakers to start a dialogue with. */
const defaultLines = (m: ModelDef) => {
  const v = m.options.voices ?? [];
  return [
    { text: "", voice: v[0]?.id },
    { text: "", voice: v[1]?.id ?? v[0]?.id },
  ];
};

// ---------------------------------------------------------------------------

/** Frames mode, as the request needs it: what the model does with frames, the clip's length, and whether it's the open chain. */
interface FramesContext {
  support: FrameSupport;
  duration: number;
  chained: boolean;
}

function buildRequest(
  feature: string,
  draft: Pick<Draft, "slots" | "refs" | "presetId" | "modelId" | "prompt" | "negativePrompt" | "params" | "presetOptions" | "presetStrength" | "mix" | "frames" | "layout">,
  op: Operation | undefined,
  promptSuffix?: string,
  refKind: MediaKind = "image",
  frames?: FramesContext,
  /**
   * The model's needs: a Fuobe Original (runs on both engines) names the engine switched to; a model that takes
   * looks (Fuobe Soul) takes the look's strength with its default look too (no presetId).
   */
  target: { engine?: Engine; looks?: boolean } = {},
): GenerationRequest {
  const s = draft.slots;
  const refs = draft.refs.filter((x) => !!x?.ref).map((x) => x.ref);
  let images = [s.image, s.image2, s.image3].filter((x): x is SlotValue => !!x?.ref).map((x) => x.ref).concat(refKind === "image" ? refs : []);
  const videos = refKind === "video" ? refs : [];
  let endImage = s.endImage?.ref || undefined;
  let params = draft.params;
  let pinned = op;
  // Frames mode: the stills in order at their times (or the first and last as start and end frame), at the strip's length.
  if (draft.frames && frames) {
    const sent = framesRequest(draft.frames, frames);
    images = sent.images;
    endImage = sent.endImage;
    params = { ...params, ...sent.params };
    pinned = op ?? sent.op;
  }
  // Layout mode: the boxes ride as params.extra.layout, captioned with the prompt; the plan compiles them for the model.
  if (draft.layout) params = layoutRequest(draft.layout, draft.prompt, params).params;
  return {
    feature,
    presetId: draft.presetId,
    modelId: draft.modelId,
    op: pinned,
    prompt: promptSuffix && draft.prompt.trim() ? `${draft.prompt.trim().replace(/[.\s]+$/, "")}. ${promptSuffix}` : draft.prompt,
    negativePrompt: draft.negativePrompt || undefined,
    inputs: {
      images: images.length ? images : undefined,
      endImage,
      mask: s.mask?.ref || undefined,
      sketch: s.sketch?.ref || undefined,
      voiceAudio: s.voiceAudio?.ref || undefined,
      voiceAudio2: s.voiceAudio2?.ref || undefined,
      video: s.video?.ref || undefined,
      audio: s.audio?.ref || undefined,
      videos: videos.length && !draft.frames ? videos : undefined,
    },
    params,
    presetOptions: draft.presetOptions,
    ...((draft.presetId || target.looks) && draft.presetStrength !== undefined && draft.presetStrength < 1 && { presetStrength: draft.presetStrength }),
    ...(draft.presetId && draft.mix && { mix: draft.mix }),
    ...(target.engine && { engine: target.engine }),
  };
}

/**
 * Whether the preset's preview was made with its recipe on this engine ("Used for this preview" on that model). The covers
 * manifest that says so is its own chunk (src/lib/catalog/preset-recipes.ts), loaded once a preset with a recipe is open.
 */
function useRecipeMade(preset: Preset | undefined, engine: Engine, recipeModel: string | undefined): boolean {
  const key = preset && recipeModel ? `${preset.id}:${engine}` : "";
  const [made, setMade] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!key || !preset || key in made) return;
    let live = true;
    void import("@/lib/catalog/preset-recipes").then((m) => live && setMade((x) => ({ ...x, [key]: m.recipeMade(preset, engine) })));
    return () => {
      live = false;
    };
  }, [key, preset, engine, made]);
  return !!key && !!made[key];
}

/** Leaving a model that takes looks (Fuobe Soul) for one that doesn't: the look (its presetId) doesn't come along. */
function lookCleared(from: ModelDef | undefined, to: ModelDef): Partial<Draft> {
  return from?.options.looks && !to.options.looks ? { presetId: undefined, presetStrength: undefined } : {};
}

/** Docked and collapsed, the composer hides its tiles: this event asks it to open first. */
const EXPAND_EVENT = "composer:expand";

/** Point at an attachment tile: scroll it into view and pulse its outline. */
function pulseSlot(root: HTMLElement | null, key: string, retried = false) {
  const el = root?.querySelector<HTMLElement>(`[data-slot-key="${key}"]`);
  if (!el) {
    if (retried || !root) return;
    root.dispatchEvent(new Event(EXPAND_EVENT));
    requestAnimationFrame(() => pulseSlot(root, key, true));
    return;
  }
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "currentColor";
  el.animate(
    [
      { boxShadow: `0 0 0 0 color-mix(in oklab, ${primary} 70%, transparent)` },
      { boxShadow: `0 0 0 7px color-mix(in oklab, ${primary} 0%, transparent)` },
    ],
    { duration: 650, iterations: 2, easing: "ease-out" },
  );
}

/** An empty attachment tile's upload button (focus it, or click it from a toast action to open the file picker). */
function slotButton(root: HTMLElement | null, key: string) {
  return root?.querySelector<HTMLButtonElement>(`[data-slot-key="${key}"] button[aria-label$=": upload"]`) ?? null;
}

export function Composer({ docked }: { docked: boolean }) {
  const { config, draft: typed, setDraft, setSlot } = useStudio();
  const catalog = useCatalog();
  const presetUrl = usePresetUrl();
  const [engine, setEngine, engineMode] = useEngine();
  const create = useCreateGeneration();
  const [enhancing, setEnhancing] = useState(false);
  const [focused, setFocused] = useState(false);
  const promptRef = useRef<PromptInputHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  // The words typed are kept for this tab, per page (a hub's mode has its own): a visit to other modes and back finds
  // them again, as a studio the router keeps mounted does. A prompt from the link (?prompt=) wins.
  const draftKey = useRef<string | null>(null);
  useEffect(() => {
    draftKey.current = `fuobe:draft:${window.location.pathname}`;
    try {
      const kept = sessionStorage.getItem(draftKey.current);
      if (kept && !typed.prompt) setDraft({ prompt: kept });
    } catch {}
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!draftKey.current) return;
    try {
      if (typed.prompt) sessionStorage.setItem(draftKey.current, typed.prompt);
      else sessionStorage.removeItem(draftKey.current);
    } catch {}
  }, [typed.prompt]);
  // Connection status can arrive before this Suspense subtree hydrates: render the server's view (no status) until then.
  const hydrated = useHydrated();
  const liveStatus = useStatus().data;
  const status = hydrated ? liveStatus : undefined;
  // A hosted studio: the owner connects a GPU from the dialog ("Connect your GPU"), not with an address in Settings.
  const hostedPage = usePagePlace() === "hosted";
  // The day a launch price is read on: the browser's, once hydrated (none while the page prerenders: no price shown then).
  const today = useToday();
  // Upscale hub: the attached clip's header (length, size, frame rate). Its length prices per-second tools and
  // travels with the request (params.sourceDuration), with its rate for a route billed by frames (params.sourceFps);
  // a clip swapped since a Reuse never keeps the old one's.
  const facts = useClipFacts(config.clipFacts && !typed.slots.video?.uploading ? typed.slots.video?.ref : undefined).data;
  // Lipsync: a talking avatar is as long as its voice (the voice's header prices it and goes with the request); not while a
  // video is attached (lip re-sync keeps the clip's length).
  const voiceRef = config.voiceFacts && !typed.slots.video?.ref && !typed.slots.audio?.uploading ? typed.slots.audio?.ref : undefined;
  const voice = useClipFacts(voiceRef).data;
  const draft = useMemo(
    () =>
      config.clipFacts
        ? { ...typed, params: { ...typed.params, sourceDuration: typed.slots.video?.ref ? facts?.duration : undefined, sourceFps: typed.slots.video?.ref ? facts?.fps : undefined } }
        : config.voiceFacts
          ? { ...typed, params: { ...typed.params, sourceDuration: voiceRef ? voice?.duration : undefined } }
          : typed,
    [config.clipFacts, config.voiceFacts, typed, facts?.duration, facts?.fps, voiceRef, voice?.duration],
  );
  const liveElements = useElements().data;
  const elements = (hydrated && liveElements) || EMPTY;
  const [, setRecent] = useStoredList(RECENT_MODELS);
  const bridgeRef = useComposerBridge();
  const [chipRow, fade] = useEdgeFade<HTMLDivElement>();
  useUploadReaper(draft);
  // Typed into before the page hydrated: the prompt already has focus (onFocus never ran).
  useLayoutEffect(() => {
    if (root.current?.contains(document.activeElement)) setFocused(true);
  }, []);
  useEffect(() => {
    const el = root.current;
    const expand = () => setFocused(true);
    el?.addEventListener(EXPAND_EVENT, expand);
    return () => el?.removeEventListener(EXPAND_EVENT, expand);
  }, []);

  const pickerOps = config.pickerOps ?? config.ops;
  const models = useMemo(() => filterModels(catalog.models, { kind: config.kind, ops: pickerOps }), [catalog.models, config.kind, pickerOps]);
  const model: ModelDef | undefined = catalog.getModel(draft.modelId);
  // Fuobe Soul's presetId is a look (its own chip), not an app, motion or effect.
  const takesLook = !!model?.options.looks;
  const preset: Preset | undefined = draft.presetId && !takesLook ? catalog.getPreset(draft.presetId) : config.preset;
  const lockedModel = preset?.type === "app";
  const presetLoading = !!draft.presetId && !takesLook && !preset && !catalog.complete;
  // The models the viewer's catalog has (the studio's slice, or the full catalog once it's loaded), and the ones this
  // viewer can run now: offered in Settings → Models & licences, and a key for its provider when it's an account's paid run.
  const has = useCallback((id: string) => !!catalog.getModel(id), [catalog]);
  const runs = useCallback(
    (id: string) => {
      const m = catalog.getModel(id);
      return !!m && catalog.offered(id, engine) && !needsKey(m, status);
    },
    [catalog, engine, status],
  );
  // An app runs on its own models on this engine: the one its preview was made with, then its own route's.
  const appIds = useMemo(() => (lockedModel && preset ? appModels(preset, engine, has) : []), [lockedModel, preset, engine, has]);
  // The model the preset's preview was made with on this engine (MiniMax H3, Qwen-Image 2.1 Turbo), and whether its live
  // preview really came from it ("Used for this preview" on that model).
  const recipe = preset && !takesLook ? recipeRoute(preset, engine) : undefined;
  const recipeModel = recipe && has(recipe.modelId) ? recipe.modelId : undefined;
  const madeWith = useRecipeMade(preset, engine, recipeModel) ? recipeModel : undefined;
  /** What the request names for its model: the engine (only a model that runs on both, a Fuobe Original), and whether it takes looks. */
  const targetFor = (id: string) => {
    const m = catalog.getModel(id);
    return { engine: dualEngine(m) ? engine : undefined, looks: !!m?.options.looks };
  };

  // A curated moodboard on a model that takes looks is a look: it moves to the Look chip, so the chip shows what
  // runs (a /moodboards link, or a pick in the Moodboard panel, would otherwise override the chip unseen).
  const curatedId = draft.signature?.moodboard?.kind === "curated" ? draft.signature.moodboard.id : undefined;
  useEffect(() => {
    const card = takesLook && curatedId ? lookCard(curatedId) : undefined;
    if (!card) return;
    setDraft((d) => ({ presetId: card.id === DEFAULT_LOOK ? undefined : card.id, signature: { ...d.signature, moodboard: undefined } }));
    toast(`${card.name} is a Fuobe Soul look: it's on the Look chip`);
  }, [takesLook, curatedId, setDraft]);

  // Presets handed over in the URL, a Mix, or a model outside this studio's slice: fetch the full catalog.
  const needsFull = presetLoading || (!!draft.mix && !catalog.getPreset(draft.mix.presetId)) || (catalog.ready && !model);
  useEffect(() => {
    if (needsFull) void loadFullCatalog();
  }, [needsFull]);

  // The studio's defaults as this viewer runs them: Ideogram 4 gives way to its stand-in where the server writes no caption.
  const writes = writesCaptions(status);
  const defaults = useMemo(() => viewerDefaults(config.defaultModels, config.uncaptioned, writes), [config.defaultModels, config.uncaptioned, writes]);

  // Keep the selected model in sync with the engine switch. A camera motion or effect keeps its Original (Fuobe DoP),
  // moving to the model its move names on this engine (Jib Up: Fuobe DoP on the GPU, Fuobe DoP · LTX in the cloud) when
  // the engine changes; the same Original on the other engine takes that engine's defaults (480p on the GPU, 720p in the
  // cloud) for the settings the person left alone.
  const seen = useRef<{ engine: Engine; model?: ModelDef }>({ engine, model });
  // An account's paid model it has no key for yet (from a link, ⌘K or a Reuse) stays picked while its switch is held on
  // open source: the note under the composer says how to run it, where a swap to an open model would say nothing. The
  // studio's untouched cloud default still gives way, unless the link names it. Until the status is known, it waits.
  const heldForKey =
    !!model &&
    !lockedModel &&
    model.engine !== "open" &&
    engine === "open" &&
    engineMode === "open" &&
    (!status || (!!needsKey(model, status) && status.viewer?.paidAllowed !== false));
  useEffect(() => {
    const before = seen.current;
    seen.current = { engine, model };
    if (!model) return;
    if (heldForKey && (model.id !== config.defaultModels.cloud || new URLSearchParams(window.location.search).get("model") === model.id)) return;
    const next = engineSwitchModel({ model, preset, engine, from: before.engine, defaults, has });
    const m = next ? catalog.getModel(next) : undefined;
    if (!m) {
      if (before.engine === engine || before.model?.id !== model.id || before.model === model) return;
      const from = before.model.defaults ?? {};
      const to = model.defaults ?? {};
      setDraft((d) => {
        const params = d.modelId === model.id ? followEngineParams(d.params, from, to) : undefined;
        return params ? { params } : {};
      });
      return;
    }
    // Only the model this effect saw: a hand-off applied in the same commit (?model=, a layout effect) already
    // replaced it, and swapping it for the engine's default would undo the link (it landed on Z-Image Turbo).
    // An app takes the settings of its route on that model; a camera motion or effect its move's.
    const route = lockedModel ? routeParams(appRoute(preset, engine, m.id, has), "app") : m.id === presetModel(preset, engine, has) ? presetParams(preset, engine, has) : {};
    setDraft((d) => (d.modelId !== model.id ? {} : { modelId: m.id, params: { ...m.defaults, ...route, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt }, ...lookCleared(model, m) }));
  }, [engine, model, preset, defaults, setDraft, catalog, heldForKey, config.defaultModels.cloud, has, lockedModel]);

  // Where the server can't write Ideogram 4's caption (writesCaptions), the studio's untouched default moves to its stand-in
  // once the status is known. Ideogram 4 picked after that stays.
  const captionChecked = useRef(false);
  useEffect(() => {
    if (captionChecked.current || writes === undefined || !model) return;
    captionChecked.current = true;
    const to = defaults[engine];
    // An app moves only to one of its own models.
    const m = to !== model.id && model.id === config.defaultModels[engine] && (!lockedModel || appIds.includes(to)) ? catalog.getModel(to) : undefined;
    if (m) setDraft((d) => (d.modelId !== model.id ? {} : { modelId: m.id, params: { ...m.defaults, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt }, ...lookCleared(model, m) }));
  }, [writes, model, defaults, engine, config.defaultModels, lockedModel, appIds, catalog, setDraft]);

  // The preset's recipe (the model its preview was made with) that this viewer can't run: a Replicate-only account and
  // hosted MiniMax H3 (fal only), or a model switched off in Settings → Models & licences. The composer moves to the
  // preset's own route on this engine when the viewer can run that (Kling 2.5 Turbo, Fuobe DoP, the app's own model).
  const presetFallback = useMemo(() => (takesLook ? undefined : presetFallbackRoute(preset, engine, model?.id, has, runs)), [preset, takesLook, model, engine, has, runs]);
  useEffect(() => {
    const m = presetFallback && model ? catalog.getModel(presetFallback.modelId) : undefined;
    if (!m || !model) return;
    const route = routeParams(presetFallback, preset!.type);
    setDraft((d) => (d.modelId !== model.id ? {} : { modelId: m.id, params: { ...m.defaults, ...route, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt, seed: d.params.seed } }));
    // Said only for the setting: an account's key is its own business (the keys' note says what each model needs).
    if (!catalog.offered(model.id, engine)) toast(`${model.name} is turned off in Settings → Models & licences, so this uses ${m.name}`, { id: "model-access" });
  }, [presetFallback, model, preset, engine, catalog, setDraft]);

  // Settings → Models & licences switched the model off (a default, a remembered pick, a Reuse, a link): the composer
  // moves to the studio's default on this engine, else the first model of its list that is on, and says so. With
  // none on, Generate says what to turn on (accessError). A preset's recipe moves to the preset's own route instead.
  const offModel = model && !catalog.offered(model.id, engine) ? model : undefined;
  const fallback = offModel ? [defaults[engine], ...models.filter((m) => m.engine === engine).map((m) => m.id)].find((id) => !!id && catalog.offered(id, engine) && !!catalog.getModel(id)) : undefined;
  useEffect(() => {
    if (!offModel || !fallback || lockedModel || presetFallback) return;
    const m = catalog.getModel(fallback)!;
    setDraft((d) => (d.modelId !== offModel.id ? {} : { modelId: m.id, params: { ...m.defaults, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt }, ...lookCleared(offModel, m) }));
    toast(`${offModel.name} is turned off in Settings → Models & licences, so this uses ${m.name}`, { id: "model-access" });
  }, [offModel, fallback, lockedModel, presetFallback, catalog, setDraft]);

  // An account (Your keys) starts on a paid model it can run: the studio's untouched default when it has that key, else
  // the first of the list it can run. Quietly: nothing it picked changed (a model it picked is never swapped). A preset's
  // recipe moves to the preset's own route instead (presetFallback).
  const keyStart =
    model && model.id === config.defaultModels[engine] && needsKey(model, status) ? startingModel(model.id, models.filter((m) => m.engine === engine && catalog.offered(m.id, engine)), status) : undefined;
  useEffect(() => {
    const m = keyStart && model && keyStart !== model.id && !lockedModel && !presetFallback ? catalog.getModel(keyStart) : undefined;
    if (!m || !model) return;
    setDraft((d) => (d.modelId !== model.id ? {} : { modelId: m.id, params: { ...m.defaults, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt }, ...lookCleared(model, m) }));
  }, [keyStart, model, lockedModel, presetFallback, catalog, setDraft]);

  // A camera motion or effect runs on its Original on this engine (Fuobe DoP): picking one moves the composer there,
  // with the move's own settings (Focus Change: 6 s, silent). Another video model can be picked after it; it takes
  // the move's words. A move whose cloud route is a partner model's words leaves the person's model as it is.
  const pickPreset = (id?: string) => {
    presetUrl(id);
    if (!id) return setDraft({ presetId: undefined, mix: undefined, presetStrength: undefined });
    const picked = catalog.getPreset(id);
    const want = presetOriginal(picked, engine, runs);
    const m = want ? catalog.getModel(want) : undefined;
    if (!m) return setDraft({ presetId: id });
    // Also when the composer is already on that model (MiniMax H3 for most moves): the move picked brings its own length
    // and Quality, not the last one's.
    const route = presetParams(picked, engine, runs);
    setDraft((d) => ({ presetId: id, modelId: m.id, params: { ...m.defaults, ...route, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt, seed: d.params.seed }, ...lookCleared(model, m) }));
  };
  // The empty studio's example tiles pick a camera motion or effect here, as the chip does, so what is attached stays.
  useEffect(() => {
    if (!bridgeRef) return;
    bridgeRef.pick = pickPreset;
    return () => {
      if (bridgeRef.pick === pickPreset) bridgeRef.pick = null;
    };
  });
  // A motion handed over in the link (?preset= from the Motions gallery) is known once the presets load: it moves the
  // studio's untouched default model to its Original, once per preset.
  const adoptedPreset = useRef<string | undefined>(undefined);
  useEffect(() => {
    const want = presetOriginal(preset, engine, runs);
    if (!preset || !want || !model || adoptedPreset.current === preset.id) return;
    adoptedPreset.current = preset.id;
    const route = presetParams(preset, engine, runs);
    // Already on that model (MiniMax H3 is the Video studio's default): the move's length and Quality replace the ones
    // still at the model's defaults.
    if (model.id === want) {
      setDraft((d) => {
        const params = d.modelId === model.id ? untouchedParams(d.params, model.defaults ?? {}, route) : undefined;
        return params ? { params } : {};
      });
      return;
    }
    if (model.id !== defaults[engine]) return;
    const m = catalog.getModel(want);
    if (m) setDraft((d) => (d.modelId !== model.id ? {} : { modelId: m.id, params: { ...m.defaults, ...route, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt, seed: d.params.seed }, ...lookCleared(model, m) }));
  }, [preset, engine, model, defaults, catalog, setDraft, runs]);
  // A link to a camera motion or effect Fuobe doesn't have (?preset=nope): once every preset is known, the composer
  // drops it and says so, so the chip doesn't wait on it and a plain prompt runs.
  const unknownPreset = catalog.complete && !!draft.presetId && !takesLook && !preset;
  useEffect(() => {
    if (!unknownPreset) return;
    setDraft({ presetId: config.preset?.id, mix: undefined, presetStrength: undefined });
    presetUrl(undefined);
    toast("That camera motion or effect isn't available. Pick another one.", { id: "unknown-preset" });
  }, [unknownPreset, config.preset, presetUrl, setDraft]);

  // Single-purpose studios (Extend, Reframe, Edit video…) pin their operation.
  const studioOp = config.ops.length === 1 && !preset ? config.ops[0] : undefined;
  const opts = model?.options ?? {};
  // Try-on names its images: "Person photo", then "Add garment" (instead of "Image" / "Add ref").
  const baseSlots = preset?.inputs ?? config.slots;
  const named = useMemo(
    () => namedImageSlots(baseSlots, model?.options.imageLabels, config.multiRef?.label, draft.refs.length),
    [baseSlots, model?.options.imageLabels, config.multiRef?.label, draft.refs.length],
  );
  const slots = named.slots;
  const hasCleanVoice = slots.some((s) => s.cleanVoice && s.accept === "audio");
  // Clips: ComfyUI joins 4 at a time. Images: what the model takes beyond the fixed image slots, for the operation the run
  // will be (a painted mask makes it an inpaint, which Qwen-Image 2.1 runs on the picture alone).
  const refOp = studioOp ?? (draft.slots.mask?.ref && model && routesFor(model, "inpaint").length ? "inpaint" : undefined);
  const refMax = !config.multiRef
    ? 0
    : config.multiRef.kind === "video"
      ? Math.min(config.multiRef.max, model?.engine === "open" ? 4 : config.multiRef.max)
      : Math.min(config.multiRef.max, Math.max(0, ((model ? imageLimit(model, refOp) : opts.maxImages) ?? 1) - slots.filter((s) => s.accept === "image").length));
  const attach = useAttach(slots, refMax);

  // Frames mode (Video studio): up to 10 stills at their times, as the picked model can take them.
  const framesOn = !!config.frames && !!draft.frames;
  const framesCtx: FramesContext | undefined =
    framesOn && model ? { support: frameSupport(model), duration: framesDuration(model, draft.params.duration), chained: !!keyframeChain(model) } : undefined;
  const framesAt = framesCtx && draft.frames ? frameTimes(draft.frames.map((f) => f.at), framesCtx.duration) : [];
  // The open chain's gaps (and one frame's clip) must be clips its model makes; the planner checks two or more frames too.
  const framesGap = framesCtx?.chained && model && framesAt.length ? chainGapProblem(framesAt, framesCtx.duration, chainTiming(model)) : null;
  // Layout mode (Image studio): boxes on the picture, one row each, compiled for the model at the size it renders.
  const layoutOn = !!config.layout && !!draft.layout;
  const [layoutEditing, setLayoutEditing] = useState(false);

  // The page's drop zone hands its files to this composer.
  useEffect(() => {
    if (!bridgeRef) return;
    bridgeRef.current = attach.attachFiles;
    return () => {
      if (bridgeRef.current === attach.attachFiles) bridgeRef.current = null;
    };
  }, [bridgeRef, attach.attachFiles]);

  // A picked palette / moodboard routes the request (and can move it to another model) before anything else.
  const signature = useSignature(!!config.signature, draft.signature);
  const prepare = (d: typeof draft) => {
    const signed = signature.apply(buildRequest(config.feature, d, studioOp, config.promptSuffix, config.multiRef?.kind, framesCtx, targetFor(d.modelId)));
    // Planned with the signature's sentences in the prompt (as the server runs it); sent with them apart.
    const raw = signed.worded;
    const m = catalog.getModel(raw.modelId) ?? model;
    const mentions = m ? applyMentions(raw, m, elements) : { request: raw, mentioned: [], notes: [] };
    const sketched = m ? applySketch(mentions.request, m) : { request: mentions.request };
    return { mentions, sketched, signed, request: m ? stripMotionPaths(sketched.request, m) : sketched.request };
  };
  const { mentions, sketched, signed } = prepare(draft);
  // Hosted runs: an open model may run on this studio's GPUs. Its price there is the server's (the words of the
  // studio's billing service, or free), asked again 300 ms after a change. With the account's own GPU online, that
  // GPU is the default; the person can pick either.
  const viewerInfo = status?.viewer;
  const ownOnline = !!viewerInfo?.gpu.connected && !!viewerInfo.gpu.online;
  const [runOnPick, setRunOn] = useState<RunOn | null>(null);
  const runOn: RunOn = runOnPick ?? (ownOnline ? "own" : "pool");
  const hostedHere = !!viewerInfo?.hosted && model?.engine === "open";
  const poolPrice = hostedHere && runOn === "pool";
  const priceBody = useSettled(poolPrice ? quoteBody(signed.request, runOn) : null);
  const hostedQuote = useHostedQuote(priceBody).data?.quote;
  const priceUnavailable = poolPrice && hostedQuote?.code === "paused";
  const resolvesOnServer = mentions.mentioned.length > 0 || !!draft.slots.mask?.ref || !!draft.slots.sketch?.ref;

  // Plan with stand-ins for attachments that are missing or still uploading, so the cost and the
  // operation are known up front and the blocker can name the slot in the studio's own words.
  // Studios that need one of several inputs (Lipsync: a portrait or a video) name the group.
  const anyOf = preset?.inputs ? undefined : config.anyOf;
  // Frames mode has its own strip: the start frame is frame 1 (a camera motion's start frame tile isn't asked for).
  const askedSlots = framesOn ? framesSlots(slots) : slots;
  const missing = firstMissingSlot(askedSlots, draft.slots, anyOf);
  const uploading = Object.values(draft.slots).some((v) => v?.uploading) || draft.refs.some((r) => r.uploading) || (framesOn && framesUploading(draft.frames));
  // A voice slot's "Clean up voice" is cleaning the file that just landed: Generate waits for the clean one.
  const cleaningVoice = useVoiceCleaning();
  // Export without a ComfyUI to write it (none connected, or the install runs cloud APIs only): say so and offer the cloud route.
  // A cloud-only install refuses open models, and without placeholder results nothing else runs it, so Generate says why.
  const comfyMissing = !!config.comfyOnly && !!status && (engineMode === "cloud" || !status.providers.comfyui?.configured);
  const comfyBlock = comfyMissing && model?.engine === "open" && (engineMode === "cloud" || !placeholdersOn(status?.demoMode)) ? "Needs ComfyUI: see the note below" : null;
  const accessError = offModel && !presetFallback && (!fallback || lockedModel) ? `${offModel.name} is turned off in Settings → Models & licences` : null;
  const engineError =
    (lockedModel && preset && !appIds.length ? `${preset.name} has no ${engine === "open" ? "open-source" : "cloud"} version yet` : null) ?? accessError ?? comfyBlock;
  let op: Operation | undefined;
  let cost: number | null = null;
  // The run goes to a LoRA endpoint whose price isn't published (fal's MOSS-Image /lora).
  let loraPriceUnknown = false;
  let planError: string | null = null;
  // What the plan made of the layout: the form the model reads it in and the canvas it was compiled at.
  let laid: Plan["layout"];
  if (model && !engineError && !presetLoading) {
    try {
      const stand = (v: SlotValue | null | undefined, kind: MediaKind): SlotValue | null | undefined => (v?.uploading ? { ...v, ref: PLACEHOLDER[kind] } : v);
      const planSlots: Draft["slots"] = Object.fromEntries(Object.entries(draft.slots).map(([k, v]) => [k, stand(v, v?.kind ?? "image")]));
      for (const s of askedSlots) if (s.required && !planSlots[s.key]?.ref) planSlots[s.key] = { ref: PLACEHOLDER[s.accept], preview: "", kind: s.accept };
      for (const g of anyOf ?? []) {
        const first = slots.find((s) => s.key === g[0]);
        if (first && !g.some((k) => planSlots[k]?.ref)) planSlots[first.key] = { ref: PLACEHOLDER[first.accept], preview: "", kind: first.accept };
      }
      const { request: planned } = prepare({
        ...draft,
        slots: planSlots,
        refs: draft.refs.map((r) => stand(r, r.kind) as SlotValue),
        frames: draft.frames?.map((f) => ({ ...f, value: stand(f.value, "image") as SlotValue })),
      });
      const plan = planGeneration({ ...planned, prompt: planned.prompt || (config.promptOptional ? " " : "") }, catalog.getModel, catalog.getPreset);
      op = plan.op;
      laid = plan.layout;
      // A run with LoRAs (a Soul look) goes to the route's LoRA endpoint, which has its own price.
      const withLoras = plan.loras.length > 0 && routesFor(plan.model, plan.op).some((r) => !!r.loraEndpoint);
      cost = estimateCost(plan.model, plan.params, plan.jobs, plan.op, withLoras, today);
      loraPriceUnknown = withLoras && !!plan.model.pricing?.lorasUnknown;
      // A relight effect relights the start frame first (free on the GPU, about $0.04 in the cloud).
      if (cost !== null) cost += prestepCost(preset, plan.model.id, engine);
      // PixeletedFace pixelates each picture's faces afterwards ($0.01 a picture in the cloud, free on the GPU).
      if (cost !== null) cost += postStepCost(plan.model.id, planned.presetId, engine, planned.params?.numOutputs ?? 1, catalog.getModel, today);
    } catch (e) {
      planError = (e as Error).message;
    }
  }
  // What the clip's header rules out before Generate (as the server does): an upscale that wouldn't enlarge it,
  // an open tool that holds the whole clip in more RAM than the ComfyUI can spare.
  const clipProblem = config.clipFacts ? clipBlocker(studioOp ?? op, facts, draft.params, model, status?.providers.comfyui?.ramBytes) : null;
  if (clipProblem && !planError) planError = clipProblem;
  if (signed.blocker) planError = signed.blocker;
  // Models that take no prompt (try-on, 3D, transcription, upscalers), or can run without one, never ask for one.
  const promptMissing =
    !config.promptOptional &&
    !opts.promptless &&
    !opts.promptOptional &&
    preset?.userPrompt !== "none" &&
    preset?.userPrompt !== "optional" &&
    !draft.prompt.trim() &&
    !draft.params.shots?.some((s) => s.prompt.trim()) &&
    // Boxes say what the picture holds: the whole picture's caption can stay empty.
    !(layoutOn && draft.layout!.items.length > 0);
  const blocker = blockerFor({
    // A model outside the studio's slice (remembered, or handed over) is known once the full catalog arrives: loading until then, not "Pick a model".
    loading: !catalog.ready || (!model && !catalog.complete) ? "Loading models…" : presetLoading ? "Loading presets…" : null,
    model: !!model,
    engineError,
    frames: framesOn && model ? (framesBlocker(model, draft.frames!.length) ?? (framesGap ? { message: framesGap } : null)) : null,
    missing,
    uploading,
    cleaning: cleaningVoice,
    maskMissing: needsMask(model, config.sketch, draft.slots),
    planError,
    promptMissing,
  });

  // GPU pre-flight: the picked open tool's state on the viewer's GPU. Not ready (something to set up, or a bigger
  // GPU): Generate opens the guided fix instead of sending a run that would fail late, and the prompt stays here.
  const gpuBadges = useGpuBadges().data;
  const gpuOp = op ?? studioOp;
  // A preset's badge describes its route on the model picked (src/server/gpu/tools.ts): the first open route (its recipe's
  // when the catalog has its model) as "<id>", another one as "<id>@<model id>" (Fuobe DoP with the move's LoRAs). On a
  // model the preset has no route on, or at another Quality than the route's (H3's 8-step graph for a preset made at
  // Best), the model's own badge applies.
  const presetKey =
    preset && !takesLook && model
      ? presetGpuKey(preset, has, model.id, draft.params.extra?.quality, model.options.controls?.find((c) => c.param === "quality")?.default)
      : undefined;
  const presetGpu = presetKey && gpuBadges?.connected ? gpuBadges.presets[presetKey] : undefined;
  const gpuBadge = model?.engine === "open" && gpuBadges?.connected ? (presetGpu ?? badgeFor(gpuBadges, { modelId: model.id, op: gpuOp })) : null;
  const gpuSetup = gpuBadge && gpuBadge[0] !== "r" ? gpuBadge : null;
  const gpuRef = presetGpu && presetKey ? `preset:${presetKey}` : model ? `model:${model.id}#${gpuOp ?? Object.keys(gpuBadges?.models ?? {}).find((k) => k.startsWith(`${model.id}#`))?.split("#")[1] ?? ""}` : "";
  const openGpuFix = () => {
    setGpuRetry(
      () => submitRef.current(),
      () => submitRef.current(true),
      model?.kind,
    );
    openGpuSetup({ ref: gpuRef, name: presetGpu ? preset?.name : model?.name });
  };

  // An account's paid model it has no key for yet: Generate asks for the key (the note below says so too).
  const keyToAdd = model && status?.viewer?.paidAllowed !== false ? needsKey(model, status)?.[0] : undefined;

  // `skip` is true only from the guided fix's "Run anyway" (a click handler passes its event here).
  const submit = (skip?: unknown) => {
    const skipGpu = skip === true;
    if (keyToAdd && model && !create.isPending) return openAddKey(keyToAdd, model.id);
    if (!blocker && gpuSetup && !skipGpu && !create.isPending) return openGpuFix();
    if (blocker || create.isPending || signature.lock.isPending) {
      if (blocker) {
        // One blocker toast at a time (pressing Generate again replaces it), gone once a run starts.
        // A missing photo or clip: the toast's Upload opens the file picker (a click, so the browser allows it).
        const slot = blocker.slot;
        toast(blocker.message, { id: "composer-blocker", action: slot ? { label: "Upload", onClick: () => slotButton(root.current, slot)?.click() } : undefined });
        // Point at the tile to fill: the missing slot, or the clip list of a tool that only takes clips.
        const target = slot ?? (config.multiRef && config.hidePrompt && draft.refs.length < 2 ? "refs" : undefined);
        if (target) pulseSlot(root.current, target);
      }
      return;
    }
    toast.dismiss("composer-blocker");
    setRecent((r) => pushRecent(r, draft.modelId));
    // The server resolves @mentions and drawings itself; only pin the operation when there are none.
    // No "Queued" toast: the new card (and the "1 generating ↑" pill when it's off-screen) says it.
    const sent = signature.apply(buildRequest(config.feature, draft, resolvesOnServer ? studioOp : op, config.promptSuffix, config.multiRef?.kind, framesCtx, targetFor(draft.modelId)));
    // Open palette lock: the images are recoloured to the palette by a chained step (POST /api/palettes/lock).
    if (sent.lock) return signature.lock.mutate({ request: sent.request, colors: sent.lock.colors }, { onError: (e) => toastError(e) });
    // If the server's pre-flight stops it (409 gpu-setup), the guided fix that opens can try again, or run it anyway.
    setGpuRetry(
      () => submitRef.current(),
      () => submitRef.current(true),
      model?.kind,
    );
    // Hosted runs: where it should go, and the price shown (the server checks both; a higher price comes back to confirm).
    const hosted = viewerInfo?.hosted ? { place: runOn, ...(poolPrice && hostedQuote && { shown: { amount: hostedQuote.amount, priceVersion: hostedQuote.priceVersion } }) } : {};
    const body = { ...sent.request, ...hosted, ...(skipGpu && { gpuCheck: "skip" }) } as typeof sent.request;
    create.mutate(body, {
      // Accepted: nothing to try again (a card opened later never starts this run a second time).
      onSuccess: () => dropGpuRetry(),
      // Stopped by the GPU pre-flight, or refused with its own card: the guided fix or the card is open already, so no error toast on top.
      onError: (e) => void ((e as { gpuSetup?: boolean }).gpuSetup || toastError(e)),
    });
  };

  const runEnhance = async () => {
    if (!draft.prompt.trim()) return toast("Write a short idea first, then enhance it");
    setEnhancing(true);
    try {
      const p = await enhance(draft.prompt, config.kind, op ?? (config.kind === "video" ? "t2v" : "t2i"));
      setDraft({ prompt: p });
    } catch (e) {
      toastError(e);
    } finally {
      setEnhancing(false);
    }
  };

  // Paste images, clips or audio from the clipboard (text pastes as usual).
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => /^(image|video|audio)\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    attach.attachFiles(files);
  };

  const p = draft.params;
  const setP = (patch: Partial<typeof p>) => setDraft((d) => ({ params: { ...d.params, ...patch } }));
  const setExtra = (key: string, v: unknown) =>
    setDraft((d) => {
      const extra = { ...d.params.extra };
      if (v === undefined) delete extra[key];
      else extra[key] = v;
      return { params: { ...d.params, extra: Object.keys(extra).length ? extra : undefined } };
    });
  const opNote = op && model ? routesFor(model, op)[0]?.note : undefined;
  // Booleans in, not the model's options object: the React Compiler keeps the memos above.
  const showPrompt = showsPrompt({ hidePrompt: config.hidePrompt, modelPrompt: config.modelPrompt }, { promptless: !!opts.promptless, promptOptional: !!opts.promptOptional }, preset?.userPrompt);
  const effectiveOp = studioOp ?? op;
  // SDR to HDR, Export: every format the studio's models on this engine write; picking one this model doesn't
  // write moves the request to the model that does (EXR frames → LTX 2.3 HDR on the cloud).
  const engineModels = useMemo(() => models.filter((m) => m.engine === (model?.engine ?? engine)), [models, model?.engine, engine]);
  const studioFormats = useMemo(() => (config.formatPicker ? formatsOf(engineModels) : undefined), [config.formatPicker, engineModels]);
  const writerOf = (f: VideoFormat) => (model?.options.formats?.includes(f) ? model : engineModels.find((m) => m.options.formats?.includes(f)));
  const pickFormat = (f: VideoFormat) => {
    const m = writerOf(f);
    if (!m || m.id === model?.id) return setP({ format: f });
    setDraft((d) => ({ modelId: m.id, params: { ...m.defaults, format: f, numOutputs: d.params.numOutputs, seed: d.params.seed } }));
  };
  const formatVia = (f: VideoFormat) => {
    const m = writerOf(f);
    // "via LTX 2.3 HDR": the name without what it makes in brackets (the format already says it).
    return m && m.id !== model?.id ? `via ${m.name.replace(/\s*\([^)]*\)$/, "")}` : undefined;
  };
  // Enhance writes a scene; a tool's optional words (FLUX.3 Upscale's details) stay as typed.
  const baseShape = settingsShape(model, effectiveOp, config.kind, showPrompt && !config.hidePrompt, p, config.ops, studioFormats);
  const shape = framesCtx ? framesShape(baseShape, framesCtx.chained) : layoutOn ? layoutShape(baseShape) : baseShape;
  const outcome = config.clipFacts && draft.slots.video?.ref ? clipOutcome(effectiveOp, facts, p, model, today) : null;
  const video = draft.slots.video?.ref;
  const alternative = config.comfyOnly?.alternative;
  const alternativeHref = alternative && `${alternative.href}${video?.startsWith("/api/files/") ? `&video=${encodeURIComponent(video)}` : ""}`;
  const demo = !!(model && placeholdersOn(status?.demoMode));
  // On the open engine every run is free on the GPU: said even before the run can be planned (no voice sample, no clip yet).
  const ownCostText = costLabel({ demo, cost: cost ?? (engine === "open" && model ? 0 : null), unknown: loraPriceUnknown }, formatCost);
  // An account's paid run is billed to its own provider account (Your keys), or still needs that key.
  const payer = paidThrough(model, status);
  const missingKey = needsKey(model, status)?.[0];
  const ownPayerText = payer && cost ? ` · ${billedTo(payer)}` : missingKey ? ` · ${addKeyLabel(missingKey).toLowerCase()}` : "";
  // On this studio's GPUs: the quote's words (none from the server: free, as the open engine always is).
  const costText = poolPrice ? (priceUnavailable ? "Price unavailable" : hostedQuote?.text || ownCostText) : ownCostText;
  const payerText = poolPrice ? "" : ownPayerText;

  // Attachments: only when something is attached, a required slot is still empty, or none of a "one of these" group is filled (U8).
  const kinds = [...attach.kinds];
  const hasAttachment = slots.some((s) => draft.slots[s.key]) || draft.refs.length > 0;
  // Tools whose only input is a list of clips (Join clips) keep their "Add clip" tile in view.
  const showAttachments =
    framesOn ||
    ((slots.length > 0 || !!config.multiRef) && (hasAttachment || !!missing || !!slots.find((s) => s.required && !draft.slots[s.key]) || (!!config.multiRef && !showPrompt)));
  const collapsed = docked && !focused;
  // Docked and not focused, the tiles fold into one chip on the toolbar (the composer stays one line).
  const attached = [...slots.map((s) => draft.slots[s.key]), ...draft.refs, ...(draft.frames ?? []).map((f) => f.value)].filter((v): v is SlotValue => !!v);

  // Phones can't hover Generate for its tooltip, and a folded composer hides the tile it points at:
  // there the blocker is a line under the toolbar (blockerLine), and tapping it opens that tile (the
  // file picker, or the paint tool), as the tap is the click the browser needs for a picker.
  const line = blockerLine(blocker, collapsed);
  const blockerSlot = blocker?.slot ?? (config.multiRef && config.hidePrompt && draft.refs.length < 2 ? "refs" : undefined);
  const openBlocked = (key: string) => {
    flushSync(() => setFocused(true));
    const tile = root.current?.querySelector<HTMLElement>(`[data-slot-key="${key}"]`);
    const control = tile?.matches("button") ? tile : tile?.querySelector<HTMLButtonElement>('button[aria-label$=": upload"]');
    pulseSlot(root.current, key);
    // The focus moves into the tile (the press itself didn't take it), so leaving the composer folds it again.
    const target = control ?? tile?.querySelector<HTMLElement>("button");
    if (target) {
      target.focus({ preventScroll: true });
      control?.click();
      return;
    }
    // Nothing to focus: the next press outside the composer folds it.
    const fold = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node) || root.current?.contains(document.activeElement)) return;
      document.removeEventListener("pointerdown", fold, true);
      setFocused(false);
    };
    document.addEventListener("pointerdown", fold, true);
  };

  // A blocker toast goes away once it's out of date: the photo attached, the prompt typed (or the next blocker is a different one).
  const blocking = blocker?.message;
  useEffect(() => {
    toast.dismiss("composer-blocker");
  }, [blocking]);

  // Home's Start (go=<token>): run the handed-over prompt once the models and uploads have settled. A
  // blocker (Edit's photo) gets the usual toast, and its slot is pointed at, instead.
  const startRequest = useStartRequest();
  const startedFor = useRef(0);
  const submitRef = useRef(submit);
  useLayoutEffect(() => {
    submitRef.current = submit;
  });
  const settling = !catalog.ready || presetLoading || uploading || (needsFull && !catalog.complete);
  const step = startRequest ? startStep({ settling, blocker }) : "wait";
  const blockedSlot = blocker?.slot;
  useEffect(() => {
    if (step === "wait" || startRequest <= startedFor.current) return;
    startedFor.current = startRequest;
    // After the blocker toast above was cleared for this render.
    submitRef.current();
    // Nothing ran: the missing tile gets the focus, so Enter opens the file picker.
    if (step === "explain" && blockedSlot) requestAnimationFrame(() => slotButton(root.current, blockedSlot)?.focus({ preventScroll: true }));
  }, [step, startRequest, blockedSlot]);

  const pickModel = (m: ModelDef) => {
    setDraft((d) => ({ modelId: m.id, params: { ...m.defaults, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt, seed: d.params.seed }, ...lookCleared(model, m) }));
    if (m.engine !== engine) setEngine(m.engine);
  };
  // An app's two models on this engine (the one its preview was made with, then its own route's): a picker of those in
  // place of the model chip, listing the other engine's too for the picker's engine switch. A model switched off in
  // Settings → Models & licences leaves it.
  const appPickerModels = useMemo(
    () =>
      lockedModel && preset
        ? (["cloud", "open"] as const)
            .flatMap((e) => appModels(preset, e, has).filter((id) => catalog.offered(id, e)))
            .map((id) => catalog.getModel(id))
            .filter((m): m is ModelDef => !!m)
        : [],
    [lockedModel, preset, has, catalog],
  );
  const appChoice = appPickerModels.filter((m) => m.engine === engine).length > 1;
  const pickAppModel = (m: ModelDef) => {
    const route = routeParams(appRoute(preset, m.engine, m.id, has), "app");
    setDraft((d) => ({ modelId: m.id, params: { ...m.defaults, ...route, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt, seed: d.params.seed } }));
    if (m.engine !== engine) setEngine(m.engine);
  };

  // Frames on: the start and end frames already attached become the first frames. Off: the first and last frames
  // go back to start and end (the ones in between can come back with Undo).
  const framesLength = framesCtx?.duration ?? (model ? framesDuration(model, p.duration) : p.duration);
  const toggleFrames = () => {
    if (!draft.frames) {
      setDraft((d) => {
        const entered = enterFrames(d.slots);
        const cleared = onImageChange(d, entered.slots);
        return { frames: entered.frames, slots: cleared.slots, params: { ...(cleared.params ?? d.params), shots: undefined, multiShot: undefined, duration: framesLength } };
      });
      setFocused(true);
      return;
    }
    const before = { frames: draft.frames, slots: draft.slots, params: draft.params };
    const { slots: back, dropped } = leaveFrames(draft.frames, draft.slots);
    // A length only the open chain makes goes back to the nearest one the model makes on its own.
    const lengths = opts.durations;
    const duration = lengths?.length && p.duration !== undefined && !lengths.includes(p.duration) ? lengths.reduce((a, b) => (Math.abs(b - p.duration!) < Math.abs(a - p.duration!) ? b : a)) : p.duration;
    setDraft({ frames: undefined, slots: back, params: { ...p, duration } });
    if (dropped) toast(`Frames off — frames 1 and ${draft.frames.length} are your start and end frames`, { action: { label: "Undo", onClick: () => setDraft(before) } });
  };

  // Layout on: an empty layout on the picture's shape, and the editor opens to draw the first box. Off: the boxes go (Undo
  // brings them back); the prompt stays as written.
  const toggleLayout = () => {
    if (!draft.layout) {
      setDraft((d) => ({ layout: enterLayout(d.params, model) }));
      setLayoutEditing(true);
      setFocused(true);
      return;
    }
    const before = { layout: draft.layout, params: draft.params };
    const { params, dropped } = leaveLayout(draft.layout, draft.params);
    setDraft({ layout: undefined, params });
    if (dropped) toast(`Layout off — ${dropped} box${dropped === 1 ? "" : "es"} set aside`, { id: "layout-off", action: { label: "Undo", onClick: () => setDraft(before) } });
  };
  // The canvas the boxes are drawn on: the size this model renders (src/lib/catalog/plan.ts layoutCanvas).
  const canvasFor = (aspect: string | undefined) => layoutCanvas(model!, { ...draft.params, aspectRatio: aspect }, studioOp ?? "t2i");
  const layoutCanvasNow = layoutOn && model ? canvasFor(p.aspectRatio ?? model.defaults?.aspectRatio) : undefined;
  const boxModel = layoutOn && model ? layoutBoxModel(model, { id: BOX_MODELS[model.engine], getModel: catalog.getModel, offered: catalog.offered }) : undefined;
  const layoutStripNotes = layoutOn ? layoutNotes(model, layoutCanvasNow) : [];
  const layoutSummary = !model
    ? ""
    : laid?.width
      ? `Laid out for ${model.name} at ${laid.width} × ${laid.height}, the size it renders`
      : laid?.format === "flux3" || laid?.format === "ideogram"
        ? `${model.name} reads the boxes in place (its own layout form)`
        : laid
          ? `Sent to ${model.name} as sentences`
          : layoutCanvasNow
            ? `Drawn at ${layoutCanvasNow.exact ? "" : "about "}${layoutCanvasNow.width} × ${layoutCanvasNow.height}`
            : "";
  const layoutChip = config.layout ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Chip icon={LayoutDashboard} active={layoutOn} aria-pressed={layoutOn} onClick={toggleLayout}>
          Layout
        </Chip>
      </TooltipTrigger>
      <TooltipContent>{layoutOn ? "Back to a plain prompt" : "Draw boxes for where things go, with the exact words"}</TooltipContent>
    </Tooltip>
  ) : null;

  // What the model does with the frames, said under the strip before anything runs (with the model that takes them all).
  let framesNotice: FramesNotice | null = null;
  if (framesCtx && model && draft.frames) {
    const alt = catalog.getModel(FRAMES_MODELS[model.engine].id);
    const action = alt && alt.id !== model.id ? { label: `Use ${alt.name}`, onClick: () => pickModel(alt) } : undefined;
    const count = draft.frames.length;
    // On the open chain, a last frame far enough from the end gets a clip of its own after it.
    const tail = framesCtx.chained && count > 0 && framesCtx.duration - framesAt[count - 1] >= OPEN_MIN_GAP - 1e-6;
    const note = framesNote(model, count, draft.frames.at(-1)?.at, { suggested: alt, tail });
    if (framesCtx.support === "start" || framesCtx.support === "none") framesNotice = { text: `${framesBlocker(model, count)!.message}.`, tone: "warn", action };
    else if (framesGap) framesNotice = { text: `${framesGap}.`, tone: "warn" };
    else if (note) framesNotice = { text: note, tone: "info", action };
  }
  const framesChip = config.frames ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Chip icon={GalleryHorizontalEnd} active={framesOn} aria-pressed={framesOn} onClick={toggleFrames}>
          Frames
        </Chip>
      </TooltipTrigger>
      <TooltipContent>{framesOn ? "Back to a start and an end frame" : "Up to 10 frames, each at its own time"}</TooltipContent>
    </Tooltip>
  ) : null;

  // Voice, language, motion, style and Director chips: inline from sm up; on phones they live in the settings sheet, so the toolbar fits.
  const voiceChips = (
    <>
      {model && (opts.voices?.length || opts.voiceClone) && effectiveOp !== "dialogue" && (
        <VoicePicker
          model={model}
          voice={p.voice}
          sample={draft.slots.voiceAudio}
          label={effectiveOp === "voice-change" ? "New voice" : "Voice"}
          onChange={(c) => {
            if (c?.kind === "preset") setDraft((d) => ({ params: { ...d.params, voice: c.id }, slots: { ...d.slots, voiceAudio: null } }));
            if (c?.kind === "sample") setSlot("voiceAudio", c.value);
          }}
        />
      )}
      {/* Open-source dialogue clones each speaker from a sample. */}
      {model &&
        opts.voiceClone &&
        effectiveOp === "dialogue" &&
        (["voiceAudio", "voiceAudio2"] as const).map((key, i) => (
          <VoicePicker
            key={key}
            model={{ ...model, options: { ...model.options, voices: [] } }}
            sample={draft.slots[key]}
            label={`Speaker ${i ? "B" : "A"}`}
            onChange={(c) => c?.kind === "sample" && setSlot(key, c.value)}
          />
        ))}
      {model && opts.languages && (
        <LanguageChip languages={opts.languages} value={p.targetLanguage} label={effectiveOp === "dub" ? "Translate to…" : "Language"} onChange={(targetLanguage) => setP({ targetLanguage })} />
      )}
    </>
  );
  // A move's strength scales its LoRAs (Fuobe DoP's, Fuobe DoP · LTX's camera LoRA): the slider shows on a model whose
  // route of the move has them, else the note names the model that does (MiniMax H3 runs a move in words).
  const moveStrength = useMemo(() => {
    if (!preset || !model || (preset.type !== "motion" && preset.type !== "effect")) return { here: true };
    const scaled = (r: PresetRoute | null | undefined) => !!r?.loras?.length || !!r?.params?.extra?.camera_lora;
    if (presetRoutes(preset, engine, has).some((r) => r.modelId === model.id && scaled(r))) return { here: true };
    const own = engine === "open" ? preset.open : preset.cloud;
    return { here: false, on: scaled(own) && own!.modelId !== model.id ? catalog.getModel(own!.modelId)?.name : undefined };
  }, [preset, model, engine, has, catalog]);
  const styleChips = (
    <>
      {(config.presetPicker || (preset && (preset.type === "motion" || preset.type === "effect"))) && (
        <PresetChips
          picker={config.presetPicker}
          preset={preset}
          presetId={draft.presetId}
          strength={draft.presetStrength ?? 1}
          takesStrength={moveStrength.here}
          strengthOn={moveStrength.on}
          mix={draft.mix}
          onPreset={pickPreset}
          onMix={(patch) => setDraft(patch)}
        />
      )}
      {config.signature && (
        <SignatureChips
          value={draft.signature}
          onChange={(update) => setDraft((d) => ({ signature: update(d.signature) }))}
          engine={engine}
          lockByDefault={locksByDefault(model?.id)}
        />
      )}
      {opts.looks && (
        <LookChip
          value={draft.presetId}
          strength={draft.presetStrength ?? 1}
          onChange={(id, look) => {
            // A lettering look runs best on Fuobe Soul HD: move there when it's in this studio and can run what this
            // run does (Soul HD makes new pictures only: with a picture attached, Fuobe Soul edits it with the look's words).
            const hd = look?.hd && model?.id !== "fuobe-soul-hd" ? catalog.getModel("fuobe-soul-hd") : undefined;
            const fits = !!hd && routesFor(hd, effectiveOp ?? "t2i").length > 0;
            if (hd && fits) toast(`${look!.name} runs on Fuobe Soul HD (cleaner lettering)`);
            else if (hd) toast(`${look!.name} is made for Fuobe Soul HD, which doesn't edit pictures: here it uses its words`);
            // The strength stays as it was set (it scales whichever look runs, the General look too).
            setDraft({ presetId: id, ...(hd && fits && { modelId: hd.id }) });
          }}
          onStrength={(v) => setDraft({ presetStrength: v })}
        />
      )}
      {opts.controls && <ControlsChip controls={opts.controls} values={p.extra ?? {}} onChange={setExtra} title={config.controlsTitle} />}
    </>
  );
  const hasSecondary =
    !!config.frames ||
    !!config.layout ||
    (!!model && (!!opts.voices?.length || !!opts.voiceClone || !!opts.languages || !!opts.controls || !!opts.looks)) ||
    !!config.presetPicker ||
    !!config.signature ||
    preset?.type === "motion" ||
    preset?.type === "effect";

  return (
    <div
      ref={root}
      className={cn(
        "group/composer w-full rounded-[20px] border bg-background p-2.5 shadow-soft transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint sm:rounded-composer",
        docked && "shadow-normal",
      )}
      onPaste={onPaste}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        const to = e.relatedTarget as HTMLElement | null;
        // Moving into one of the composer's own popovers or sheets keeps it open.
        if (e.currentTarget.contains(to) || to?.closest("[data-radix-popper-content-wrapper],[role=dialog]")) return;
        setFocused(false);
      }}
      onKeyDown={(e) => {
        // ⌘/Ctrl+Enter generates from any field (shots, dialogue lines); the prompt handles Enter itself.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.defaultPrevented && !e.nativeEvent.isComposing) {
          e.preventDefault();
          submit();
        }
      }}
    >
      {framesOn && !collapsed && draft.frames && (
        <FramesStrip
          frames={draft.frames}
          duration={framesCtx?.duration ?? p.duration ?? 5}
          durations={model ? framesDurations(model) : [5]}
          onDuration={(duration) => setP({ duration })}
          onMove={(i, seconds) =>
            setDraft((d) => {
              if (!d.frames || !framesCtx) return {};
              const ats = moveFrameAt(d.frames.map((f) => f.at), i, seconds, framesCtx.duration);
              return { frames: d.frames.map((f, j) => ({ ...f, at: ats[j] })) };
            })
          }
          onFrame={attach.setFrameValue}
          onFrameFile={attach.uploadToFrame}
          onAddFile={(f) => attach.attachFiles([f])}
          onAddPick={attach.attach}
          onClose={toggleFrames}
          notice={framesNotice}
        />
      )}
      {layoutOn && !collapsed && draft.layout && (
        <LayoutStrip
          layout={draft.layout}
          aspect={p.aspectRatio ?? model?.defaults?.aspectRatio}
          summary={layoutSummary}
          notes={layoutStripNotes}
          action={boxModel ? { label: `Use ${boxModel.name}`, onClick: () => pickModel(boxModel) } : undefined}
          onEdit={() => setLayoutEditing(true)}
          onClose={toggleLayout}
        />
      )}
      {layoutEditing && layoutOn && draft.layout && model && (
        <LayoutEditor
          open
          onOpenChange={(o) => !o && setLayoutEditing(false)}
          layout={draft.layout}
          caption={draft.prompt}
          aspect={p.aspectRatio ?? model.defaults?.aspectRatio}
          aspects={model.options.aspectRatios}
          canvasFor={canvasFor}
          model={model}
          onDone={(r) =>
            setDraft((d) => ({
              layout: r.layout,
              prompt: r.caption,
              ...(r.aspect && r.aspect !== (d.params.aspectRatio ?? model.defaults?.aspectRatio) && { params: { ...d.params, aspectRatio: r.aspect } }),
            }))
          }
        />
      )}
      {showAttachments && !collapsed && !framesOn && (
        <div className="scrollbar-none flex items-center gap-2 overflow-x-auto px-1 pt-1.5 pb-2">
          {slots.map((s) =>
            s.cleanVoice && s.accept === "audio" ? (
              <CleanVoiceSlot
                key={s.key}
                slotKey={s.key}
                label={s.label}
                required={s.required}
                value={draft.slots[s.key] ?? null}
                onChange={(v) => attach.setSlotValue(s.key, v)}
                onFile={(f) => attach.uploadToSlot(s.key, f, s.accept)}
              />
            ) : (
              <MediaSlot
                key={s.key}
                slotKey={s.key}
                label={s.label}
                kind={s.accept}
                required={s.required}
                caption
                value={draft.slots[s.key] ?? null}
                onChange={(v) => attach.setSlotValue(s.key, v)}
                onFile={(f) => attach.uploadToSlot(s.key, f, s.accept)}
              />
            ),
          )}
          {hasCleanVoice && <CleanVoiceSwitch status className="hidden max-w-[16rem] shrink-0 sm:flex" hint="first, free on your GPU" />}
          {config.sketch && draft.slots.image?.ref && !draft.slots.image.uploading && (
            <SketchTools modes={config.sketch} image={draft.slots.image.ref} autoOpen={config.sketchAutoOpen} />
          )}
          {config.multiRef &&
            draft.refs.map((r, i) => (
              <div key={r.id ?? r.ref} className="relative size-14 shrink-0 overflow-hidden rounded-xl border bg-muted">
                <SlotPreview value={r} />
                {r.uploading && (
                  <div className="absolute inset-0 grid place-items-center bg-background/60" role="status" aria-label="Uploading">
                    <Loader2 className="size-4 animate-spin" />
                  </div>
                )}
                <button
                  onClick={() => attach.removeRef(r)}
                  className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-foreground/80 text-background"
                  aria-label={`Remove ${config.multiRef?.kind === "video" ? "clip" : "reference"} ${i + 1}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          {config.multiRef && draft.refs.length < refMax && (
            <MediaSlot
              slotKey="refs"
              label={named.refLabel ?? config.multiRef.label}
              kind={config.multiRef.kind ?? "image"}
              value={null}
              onFile={attach.addRefFile}
              onChange={(v) => v && setDraft((d) => ({ refs: [...d.refs, v] }))}
            />
          )}
        </div>
      )}
      {/* On a phone the slot row scrolls sideways, so the switch gets its own line under it. */}
      {showAttachments && !collapsed && !framesOn && hasCleanVoice && <CleanVoiceSwitch status className="px-3 pb-2 sm:hidden" hint="first, free on your GPU" />}

      {showPrompt && (
        <PromptInput
          ref={promptRef}
          value={draft.prompt}
          onChange={(v) => setDraft({ prompt: v })}
          onSubmit={submit}
          placeholder={
            layoutOn
              ? "Describe the whole picture… the boxes say what goes where"
              : (preset?.promptPlaceholder ?? (config.hidePrompt && config.modelPrompt ? config.modelPrompt : config.placeholder))
          }
          elements={elements}
          collapsed={collapsed}
          elementsNote={elementsNote(model)}
        />
      )}

      {model && effectiveOp === "dialogue" && <DialogueEditor model={model} lines={p.dialogue ?? defaultLines(model)} onChange={(dialogue) => setP({ dialogue })} />}

      {model?.options.multiShot && p.shots && <ShotsEditor model={model} shots={p.shots} onChange={(shots) => setP({ shots })} />}

      {/* @mentioned elements */}
      {mentions.mentioned.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
          {mentions.mentioned.map((el) => {
            const Icon = ELEMENT_ICONS[el.kind];
            const words = mentions.notes.find((n) => n.startsWith(`${el.name} `));
            return (
              <Tooltip key={el.id}>
                <TooltipTrigger asChild>
                  <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border bg-background pr-2.5 pl-0.5 text-[12px] font-medium", words && "border-dashed text-muted-foreground")}>
                    <span className="grid size-6 place-items-center overflow-hidden rounded-full bg-muted">
                      {el.references[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={el.references[0]} alt="" className="size-full object-cover" />
                      ) : (
                        <Icon className="size-3.5" />
                      )}
                    </span>
                    {el.name}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {words ?? (el.loras.some((l) => l.modelId === model?.id) ? `Uses ${el.name}'s trained LoRA on ${model?.name}` : `${el.name}'s photos are sent as reference images`)}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}

      {/* Preset options (apps) */}
      {preset?.options?.length ? (
        <div className="flex flex-wrap gap-3 px-1.5 pb-2">
          {preset.options.map((o) => (
            <div key={o.key} role="radiogroup" aria-label={o.label} onKeyDown={radioKeys} className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[12px] text-muted-foreground">{o.label}</span>
              {o.choices.map((c) => {
                const sel = (draft.presetOptions[o.key] ?? o.default ?? o.choices[0].value) === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    tabIndex={radioTab(sel)}
                    onClick={() => setDraft((d) => ({ presetOptions: { ...d.presetOptions, [o.key]: c.value } }))}
                    className={cn("h-7 rounded-full border px-2.5 text-[12px] font-medium transition-colors", sel ? "border-primary bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent")}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      {/* Toolbar: one row on phones (it scrolls, with faded edges, when it does not fit); from sm up it wraps, so every chip shows. */}
      <div className="flex items-center gap-2">
        {/* Phones (below sm): "+", Settings (icon), the model (it shrinks to fit) and @; the other chips are in the settings sheet. */}
        <div ref={chipRow} style={fade} data-composer-toolbar className="scrollbar-none -my-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 sm:flex-wrap sm:overflow-x-visible">
          {kinds.length > 0 && <AttachMenu kinds={kinds} onFiles={attach.attachFiles} onPick={attach.attach} />}
          {collapsed && showAttachments && attached.length > 0 && (
            <button
              type="button"
              onClick={() => setFocused(true)}
              aria-label={`${attached.length} attached. Show attachments`}
              className={cn(chipBase, chipIdle, "gap-1.5 pl-1 max-sm:order-1")}
            >
              <span className="flex -space-x-2.5">
                {attached.slice(0, 3).map((v, i) => (
                  <span key={v.id ?? `${v.ref}-${i}`} className="size-6 overflow-hidden rounded-full border-2 border-secondary bg-muted">
                    <SlotPreview value={v} />
                  </span>
                ))}
              </span>
              <span className="tabular-nums">
                {attached.length}
                <span className="max-sm:hidden"> attached</span>
              </span>
            </button>
          )}
          {/* The model chip may shrink (its name truncates) on phones, so the row fits without scrolling. */}
          <span className="flex min-w-0 shrink-0 max-sm:order-2 max-sm:min-w-[4.5rem] max-sm:shrink max-sm:[&>button]:min-w-0 max-sm:[&>button]:shrink max-sm:[&>button>svg:first-child]:hidden">
            {!lockedModel || appChoice ? (
              catalog.ready ? (
                <ModelPicker
                  models={appChoice ? appPickerModels : models}
                  value={model}
                  engine={engine}
                  onEngineChange={setEngine}
                  defaultModels={defaults}
                  ops={pickerOps}
                  onChange={appChoice ? pickAppModel : pickModel}
                  recipe={recipeModel}
                  flat={appChoice}
                  madeWith={madeWith}
                  boxes={layoutOn}
                />
              ) : (
                <Chip icon={Loader2} disabled className="[&>svg]:animate-spin">
                  Loading models…
                </Chip>
              )
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Chip icon={model?.engine === "cloud" ? Cloud : Cpu} aria-label={`${preset?.name} runs on ${model?.name ?? "its own model"}${model && model.id === madeWith ? ", used for this preview" : ""}`}>
                    <span className="min-w-0 truncate">{model?.name ?? "…"}</span>
                    {model && model.id === madeWith && <Sparkles className="size-3.5 shrink-0 text-brand-text" aria-hidden />}
                  </Chip>
                </TooltipTrigger>
                <TooltipContent>
                  {preset?.name} runs on {model?.name ?? "its own model"}
                  {model && model.id === madeWith ? " · Used for this preview" : ""}
                </TooltipContent>
              </Tooltip>
            )}
          </span>
          {showPrompt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => promptRef.current?.startMention()}
                  // Phones: at the end of the row (typing @ does the same); folded away with the docked composer.
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:order-3",
                    collapsed && "max-sm:hidden",
                  )}
                  aria-label="Add an element"
                >
                  <AtSign className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add a character, location or prop · type @</TooltipContent>
            </Tooltip>
          )}
          <span className="contents max-sm:hidden">
            {framesChip}
            {layoutChip}
            {voiceChips}
          </span>
          <SettingsChip
            model={model}
            op={op}
            shape={shape}
            params={p}
            setP={setP}
            setExtra={setExtra}
            negativePrompt={draft.negativePrompt}
            setNegativePrompt={(negativePrompt) => setDraft({ negativePrompt })}
            kind={config.kind}
            enhancing={enhancing}
            onRewrite={runEnhance}
            opNote={opNote}
            onFormat={pickFormat}
            formatVia={formatVia}
            className="max-sm:order-1"
            extras={
              hasSecondary ? (
                <>
                  {framesChip}
                  {layoutChip}
                  {voiceChips}
                  {styleChips}
                </>
              ) : undefined
            }
          />
          <span className="contents max-sm:hidden">{styleChips}</span>
        </div>
        {hostedHere && viewerInfo?.gpu.connected && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setRunOn(runOn === "own" ? "pool" : "own")}
            aria-label={`Runs on ${runOn === "own" ? "your GPU" : "this studio's GPUs"}. Switch`}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground underline decoration-border-strong underline-offset-2 hover:text-foreground"
          >
            {runOn === "own" ? "Your GPU" : "This studio's GPUs"}
          </button>
        )}
        {costText && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 text-[12px] font-medium text-muted-foreground tabular-nums">
                <span className="sm:hidden">{poolPrice ? costText : costLabel({ demo, cost, compact: true, unknown: loraPriceUnknown }, formatCost)}</span>
                <span className="hidden sm:inline">
                  {costText}
                  {payerText}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {poolPrice
                ? priceUnavailable
                  ? "Runs on this studio's GPUs are paused for a moment. Try again soon, or run on your own GPU."
                  : (hostedQuote?.sub ?? "Runs on this studio's GPUs")
                : demo
                ? "Placeholder results are on (Settings), so outputs are free stand-ins"
                : cost === 0
                  ? "Runs on your own GPU"
                  : missingKey
                    ? `Runs on ${CLOUD_KEY[missingKey].label}, billed to your own ${CLOUD_KEY[missingKey].label} account. Add your key in Settings → Your keys.`
                    : cost === null
                      ? "The provider publishes no price for this model with LoRAs yet: it bills your key at its own rate"
                      : payer
                        ? `Estimated cost, billed to ${billedTo(payer)}. ${CLOUD_KEY[payer].label}'s bill is the final word.`
                        : "Estimated cost, billed by the provider to your key"}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              onClick={submit}
              disabled={create.isPending || signature.lock.isPending || priceUnavailable}
              aria-label={blocker ? `Generate — ${blocker.message}` : "Generate"}
              // Blocked, it stays the brand colour (paler, the arrow still 3:1 or more): pressing it still says what's missing and points at it.
              className={cn("size-10 shrink-0 rounded-full", blocker && "bg-primary/70 hover:bg-primary/80")}
            >
              {create.isPending || signature.lock.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {blocker?.message ?? (
              <span className="flex items-center gap-1.5">
                Generate <Kbd>↵</Kbd>
                {costText && <span className="text-muted-foreground tabular-nums">· {costText}</span>}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      </div>
      <div aria-live="polite">
        {line && blocker && (
          // Focused from the keyboard, it stays (the composer unfolding must not hide what has the focus).
          <p className={cn("px-2 text-[12px] text-muted-foreground", line === "touch" && "[@media(hover:hover)]:hidden [@media(hover:hover)]:focus-within:block")}>
            {blockerSlot ? (
              <button
                type="button"
                // A mouse press would focus the composer and unfold it under the pointer before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => openBlocked(blockerSlot)}
                className="inline-flex min-h-6 items-center text-left underline decoration-border-strong underline-offset-2 hover:text-foreground hover:decoration-current"
              >
                {blocker.message}
              </button>
            ) : (
              <span className="inline-flex min-h-6 items-center">{blocker.message}</span>
            )}
          </p>
        )}
        {!blocker && gpuSetup && (
          <p className="px-2 text-[12px] text-muted-foreground">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={openGpuFix}
              className="inline-flex min-h-6 items-center text-left underline decoration-border-strong underline-offset-2 hover:text-foreground hover:decoration-current"
            >
              {badgeText(gpuSetup, gpuBadges?.gpu).long}
            </button>
          </p>
        )}
      </div>
      {outcome && (
        <p className="px-2 pt-1 text-[12px] text-muted-foreground tabular-nums" aria-live="polite">
          {outcome}
        </p>
      )}
      {comfyMissing && (
        <div role="note" className="mx-1 mt-2 space-y-1 rounded-xl border border-dashed px-3 py-2 text-[12px] leading-snug text-muted-foreground">
          <p>
            {engineMode === "cloud"
              ? "This install runs paid cloud APIs only (Settings → Engine mode), and no cloud API re-encodes a finished clip: export formats are written by ComfyUI on your own machine."
              : config.comfyOnly!.note}{" "}
            {hostedPage && engineMode !== "cloud" && !status?.viewer ? (
              <button type="button" onClick={() => window.dispatchEvent(new Event(CONNECT_GPU_EVENT))} className="font-medium text-brand-text underline-offset-2 hover:underline">
                Connect your GPU
              </button>
            ) : (
              <Link href="/settings" className="font-medium text-brand-text underline-offset-2 hover:underline">
                Open Settings
              </Link>
            )}
          </p>
          {alternative && alternativeHref && engineMode !== "open" && (
            <p>
              <Link href={alternativeHref} onClick={() => setEngine("cloud")} className="font-medium text-brand-text underline-offset-2 hover:underline">
                {alternative.label}
              </Link>
            </p>
          )}
        </div>
      )}
      {keyToAdd && model && (
        <div role="note" className="mx-1 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-dashed px-3 py-2 text-[12px] leading-snug text-muted-foreground">
          <p className="min-w-0 flex-1 basis-56">
            {model.name} runs on {CLOUD_KEY[keyToAdd].label}, billed to your own {CLOUD_KEY[keyToAdd].label} account. Add your {CLOUD_KEY[keyToAdd].label} key to run it.
          </p>
          <Button size="sm" variant="secondary" className="h-7" onMouseDown={(e) => e.preventDefault()} onClick={() => openAddKey(keyToAdd, model.id)}>
            Add key
          </Button>
        </div>
      )}
      {sketched.note && <p className="px-2 pt-1 text-[12px] text-muted-foreground">{sketched.note}</p>}
      {signed.notes.length > 0 && <p className="px-2 pt-1 text-[12px] text-muted-foreground">{signed.notes.join(" · ")}</p>}
      {model && op && model.options.endFrame === undefined && draft.slots.endImage?.ref && (
        <p className="px-2 pt-1 text-[12px] text-warning">{model.name} ignores the end frame — pick Kling 2.5, Veo 3.1, Seedance or Wan 2.2 to use it.</p>
      )}
    </div>
  );
}

export { buildRequest };
