/**
 * Character Swap Studio's jobs on each engine (src/lib/catalog/swap-studio.ts holds the project document). Every job
 * is ordinary generations planned as PlanSteps for createPipeline: the 24 fps copy of a clip, its transcript, a mask,
 * a scene anchor, one segment's take, and the assembled clip. Pure, shared by the server and the tests.
 *
 * Your GPU (ComfyUI): Fuobe's fit graph makes the 24 fps copy (VHS, constant memory), Qwen3-ASR transcribes, H3 Relay
 * 2.0's SAM 3.1 chain makes masks (points on any frame, Update frame or Track shot spliced into the version they
 * correct), Qwen-Image-Edit 2511 makes anchors, and each segment is one H3 Relay pass with the approved mask, its
 * anchor and the previous take's lossless (FFV1) master as history; the assembly fits every piece to the clip's size
 * at 24 fps, joins them packet by packet and puts the clip's sound back.
 * The cloud (fal): the clip stays as filmed (a browser copy is made when the page can't play it), Scribe v2 transcribes,
 * SAM 3.1 video marks the person from your words or clicks, GPT Image 2.5 Sunburst or Nano Banana Pro make anchors, and
 * each segment is fal's MiniMax H3 reference-to-video with Akatz Labs' swap LoRA, trimmed to the segment — no mask (who
 * to swap is said in words) and no history (a continuing segment starts from the previous take's last frame); the
 * assembly scales every piece to one frame and joins them at 24 fps.
 */
import { anchorAspect, anchorModel, anchorPrompt, h3Canvas, swapLoraRef } from "./character-swap";
import { CLOUD_TIERS, SHARPEN_COPY, sharpenPrompt, sharpenSteps, type SharpenTier } from "./sharpen";
import { MASK_TRACKER } from "./remove-object";
import type { PlanStep } from "./shorts";
import {
  approvedMask,
  at,
  cloudFilmSize,
  enginePrompt,
  frameWindow,
  normalizedSize,
  qualityFor,
  SWAP_STUDIO,
  type AssemblyPiece,
  type MaskVersion,
  type SwapClip,
  type SwapProject,
  type SwapSegment,
  type SwapShot,
  type SwapTake,
  type WhoToSwap,
} from "./swap-studio";
import { silenceRef } from "./canvas";
import { getModel } from "./index";
import type { ChainSlot, Engine, GenerationRequest, PixelPoint } from "./types";

/** The models each job runs on. */
export const STUDIO_MODELS = {
  open: {
    normalize: "oss-fit-clip",
    transcribe: "oss-qwen3-asr",
    mask: "oss-h3-person-mask",
    frame: "oss-extract-frame",
    swap: "oss-h3-swap-segment",
    fit: "oss-fit-clip",
    join: "oss-join-encoded",
    mux: "oss-mux",
    joinMax: 100,
  },
  cloud: {
    transcribe: "scribe-v2",
    mask: MASK_TRACKER,
    cut: "trim-video",
    frame: "extract-frame",
    swap: "fuobe-character-swap",
    scale: "scale-video",
    join: "join-clips",
    mux: "merge-audio-video",
    joinMax: 24,
  },
} as const;

/** The ComfyUI workflows the studio adds (H3 Relay 2.0 nodes). */
export const STUDIO_WORKFLOWS = { mask: "video-mask-h3-relay", segment: "video-character-swap-h3-segment" } as const;

const helper = (title: string) => ({ feature: SWAP_STUDIO.stepFeature, batchTitle: title });

/** The clip a job reads: your GPU's 24 fps copy, else the upload. */
export const workingClip = (clip: SwapClip, engine: Engine) => (engine === "open" ? (clip.normalized?.url ?? clip.source.url) : clip.source.url);

// ---------------------------------------------------------------------------
// Import: the 24 fps copy (your GPU)

/** Your GPU: the clip at 24 fps, at its own size (even, at most 2048 px), its sound kept. The cloud keeps the clip as filmed. */
export function planNormalize(clip: SwapClip): PlanStep[] {
  const size = normalizedSize(clip.source.width, clip.source.height);
  return [
    {
      key: "normalize",
      request: {
        ...helper(`Character Swap · ${clip.name}`),
        title: `${clip.name} · 24 fps`,
        modelId: STUDIO_MODELS.open.normalize,
        op: "trim",
        inputs: { video: clip.source.url },
        params: { startTime: 0, fps: SWAP_STUDIO.fps, ...(size ? { extra: { ...size } } : { aspectRatio: "auto" }) },
        step: { label: "The clip at 24 fps", index: 0, of: 1 },
      },
    },
  ];
}

