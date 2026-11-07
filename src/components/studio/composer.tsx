"use client";

import { OrbitPad, orbitOptions } from "@/components/studio/orbit-pad";
import { ArrowUp, AtSign, Cloud, Cpu, GalleryHorizontalEnd, LayoutDashboard, Library, Loader2, Sparkles, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { openAddKey } from "@/components/keys/your-keys";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToday } from "@/hooks/use-today";
import { estimateCost, imageLimit, layoutCanvas, mixLimit, planGeneration, routesFor, type Plan } from "@/lib/catalog/plan";
import type { Engine, InputSlot, MediaKind, ModelDef, Operation, Preset, PresetRoute, VideoFormat } from "@/lib/catalog/types";
import { LYRICS_PARAM, SONG_ID_PARAM, songFormat, songToolProblem, withSongId } from "@/lib/lyrics";
import { murekaSongRule, SONG_FIT_OPS } from "@/lib/av/song-fit";
import { FitUploadNote, useFitUpload } from "@/components/av/fit-upload";
import { FitClipNote, useClipFit } from "@/components/av/fit-clip";
import { ListFit, useAddFit, type ListItem } from "@/components/av/fit-list";
import { ElementClipFix, useElementClipCheck } from "@/components/av/element-clip-fit";
import { trimLine, trimTarget } from "@/lib/av/reference-fit";
import { FitCropNote, useCropFit } from "@/components/av/fit-crop";
import { fitStill, stillEndpoint } from "@/components/av/fit-still";
import { portraitRatio } from "@/lib/catalog/clip-windows";
import { sampleFitRule, shortName, voiceFitRule } from "@/lib/av/voice-fit";
import { dualEngine, onEngine, runsOn } from "@/lib/catalog/engines";
import type { Unavailable } from "@/lib/unavailable";
import { locksByDefault } from "@/lib/catalog/palettes";
import { DEFAULT_LOOK, lookCard } from "@/lib/catalog/soul-cards";
import { formatsOf } from "@/lib/av/formats";
import { poolRunState, quoteBody, useHostedQuote, useSettled, type RunOn } from "@/lib/hosted";
import { composerOnPool, composerPlace, keyOnlyChip, placeRows, type RunOnPick } from "@/lib/run-place";
import { useSetRunOn } from "@/lib/run-on";
import { RunOnChip } from "./run-on";
import { PlaceIntro } from "./place-intro";
import { PoolNote } from "./pool-note";
import { EndFrameNote } from "./end-frame-note";
import { modelOwnSetup, pickerRules, poolRunsModel } from "@/lib/pool-rules";
import { controlSetup, keyOnlySetup } from "@/lib/own-setup-controls";
import { ownSetupDetail, ownSetupLabel, ownSetupShort } from "@/lib/own-setup";
import { OwnSetupChip, useOwnSetupPress, useOwnSetupViewer } from "@/components/own-setup";
import { HoldFilesCtx } from "@/lib/held-files";
import { PENDING_WORDS, pendingStep } from "@/lib/guest-draft";
import { useGuestDraft } from "./guest-draft";
import { ExactOrbitControls } from "@/components/exact-orbit-controls";
import { useFlyAround } from "@/components/fly-around-run";
import { exactDefaults, takesExact, type ExactOrbit } from "@/lib/exact-orbit";
import { placeOf } from "@/lib/place-name";
import { askToSignUp, CONNECT_GPU_EVENT, engineForNextPage, enhance, useClipFacts, useCreateGeneration, useElements, useEngine, useHydrated, useIsGuest, useIsOwner, useLikelyVisitor, useNewestRun, useStatus } from "@/lib/api";
import { keyTurnedDown, keyTurnedDownWords, siteRunOf, siteRunRequest } from "@/lib/site-run";
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
} from "@/lib/catalog/keyframes";
import { timingFor, timingFromTimes, timingProblem, type InbetweenTiming } from "@/lib/inbetween";
import { appModels, presetGpuKey, presetRoutes, recipeRoute } from "@/lib/catalog/preset-recipe-routes";
import {
  appRoute,
  blockerFor,
  blockerLine,
  clipBlocker,
  clipFitWindow,
  clipOutcome,
  costLabel,
  engineSwitchModel,
  enterFrames,
  enterLayout,
  filterModels,
  firstMissingSlot,
  followEngineParams,
  framesShape,
  framesSlots,
  framesUploading,
  layoutBoxModel,
  layoutNotes,
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
  saysYourGpu,
  untouchedParams,
  settingsShape,
  showsPrompt,
  startStep,
  viewerDefaults,
  writesCaptions,
  WRITE_PROMPT,
} from "@/lib/composer";
import { qwen21Note } from "@/lib/qwen21-speed";
import { H3_TIER_PARAM, h3TierNote } from "@/lib/gpu/h3-tier";
import { formatCost } from "@/lib/format";
import { toastError } from "@/lib/refusals";
import { addKeyLabel, billedTo, CLOUD_KEY, cloudVersion, isCloudProvider, needsKey, paidThrough, startingModel, type CloudProvider } from "@/lib/your-keys";
import { anywayKeys, anywaySaid, likelyProvider, routeNotice } from "@/lib/catalog/route-notice";
import { beforeRunTail, gpuBeforeRun, onCloudKey, runOnceOnKey } from "@/lib/before-run";
import { BILLING_URL, ISOLATED_ON_GPU_WHY, withKeyAction, type TroubleAction } from "@/lib/diagnose";
import { openModelPicker } from "@/lib/open-model-picker";
import { GpuReadinessLine } from "@/components/gpu/file-steps";
import { TroubleActions, TroubleDetails } from "@/components/gpu/trouble";
import { cn } from "@/lib/utils";
import { H3_REFERENCE_LIMITS, h3ReferenceProblem, openReferenceMode } from "@/lib/h3-references";
import { badgeFor, badgeText, dropGpuRetry, openGpuSetup, setGpuRetry, useGpuBadges } from "@/hooks/use-gpu";
import { AttachMenu } from "./attach-menu";
import { useAttach, useComposerBridge, useUploadReaper } from "./attachments";
import { buildRequest, type FramesContext } from "./build-request";
import { DialogueEditor, LanguageChip, VoicePicker } from "./audio-controls";
import { FramesStrip, type FramesNotice } from "./frames-strip";
import { LayoutStrip } from "./layout-strip";
import { loadFullCatalog, useCatalog } from "./catalog";
import { Chip, chipBase, chipIdle } from "./chip";
import { ReferenceOrder, ReferenceTiles, useMediaSeconds } from "./reference-tray";
import { MediaSlot, SlotPreview, type SlotValue } from "./media-slot";
import { InsertRangeChip, LightSphereChip } from "./hosted-chips";
import { voiceWindowProblem } from "@/lib/catalog/clip-windows";
import { ControlsChip } from "./model-controls";
import { ModelPicker } from "./model-picker";
import { FinishChoices } from "./finish-choices";
import { waitForGeneration } from "@/components/genjutsu/hooks";
import { REGEN_DESCRIBE_MODEL, REGEN_MODEL, regenDescribeRequest, regenDescription } from "@/lib/catalog/regenerate";
import { ELEMENT_ICONS, PromptInput, type PromptInputHandle } from "./prompt-input";
import { radioKeys, radioTab } from "./radio-keys";
import { SettingsChip } from "./settings-panel";
import { ShotsEditor } from "./shots-editor";
import { LyricsEditor } from "./lyrics-editor";
import { SketchTools } from "./sketch-tools";
import { RECENT_MODELS, useStoredList } from "./stored-list";
import { usePresetUrl, useStartRequest, useStudio, type Draft } from "./studio-context";
import { useEdgeFade } from "./use-edge-fade";
import { CleanVoiceSlot, CleanVoiceSwitch, useVoiceCleaning } from "@/components/audio-tools/clean-voice-switch";
import { useVoiceFirstLive, useVoiceFirstShown, VoiceFirstSwitch } from "@/components/audio-tools/voice-first-switch";
import { VOICE_FIRST_PARAM, voiceFirstDefault } from "@/lib/av/voice-first";
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

/** Operations whose models sing lyrics (the lyrics editor): a song, and a song extended or remixed. */
const SUNG_OPS = new Set<Operation>(["music", "song-extend", "song-remix"]);

/**
 * Audio → Music: the lyrics go to a model that sings them (params.extra.lyrics), and a song to cover only to a model that
 * covers one (the slot is hidden for the others, so a song left there from YuE2 is never sent to them).
 */
function songDraft<D extends Pick<Draft, "lyrics" | "params" | "slots" | "song">>(d: D, model: ModelDef | undefined, slots: InputSlot[]): D {
  let out = d;
  if (d.lyrics?.trim() && model?.options.lyrics) out = { ...out, params: { ...out.params, extra: { ...out.params.extra, [LYRICS_PARAM]: d.lyrics } } };
  // One of Mureka's own songs, still the one attached: its tools take it by id (no upload). Any other song goes as itself.
  if (d.song || (out.params.extra && SONG_ID_PARAM in out.params.extra)) {
    out = { ...out, params: { ...out.params, extra: withSongId(out.params.extra, d.song, d.slots.audio?.ref, model?.family === "mureka") } };
  }
  const hidden = slots.filter((s) => s.cover && !model?.options.cover && out.slots[s.key]).map((s) => s.key);
  if (hidden.length) out = { ...out, slots: Object.fromEntries(Object.entries(out.slots).filter(([k]) => !hidden.includes(k as InputSlot["key"]))) };
  return out;
}

/** Leaving a model that takes looks (Fuobe Soul) for one that doesn't: the look (its presetId) doesn't come along. */
function lookCleared(from: ModelDef | undefined, to: ModelDef): Partial<Draft> {
  return from?.options.looks && !to.options.looks ? { presetId: undefined, presetStrength: undefined } : {};
}

/** Docked and collapsed, the composer hides its tiles: this event asks it to open first. */
const EXPAND_EVENT = "composer:expand";

/** "Run anyway" keys (route-notice.ts anywayKeys) for this tab's session. */
const ANYWAY_KEY = "fuobe:route-anyway";

