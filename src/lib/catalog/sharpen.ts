/**
 * Character swap in 2K (docs/research/new-models-7.md §2.10 rows 4-5, §2.11): a swap comes back at H3's 768p, and
 * "Sharpen" (Character Swap Studio's Finish) or a 1080p / 2K / 4K quality (Genjutsu's Character swap) makes it sharper
 * without touching the background or the sound.
 *
 * Your GPU: the 768p swap is redrawn by Open-H3 Regenerate (video-regenerate-h3, start sigma 0.8: it stays closer to the
 * draft), at most the size the footage is kept at, in 15 s windows; then video-composite-mask puts only the character
 * back over the original footage (the swap first, then the regenerate, each through the person's mask, grown and
 * feathered), with the footage's own sound, in short composite windows joined packet by packet.
 * The cloud: nobody hosts a regenerate after the fact, so the swap is made again on fal's MiniMax H3 at 2K or 4K (the
 * same hosted model asked for a size it offers, with the same words, LoRA, references and seed): a new version beside
 * the first one, for approval. The whole frame is redrawn there.
 *
 * Pure: the tiers and what each engine makes of them, the cap at the size the film is joined at, the composite's
 * geometry, the windows, the copy, and the steps on your GPU.
 */
import { REGEN_MODEL, REGEN_WINDOW_SECONDS, RERENDER } from "./regenerate";
import type { PlanStep } from "./shorts";
import type { ChainSlot, Engine, GenerationRequest } from "./types";

export const SHARPEN_TIERS = ["1080p", "2K", "4K"] as const;
export type SharpenTier = (typeof SHARPEN_TIERS)[number];
export const isSharpenTier = (v: unknown): v is SharpenTier => typeof v === "string" && (SHARPEN_TIERS as readonly string[]).includes(v);

/** Open-H3 Regenerate's tier for each (Upscale → Video names them by the shorter edge). */
export const SHARPEN_REGEN_TIER: Record<SharpenTier, "1080p" | "1440p" | "2160p"> = { "1080p": "1080p", "2K": "1440p", "4K": "2160p" };
/** The shorter edge each tier is made at. */
export const SHARPEN_SHORT_EDGE: Record<SharpenTier, number> = { "1080p": 1080, "2K": 1440, "4K": 2160 };
/** fal's MiniMax H3 resolutions: 480P and 768P are made natively, 2K and 4K from a 768P base (no 1080P). */
export const CLOUD_TIERS: readonly SharpenTier[] = ["2K", "4K"];

/** The regenerate's start noise for a swap (rdh: 0.8 "stays closer to the draft"; the release's 0.909 can drift a face). */
export const SHARPEN_SIGMA = 0.8;
/** The start noises an evaluation may try (Close 0.7 … the release's 0.909). */
export const SHARPEN_SIGMA_RANGE = { min: 0.5, max: 0.909 } as const;
const sigmaOf = (v: number | undefined) => (v !== undefined && v >= SHARPEN_SIGMA_RANGE.min && v <= SHARPEN_SIGMA_RANGE.max ? v : SHARPEN_SIGMA);

/** fal's price per second of the LoRA route (the Character swap's), by resolution. */
export const SWAP_PER_SECOND: Record<"480P" | "768P" | "2K" | "4K", number> = { "480P": 0.0625, "768P": 0.075, ...RERENDER["fuobe-character-swap"].perSecond };

/** The mask composite (core nodes): the hidden model and its graph. */
export const COMPOSITE_MODEL = "oss-composite-mask";
export const COMPOSITE_WORKFLOW = "video-composite-mask";
/** One composite pass decodes four streams as float32 (about 25 MB a frame each at 1080p): 3 s keeps it near 12 GB. */
export const COMPOSITE_WINDOW_SECONDS = 3;
/** Both engines join the film at most this many pixels a side (the fit graph's limit; fal merge-videos' 2048). */
export const FILM_MAX = 2048;
const FPS = 24;

/** The pace the open engine's regenerate was measured at (about 3 minutes per 5 s at 2K on a 72 GB GPU). */
export const REGEN_MINUTES_PER_5S = 3;

export const SHARPEN_COPY = {
  title: "Sharpen to 1080p / 2K / 4K",
  /** Your GPU: only the character is redrawn. */
  card: "Redraws each chosen take at 2K, then puts only your character back over the original footage. The background and the sound stay as filmed. Faces can change slightly; compare before you keep it.",
  /** The cloud: a new render of the take (no regenerate is hosted). */
  cardCloud:
    "Makes each chosen take again at 2K on MiniMax H3, with the same words, references and seed, as a new version beside the first. The whole frame is redrawn, so compare before you keep it.",
  /** Genjutsu's Quality hint for a finishing size. */
  hint: "2K and 4K redraw the 768p swap at the higher size.",
  hintOpen: "1080p, 2K and 4K redraw the 768p swap at the higher size.",
  /** The version beside a take, and its switch. */
  version: (tier: string) => `${tier} version`,
  pick: (tier: string) => `Use the ${tier} version`,
  usingIt: (tier: string) => `The assembly uses the ${tier} version`,
  noMask: "Sharpen puts your character back through the shot's mask: approve a mask in Who to swap and make the take with it",
  small: "This clip is filmed below 1080p, so the 768p takes already match it",
  noSize: "Couldn't read this clip's size, so it can't be sharpened: save it as an MP4 (H.264) and add it again",
  none: "Choose a take for every swapped segment first",
} as const;