/**
 * The cloud: a copy of the clip the browser can play (fal's scale-video re-encodes it as an H.264 MP4 at its own
 * size), for the page alone — the cloud's jobs read the upload as filmed. Null when the clip's size is unknown.
 */
export function planPreview(clip: SwapClip): PlanStep[] | null {
  const size = normalizedSize(clip.source.width, clip.source.height);
  if (!size) return null;
  return [
    {
      key: "preview",
      request: {
        ...helper(`Character Swap · ${clip.name}`),
        title: `${clip.name} · browser copy`,
        modelId: STUDIO_MODELS.cloud.scale,
        op: "reframe",
        inputs: { video: clip.source.url },
        params: { extra: { ...size } },
        step: { label: "A copy your browser can play", index: 0, of: 1 },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Transcript

export function planTranscribe(clip: SwapClip, engine: Engine): PlanStep[] {
  const s = clip.source.duration;
  return [
    {
      key: "transcribe",
      request: {
        ...helper(`Character Swap · ${clip.name}`),
        title: `${clip.name} · words`,
        modelId: STUDIO_MODELS[engine].transcribe,
        op: "transcribe",
        inputs: { video: workingClip(clip, engine) },
        params: { duration: s, sourceDuration: s },
        step: { label: "The clip's words", index: 0, of: 1 },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Masks

export interface MaskPlanInput {
  engine: Engine;
  clip: SwapClip;
  shot: SwapShot;
  kind: MaskVersion["kind"];
  /** The shot's frame the points are on (0 = its first). */
  frame: number;
  points: PixelPoint[];
  who: WhoToSwap;
  /** The version it corrects (your GPU splices into its mask). */
  base: MaskVersion | null;
}

/**
 * What a mask job sends SAM 3.1 to point at someone: your GPU's graph takes clicks as JSON pixel points on H3's
 * prepared frame (the provider moves them into its canvas) and the selection; fal's SAM 3.1 takes `point_prompts`
 * ({x, y, label 1 | 0}) on the first frame of the clip it gets, so its clip starts on the clicked frame.
 */
export function maskPointsPayload(engine: Engine, points: PixelPoint[], who: WhoToSwap): { points?: PixelPoint[]; prompt?: string; selection?: string; subjectIndex?: number } {
  const clicked = points.slice(0, SWAP_STUDIO.maxPoints);
  if (engine === "cloud") return clicked.length ? { points: clicked } : { prompt: who.words.trim() || "person" };
  // SAM3_Detect puts the clicked person first among its detections: take that one.
  return clicked.length ? { points: clicked, prompt: who.words.trim() || "person", selection: "index", subjectIndex: 0 } : { prompt: who.words.trim() || "person", selection: who.selection, subjectIndex: who.selection === "index" ? who.index : 0 };
}

/**
 * The clip's frames [from, to) a cloud mask job reads, and where the shot's frame is in them (`offset`). Track shot:
 * from the frame to the shot's end. Update frame: half a second (a one-frame cut is too short to trim and track) from
 * the frame — past the shot's end if need be, it is the clicked frame that counts — or, in the clip's last half
 * second, its last 12 frames with the clicks on the frame inside them.
 */
export function cloudMaskCut(clip: Pick<SwapClip, "frames">, shot: Pick<SwapShot, "start" | "end">, kind: MaskVersion["kind"], frame: number): { from: number; to: number; offset: number } {
  const at0 = shot.start + frame;
  if (kind === "track") return { from: at0, to: shot.end, offset: 0 };
  const span = Math.min(12, clip.frames);
  const from = Math.max(0, Math.min(at0, clip.frames - span));
  return { from, to: from + span, offset: at0 - from };
}

export function planMask(m: MaskPlanInput): PlanStep[] {
  const { clip, shot } = m;
  const len = shot.end - shot.start;
  const title = `Character Swap · ${clip.name} · shot mask`;
  const payload = maskPointsPayload(m.engine, m.points, m.who);
  const label = m.kind === "frame" ? `Mask · frame ${m.frame + 1}` : m.frame ? `Mask · from frame ${m.frame + 1}` : "Mask · the shot";
  if (m.engine === "open") {
    const span = m.kind === "frame" ? 1 : len - m.frame;
    const prev = m.base?.pieces[0]?.url;
    return [
      {
        key: "mask",
        request: {
          ...helper(title),
          title: label,
          modelId: STUDIO_MODELS.open.mask,
          op: "bg-remove-video",
          prompt: payload.prompt,
          inputs: { video: workingClip(clip, "open") },
          params: {
            ...frameWindow(shot.start, shot.end),
            resolution: qualityFor(shot.settings.renderMp),
            matteOutput: "matte",
            ...(payload.points ? { points: payload.points } : {}),
            extra: {
              selection: payload.selection,
              subjectIndex: payload.subjectIndex,
              maskPrompt: payload.prompt,
              keyFrame: m.frame,
              spanFrames: span,
              shotFrames: len,
              ...(prev && (m.frame > 0 || span < len) ? { prevMask: prev } : {}),
            },
          },
          step: { label, index: 0, of: 1 },
        },
      },
    ];
  }
  const cut = cloudMaskCut(clip, shot, m.kind, m.frame);
  // The clicks go on the clicked frame of the cut (fal's frame_index when it isn't the first).
  const points = payload.points?.map((p) => (cut.offset ? { ...p, frame: cut.offset } : p));
  return [
    { key: "cut", request: { ...helper(title), modelId: STUDIO_MODELS.cloud.cut, op: "trim", inputs: { video: clip.source.url }, params: { startTime: at(cut.from), endTime: at(cut.to) }, step: { label: "Cut from the frame", index: 0, of: 2 } } },
    {
      key: "mask",
      request: {
        ...helper(title),
        title: label,
        modelId: STUDIO_MODELS.cloud.mask,
        op: "bg-remove-video",
        ...(payload.prompt ? { prompt: payload.prompt } : {}),
        params: { matteOutput: "matte", duration: at(cut.to - cut.from), ...(points ? { points } : {}) },
        step: { label, index: 1, of: 2 },
      },
      after: ["cut"],
      chain: [{ slot: "video" }],
    },
  ];
}

// ---------------------------------------------------------------------------
// Anchors

export interface AnchorPlanInput {
  engine: Engine;
  project: Pick<SwapProject, "character">;
  clip: SwapClip;
  shot: SwapShot;
  /** The frame of the clip the anchor edits (the shot's or a segment's first). */
  frame: number;
  /** The image model (the engine's first by default). */
  modelId?: string;
  seed?: number;
}

/** The anchor edit's words: your own base prompt, else Akatz Labs' brief (or Openjutsu's without a description), plus your instructions. */
export function anchorWords(project: Pick<SwapProject, "character">, shot: SwapShot): string {
  const base = shot.anchorBasePrompt.trim() || anchorPrompt({ who: shot.who.selection, index: shot.who.index, subject: shot.who.words, description: project.character.description.slice(0, 500) });
  const extra = shot.anchorInstructions.trim();
  return (extra ? `${base}\n\n${extra}` : base).slice(0, SWAP_STUDIO.maxPromptChars);
}

export function planAnchor(a: AnchorPlanInput): PlanStep[] {
  if (!a.project.character.image) throw new Error("Add a picture of your character first");
  const am = anchorModel(a.engine, a.modelId);
  const title = `Character Swap · ${a.clip.name} · anchor`;
  const t = at(a.frame);
  // The first frame keeps the clip's shape ("auto", or the nearest ratio the model lists): the models' default is square.
  const aspect = anchorAspect(getModel(am.id)?.options.aspectRatios, a.clip.source);
  const edit = (after: string): PlanStep => ({
    key: "anchor",
    request: {
      ...helper(title),
      title: `Anchor · ${am.label}`,
      modelId: am.id,
      op: "edit",
      prompt: anchorWords(a.project, a.shot),
      inputs: { images: [a.project.character.image!] },
      params: { ...(aspect ? { aspectRatio: aspect } : {}), ...(am.extra ? { extra: { ...am.extra } } : {}), ...(a.seed !== undefined ? { seed: a.seed } : {}) },
      step: { label: `Your character in the frame (${am.label})`, index: 1, of: 2 },
    },
    after: [after],
    chain: [{ slot: "images", position: "first" }],
  });
  if (a.engine === "open") {
    return [
      { key: "frame", request: { ...helper(title), modelId: STUDIO_MODELS.open.frame, op: "frame", inputs: { video: workingClip(a.clip, "open") }, params: { ...frameWindow(a.frame, a.frame + 12), extra: { frameIndex: 0 } }, step: { label: "The frame", index: 0, of: 2 } } },
      edit("frame"),
    ];
  }
  return [
    { key: "cut", request: { ...helper(title), modelId: STUDIO_MODELS.cloud.cut, op: "trim", inputs: { video: a.clip.source.url }, params: { startTime: t, endTime: Math.min(a.clip.source.duration, t + 1) }, step: { label: "Cut at the frame", index: 0, of: 3 } } },
    { key: "frame", request: { ...helper(title), modelId: STUDIO_MODELS.cloud.frame, op: "frame", params: { extra: { frame_type: "first" } }, step: { label: "The frame", index: 1, of: 3 } }, after: ["cut"], chain: [{ slot: "video" }] },
    edit("frame"),
  ];
}

// ---------------------------------------------------------------------------
// A segment's take

export interface SegmentPlanInput {
  engine: Engine;
  project: SwapProject;
  clip: SwapClip;
  shot: SwapShot;
  seg: SwapSegment;
  /** 1-based, for labels. */
  shotNumber: number;
  segNumber: number;
  takeNumber: number;
  /** segmentPrompt(...) in H3's tags; the plan puts it in the engine's words. */
  prompt: string;
  history: number;
  anchor: string | null;
  /** Your GPU: the approved mask (a whole-shot mask video) when masked generation is on. */
  mask?: string | null;
  /** Your GPU: the previous take's lossless master and its frame count; the cloud: its video (the last frame starts this one). */
  previous?: { master?: string; video?: string; frames: number } | null;
  /** Your GPU: how many of this take's last frames its master keeps (masterKeep; all of them when unset). */
  keep?: number;
  /** The cloud: a size fal makes from a 768P base (2K, 4K) instead of the shot's own (Sharpen's new version). */
  resolution?: "2K" | "4K";
}

/** H3's whole seconds for a cloud call (5–15). */
export const cloudCallSeconds = (frames: number) => Math.min(15, Math.max(5, Math.ceil(frames / SWAP_STUDIO.fps - 1e-6)));

/**
 * One take of a segment. Your GPU: one H3 Relay pass over the segment's frames (and the `history` frames before it,
 * which the previous take's master replaces), with the approved mask, the anchor as <Picture 2> (or <Picture 3> after
 * the boundary) and a lossless master saved for the next segment. The cloud: the segment cut from the clip, then fal's
 * H3 with the swap LoRA (the character, the anchor and the previous take's last frame as pictures).
 */
export function planSegmentTake(p: SegmentPlanInput): { steps: PlanStep[]; final: string } {
  const { shot, seg, clip, project } = p;
  if (!project.character.image) throw new Error("Add a picture of your character first");
  const title = `Character Swap · ${clip.name}`;
  const label = `Shot ${p.shotNumber} · segment ${p.segNumber} · take ${p.takeNumber}`;
  const quality = qualityFor(shot.settings.renderMp);
  const frames = seg.end - seg.start;
  if (p.engine === "open") {
    const h = p.history;
    if (h && !p.previous?.master) throw new Error(`${label} continues from the segment before it, which has no lossless master`);
    const first = shot.start + seg.start - h;
    const mask = shot.settings.useMask ? (p.mask ?? null) : null;
    const keep = Math.max(1, Math.min(frames, p.keep ?? frames));
    return {
      final: "swap",
      steps: [
        {
          key: "swap",
          request: {
            ...helper(title),
            title: label,
            modelId: STUDIO_MODELS.open.swap,
            op: "video-swap",
            prompt: enginePrompt(p.prompt, "open", shot.who),
            inputs: { video: workingClip(clip, "open"), images: [project.character.image, ...(p.anchor ? [p.anchor] : [])] },
            params: {
              ...frameWindow(first, shot.start + seg.end),
              resolution: quality,
              seed: seg.seed,
              extra: {
                selection: shot.who.selection,
                subjectIndex: shot.who.selection === "index" ? shot.who.index : 0,
                maskPrompt: shot.who.words.trim() || "person",
                maskGrow: shot.settings.expansion,
                ...(shot.settings.lora !== "v1.5" ? { lora: shot.settings.lora } : {}),
                ...(shot.settings.useMask ? {} : { useMask: false }),
                // The mask video covers the shot from its first frame: the same window, counted from the shot.
                ...(mask ? { maskVideo: mask, maskStart: frameWindow(seg.start - h, seg.end).startTime } : {}),
                ...(h ? { historyVideo: p.previous!.master, historyStart: p.previous!.frames - h, historyLength: h } : {}),
                ...(h && p.anchor ? { anchorAfterHistory: true } : {}),
                // The master keeps the segment's last `keep` frames (what the next segment reads as history).
                masterKeep: keep,
                segmentFrames: frames,
              },
            },
            step: { label, index: 0, of: 1 },
          },
        },
      ],
    };
  }
  // The cloud: fal's H3 takes 2–15 s of reference video and makes whole seconds (at least 5), so its video is cut back
  // to the segment: the next segment's boundary is this one's last frame, and the assembly lines it up with the sound.
  const from = shot.start + seg.start;
  const boundary = p.history > 0 && !!p.previous?.video;
  const of = boundary ? 4 : 3;
  const steps: PlanStep[] = [
    { key: "cut", request: { ...helper(title), modelId: STUDIO_MODELS.cloud.cut, op: "trim", inputs: { video: clip.source.url }, params: { startTime: at(from), endTime: at(shot.start + seg.end) }, step: { label: `${label} · cut`, index: 0, of } } },
  ];
  const after = ["cut"];
  const chain: ChainSlot[] = [{ slot: "video" }];
  if (boundary) {
    steps.push({
      key: "boundary",
      request: { ...helper(title), modelId: STUDIO_MODELS.cloud.frame, op: "frame", inputs: { video: p.previous!.video! }, params: { extra: { frame_type: "last" } }, step: { label: `${label} · the previous take's last frame`, index: 1, of } },
    });
    after.push("boundary");
    chain.push({ slot: "images", position: "last" });
  }
  const text = enginePrompt(p.prompt, "cloud", shot.who, { swapPictures: boundary && !!p.anchor });
  const size = p.resolution ? ` at ${p.resolution}` : "";
  steps.push({
    key: "swap",
    request: {
      ...helper(title),
      title: label,
      modelId: STUDIO_MODELS.cloud.swap,
      op: "video-swap",
      prompt: text,
      inputs: { images: [project.character.image, ...(p.anchor ? [p.anchor] : [])] },
      loras: [swapLoraRef(shot.settings.lora === "v1" ? "v1" : "v1.5")],
      params: { duration: cloudCallSeconds(frames), sourceDuration: at(frames), resolution: p.resolution ?? quality, seed: seg.seed },
      step: { label: `${label} · swap${size}`, index: of - 2, of },
    },
    after,
    chain,
  });
  steps.push({
    key: "fit",
    request: { ...helper(title), title: label, modelId: STUDIO_MODELS.cloud.cut, op: "trim", params: { startTime: 0, endTime: at(frames) }, step: { label, index: of - 1, of } },
    after: ["swap"],
    chain: [{ slot: "video" }],
  });
  return { steps, final: "fit" };
}

/**
 * A queued take's steps from what it was queued with (take.frozen): the shot's frames, settings, who to swap, anchor,
 * mask, history, prompt and seed as they were, and the previous take it continues from as it came out.
 */
export function frozenTakePlan(
  project: SwapProject,
  clip: SwapClip,
  shot: SwapShot,
  seg: SwapSegment,
  take: SwapTake,
  numbers: { shot: number; segment: number; take: number },
  previous: SegmentPlanInput["previous"],
  resolution?: SegmentPlanInput["resolution"],
): { steps: PlanStep[]; final: string } {
  const f = take.frozen;
  if (!f) throw new Error("This take wasn't queued from the studio — queue the segment again");
  return planSegmentTake({
    engine: take.engine,
    project: { ...project, character: { ...project.character, image: f.reference } },
    clip,
    shot: { ...shot, start: f.shotStart, settings: f.settings, who: f.who },
    seg: { ...seg, start: f.start, end: f.end, seed: take.seed },
    shotNumber: numbers.shot,
    segNumber: numbers.segment,
    takeNumber: numbers.take,
    prompt: take.prompt,
    history: f.history,
    anchor: f.anchor,
    mask: f.mask,
    previous,
    ...(f.keep !== undefined ? { keep: f.keep } : {}),
    ...(resolution ? { resolution } : {}),
  });
}

// ---------------------------------------------------------------------------
// Assemble → Finish → Sharpen (sharpen.ts)

export interface FinishPlanInput {
  project: SwapProject;
  clip: SwapClip;
  shot: SwapShot;
  seg: SwapSegment;
  take: SwapTake;
  numbers: { shot: number; segment: number; take: number };
  /** The size made (sharpenTierFor: never above the film on your GPU; 2K or 4K on the cloud). */
  tier: SharpenTier;
  /** Your GPU: the take's video. */
  video?: string;
  /** The cloud: what the take continued from (as when it was made). */
  previous?: SegmentPlanInput["previous"];
}

/**
 * A chosen take made sharper, on the engine it was made on. Your GPU: its video regenerated at the tier (start sigma 0.8,
 * the take's words and seed) and only the character put back over the clip's 24 fps copy through the mask it was made
 * with (the shot's approved one). The cloud: the same segment made again on fal's H3 at 2K or 4K, with the words, LoRA,
 * references and seed it was queued with.
 */
export function planTakeFinish(p: FinishPlanInput): { steps: PlanStep[]; final: string } {
  const { project, clip, shot, seg, take } = p;
  const f = take.frozen;
  if (!f) throw new Error("This take wasn't queued from the studio — queue the segment again");
  const label = `Shot ${p.numbers.shot} · segment ${p.numbers.segment} · take ${p.numbers.take}`;
  if (take.engine === "cloud") {
    if (!CLOUD_TIERS.includes(p.tier)) throw new Error("The cloud makes 2K or 4K");
    return frozenTakePlan(project, clip, shot, seg, take, p.numbers, p.previous ?? null, p.tier as "2K" | "4K");
  }
  const mask = f.mask ?? approvedMask(shot, "open")?.pieces[0]?.url ?? null;
  if (!mask) throw new Error(SHARPEN_COPY.noMask);
  if (!p.video) throw new Error(`${label} has no video yet`);
  const film = normalizedSize(clip.source.width, clip.source.height);
  if (!film) throw new Error(SHARPEN_COPY.noSize);
  const title = `Character Swap · ${clip.name}`;
  return sharpenSteps({
    key: "",
    label,
    helper: helper(title),
    result: { ...helper(title), title: `${label} · ${p.tier}` },
    tier: p.tier,
    prompt: sharpenPrompt(take.prompt, project.character.description),
    seed: take.seed,
    frames: f.end - f.start,
    take: { url: p.video },
    source: { url: workingClip(clip, "open"), start: at(f.shotStart + f.start) },
    // The mask covers the shot from its first frame.
    mask: { url: mask, start: at(f.start) },
    film,
    canvas: h3Canvas(film.width, film.height, qualityFor(f.settings.renderMp)),
  });
}

// ---------------------------------------------------------------------------
// Assembly

export interface AssemblyPlanInput {
  engine: Engine;
  clip: SwapClip;
  pieces: AssemblyPiece[];
  /** Each take's finished video. */
  videoOf: (piece: Extract<AssemblyPiece, { kind: "take" }>) => string;
}

/** Fold `keys` into joins of at most `max` (the last join is "join"). */
function joins(steps: PlanStep[], keys: string[], max: number, request: (n: number, last: boolean) => GenerationRequest): string {
  let level = keys;
  let depth = 0;
  while (level.length > 1) {
    const groups: string[][] = [];
    for (let i = 0; i < level.length; i += max) groups.push(level.slice(i, i + max));
    const last = groups.length === 1;
    level = groups.map((g, gi) => {
      const key = last ? "join" : `join-${depth}-${gi}`;
      steps.push({ key, request: request(g.length, last), after: g, chain: g.map(() => ({ slot: "videos" as const })) });
      return key;
    });
    depth++;
  }
  return level[0];
}

/**
 * The clip with every swapped shot's chosen takes over the original timeline and the clip's own sound; kept shots
 * stay as filmed. Your GPU: each piece fitted to the clip's size at 24 fps (Fuobe's fit graph), joined packet by
 * packet, the clip's sound put back. The cloud: the clip's pieces cut (a take is already its segment's length), every
 * piece scaled to one frame (cloudFilmSize: H3 makes 480p / 768p, the clip is as filmed), joined at 24 fps, the clip's
 * sound (or its silence) put back.
 */
export function planAssembly(a: AssemblyPlanInput): { steps: PlanStep[]; final: string } {
  const { clip } = a;
  const title = `${clip.name} · character swap`;
  const base = { feature: SWAP_STUDIO.feature, batchTitle: title, title };
  const total = a.pieces.length;
  const steps: PlanStep[] = [];
  const keys: string[] = [];
  const size = normalizedSize(clip.source.width, clip.source.height);
  const film = cloudFilmSize(clip.source.width, clip.source.height);
  a.pieces.forEach((piece, i) => {
    const key = `piece${i}`;
    const what = piece.kind === "source" ? "kept as filmed" : "your character";
    const label = { label: `Part ${i + 1} of ${total} · ${what}`, index: i, of: total };
    // Exact frame times: the fit graph counts round(seconds × 24) frames from them.
    const len = at(piece.end - piece.start);
    const video = piece.kind === "source" ? workingClip(clip, a.engine) : a.videoOf(piece);
    const start = piece.kind === "source" ? at(piece.start) : 0;
    if (a.engine === "open") {
      steps.push({
        key,
        request: { ...helper(title), modelId: STUDIO_MODELS.open.fit, op: "trim", inputs: { video }, params: { startTime: start, endTime: start + len, fps: SWAP_STUDIO.fps, ...(size ? { extra: { ...size } } : { aspectRatio: "auto" }) }, step: label },
      });
    } else {
      const cut = piece.kind === "source";
      if (cut) steps.push({ key: film ? `${key}-cut` : key, request: { ...helper(title), modelId: STUDIO_MODELS.cloud.cut, op: "trim", inputs: { video }, params: { startTime: start, endTime: start + len }, step: label } });
      if (film) {
        steps.push({
          key,
          request: { ...helper(title), modelId: STUDIO_MODELS.cloud.scale, op: "reframe", ...(cut ? {} : { inputs: { video } }), params: { extra: { ...film } }, step: { ...label, label: `${label.label} · to ${film.width}×${film.height}` } },
          ...(cut ? { after: [`${key}-cut`], chain: [{ slot: "video" as const }] } : {}),
        });
      } else if (!cut) {
        // The clip's size unknown: the take as it came out.
        steps.push({ key, request: { ...helper(title), modelId: STUDIO_MODELS.cloud.cut, op: "trim", inputs: { video }, params: { startTime: 0, endTime: len }, step: label } });
      }
    }
    keys.push(key);
  });
  const m = STUDIO_MODELS[a.engine];
  const rate = a.engine === "cloud" ? { params: { extra: { target_fps: SWAP_STUDIO.fps } } } : {};
  const picture = joins(steps, keys, m.joinMax, (_n, last) => ({ ...helper(title), modelId: m.join, op: "concat", prompt: title, ...rate, step: { label: last ? "Join the parts" : "Joining", index: 1000, of: 1000 } }));
  const sound: GenerationRequest["inputs"] = clip.source.hasAudio ? { audio: workingClip(clip, a.engine) } : a.engine === "cloud" ? { audio: silenceRef(clip.source.duration) } : undefined;
  if (!sound) {
    // Your GPU, a silent clip: the fit graph already gave every part silence; the join is the result.
    const last = steps.find((s) => s.key === picture)!;
    last.request = { ...last.request, ...base };
    return { steps, final: picture };
  }
  steps.push({
    key: "final",
    request: { ...base, modelId: m.mux, op: "mux", inputs: sound, step: { label: clip.source.hasAudio ? "Put the clip's sound back" : "Keep it silent, like the clip", index: 1200, of: 1000 } },
    after: [picture],
    chain: [{ slot: "video" }],
  });
  return { steps, final: "final" };
}