function readAnyway(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(ANYWAY_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function keepAnyway(keys: string[]) {
  try {
    sessionStorage.setItem(ANYWAY_KEY, JSON.stringify(keys.slice(-50)));
  } catch {
  }
}

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
  const visitor = useLikelyVisitor();
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
  const facts = useClipFacts(config.clipFacts && !typed.slots.video?.uploading && !typed.slots.video?.held ? typed.slots.video?.ref : undefined).data;
  // Regenerate · creative needs words: a clip with none (an upload) can have Fuobe's reading model on your GPU describe it,
  // into the prompt box to edit before the run. A second instance, so the composer's own Generate state isn't touched.
  const describeRun = useCreateGeneration();
  const [describing, setDescribing] = useState(false);
  const describeAlive = useRef<AbortController | null>(null);
  useEffect(() => () => describeAlive.current?.abort(), []);
  // Lipsync: a talking avatar is as long as its voice (the voice's header prices it and goes with the request); not while a
  // video is attached (lip re-sync keeps the clip's length).
  const voiceRef = config.voiceFacts && !typed.slots.video?.ref && !typed.slots.audio?.uploading && !typed.slots.audio?.held ? typed.slots.audio?.ref : undefined;
  const voice = useClipFacts(voiceRef).data;
  // "Clean the voice first" (Transcribe, Lipsync): the recording or the video's speech apart from its music and effects
  // before the model hears it. On for a video's speech on your GPU, off for a recording (src/lib/av/voice-first.ts).
  // Shown to every visitor: until it passes on this studio's GPU it runs on their own GPU or key, labelled so.
  const voiceFirstShown = useVoiceFirstShown(true);
  const voiceFirstLive = useVoiceFirstLive();
  const [voiceFirstAsked, setVoiceFirstAsked] = useState<boolean | null>(null);
  const voiceFirstKind: "audio" | "video" | null = !config.voiceFirst ? null : typed.slots.audio?.ref ? "audio" : typed.slots.video?.ref && config.ops.includes("transcribe") ? "video" : null;
  const draft = useMemo(
    () =>
      config.clipFacts
        ? {
            ...typed,
            params: {
              ...typed.params,
              sourceDuration: typed.slots.video?.ref ? facts?.duration : undefined,
              sourceFps: typed.slots.video?.ref ? facts?.fps : undefined,
              // An upscale billed per output frame (Kandinsky VSR) is priced on the clip's size.
              sourceSize: typed.slots.video?.ref && facts?.width && facts.height ? { width: facts.width, height: facts.height } : undefined,
            },
          }
        : config.voiceFacts
          ? { ...typed, params: { ...typed.params, sourceDuration: voiceRef ? voice?.duration : undefined } }
          : typed,
    [config.clipFacts, config.voiceFacts, typed, facts?.duration, facts?.fps, facts?.width, facts?.height, voiceRef, voice?.duration],
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
  // For a viewer whose runs go to this studio's GPUs (hosted runs), the open models they keep off stay in the list with
  // what runs them (their own-setup label, src/lib/pool-rules.ts), as the models that run on a visitor's own setup only
  // do: Run then opens that setup, or runs it on the viewer's own GPU at once. Only a viewer with no GPU of its own is
  // moved off an untouched default they keep off (poolOff, below).
  const poolRules = status?.viewer?.hosted && !status.viewer.gpu.connected ? status.viewer.pool : undefined;
  const labelRules = pickerRules(status?.viewer);
  const models = useMemo(() => filterModels(catalog.models, { kind: config.kind, ops: pickerOps }), [catalog.models, config.kind, pickerOps]);
  const setupViewer = useOwnSetupViewer();
  const pressSetup = useOwnSetupPress();
  const modelSetup = useCallback((m: ModelDef) => (setupViewer ? modelOwnSetup(labelRules, m) : null), [setupViewer, labelRules]);
  const model: ModelDef | undefined = catalog.getModel(draft.modelId);
  // MiniMax H3 on your GPU has a References mode (Pika H3 Flex): reference clips and voice or music clips beside the images.
  const refMode = config.ops.includes("ref2v") ? openReferenceMode(model) : null;
  const [refsOpen, setRefsOpen] = useState(false);
  const refClips = refMode ? (draft.refClips ?? []) : [];
  const refAudios = refMode ? (draft.refAudios ?? []) : [];
  const refSeconds = useMediaSeconds([...refClips, ...refAudios]);
  // Fuobe Soul's presetId is a look (its own chip), not an app, motion or effect.
  const takesLook = !!model?.options.looks;
  const preset: Preset | undefined = draft.presetId && !takesLook ? catalog.getPreset(draft.presetId) : config.preset;
  const lockedModel = preset?.type === "app";
  // Fuobe DoP's orbit moves: the Exact switch films the orbit by its numbers through /api/fly-around.
  // It starts with a 3D depth step and films on a 48 GB GPU or a fal.ai key: a visitor sees it with that label, and Run
  // opens the setup it lacks (own-setup.ts "fly-around:exact-orbit").
  const owner = useIsOwner();
  const exactId = preset?.type === "motion" && takesExact(preset.id) ? preset.id : undefined;
  const [exactBy, setExactBy] = useState<{ id: string; orbit: ExactOrbit } | null>(null);
  const exact = exactId && exactBy?.id === exactId ? exactBy.orbit : null;
  const exactImage = draft.slots.image?.ref;
  const fly = useFlyAround(exact ? { engine, image: exactImage, orbit: exact, prompt: draft.prompt.trim() || undefined, feature: config.feature } : null);
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
    return { engine: dualEngine(m) ? engine : undefined, looks: !!m?.options.looks, refs: config.ops.includes("ref2v") && !!openReferenceMode(m) };
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

  // The studio's untouched default that this studio's GPUs keep off, for a viewer with no GPU of its own: the composer
  // moves to the first model of its list they run. A model the person picked (or a link, a Reuse) stays, with its label,
  // and Run opens the setup that runs it.
  const untouched = !!model && (model.id === config.defaultModels[engine] || model.id === defaults[engine]);
  const poolOff = model && untouched && !lockedModel && !presetFallback && !offModel && !poolRunsModel(poolRules, model) ? model : undefined;
  const poolTo = poolOff
    ? [defaults[engine], ...models.filter((m) => m.engine === engine).map((m) => m.id)].find((id) => {
        const m = id && id !== poolOff.id ? models.find((x) => x.id === id) : undefined;
        return !!m && poolRunsModel(poolRules, m) && !modelSetup(m);
      })
    : undefined;
  useEffect(() => {
    const m = poolOff && poolTo ? catalog.getModel(poolTo) : undefined;
    // A link that names the model keeps it.
    if (!m || !poolOff || new URLSearchParams(window.location.search).get("model") === poolOff.id) return;
    setDraft((d) => (d.modelId !== poolOff.id ? {} : { modelId: m.id, params: { ...m.defaults, numOutputs: d.params.numOutputs, enhancePrompt: d.params.enhancePrompt }, ...lookCleared(poolOff, m) }));
  }, [poolOff, poolTo, catalog, setDraft]);

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
  // A studio's other tool on the model picked (Edit video's "Insert a moment" on H3 Max insert) takes the pin's place.
  const pinnedOp = config.ops.length === 1 && !preset ? config.ops[0] : undefined;
  const studioOp =
    pinnedOp && model && !model.routes.some((r) => r.op === pinnedOp) ? (model.routes.find((r) => config.pickerOps?.includes(r.op))?.op ?? pinnedOp) : pinnedOp;
  const opts = model?.options ?? {};
  // Try-on names its images: "Person photo", then "Add garment" (instead of "Image" / "Add ref").
  const baseSlots = preset?.inputs ?? config.slots;
  const named = useMemo(
    () => namedImageSlots(baseSlots, model?.options.imageLabels, config.multiRef?.label, draft.refs.length),
    [baseSlots, model?.options.imageLabels, config.multiRef?.label, draft.refs.length],
  );
  // A song to cover (Audio → Music) shows only for a model that covers one (YuE2).
  const slots = useMemo(() => named.slots.filter((s) => !s.cover || !!model?.options.cover), [named.slots, model?.options.cover]);
  const hasCleanVoice = slots.some((s) => s.cleanVoice && s.accept === "audio");
  // Clips: ComfyUI joins 4 at a time. Images: what the model takes beyond the fixed image slots, for the operation the run
  // will be (a painted mask makes it an inpaint, which Qwen-Image 2.1 runs on the picture alone).
  const refOp = studioOp ?? (draft.slots.mask?.ref && model && routesFor(model, "inpaint").length ? "inpaint" : undefined);
  const refMax = !config.multiRef
    ? 0
    : config.multiRef.kind === "video"
      ? Math.min(config.multiRef.max, model?.engine === "open" ? 4 : config.multiRef.max)
      : refMode
        ? Math.max(0, refMode.images - 1)
        : Math.min(config.multiRef.max, Math.max(0, ((model ? imageLimit(model, refOp) : opts.maxImages) ?? 1) - slots.filter((s) => s.accept === "image").length));
  // Hosted runs on, a guest's files are kept in this browser until sign-up (HoldFilesForGuests), and its whole draft and
  // the run it pressed come back after it (useGuestDraft).
  const guestHold = useContext(HoldFilesCtx);
  // A song tool's song dropped or pasted on the page goes to its slot's converter first (useSongFit, below).
  const songRoute = useRef<((f: File) => boolean) | null>(null);
  const routeSong = useCallback((f: File) => songRoute.current?.(f) ?? false, []);
  const attach = useAttach(slots, refMax, { hold: guestHold, route: routeSong });
  const guestDraft = useGuestDraft({ hold: guestHold, viewer: status?.viewer?.kind, draft: typed, setDraft });
  // The price changed since its guest pressed Run: said once, and Run waits for a click.
  const [priceNote, setPriceNote] = useState<string | null>(null);

  // Frames mode (Video studio): up to 10 stills at their times, as the picked model can take them.
  const framesOn = !!config.frames && !!draft.frames;
  // Style: Animation (Fuobe Animation): keyframes with a timing per gap, the in-betweens drawn by AniSora.
  const animationOn = framesOn && !!model?.options.inbetween;
  // Until a gap is timed, the frames' places on the strip give the timing (Frames mode's times, at the playback rate).
  const savedTiming = draft.params.extra?.inbetween as Partial<InbetweenTiming> | undefined;
  const animationTiming =
    animationOn && model && draft.frames
      ? savedTiming?.gaps
        ? timingFor(draft.frames.length, savedTiming, model.engine)
        : timingFromTimes(frameTimes(draft.frames.map((f) => f.at), framesDuration(model, draft.params.duration)), { engine: model.engine })
      : undefined;
  const framesCtx: FramesContext | undefined =
    framesOn && model
      ? { support: frameSupport(model), duration: framesDuration(model, draft.params.duration), chained: !!keyframeChain(model), ...(animationTiming && { animation: { timing: animationTiming } }) }
      : undefined;
  const framesAt = framesCtx && draft.frames ? frameTimes(draft.frames.map((f) => f.at), framesCtx.duration) : [];
  // The open chain's gaps (and one frame's clip) must be clips its model makes; the planner checks two or more frames too.
  // An animation's gaps are its own timing (two keyframes at least).
  const framesGap = animationTiming
    ? draft.frames!.length > 0 && draft.frames!.length < 2
      ? "Add a second keyframe: the in-betweens go between them"
      : timingProblem(animationTiming, draft.frames!.length, model!.engine)
    : framesCtx?.chained && model && framesAt.length
      ? chainGapProblem(framesAt, framesCtx.duration, chainTiming(model))
      : null;
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

  // A picked palette / moodboard routes the request (and can move it to another model) before anything else. An account's
  // palette lock runs on this studio's GPUs only (on its own GPU or key its colours go in the prompt): where the price
  // check last said this run goes (poolPrice, below).
  const [lockOnPool, setLockOnPool] = useState(false);
  const signature = useSignature(!!config.signature, draft.signature, lockOnPool);
  // Hosted runs: "Run without LoRAs" pressed (a run refused there only for its LoRAs): the next run goes without them.
  const [lorasOff, setLorasOff] = useState(false);
  const offLoras = <R extends object>(r: R): R => (lorasOff ? { ...r, lorasOff: true as const } : r);
  const prepare = (draftIn: typeof draft) => {
    const d = songDraft(draftIn, catalog.getModel(draftIn.modelId), config.slots);
    const signed = signature.apply(offLoras(buildRequest(config.feature, d, studioOp, config.promptSuffix, config.multiRef?.kind, framesCtx, targetFor(d.modelId))));
    // Planned with the signature's sentences in the prompt (as the server runs it); sent with them apart.
    const raw = signed.worded;
    const m = catalog.getModel(raw.modelId) ?? model;
    const mentions = m ? applyMentions(raw, m, elements) : { request: raw, mentioned: [], notes: [] };
    const sketched = m ? applySketch(mentions.request, m) : { request: mentions.request };
    return { mentions, sketched, signed, request: m ? stripMotionPaths(sketched.request, m) : sketched.request };
  };
  const { mentions, sketched, signed } = prepare(draft);
  // Hosted runs: an open model may run on this studio's GPUs. Its price there is the server's (the words of the
  // studio's billing service, or free), asked again 300 ms after a change. Where the run goes, in one order: the
  // account's own pick (the Run on list, kept on the server for every device), else its own GPU while online unless
  // the studio puts its own GPUs first. A place named for one run only ("Run on …") is sent with that run.
  const viewerInfo = status?.viewer;
  const ownOnline = !!viewerInfo?.gpu.connected && !!viewerInfo.gpu.online;
  const runOnPicked = viewerInfo?.hosted ? viewerInfo.runOn : undefined;
  const setRunOn = useSetRunOn();
  // (The place the run names: none when the default is the studio's GPUs only because they go first.)
  const { runOn, place: runPlace } = composerPlace(null, runOnPicked, ownOnline, viewerInfo?.prefer === "pool");
  const hostedHere = !!viewerInfo?.hosted && model?.engine === "open";
  // The name visitors read for this studio's GPUs ("Our GPUs"): said only while hosted runs are on.
  const sitePlace = placeOf(viewerInfo?.placeName);
  // The price check is asked with the place the run itself names: none while the studio puts its GPUs first and the
  // account's own GPU is online, so it answers for where the server would really send the run.
  const askPool = hostedHere && runOn === "pool";
  const wantPrice = askPool ? quoteBody(signed.request, runPlace) : null;
  const priceBody = useSettled(wantPrice);
  const priceQuery = useHostedQuote(priceBody);
  const hostedCheck = priceQuery.data;
  // What the check last said of a run that names no place, kept while it asks again for a changed draft.
  const [lastOnPool, setLastOnPool] = useState(true);
  const checkedOnPool = hostedCheck === undefined ? null : hostedCheck?.place === "pool";
  if (checkedOnPool !== null && checkedOnPool !== lastOnPool) setLastOnPool(checkedOnPool);
  // A run on this studio's GPUs (their price and line, no pre-flight of the account's own GPU, the price shown sent with
  // it): named there, or the check says the server sends it there. What they don't take runs on its own GPU, as before.
  const poolPrice = askPool && composerOnPool(runPlace, hostedCheck, lastOnPool);
  if (poolPrice !== lockOnPool) setLockOnPool(poolPrice);
  // Where the place switch says it runs.
  const shownOn: RunOn = runOn === "pool" && hostedHere && !poolPrice ? "own" : runOn;
  // The price check has answered for the draft as it is now (not one typed a moment ago).
  const priceSettled = !wantPrice || (priceBody === wantPrice && priceQuery.isFetched && !priceQuery.isFetching);
  const hostedQuote = hostedCheck?.quote;
  // The price check's answer: refused (busy, a limit, not offered here, paused…), Run is off and says why; otherwise
  // the price, and where the run would stand in line with the wait.
  const poolState = poolPrice ? poolRunState(hostedCheck) : null;
  const poolRefused = !!poolState?.refused;
  // Refused because it runs on the visitor's own GPU or key: Run opens that setup instead of staying off.
  const poolSetup = poolRefused ? poolState?.setup : undefined;
  const resolvesOnServer = mentions.mentioned.length > 0 || !!draft.slots.mask?.ref || !!draft.slots.sketch?.ref;

  // Plan with stand-ins for attachments that are missing or still uploading, so the cost and the
  // operation are known up front and the blocker can name the slot in the studio's own words.
  // Studios that need one of several inputs (Lipsync: a portrait or a video) name the group.
  const anyOf = preset?.inputs ? undefined : config.anyOf;
  // Frames mode has its own strip: the start frame is frame 1 (a camera motion's start frame tile isn't asked for).
  const askedSlots = framesOn ? framesSlots(slots) : slots;
  const missing = firstMissingSlot(askedSlots, draft.slots, anyOf);
  const uploading =
    Object.values(draft.slots).some((v) => v?.uploading) ||
    [...draft.refs, ...refClips, ...refAudios].some((r) => r.uploading) ||
    (framesOn && framesUploading(draft.frames));
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
  let planModel: ModelDef | undefined;
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
        refClips: draft.refClips?.map((r) => stand(r, "video") as SlotValue),
        refAudios: draft.refAudios?.map((r) => stand(r, "audio") as SlotValue),
        frames: draft.frames?.map((f) => ({ ...f, value: stand(f.value, "image") as SlotValue })),
      });
      const plan = planGeneration({ ...planned, prompt: planned.prompt || (config.promptOptional ? " " : "") }, catalog.getModel, catalog.getPreset);
      op = plan.op;
      planModel = plan.model;
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
  // A voice outside what a hosted talking-avatar model takes (H3 Max lip sync: 5 s to 15 min), as the server would say.
  const voiceProblem = op === "avatar" && voiceRef && voice?.duration && model ? voiceWindowProblem(model, voice.duration) : null;
  if (voiceProblem && !planError) planError = voiceProblem;
  // A song Mureka's tools refuse (Stems: MP3 or M4A; Remix: 10 s to 5:50; Extend and Remix of a song Mureka didn't make: MP3
  // or M4A), from its name and header, as the server does. One of Mureka's own goes by its id (withSongId), never as a file.
  const songRef = config.voiceFacts && (op === "song-stems" || op === "song-remix" || op === "song-extend") ? draft.slots.audio?.ref : undefined;
  const songById = model?.family === "mureka" && !!draft.song && !!songRef && draft.song.url === songRef;
  // One Mureka can't take as it is (another format, over 10 MB, a video's sound, longer than Remix takes) is fitted in this
  // browser instead: converted to an MP3, or a part of it offered (src/components/av/fit-upload.tsx); what's left is said
  // as before. One of Mureka's own songs goes by its id and is left alone.
  const fitOp = op ?? studioOp ?? model?.routes.find((r) => SONG_FIT_OPS.has(r.op))?.op;
  // A talking avatar's voice outside its model's length (H3 Max lip sync 5 s to 15 min, OmniHuman 2 4 s to 5 min, P-Video up to
  // 3 min), or a file its model doesn't take (OmniHuman 2: an MP3 or WAV up to 15 MB): the same step, with that model's rule.
  const songRule = useMemo(() => {
    if (!config.voiceFacts || !model) return null;
    if (model.family === "mureka") return murekaSongRule(fitOp);
    return (op ?? studioOp) === "avatar" ? voiceFitRule({ id: model.id, name: shortName(model.name) }) : null;
  }, [config.voiceFacts, model, fitOp, op, studioOp]);
  const songFit = useFitUpload({
    rule: songRule,
    value: draft.slots.audio,
    skip: songById,
    seconds: voice?.duration,
    setValue: (v) => attach.setSlotValue("audio", v),
    upload: (f) => attach.uploadToSlot("audio", f, "audio"),
  });
  // A clip longer than the model's window (or a tool's longest source: Kandinsky VSR 5 s): a part of it offered, cut from a
  // key frame without encoding it again (src/components/av/fit-clip.tsx).
  const clipRule = useMemo(() => {
    const w = config.clipFacts ? clipFitWindow(op ?? studioOp, model, facts?.fps) : undefined;
    return w && model ? { for: shortName(model.name), tool: shortName(model.name), minSeconds: w.min, maxSeconds: w.max } : null;
  }, [config.clipFacts, op, studioOp, model, facts?.fps]);
  const clipFit = useClipFit({
    rule: clipRule,
    value: draft.slots.video,
    seconds: facts?.duration,
    setValue: (v) => attach.setSlotValue("video", v),
    upload: (f) => attach.uploadToSlot("video", f, "video"),
  });
  // A portrait outside the shapes its model takes (H3 Max lip sync: 0.4:1 to 2.5:1): a crop offered.
  const cropRule = useMemo(() => {
    const ratio = model && (op ?? studioOp) === "avatar" ? portraitRatio(model.id) : undefined;
    return ratio && model ? { tool: shortName(model.name), ratio } : null;
  }, [model, op, studioOp]);
  const cropFit = useCropFit({ rule: cropRule, value: draft.slots.image, setValue: (v) => attach.setSlotValue("image", v) });
  // A picture for a cloud endpoint with limits of its own (Qwen Image 3 edit, Recraft Crisp…): fitted here before it goes up.
  const stillEp = stillEndpoint(model, op ?? studioOp);
  // AuK's voice sample (under 20 s): a part of a longer one offered.
  const sampleRule = useMemo(() => (model?.id === "oss-auk" ? sampleFitRule() : null), [model?.id]);
  const sampleFit = useFitUpload({
    rule: sampleRule,
    value: draft.slots.voiceAudio,
    setValue: (v) => setSlot("voiceAudio", v),
    upload: (f) => attach.uploadToSlot("voiceAudio", f, "audio"),
  });
  useEffect(() => {
    songRoute.current = (f) => (songFit.wants(f) && (songFit.take(f), true)) || (clipFit.wants(f) && (clipFit.take(f), true));
  });
  const songProblem = songRef ? songToolProblem(op!, { format: songFormat(undefined, songRef), seconds: voice?.duration }, songById) : null;
  if (songProblem && !planError) planError = songProblem;
  if (signed.blocker) planError = signed.blocker;
  // References mode: Pika's limits (12 files, 2-15 s each, 15 s a group), checked on the clips' lengths before anything runs.
  const refImages = (draft.slots.image?.ref ? 1 : 0) + draft.refs.length;
  const refProblem =
    refMode && !framesOn && (refClips.length || refAudios.length)
      ? h3ReferenceProblem({ images: refImages, videos: refSeconds.slice(0, refClips.length), audios: refSeconds.slice(refClips.length) })
      : null;
  if (refProblem && !planError) planError = refProblem;
  // A reference clip or voice longer than H3 takes (15 s each, 15 s of each kind together): the part to use is offered.
  const refWindow = { min: H3_REFERENCE_LIMITS.minSec, max: H3_REFERENCE_LIMITS.maxSec, total: H3_REFERENCE_LIMITS.groupSec };
  const refFit = (() => {
    if (!refMode || framesOn) return null;
    const lists = [
      { kind: "video" as const, items: refClips, seconds: refSeconds.slice(0, refClips.length), one: "Clip", all: "The clips" },
      { kind: "audio" as const, items: refAudios, seconds: refSeconds.slice(refClips.length), one: "Voice", all: "The voice and music clips" },
    ];
    for (const l of lists) {
      const t = trimTarget(l.seconds, refWindow);
      if (!t) continue;
      const words = { model: "H3", label: (i: number) => `${l.one} ${i + 1}`, all: l.all };
      return { ...l, target: t, item: l.items[t.index], line: trimLine(l.seconds, t, refWindow, words), label: words.label(t.index) };
    }
    return null;
  })();
  // A clip or voice swapped for its part (a stand-in while it is cut), in whichever list holds it.
  const replaceRef = (from: ListItem, to: SlotValue) =>
    setDraft((d) => {
      const swap = (l?: SlotValue[]) => l?.map((r) => ((from.id ? r.id === from.id : r.ref === from.ref) ? { ...to, id: to.id ?? r.id } : r));
      return { refClips: swap(d.refClips), refAudios: swap(d.refAudios) };
    });
  // A guest's clips and voices are kept in this browser: a long one gets its part offered before it is added.
  const guest = useIsGuest();
  const clipAdd = useAddFit({ kind: "video", max: refMode && guest ? H3_REFERENCE_LIMITS.maxSec : undefined, min: H3_REFERENCE_LIMITS.minSec, tool: "H3", add: (f) => attach.addListFile("refClips", f, refMode?.videos ?? 0) });
  const voiceAdd = useAddFit({ kind: "audio", max: refMode && guest ? H3_REFERENCE_LIMITS.maxSec : undefined, min: H3_REFERENCE_LIMITS.minSec, tool: "H3", add: (f) => attach.addListFile("refAudios", f, refMode?.audios ?? 0) });
  // Clip elements mentioned by name (Kling 4.0: 3–8 s each, 30 s of clips in all): said before the run, with the fix.
  const elementCheck = useElementClipCheck(catalog.getModel(mentions.request.modelId) ?? model, mentions.request, mentions.mentioned);
  if (elementCheck.problem && !planError) planError = elementCheck.problem;
  // An end frame runs first and last frames only: References mode's extra images, clips and sound would be left out.
  // It goes before "Write a prompt first": words won't fix it.
  if (refMode && !framesOn && draft.slots.endImage?.ref && (draft.refs.length || refClips.length || refAudios.length) && (!planError || planError === WRITE_PROMPT)) {
    planError = "References can't go with an end frame. Remove the end frame, or the references";
  }
  // Models that take no prompt (try-on, 3D, transcription, upscalers), or can run without one, never ask for one.
  // A model that reads only words (Open-H3 Regenerate redraws from them) asks for them even in a tool that hides the box.
  const promptMissing =
    (!!opts.requires?.prompt ||
      (!config.promptOptional && !opts.promptless && !opts.promptOptional && preset?.userPrompt !== "none" && preset?.userPrompt !== "optional")) &&
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
  // (A run on this studio's GPUs never meets the pre-flight of the account's own GPU.)
  const gpuSetup = gpuBadge && gpuBadge[0] !== "r" && !poolPrice ? gpuBadge : null;
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

  // The check before Run: an account's own GPU at a web address that didn't answer its last status check (the status
  // strip's, every 30 s; nothing here asks the GPU) shows what is wrong and its fixes before Run. A run started anyway
  // waits for the GPU. One of the account's keys that runs this tool's cloud version is offered too (an explicit click:
  // it spends the person's own credit).
  // Hosted runs: the key that runs this item's cloud version (a row of the Run on list, "Run with your fal.ai key"), and
  // its price there, so a key is offered with its price and a press that showed "Free" never bills it.
  // (Not for an exact orbit: it runs as a fly-around, at its own price.)
  const keyTwin =
    viewerInfo?.hosted && viewerInfo.kind === "account" && viewerInfo.paidAllowed !== false && model && !exact ? cloudVersion(preset, model, viewerInfo.usableKeys ?? viewerInfo.keys ?? [], has, catalog.getModel) : null;
  const keyPrice = (() => {
    const m = keyTwin ? catalog.getModel(keyTwin.modelId) : undefined;
    if (!m) return null;
    try {
      const usd = estimateCost(onEngine(m, "cloud"), draft.params, 1, (keyTwin?.op ?? op) as Operation | undefined, false, today);
      return usd != null && usd > 0 ? `≈ ${formatCost(usd)}` : null;
    } catch {
      return null;
    }
  })();
  // What this studio's GPUs take (no label of an own setup), so the check before Run offers a run on them only then.
  const siteTakes = !!viewerInfo?.hosted && !!model && model.engine === "open" && !modelSetup(model) && !poolSetup;
  const gpuDown = gpuBeforeRun({
    viewer: status?.viewer,
    model,
    engine,
    onPool: hostedHere && runOn === "pool",
    preset,
    has,
    getModel: catalog.getModel,
    hosted: !!viewerInfo?.hosted,
    site: siteTakes ? sitePlace : null,
    keyPrice,
  });
  // A graph that needs a second ComfyUI (LatentSync 1.6, ThinkSound) can't run on an account's single GPU at a web address:
  // said before Run, with what runs it instead (its cloud version on a key, or another model).
  const viewerGpu = status?.viewer?.kind === "account" ? status.viewer.gpu : undefined;
  const isolatedHere = !!model && model.worker === "isolated" && model.engine === "open" && !!viewerGpu?.connected && viewerGpu.mode === "link" && !(hostedHere && runOn === "pool");
  const isolatedTwin =
    isolatedHere && status?.viewer?.paidAllowed !== false ? cloudVersion(preset, model, status?.viewer?.usableKeys ?? status?.viewer?.keys ?? [], has, catalog.getModel) : null;
  // "Run with your fal.ai key": this run, once, on the tool's cloud version and that key. The engine switch stays where it
  // was, so the next run goes to the GPU again (the person picks Cloud themselves to stay there).
  const runOnceWithKey = (a: TroubleAction) => {
    const sent = signature.apply(
      buildRequest(config.feature, songDraft(draft, model, config.slots), resolvesOnServer ? studioOp : op, config.promptSuffix, config.multiRef?.kind, framesCtx, targetFor(draft.modelId)),
    );
    const withVoiceFirst = cleanFirst ? { ...sent.request, params: { ...sent.request.params, extra: { ...sent.request.params?.extra, [VOICE_FIRST_PARAM]: true } } } : sent.request;
    return runOnceOnKey(withVoiceFirst, a, (r) => create.mutateAsync(r)).then(
      (words) => void toast.success(words),
      (e) => toastError(e),
    );
  };
  // While hosted runs are on, "Run with your fal.ai key" is this run, once, sent by Run itself (at the price it showed);
  // otherwise as above.
  const onRunWithKey = viewerInfo?.hosted ? (a: TroubleAction) => submitRef.current(undefined, a) : runOnceWithKey;
  // "Run on Our GPUs": this run, once, on this studio's GPUs; the account's pick stays as it was.
  const onRunOnSite = () => submitRef.current(undefined, undefined, "pool");
  // A long wait on this studio's GPUs (past the policy's offer time, or until a GPU is free): an account with its own GPU,
  // or a key that runs this item's cloud version (at its price, never without one), may run this run there now, once.
  // Its pick stays as it was, and the run is taken in line all the same when it doesn't. While the day's GPU time is used
  // up, or runs there are paused, an account with nothing of its own gets the quiet way to connect its own GPU.
  // ("Now" on its GPU only while it answers.)
  const waitOffer =
    viewerInfo?.kind === "account" && poolState && !poolState.refused && poolState.long
      ? viewerInfo.gpu.connected && viewerInfo.gpu.online
        ? { label: "Run it now on your GPU", run: () => submitRef.current(undefined, undefined, "own") }
        : keyTwin && keyPrice
          ? { label: `Run it now with your ${CLOUD_KEY[keyTwin.provider].label} key · ${keyPrice}`, run: () => submitRef.current(undefined, withKeyAction(keyTwin.provider, keyTwin.modelId, keyTwin.op, keyPrice)) }
          : !viewerInfo.gpu.connected && (poolState.held === "today" || poolState.held === "service")
            ? { label: "Or connect your own GPU", run: () => void pressSetup({ need: "gpu" }) }
            : undefined
      : undefined;
  // A choice before Run for an item this studio's GPUs can't run, for an account whose key runs its cloud version (and no
  // GPU): run it once on the key, at its price, or connect a GPU. Nothing runs until one is pressed.
  const [keyChoice, setKeyChoice] = useState(false);

  // Route notice (route-notice.ts): shown on Run; nothing runs until "Run anyway" or "Use <provider>" is pressed.
  const usableRoute = (p: string) =>
    !!status?.providers[p]?.configured && (viewerInfo?.kind !== "account" || (isCloudProvider(p) && (viewerInfo.usableKeys ?? viewerInfo.keys ?? []).includes(p)));
  const routeAsk = { params: signed.request.params, negativePrompt: signed.request.negativePrompt, prefer: signed.request.prefer };
  const routeCheck =
    planModel && op && !placeholdersOn(status?.demoMode)
      ? routeNotice(planModel, op, likelyProvider(planModel, op, routeAsk, { ready: usableRoute, preferred: status?.cloudProvider }), routeAsk, usableRoute)
      : null;
  const [routeChoice, setRouteChoice] = useState(false);
  if (routeChoice && !routeCheck) setRouteChoice(false);
  const [anyway, setAnyway] = useState<string[]>(readAnyway);
  const anywayHere = !!routeCheck && !!planModel && !!op && anywaySaid(anyway, planModel.id, op, routeCheck);
  const runAnyway = () => {
    if (!routeCheck || !planModel || !op) return;
    const next = [...new Set([...anyway, ...anywayKeys(planModel.id, op, routeCheck)])];
    setAnyway(next);
    keepAnyway(next);
    submitRef.current(undefined, undefined, undefined, undefined, { prefer: isCloudProvider(routeCheck.provider) ? routeCheck.provider : undefined });
  };

  // `skip` is true only from the guided fix's "Run anyway" (a click handler passes its event here). `withKey`: this run
  // only, on the cloud version that action names and the account's key (hosted runs on; see onRunWithKey). `once`: a
  // place for this run only (hosted runs: "Run on Our GPUs", or the account's GPU for what only it runs). `signedUp`: the
  // run a guest pressed, started by itself back from sign-up (its note says so once the run is made). `picked`: route chosen
  // in the route notice, sent as `prefer`.
  const submit = (skip?: unknown, withKey?: TroubleAction, once?: "own" | "pool", signedUp?: boolean, picked?: { prefer?: CloudProvider }): void => {
    const skipGpu = skip === true;
    setKeyChoice(false);
    setRouteChoice(false);
    if (exact) {
      // An exact orbit: the still filmed along the orbit's numbers (Fly around), priced in its panel.
      const stop = !exactImage ? "Add a start frame to film an exact orbit" : fly.preview.data?.blocker;
      if (stop) return void toast(stop, { id: "composer-blocker" });
      if (fly.run.isPending) return;
      toast.dismiss("composer-blocker");
      pressSetup(owner ? null : "fly-around:exact-orbit", () => fly.run.mutate({ engine: withKey ? "cloud" : engine, image: exactImage, orbit: exact, prompt: draft.prompt.trim() || undefined, feature: config.feature }));
      return;
    }
    if (keyToAdd && model && !create.isPending) return openAddKey(keyToAdd, model.id);
    if (!blocker && gpuSetup && !skipGpu && !withKey && once !== "pool" && !create.isPending) return openGpuFix();
    // It runs on the visitor's own setup: Run opens it (Connect your GPU, Add your key, a guest's sign-up), and nothing
    // is sent. An account that has its GPU runs it there with this press (the chip said "Free · your GPU"). One whose key
    // runs its cloud version runs it there only when its key is where its runs go; otherwise it picks, at the key's price.
    if (!blocker && poolSetup && !withKey && !once) {
      if (viewerInfo?.gpu.connected && poolSetup.need === "gpu") return submitRef.current(skip, undefined, "own");
      if (keyTwin && keyPrice && !viewerInfo?.gpu.connected) {
        if (runOnPicked === "key") return submitRef.current(skip, withKeyAction(keyTwin.provider, keyTwin.modelId, keyTwin.op, keyPrice));
        return void setKeyChoice(true);
      }
      // A guest (hosted runs on): the draft waits for the sign-up, and this setup opens once signed up (never a run).
      if (guestHold) guestDraft.keepRun(null, poolSetup);
      if (pressSetup(poolSetup)) return submitRef.current(skip, undefined, "own");
      return;
    }
    // Refused by the price check (Run is off; Enter in the prompt lands here too): its words, and nothing is sent.
    if (!blocker && poolRefused && poolState && !withKey && !once) return void toast(poolState.text, { id: "composer-blocker" });
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
    if (routeCheck && !picked && !withKey && !once && !anywayHere) return void setRouteChoice(true);
    const route = withKey ? undefined : picked ?? (routeCheck && anywayHere && isCloudProvider(routeCheck.provider) ? { prefer: routeCheck.provider } : undefined);
    const withRoute = <R extends object>(r: R): R => (route?.prefer ? { ...r, prefer: route.prefer } : r);
    toast.dismiss("composer-blocker");
    setPriceNote(null);
    // A guest (hosted runs on): the draft, its kept files and this run wait for the sign-up, with the price shown; back
    // here as an account, the run starts by itself when the price is unchanged.
    if (guestHold) {
      const keptRun = poolPrice && hostedQuote?.allowed ? { amount: hostedQuote.amount, priceVersion: hostedQuote.priceVersion, text: hostedQuote.text } : null;
      guestDraft.keepRun(keptRun);
      // A run on this studio's GPUs starts by itself once the guest is in: the card says so.
      return askToSignUp("run", keptRun ? { kept: true } : {});
    }
    setRecent((r) => pushRecent(r, draft.modelId));
    // The server resolves @mentions and drawings itself; only pin the operation when there are none.
    // No "Queued" toast: the new card (and the "1 generating ↑" pill when it's off-screen) says it.
    const built = buildRequest(config.feature, songDraft(draft, model, config.slots), resolvesOnServer ? studioOp : op, config.promptSuffix, config.multiRef?.kind, framesCtx, targetFor(draft.modelId));
    // (Without LoRAs only where they were the reason: never on the account's own GPU or key.)
    const sent = signature.apply(withKey || once === "own" ? built : offLoras(built));
    // Hosted runs: where it should go, and the price shown (the server checks both; a higher price comes back to confirm).
    // A run on the account's key names neither: the key is where it goes.
    const placeNow = once ?? runPlace;
    const shownHere = poolPrice && !once && hostedQuote;
    const hosted = viewerInfo?.hosted && !withKey ? { ...(placeNow && { place: placeNow }), ...(shownHere && { shown: { amount: hostedQuote.amount, priceVersion: hostedQuote.priceVersion } }) } : {};
    // Open palette lock: the images are recoloured to the palette by a chained step (POST /api/palettes/lock).
    // (An account's lock runs on this studio's GPUs only: sent there by name.)
    if (sent.lock) {
      const request = withKey ? onCloudKey(sent.request, withKey) : withRoute(sent.request);
      return signature.lock.mutate({ request, colors: sent.lock.colors, ...hosted, ...(poolPrice && !withKey && once !== "own" && { place: "pool" as const }) }, { onError: (e) => toastError(e) });
    }
    // If the server's pre-flight stops it (409 gpu-setup), the guided fix that opens can try again, or run it anyway.
    if (!withKey && once !== "pool")
      setGpuRetry(
        () => submitRef.current(),
        () => submitRef.current(true),
        model?.kind,
      );
    const withVoiceFirst = cleanFirst ? { ...sent.request, params: { ...sent.request.params, extra: { ...sent.request.params?.extra, [VOICE_FIRST_PARAM]: true } } } : sent.request;
    const onKey = withKey ? onCloudKey(withVoiceFirst, withKey) : withVoiceFirst;
    const body = { ...withRoute(onKey), ...hosted, ...(skipGpu && { gpuCheck: "skip" }) } as typeof sent.request;
    create.mutate(body, {
      // Accepted: nothing to try again (a card opened later never starts this run a second time). Back from sign-up, the
      // line says the run is on its way (hosted runs: its tile shows "In line" too).
      onSuccess: () => {
        dropGpuRetry();
        setLorasOff(false);
        if (signedUp && viewerInfo?.hosted) setPriceNote(PENDING_WORDS.made);
      },
      // Stopped by the GPU pre-flight, or refused with its own card: the guided fix or the card is open already, so no error toast on top.
      onError: (e) => void ((e as { gpuSetup?: boolean }).gpuSetup || toastError(e)),
    });
  };

  const runEnhance = async () => {
    if (!draft.prompt.trim()) return toast("Write a short idea first, then enhance it");
    setEnhancing(true);
    try {
      const p = await enhance(draft.prompt, config.kind, op ?? (config.kind === "video" ? "t2v" : "t2i"), draft.modelId);
      setDraft({ prompt: p });
    } catch (e) {
      toastError(e);
    } finally {
      setEnhancing(false);
    }
  };

  const describeClip = async () => {
    const video = draft.slots.video?.ref;
    if (!video || describing) return;
    describeAlive.current?.abort();
    const ctl = new AbortController();
    describeAlive.current = ctl;
    setDescribing(true);
    try {
      const [read] = await describeRun.mutateAsync(regenDescribeRequest(video, facts?.duration));
      const done = await waitForGeneration(read.id, { signal: ctl.signal });
      const words = regenDescription(done.outputs.find((o) => o.kind === "text")?.text);
      if (ctl.signal.aborted) return;
      if (words) {
        setDraft((d) => (d.prompt.trim() ? {} : { prompt: words }));
        promptRef.current?.focus();
      } else toast("Couldn't put the clip into words", { description: "Describe it in a sentence or two: what is in it, how it moves, the light." });
    } catch (e) {
      if (!ctl.signal.aborted && !(e as { gpuSetup?: boolean }).gpuSetup) toastError(e);
    } finally {
      if (describeAlive.current === ctl) setDescribing(false);
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
  const setLight = useCallback((v: SlotValue | null) => setSlot("image", v), [setSlot]);
  // A light's sphere leaves the run when another model is picked: it means nothing to a model that reads words.
  const lightLeft = !opts.lightSphere && !!typed.slots.image?.name?.startsWith("light:");
  useEffect(() => {
    if (lightLeft) setSlot("image", null);
  }, [lightLeft, setSlot]);
  const setInsertRange = useCallback((startTime: number, endTime: number) => setDraft((d) => ({ params: { ...d.params, startTime, endTime } })), [setDraft]);
  const opNote = op && model ? routesFor(model, op)[0]?.note : undefined;
  const voiceFirstEngine: Engine = model?.engine ?? engine;
  const cleanFirst = voiceFirstShown && !!voiceFirstKind && (voiceFirstAsked ?? (voiceFirstEngine === "open" && voiceFirstDefault(voiceFirstKind, voiceFirstLive)));
  // Booleans in, not the model's options object: the React Compiler keeps the memos above.
  const showPrompt = showsPrompt(
    { hidePrompt: config.hidePrompt, modelPrompt: config.modelPrompt },
    { promptless: !!opts.promptless, promptOptional: !!opts.promptOptional, needsPrompt: !!opts.requires?.prompt },
    preset?.userPrompt,
  );
  const effectiveOp = studioOp ?? op;
  // Qwen-Image 2.1's Options → GPU on Small: what the small encoder can't do (or that a speed with its own graph wins).
  // MiniMax H3's GPU tier: what FastH3 V2 or Trim changes, picked or as Auto runs it on the card the GPU check read.
  const h3Note = opts.controls?.some((c) => c.param === H3_TIER_PARAM) ? h3TierNote(p.extra, effectiveOp, gpuBadges?.h3Tier) : undefined;
  const smallGpuNote = qwen21Note(opts.controls, p.extra, effectiveOp) ?? h3Note;
  // A setting an app's choices already set (the Angles app's angle, height and distance on QMA · 96 views) isn't asked twice.
  const presetSets = new Set((preset?.options ?? []).flatMap((o) => o.choices.flatMap((c) => Object.keys(c.extra ?? {}))));
  const shownControls = (opts.controls ?? []).filter((c) => !presetSets.has(c.param));
  // The Angles app's camera: an orbit pad beside its chips.
  const orbit = orbitOptions(preset?.options);
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
  // Said with "your GPU" only off a hosted studio: there the run may use the studio's GPUs, and the chip or hint says where.
  const gpuRun = saysYourGpu(engine, hostedHere);
  // A cloud model that runs on a visitor's own key only (Mureka Extend on Audio → Extend & remix): never "Free · your GPU",
  // its key in the label's words.
  const keyOnly = setupViewer && !demo ? keyOnlySetup(model, engine) : null;
  const freeHere = engine === "open" && model && !keyOnly ? 0 : null;
  const ownCostText = keyOnly && cost == null ? ownSetupLabel(keyOnly) : costLabel({ demo, cost: cost ?? freeHere, unknown: loraPriceUnknown, gpu: gpuRun }, formatCost);
  // An account's paid run is billed to its own provider account (Your keys), or still needs that key.
  const payer = paidThrough(model, status);
  // Its provider account's balance ran out on a run: said before the next one, with Add credit.
  const emptyPayer = payer && status?.viewer?.emptyKeys?.includes(payer) ? payer : null;
  const missingKey = needsKey(model, status)?.[0];
  const ownPayerText = payer && cost ? ` · ${billedTo(payer)}` : missingKey ? ` · ${addKeyLabel(missingKey).toLowerCase()}` : "";
  // On this studio's GPUs: the quote's words (none from the server: free, as the open engine always is).
  // An exact orbit runs as a fly-around: its own price.
  const exactPrice = exact ? fly.price : "";
  const costText = exactPrice || (poolPrice ? (poolState?.refused ? poolState.text : hostedQuote?.text || ownCostText) : ownCostText);
  const payerText = poolPrice ? "" : ownPayerText;
  // Hosted runs: the Run on list, for an account with a choice for this item (its GPU, or a key that runs its cloud
  // version): the price chip opens it ("Free ▾"). On the Cloud engine, for an account whose runs go to its key, so it
  // has the way back. An item this studio's GPUs don't take for this account runs on its GPU, said so, with no list.
  const siteMissed = runOn === "pool" && shownOn === "own";
  const onKeyNow = engine === "cloud" && runOnPicked === "key" && model?.engine === "cloud" && !!payer;
  const runOnRows =
    !viewerInfo?.hosted || exact || demo
      ? null
      : hostedHere
        ? placeRows(
            viewerInfo,
            { key: keyTwin && { provider: keyTwin.provider, price: keyPrice }, siteRuns: siteTakes && !siteMissed },
            { text: hostedQuote?.allowed ? hostedQuote.text : undefined, wait: poolState?.wait },
          )
        : onKeyNow
          ? placeRows(viewerInfo, { key: { provider: viewerInfo.runKey ?? payer, price: cost ? `≈ ${formatCost(cost)}` : null }, cloud: true })
          : null;
  const ownGpuHere = hostedHere && !!viewerInfo?.gpu.connected && siteMissed && !runOnRows;
  // Refused there only for its LoRAs: the same run without them runs there (the price check asks again, then Generate).
  const withoutLoras = poolState?.refused && poolState.withoutLoras && !lorasOff ? { label: "Run without LoRAs", run: () => setLorasOff(true) } : undefined;
  // An item that runs on an own setup only, for an account whose runs go to its key (and no GPU): Generate runs it on the
  // key's cloud version, so the chip says the key's price first.
  const keyChip = keyOnlyChip({ ownSetup: !!poolSetup, key: keyTwin ? { provider: keyTwin.provider, price: keyPrice } : null, gpu: !!viewerInfo?.gpu.connected, picked: runOnPicked, rows: !!runOnRows });
  const ownKeyHere = !!keyChip;
  const keyTip = keyChip?.tip ?? "";
  const runOnText = runOnRows?.on === "gpu" || ownGpuHere ? "Free · your GPU" : keyChip ? keyChip.text : runOnRows?.on === "key" ? `${costText} · your key` : costText;
  // What Generate's tooltip says it costs.
  const pressCost = ownKeyHere ? runOnText : costText;
  // Hosted runs, runs going to the account's key: its key turned the last run down (out of credit, not accepted). Said
  // before the next press, with that run once on {Place} when it takes its open version.
  const newestRun = useNewestRun();
  const turnedDown = viewerInfo?.hosted && viewerInfo.kind === "account" && engine === "cloud" && newestRun ? keyTurnedDown([newestRun]) : null;
  const siteAgain = turnedDown ? siteRunOf(turnedDown.run, true, viewerInfo?.pool) : null;
  const runOnTip =
    runOnRows?.on === "gpu"
      ? `Runs on your own GPU${viewerInfo?.gpu.online ? "" : " · not answering right now"}`
      : runOnRows?.on === "key"
        ? `Estimated cost, billed to ${billedTo(viewerInfo?.runKey ?? payer ?? "fal")}`
        : runOnRows?.note
          ? runOnRows.note
          : poolState?.refused
            ? (poolState.sub ?? poolState.text)
            : [hostedQuote?.sub ?? `Runs on ${sitePlace.text}`, poolState?.wait].filter(Boolean).join(" · ");
  /** A pick from the Run on list: kept for the account; the key runs on the Cloud engine, the others on Open source. */
  const pickRunOn = (id: RunOnPick) => {
    const key = id === "key" ? (keyTwin?.provider ?? viewerInfo?.runKey ?? payer ?? undefined) : undefined;
    setRunOn.mutate({ runOn: id, ...(key && { key }) });
    if (id === "key" && engine !== "cloud") setEngine("cloud");
    if (id !== "key" && onKeyNow) setEngine("open");
  };

  // Attachments: only when something is attached, a required slot is still empty, or none of a "one of these" group is filled (U8).
  const kinds = [...attach.kinds];
  const hasAttachment = slots.some((s) => draft.slots[s.key]) || draft.refs.length > 0 || refClips.length > 0 || refAudios.length > 0;
  // Tools whose only input is a list of clips (Join clips) keep their "Add clip" tile in view.
  const showAttachments =
    framesOn ||
    ((slots.length > 0 || !!config.multiRef) && (hasAttachment || !!missing || !!slots.find((s) => s.required && !draft.slots[s.key]) || (!!config.multiRef && !showPrompt))) ||
    (!!refMode && refsOpen);
  const collapsed = docked && !focused;
  // Docked and not focused, the tiles fold into one chip on the toolbar (the composer stays one line).
  const attached = [...slots.map((s) => draft.slots[s.key]), ...draft.refs, ...refClips, ...refAudios, ...(draft.frames ?? []).map((f) => f.value)].filter((v): v is SlotValue => !!v);

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

  // Back from sign-up with the run its guest pressed: once the draft, its files and the price check have settled, it
  // starts by itself when the price is the one the guest saw on the draft Run was pressed on. Otherwise Run waits for a
  // click, with a line saying why: a kept file didn't come back, the draft changed after Run, or a new price. Something
  // else missing leaves it to the blocker's line.
  const pendingRun = guestDraft.pending;
  const clearPending = guestDraft.clearPending;
  const keptLost = guestDraft.lost;
  useEffect(() => {
    if (!pendingRun) return;
    const next = pendingStep({
      settled: !settling && priceSettled,
      blocked: !!blocker,
      pool: poolPrice,
      shown: pendingRun.shown,
      quote: hostedQuote,
      lost: keptLost,
      same: pendingRun.same,
      setup: !!poolSetup,
      labelled: !!pendingRun.setup,
    });
    if (next === "wait") return;
    clearPending();
    if (next === "start") submitRef.current(undefined, undefined, undefined, true);
    // Pressed on an item that runs on one's own GPU or key: its setup opens on this page (Connect your GPU, Add your key),
    // with the draft back; nothing runs. One the account has already: Run waits for a click.
    else if (next === "setup" && poolSetup) {
      if (pressSetup(poolSetup)) setPriceNote(PENDING_WORDS.ask);
    }
    else if (next === "lost") setPriceNote(PENDING_WORDS.lost);
    else if (next === "ask") setPriceNote(PENDING_WORDS.ask);
    else if (next === "note" && hostedQuote) setPriceNote(PENDING_WORDS.note(hostedQuote.text));
  }, [pendingRun, clearPending, settling, priceSettled, blocker, poolPrice, hostedQuote, keptLost, poolSetup, pressSetup]);
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
    else if (animationTiming && model.engine === "cloud")
      framesNotice = {
        text: `In the cloud each gap is one clip with every frame kept, played at 16 fps.${!visitor && engineMode === "both" ? " Faster speeds and 24 fps playback are on your GPU, free." : ""}`,
        tone: "info",
      };
  }
  // Style: Animation, in Frames mode: Fuobe Animation (when it's on in this install), and back to the engine's frames model.
  const animationModel = config.frames && catalog.offered("fuobe-animation", engine) ? catalog.getModel("fuobe-animation") : undefined;
  const plainFramesModel = catalog.getModel(FRAMES_MODELS[engine].id);
  const switchStyle = (on: boolean) => {
    const to = on ? animationModel : plainFramesModel;
    if (!to) return;
    setDraft((d) => ({ modelId: to.id, params: { ...to.defaults, ...d.params, resolution: to.defaults?.resolution ?? d.params.resolution, aspectRatio: to.defaults?.aspectRatio ?? d.params.aspectRatio } }));
  };
  const setTiming = (t: InbetweenTiming) => setDraft((d) => ({ params: { ...d.params, extra: { ...d.params.extra, inbetween: t } } }));
  const stillMouth = draft.params.extra?.stillMouth === true;
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
  // A Mix in the cloud on a model that takes one LoRA per expert (Fuobe DoP and Wan 2.2 A14B on Replicate): a second preset
  // with no LoRA slot left stays in view as unavailable, with the way to run it (mixLimit, src/lib/catalog/plan.ts).
  const mixFits = useMemo(() => {
    if (!preset || !model || engine !== "cloud" || (preset.type !== "motion" && preset.type !== "effect")) return undefined;
    const op = effectiveOp ?? "i2v";
    const gpu = runsOn(model, "open");
    return (second: Preset): Unavailable | undefined => {
      const why = mixLimit(model, engine, op, preset, second);
      return why ? { why, ...(gpu && { fix: { label: "Use it on your GPU", run: () => setEngine("open") } }) } : undefined;
    };
  }, [preset, model, engine, effectiveOp, setEngine]);
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
          engine={engine}
          mixFits={mixFits}
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
      {shownControls.length > 0 && <ControlsChip controls={shownControls} values={p.extra ?? {}} onChange={setExtra} title={config.controlsTitle} op={effectiveOp} setupOf={setupViewer ? (param, v) => controlSetup(model?.id, param, v) : undefined} />}
      {opts.lightSphere && <LightSphereChip value={draft.slots.image} onChange={setLight} />}
      {effectiveOp === "insert-moment" && <InsertRangeChip clip={facts?.duration} start={p.startTime} resume={p.endTime} onChange={setInsertRange} />}
    </>
  );
  const hasSecondary =
    !!config.frames ||
    !!config.layout ||
    (!!model && (!!opts.voices?.length || !!opts.voiceClone || !!opts.languages || !!opts.controls || !!opts.looks || !!opts.lightSphere)) ||
    effectiveOp === "insert-moment" ||
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
          style={animationModel ? { on: animationOn, onChange: switchStyle, engine } : undefined}
          animation={
            animationTiming && model
              ? {
                  timing: animationTiming,
                  engine: model.engine,
                  onTiming: setTiming,
                  stillMouth,
                  onStillMouth: (on) => setDraft((d) => ({ params: { ...d.params, extra: { ...d.params.extra, stillMouth: on || undefined } } })),
                }
              : undefined
          }
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
                onFile={(f) =>
                  s.key === "audio" && songFit.wants(f)
                    ? songFit.take(f)
                    : s.key === "video" && clipFit.wants(f)
                      ? clipFit.take(f)
                      : s.key === "image" && stillEp && model
                        ? void fitStill(f, stillEp, model.name).then((g) => attach.uploadToSlot(s.key, g, s.accept))
                        : attach.uploadToSlot(s.key, f, s.accept)
                }
                {...(s.key === "audio" && songFit.on && { accept: songFit.accept, takes: songFit.wants })}
              />
            ),
          )}
          {hasCleanVoice && <CleanVoiceSwitch status className="hidden max-w-[16rem] shrink-0 sm:flex" hint="first, free on your GPU" />}
          {config.sketch && draft.slots.image?.ref && !draft.slots.image.uploading && (
            <SketchTools modes={config.sketch} image={draft.slots.image.ref} autoOpen={config.sketchAutoOpen} held={!!draft.slots.image.held} />
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
          {refMode && (
            <ReferenceTiles
              clips={refClips}
              audios={refAudios}
              images={refImages}
              limits={refMode}
              onFile={(list, f, max) => (!guest ? attach.addListFile(list, f, max) : list === "refClips" ? clipAdd.take(f) : voiceAdd.take(f))}
              onPick={attach.addToList}
              onRemove={attach.removeFromList}
            />
          )}
        </div>
      )}
      {showAttachments && !collapsed && !framesOn && refMode && (refsOpen || refClips.length > 0 || refAudios.length > 0) && (
        <ReferenceOrder images={refImages} clips={refClips.length} audios={refAudios.length} problem={refProblem} />
      )}
      {showAttachments && !collapsed && !framesOn && refMode && (
        <div className="px-3">
          {clipAdd.note}
          {voiceAdd.note}
          <ListFit
            item={refFit?.item ?? null}
            seconds={refFit ? refFit.seconds[refFit.target.index] : undefined}
            kind={refFit?.kind ?? "video"}
            max={refFit?.target.max}
            min={H3_REFERENCE_LIMITS.minSec}
            tool="H3"
            line={refFit?.line}
            label={refFit?.label ?? ""}
            replace={replaceRef}
          />
        </div>
      )}
      {showAttachments && !collapsed && !framesOn && <FitUploadNote fit={songFit} className="px-3" />}
      {showAttachments && !collapsed && !framesOn && <FitClipNote fit={clipFit} className="px-3" />}
      {showAttachments && !collapsed && !framesOn && <FitUploadNote fit={sampleFit} className="px-3" />}
      {showAttachments && !collapsed && !framesOn && <FitCropNote fit={cropFit} className="px-3" />}
      {/* On a phone the slot row scrolls sideways, so the switch gets its own line under it. */}
      {showAttachments && !collapsed && !framesOn && hasCleanVoice && <CleanVoiceSwitch status className="px-3 pb-2 sm:hidden" hint="first, free on your GPU" />}
      {showAttachments && !collapsed && !framesOn && voiceFirstShown && voiceFirstKind && (
        <VoiceFirstSwitch className="px-3 pb-2" engine={voiceFirstEngine} on={cleanFirst} onChange={setVoiceFirstAsked} seconds={voice?.duration} lip={!config.ops.includes("transcribe")} />
      )}

      {showPrompt && (
        <PromptInput
          ref={promptRef}
          value={draft.prompt}
          onChange={(v) => setDraft({ prompt: v })}
          onSubmit={submit}
          placeholder={
            layoutOn
              ? "Describe the whole picture… the boxes say what goes where"
              : (preset?.promptPlaceholder ?? opts.promptPlaceholder ?? (config.hidePrompt && config.modelPrompt ? config.modelPrompt : config.placeholder))
          }
          elements={elements}
          collapsed={collapsed}
          elementsNote={elementsNote(model)}
        />
      )}

      {/* Fuobe DoP's orbit moves: the Exact switch and its numbers. */}
      {exactId && !collapsed && (
        <ExactOrbitControls
          className="mx-2 mb-2"
          engine={engine}
          value={exact}
          defaults={exactDefaults(exactId)}
          onChange={(orbit) => setExactBy(orbit ? { id: exactId, orbit } : null)}
          footer={
            exact && exactImage && fly.preview.data?.blocker ? <span>{fly.preview.data.blocker}</span> : !owner ? <OwnSetupChip setup="fly-around:exact-orbit" className="mt-1" /> : undefined
          }
        />
      )}

      {model?.options.lyrics && (effectiveOp ? SUNG_OPS.has(effectiveOp) : model.routes.some((r) => SUNG_OPS.has(r.op))) && !collapsed && (
        <LyricsEditor model={model} value={draft.lyrics ?? ""} onChange={(lyrics) => setDraft({ lyrics })} idea={draft.prompt} seconds={p.duration ?? model.defaults?.duration} />
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
                      {el.references[0] && /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(el.references[0]) ? (
                        <video src={`${el.references[0]}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
                      ) : el.references[0] ? (
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
      <ElementClipFix check={elementCheck} className="px-2" />

      {/* Upscale → Video: Restore · faithful, Quick · RTX and (while it is offered) Regenerate · creative side by side (on your GPU). */}
      {config.finishChoices && !preset && (
        <FinishChoices
          choices={config.finishChoices}
          model={model}
          engine={engine}
          engineMode={engineMode}
          offered={(id) => (catalog.offered(id, "open") ? catalog.getModel(id) : undefined)}
          onPick={pickModel}
          onDescribe={
            model?.id === REGEN_MODEL && engine === "open" && draft.slots.video?.ref && !draft.slots.video.uploading && !draft.prompt.trim() && catalog.offered(REGEN_DESCRIBE_MODEL, "open")
              ? () => void describeClip()
              : undefined
          }
          describing={describing}
        />
      )}

      {/* Preset options (apps) */}
      {preset?.options?.length ? (
        <div className="flex flex-wrap gap-3 px-1.5 pb-2">
          {orbit && <OrbitPad options={orbit} values={draft.presetOptions} onChange={(next) => setDraft({ presetOptions: next })} />}
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
          {refMode && !framesOn && (
            <button
              type="button"
              onClick={() => {
                setRefsOpen((o) => !o);
                setFocused(true);
              }}
              aria-pressed={refsOpen}
              title="Images, clips and a voice or music clip the shot follows"
              className={cn(chipBase, chipIdle, "gap-1.5", refsOpen && "border-foreground/30 text-foreground")}
            >
              <Library className="size-3.5" />
              <span className="max-sm:sr-only">References</span>
            </button>
          )}
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
                  listens
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
                  ownSetup={modelSetup}
                  answersPick
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
        {runOnRows && runOnText && (
          <RunOnChip
            rows={runOnRows.rows}
            text={runOnText}
            tooltip={runOnTip}
            ariaLabel={`${runOnRows.on === "gpu" ? "Runs on your GPU" : runOnRows.on === "key" ? "Runs with your key" : `Runs on ${sitePlace.text}`}. Change where it runs`}
            onPick={pickRunOn}
            pending={setRunOn.isPending}
            className={cn(poolRefused && runOnRows.on === "site" && "max-w-48")}
          />
        )}
        {!runOnRows && costText && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn("shrink-0 text-[12px] font-medium text-muted-foreground tabular-nums", poolRefused && !ownKeyHere && "min-w-0 shrink truncate max-sm:hidden")}
                data-pool-refused={(poolRefused && !ownKeyHere) || undefined}
                data-key-price={ownKeyHere || undefined}
              >
                <span className="sm:hidden">{exactPrice ? fly.compactPrice : ownKeyHere ? runOnText : poolPrice ? costText : keyOnly && cost == null ? ownSetupShort(keyOnly) : costLabel({ demo, cost: cost ?? freeHere, compact: true, unknown: loraPriceUnknown, gpu: gpuRun }, formatCost)}</span>
                <span className="hidden sm:inline">
                  {ownGpuHere || ownKeyHere ? runOnText : costText}
                  {payerText}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-72">
              {ownGpuHere
                ? "This one runs on your own GPU."
                : ownKeyHere
                ? keyTip
                : poolPrice
                ? poolState?.refused
                  ? (poolState.sub ?? poolState.text)
                  : [hostedQuote?.sub ?? `Runs on ${sitePlace.text}`, poolState?.wait].filter(Boolean).join(" · ")
                : demo
                ? "Placeholder results are on (Settings), so outputs are free stand-ins"
                : keyOnly && cost == null
                  ? ownSetupDetail(keyOnly)
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
              disabled={create.isPending || signature.lock.isPending || (poolRefused && !poolSetup)}
              aria-label={blocker ? `Generate — ${blocker.message}` : ownKeyHere ? `Generate — ${runOnText}` : poolRefused && poolState ? `Generate — ${poolState.text}` : "Generate"}
              aria-busy={create.isPending || signature.lock.isPending || undefined}
              // Blocked, it stays the brand colour (paler, the arrow still 3:1 or more): pressing it still says what's missing and points at it.
              className={cn("size-10 shrink-0 rounded-full", blocker && "bg-primary/70 hover:bg-primary/80")}
            >
              {create.isPending || signature.lock.isPending ? (
                // A quick send keeps its arrow; a wait of more than a moment hands over to the spinner.
                <span className="grid place-items-center">
                  <ArrowUp className="motion-hand-off col-start-1 row-start-1 size-4" />
                  <Loader2 className="motion-spinner col-start-1 row-start-1 size-4" />
                </span>
              ) : (
                <ArrowUp className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {blocker?.message ?? (
              <span className="flex items-center gap-1.5">
                Generate <Kbd>↵</Kbd>
                {pressCost && <span className="text-muted-foreground tabular-nums">· {pressCost}</span>}
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
        {/* Folded (docked, not focused), the composer stays one line: the wait shows again once it opens. */}
        {!blocker && !gpuSetup && !ownKeyHere && poolState && (poolState.refused || !collapsed) && <PoolNote state={poolState} offer={waitOffer} alt={withoutLoras} />}
        {!blocker && turnedDown && (
          <p data-key-turned-down className="flex flex-wrap items-center gap-x-2 px-2 text-[12px] text-muted-foreground">
            <span>{keyTurnedDownWords(turnedDown.provider)}</span>
            {siteAgain && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                disabled={create.isPending}
                onClick={() => create.mutate(siteRunRequest(turnedDown.run, siteAgain), { onError: (e) => toastError(e) })}
                className="inline-flex min-h-6 items-center font-medium text-brand-text underline-offset-2 hover:underline"
              >
                Run on {sitePlace.label}
              </button>
            )}
          </p>
        )}
        {!blocker && priceNote && !poolRefused && (
          <p data-price-note className="px-2 text-[12px] font-medium text-foreground">
            {priceNote}
          </p>
        )}
        {/* Files missing on the viewer's GPU: the preset card's readiness line (the file, Get it, Check again), which stays
            once the card is gone. It never changes what Generate does. */}
        {!blocker && gpuSetup && gpuRef && (gpuSetup[0] === "a" || gpuSetup[0] === "s") ? (
          <GpuReadinessLine badge={gpuSetup} gpuRef={gpuRef} name={presetGpu ? preset?.name : model?.name} className="mx-1" />
        ) : !blocker && gpuSetup && (
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
      {gpuDown && (
        <div role="note" aria-live="polite" className="mx-1 mt-2 space-y-1.5 rounded-xl border border-dashed px-3 py-2 text-[12px] leading-snug text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">{gpuDown.words}</span> {beforeRunTail(gpuDown.waits)}
          </p>
          <TroubleDetails details={gpuDown.details} />
          <TroubleActions actions={gpuDown.actions} skip={["retry"]} handlers={{ onRunWithKey, onRunOnSite }} />
        </div>
      )}
      {/* Once, for an account whose runs moved to this studio's GPUs when hosted runs went on. */}
      <PlaceIntro run="Generate" onKeep={(r) => r === "key" && engine !== "cloud" && setEngine("cloud")} />
      {/* An item that runs on an own GPU, for an account whose key runs its cloud version: one run on the key, at its price. */}
      {keyChoice && poolSetup && keyTwin && keyPrice && (
        <div role="note" aria-live="polite" className="mx-1 mt-2 space-y-1.5 rounded-xl border border-dashed px-3 py-2 text-[12px] leading-snug text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">This one runs on your own GPU.</span>{" "}
            {"vramGb" in poolSetup && poolSetup.vramGb ? `It needs a GPU with ${poolSetup.vramGb} GB of memory. ` : ""}
            Your {CLOUD_KEY[keyTwin.provider].label} key runs its cloud version.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <TroubleActions actions={[withKeyAction(keyTwin.provider, keyTwin.modelId, keyTwin.op, keyPrice)]} handlers={{ onRunWithKey }} />
            <button
              type="button"
              onClick={() => (setKeyChoice(false), window.dispatchEvent(new Event(CONNECT_GPU_EVENT)))}
              className="inline-flex h-7 w-fit items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent"
            >
              Connect your GPU
            </button>
          </div>
        </div>
      )}
      {routeChoice && routeCheck && (
        <div role="note" aria-live="polite" data-route-notice className="mx-1 mt-2 space-y-1.5 rounded-xl border border-dashed px-3 py-2 text-[12px] leading-snug text-muted-foreground">
          <p className="font-medium text-foreground">{routeCheck.words}</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={runAnyway}
              disabled={create.isPending}
              className="inline-flex h-7 w-fit items-center rounded-full bg-highlight px-2.5 text-[12px] font-medium text-highlight-foreground hover:opacity-90 disabled:opacity-70"
            >
              Run anyway
            </button>
            {routeCheck.instead && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => submitRef.current(undefined, undefined, undefined, undefined, { prefer: routeCheck.instead })}
                disabled={create.isPending}
                className="inline-flex h-7 w-fit items-center rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent disabled:opacity-70"
              >
                Use {CLOUD_KEY[routeCheck.instead].label}
              </button>
            )}
          </div>
        </div>
      )}
      {isolatedHere && !gpuDown && (
        <div role="note" className="mx-1 mt-2 space-y-1.5 rounded-xl border border-dashed px-3 py-2 text-[12px] leading-snug text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">{ISOLATED_ON_GPU_WHY}</span>{" "}
            {isolatedTwin ? "Run it with your key instead, or pick another model." : "Pick another model to run it now."}
          </p>
          <TroubleActions
            actions={[...(isolatedTwin ? [withKeyAction(isolatedTwin.provider, isolatedTwin.modelId, isolatedTwin.op)] : []), { kind: "pick-model", label: "Pick another model" }]}
            handlers={{ onRunWithKey: runOnceWithKey, onPickModel: openModelPicker }}
          />
        </div>
      )}
      {emptyPayer && model && (
        <div role="note" className="mx-1 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-dashed px-3 py-2 text-[12px] leading-snug text-muted-foreground">
          <p className="min-w-0 flex-1 basis-56">Your {CLOUD_KEY[emptyPayer].label} balance is empty. Add credit there, then run.</p>
          <TroubleActions actions={[{ kind: "add-credit", label: `Add credit on ${CLOUD_KEY[emptyPayer].label}`, target: BILLING_URL[emptyPayer] }]} />
        </div>
      )}
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
              <Link
                href={alternativeHref}
                // While hosted runs are on, it opens there on Cloud for that page only: the switch the studios start on stays.
                onClick={() => (viewerInfo?.hosted ? engineForNextPage("cloud") : setEngine("cloud"))}
                className="font-medium text-brand-text underline-offset-2 hover:underline"
              >
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
      {smallGpuNote && <p className="px-2 pt-1 text-[12px] text-muted-foreground">{smallGpuNote}</p>}
      {model && !framesOn && <EndFrameNote model={model} start={draft.slots.image} end={draft.slots.endImage} hasStartSlot={slots.some((s) => s.key === "image")} setSlot={setSlot} />}
      {model && op && model.options.endFrame === undefined && draft.slots.endImage?.ref && (
        <p className="px-2 pt-1 text-[12px] text-warning">{model.name} ignores the end frame — pick Kling 2.5, Veo 3.1, Seedance or Wan 2.2 to use it.</p>
      )}
    </div>
  );
}

export { buildRequest } from "./build-request";