/**
 * The film's frame: the size every piece is joined at, on even numbers. Your GPU: the clip's own, at most 2048 px a side
 * (the studio's 24 fps copy, swap-studio.ts normalizedSize). The cloud: the same, and a small clip scaled up towards
 * 512 px on its short side (fal merge-videos, swap-studio.ts cloudFilmSize).
 */
export function filmSize(width?: number, height?: number, engine: Engine = "open"): { width: number; height: number } | null {
  if (!width || !height) return null;
  if (engine === "cloud") {
    const scale = Math.min(FILM_MAX / Math.max(width, height), Math.max(1, 512 / Math.min(width, height)));
    const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
    return { width: even(width), height: even(height) };
  }
  const k = Math.min(1, FILM_MAX / width, FILM_MAX / height);
  const even = (n: number) => Math.max(2, Math.floor((n * k) / 2) * 2);
  return { width: even(width), height: even(height) };
}

export interface SharpenOption {
  tier: SharpenTier;
  available: boolean;
  /** Why it can't be picked, in words. */
  reason?: string;
}

const sizeWords = (f: { width: number; height: number }) => `${f.width}×${f.height}`;

/**
 * What each tier does for a film of this size on an engine. The film is joined at most 2048 px a side, so a tier larger
 * than the film's shorter edge adds nothing: your GPU offers the tiers that fit (never above the footage), the cloud
 * offers what fal makes (2K, 4K) where the join keeps it.
 */
export function sharpenOptions(engine: Engine, film: { width: number; height: number } | null): SharpenOption[] {
  const short = film ? Math.min(film.width, film.height) : 0;
  return SHARPEN_TIERS.map((tier) => {
    if (engine === "cloud" && !CLOUD_TIERS.includes(tier)) return { tier, available: false, reason: "The cloud makes 2K or 4K" };
    if (!film) return { tier, available: engine === "cloud" && tier === "2K", ...(engine === "cloud" && tier === "2K" ? {} : { reason: SHARPEN_COPY.noSize }) };
    if (short < SHARPEN_SHORT_EDGE["1080p"]) return { tier, available: false, reason: SHARPEN_COPY.small };
    // The cloud's 2K is the smallest it makes: always worth it over 768p, joined at the film's size.
    if (engine === "cloud" && tier === "2K") return { tier, available: true };
    if (SHARPEN_SHORT_EDGE[tier] <= short) return { tier, available: true };
    return { tier, available: false, reason: `Joined at ${sizeWords(film)}, so ${tier} adds nothing to the film` };
  });
}

/** The tier made when `asked` is picked: the largest available one not above it (null: none is). */
export function sharpenTierFor(engine: Engine, asked: SharpenTier, film: { width: number; height: number } | null): SharpenTier | null {
  const ok = sharpenOptions(engine, film).filter((o) => o.available).map((o) => o.tier);
  const at = SHARPEN_TIERS.indexOf(asked);
  return [...ok].reverse().find((t) => SHARPEN_TIERS.indexOf(t) <= at) ?? null;
}

/** The tier picked first: 2K where it is available, else the largest that is. */
export function defaultSharpenTier(engine: Engine, film: { width: number; height: number } | null): SharpenTier | null {
  const ok = sharpenOptions(engine, film).filter((o) => o.available);
  return ok.find((o) => o.tier === "2K")?.tier ?? ok.at(-1)?.tier ?? null;
}

/** The join's note: what a sharper take is joined at. */
export function joinNote(film: { width: number; height: number } | null): string | null {
  return film ? `The clip is joined at ${sizeWords(film)} (up to ${FILM_MAX} px a side). Each sharper take keeps its own size in Takes & review` : null;
}

/** The cloud's price of one take made again at a size: whole seconds, 5–15 s a call (fal's H3). */
export function cloudSharpenUsd(tier: SharpenTier, seconds: number): number | null {
  if (!CLOUD_TIERS.includes(tier)) return null;
  const secs = Math.min(15, Math.max(5, Math.ceil(seconds - 1e-6)));
  return Math.round(SWAP_PER_SECOND[tier as "2K" | "4K"] * secs * 100) / 100;
}

/** Your GPU's time for seconds of swaps, in words ("about 3 min" per 5 s at 2K on a 72 GB GPU). */
export function gpuMinutes(seconds: number): string {
  const m = Math.max(1, Math.round((seconds / 5) * REGEN_MINUTES_PER_5S));
  return `about ${m} min on a 72 GB GPU`;
}

// ---------------------------------------------------------------------------
// The composite's geometry

export interface Box {
  width: number;
  height: number;
  x: number;
  y: number;
}

/** The centre part of a frame with a given shape (what a cover-and-crop to that shape keeps), on even numbers. */
function centre(frame: { width: number; height: number }, aspect: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return aspect < frame.width / frame.height ? { width: Math.min(frame.width, even(frame.height * aspect)), height: frame.height } : { width: frame.width, height: Math.min(frame.height, even(frame.width / aspect)) };
}

/** The draft shape Open-H3 Regenerate keeps of an H3 clip: 1344 × 768 (turned for a tall one). */
const DRAFT = { width: 1344, height: 768 };

/**
 * Where each layer goes in the film: the swap covers the part of the footage its canvas was cut from (H3 cover-crops the
 * clip to its canvas), the regenerate the centre of that its 16:9 or 9:16 draft kept (it stretches the draft to its
 * 16:9 grid and crops a few rows, so it is laid back over the draft's own part). Both are centred.
 */
export function compositeGeometry(film: { width: number; height: number }, canvas: { width: number; height: number }): { take: Box; region: Box } {
  const t = centre(film, canvas.width / canvas.height);
  const draft = canvas.height > canvas.width ? DRAFT.height / DRAFT.width : DRAFT.width / DRAFT.height;
  const r = centre(t, draft);
  const tx = Math.floor((film.width - t.width) / 2);
  const ty = Math.floor((film.height - t.height) / 2);
  return { take: { ...t, x: tx, y: ty }, region: { ...r, x: tx + Math.floor((t.width - r.width) / 2), y: ty + Math.floor((t.height - r.height) / 2) } };
}

/** The mask's grown and feathered edge, in the region's pixels (about 0.8 % and 1.2 % of its shorter side). */
export function maskEdge(region: { width: number; height: number }): { grow: number; feather: number } {
  const short = Math.min(region.width, region.height);
  return { grow: Math.max(2, Math.round(short * 0.008)), feather: Math.max(4, Math.round(short * 0.012)) };
}

// ---------------------------------------------------------------------------
// Windows

/** Frames split into equal windows of at most `max` frames (no sliver at the end). */
export function frameWindows(frames: number, max: number): { from: number; frames: number }[] {
  const total = Math.max(1, Math.round(frames));
  const n = Math.ceil(total / max);
  const out: { from: number; frames: number }[] = [];
  let from = 0;
  for (let i = 0; i < n; i++) {
    const to = Math.round(((i + 1) * total) / n);
    out.push({ from, frames: to - from });
    from = to;
  }
  return out;
}

const sec = (frames: number) => Math.round((frames / FPS) * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// The steps on your GPU

/** A file the step reads: a stored file, or the output of an earlier step. */
export type StepInput = { url: string } | { after: string };

export interface SharpenStepsInput {
  /** Prefix of the step keys (unique within the pipeline). */
  key: string;
  /** Words for step labels ("Shot 1 · segment 2 · take 1"). */
  label: string;
  helper: Pick<GenerationRequest, "feature" | "batchTitle">;
  /** The finished step's identity (a result of its own): feature, title. */
  result: Pick<GenerationRequest, "feature" | "batchTitle" | "title">;
  /** The tier the regenerate makes (already capped: sharpenTierFor). */
  tier: SharpenTier;
  /** What the regenerate redraws from. */
  prompt: string;
  seed?: number;
  /** The regenerate's start noise (SHARPEN_SIGMA unless an evaluation asks for another in SHARPEN_SIGMA_RANGE). */
  sigma?: number;
  /** The swap's length in frames (24 fps). */
  frames: number;
  /** The 768p swap. */
  take: StepInput;
  /** The footage at 24 fps and the film's size, and where the swap starts in it (seconds). */
  source: StepInput & { start: number };
  /** The person's mask (H3's canvas, 24 fps), and where the swap starts in it (seconds). */
  mask: StepInput & { start: number };
  film: { width: number; height: number };
  /** H3's canvas the swap and the mask were made at. */
  canvas: { width: number; height: number };
}

/** The words a regenerate redraws a swap from: the take's own, without H3's reference tags. */
export function sharpenPrompt(takePrompt: string, description?: string): string {
  const words = takePrompt
    .replace(/<Video \d+>/g, "the clip")
    .replace(/<Picture \d+>/g, "the reference")
    .replace(/\s+/g, " ")
    .trim();
  const who = (description ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  return [who ? `The character: ${who}.` : "", words].filter(Boolean).join(" ").slice(0, 1500);
}

const fill = (input: StepInput, slot: ChainSlot): { after?: string; chain?: ChainSlot; url?: string } => ("after" in input ? { after: input.after, chain: slot } : { url: input.url });

/**
 * One swap sharpened on your GPU: Open-H3 Regenerate in windows of up to 15 s, each composited over the footage in
 * windows of up to 3 s (the swap, then the regenerate, through the mask), joined packet by packet. The last step (the
 * join, or the only composite) is the result.
 */
export function sharpenSteps(s: SharpenStepsInput): { steps: PlanStep[]; final: string } {
  const steps: PlanStep[] = [];
  const geo = compositeGeometry(s.film, s.canvas);
  const edge = maskEdge(geo.region);
  const regen = frameWindows(s.frames, REGEN_WINDOW_SECONDS * FPS);
  const parts: string[] = [];
  const total = regen.reduce((n, w) => n + frameWindows(w.frames, COMPOSITE_WINDOW_SECONDS * FPS).length, 0);
  const take = fill(s.take, { slot: "video" });
  regen.forEach((w, wi) => {
    const rk = `${s.key}regen${wi}`;
    const many = regen.length > 1;
    steps.push({
      key: rk,
      request: {
        ...s.helper,
        modelId: REGEN_MODEL,
        op: "upscale-video",
        prompt: s.prompt,
        ...(take.url ? { inputs: { video: take.url } } : {}),
        params: {
          resolution: SHARPEN_REGEN_TIER[s.tier],
          ...(many ? { startTime: sec(w.from), endTime: sec(w.from + w.frames) } : {}),
          sourceDuration: sec(w.frames),
          ...(s.seed !== undefined ? { seed: s.seed } : {}),
          // An H3 draft (the 768p preset), and the start noise that keeps the swapped identity closer.
          extra: { startSigma: sigmaOf(s.sigma), draftFrom: "h3" },
        },
        step: { label: `${s.label} · redraw at ${s.tier}${many ? ` (${wi + 1} of ${regen.length})` : ""}`, index: wi, of: regen.length },
      },
      ...(take.after ? { after: [take.after], chain: [take.chain!] } : {}),
    });
    for (const c of frameWindows(w.frames, COMPOSITE_WINDOW_SECONDS * FPS)) {
      const ck = `${s.key}comp${parts.length}`;
      const from = w.from + c.from;
      const after: string[] = [rk];
      const chain: ChainSlot[] = [{ slot: "videos", at: 1 }];
      // The footage is the first clip, the regenerate the second, the swap the third; the mask is the mask.
      const src = fill(s.source, { slot: "videos", at: 0 });
      const tk = fill(s.take, { slot: "videos", at: 2 });
      const mk = fill(s.mask, { slot: "mask" });
      for (const x of [src, tk, mk]) {
        if (x.after) {
          after.push(x.after);
          chain.push(x.chain!);
        }
      }
      const own = [src.url, tk.url].filter((u): u is string => !!u);
      steps.push({
        key: ck,
        request: {
          ...s.helper,
          modelId: COMPOSITE_MODEL,
          op: "composite",
          inputs: { ...(own.length ? { videos: own } : {}), ...(mk.url ? { mask: mk.url } : {}) },
          params: {
            startTime: Math.round((s.source.start + sec(from)) * 1e6) / 1e6,
            endTime: Math.round((s.source.start + sec(from + c.frames)) * 1e6) / 1e6,
            extra: {
              windowStart: sec(c.from),
              takeStart: sec(from),
              maskStart: Math.round((s.mask.start + sec(from)) * 1e6) / 1e6,
              canvasWidth: geo.take.width,
              canvasHeight: geo.take.height,
              takeX: geo.take.x,
              takeY: geo.take.y,
              regionWidth: geo.region.width,
              regionHeight: geo.region.height,
              regionX: geo.region.x,
              regionY: geo.region.y,
              maskGrow: edge.grow,
              feather: edge.feather,
            },
          },
          step: { label: `${s.label} · your character over the footage${total > 1 ? ` (${parts.length + 1} of ${total})` : ""}`, index: parts.length, of: total },
        },
        after,
        chain,
      });
      parts.push(ck);
    }
  });
  if (parts.length === 1) {
    const last = steps.find((x) => x.key === parts[0])!;
    last.request = { ...last.request, ...s.result };
    return { steps, final: parts[0] };
  }
  const jk = `${s.key}join`;
  steps.push({
    key: jk,
    request: { ...s.helper, ...s.result, modelId: "oss-join-encoded", op: "concat", step: { label: `${s.label} · join`, index: total, of: total } },
    after: parts,
    chain: parts.map(() => ({ slot: "videos" as const })),
  });
  return { steps, final: jk };
}
